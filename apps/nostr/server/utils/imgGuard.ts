/**
 * Garde-fous du proxy d'images (`/api/img`).
 *
 * ## Pourquoi ce fichier existe
 *
 * `/api/media/:sha` ne prend qu'un sha256, donc il ne peut viser que l'hôte
 * qu'on a configuré. Les images des messages, elles, viennent d'adresses
 * quelconques : un autre client Nostr a publié l'URL qu'il voulait. Le proxy
 * doit donc accepter une URL — et une URL fournie par un inconnu qui atterrit
 * dans un `fetch` **serveur** est un SSRF si on n'en fait rien.
 *
 * D'où ces règles, appliquées avant tout appel réseau puis à **chaque** saut de
 * redirection (une 302 vers `http://169.254.169.254/` est le contournement
 * classique) :
 *
 *   - http/https seulement, ports par défaut, pas d'identifiants dans l'URL ;
 *   - toutes les adresses résolues doivent être publiques — pas de boucle
 *     locale, de réseau privé, de lien-local (donc pas de métadonnées cloud),
 *     de CGNAT ni de multicast ;
 *   - une seule adresse privée dans la réponse DNS suffit à tout refuser.
 *
 * ⚠️ Limite connue et assumée : la résolution est vérifiée puis `fetch` résout
 * de nouveau. Un DNS hostile peut répondre différemment entre les deux (DNS
 * rebinding). Fermer cette fenêtre demande de se connecter à l'IP validée en
 * forçant le `Host`, ce que `fetch` ne permet pas sans agent personnalisé. Ce
 * qui reste atteignable est un hôte **public**, avec un plafond de taille, un
 * délai et aucun en-tête d'authentification transmis.
 */
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

/** Types rendus par le navigateur. Pas de SVG : c'est un document à script. */
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

/**
 * 16 Mo. Ce n'est pas ce qu'on accepte de déposer (4 Mo, réduits par le client)
 * mais ce qu'on accepte de **relire** : les images déjà publiées sur le réseau
 * sont ce qu'elles sont, et une capture d'écran PNG non compressée dépasse
 * couramment 8 Mo. Refuser à ce seuil affichait un cadre cassé sur des images
 * parfaitement ordinaires.
 */
export const MAX_BYTES = 16 * 1024 * 1024
export const MAX_REDIRECTS = 3
export const TIMEOUT_MS = 8000

/**
 * Valide l'URL demandée. Lève avec un message lisible — il finit dans un
 * `statusMessage`, donc il s'adresse à qui débogue, pas à la machine.
 */
export function parseTarget(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('adresse illisible')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('schéma refusé')
  // Des identifiants dans l'URL ne servent qu'à faire porter une authentification
  // par notre serveur : on ne relaie pas ça.
  if (url.username || url.password) throw new Error('adresse refusée')
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('port refusé')
  if (!url.hostname) throw new Error('hôte manquant')
  return url
}

function isPublicV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = p as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 169 && b === 254) return false // lien-local : métadonnées cloud
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
  if (a === 192 && b === 0) return false // 192.0.0/24 et 192.0.2/24
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false
  if (a === 203 && b === 0) return false
  if (a >= 224) return false // multicast et réservé, jusqu'à 255.255.255.255
  return true
}

/** Développe la forme compressée en 8 groupes de 16 bits. */
function expandV6(ip: string): number[] | null {
  const [head = '', tail = ''] = ip.split('::', 2)
  const parts = ip.includes('::')
    ? [
        ...head.split(':').filter(Boolean),
        ...Array<string>(8 - head.split(':').filter(Boolean).length - tail.split(':').filter(Boolean).length).fill('0'),
        ...tail.split(':').filter(Boolean),
      ]
    : ip.split(':')
  if (parts.length !== 8) return null
  const groups = parts.map((g) => parseInt(g, 16))
  return groups.some((g) => Number.isNaN(g)) ? null : groups
}

function isPublicV6(raw: string): boolean {
  const ip = raw.toLowerCase().split('%')[0] ?? ''
  // Adresse v4 déguisée : c'est la règle v4 qui s'applique, sinon `::ffff:127.0.0.1`
  // passerait toutes les vérifications v6.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
  if (mapped) return isPublicV4(mapped[1]!)

  const g = expandV6(ip)
  if (!g) return false
  const [g0, g1] = g as [number, number, ...number[]]
  if (g.every((x) => x === 0)) return false // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false // ::1
  if ((g0 & 0xfe00) === 0xfc00) return false // ULA
  if ((g0 & 0xffc0) === 0xfe80) return false // lien-local
  if ((g0 & 0xff00) === 0xff00) return false // multicast
  if (g0 === 0x2002) return false // 6to4 : porte une v4 arbitraire
  if (g0 === 0x0064 && g1 === 0xff9b) return false // NAT64 : idem
  return true
}

export function isPublicIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isPublicV4(ip)
  if (version === 6) return isPublicV6(ip)
  return false
}

/**
 * Refuse l'hôte s'il pointe, même partiellement, ailleurs que sur l'internet
 * public. Une IP littérale est vérifiée telle quelle : il n'y a rien à résoudre.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const literal = hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal)) {
    if (!isPublicIp(literal)) throw new Error('adresse non publique')
    return
  }

  const addresses = await lookup(hostname, { all: true }).catch(() => {
    throw new Error('hôte introuvable')
  })
  if (addresses.length === 0) throw new Error('hôte introuvable')
  // TOUTES doivent être publiques : un hôte qui répond `1.2.3.4` et `127.0.0.1`
  // laisserait au hasard du tri le soin de choisir la cible.
  if (!addresses.every((a) => isPublicIp(a.address))) throw new Error('adresse non publique')
}
