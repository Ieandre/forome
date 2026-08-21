/**
 * Helpers Nostr purs — pas d'état, pas de réseau.
 */
import { neventEncode, npubEncode, decode } from 'nostr-tools/nip19'
import { getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent, TopicRow } from '~/types/nostr'
import { KIND_THREAD } from '~/types/nostr'

/* ------------------------------------------------------------------ tags */

export function tagValue(ev: NostrEvent, name: string): string | null {
  for (const t of ev.tags) if (t[0] === name && t[1]) return t[1]
  return null
}

/**
 * Racine du fil auquel appartient cet event (spec §2.3).
 * NIP-22 met la racine en tag MAJUSCULE `E` et le parent immédiat en `e`.
 * On tolère aussi le vieux style NIP-10 (`e` marqué "root") pour ne pas
 * ignorer les events des clients qui ne sont pas encore passés à NIP-22.
 */
export function rootIdOf(ev: NostrEvent): string | null {
  if (ev.kind === KIND_THREAD) return ev.id
  const upper = tagValue(ev, 'E')
  if (upper) return upper
  for (const t of ev.tags) if (t[0] === 'e' && t[3] === 'root' && t[1]) return t[1]
  for (const t of ev.tags) if (t[0] === 'e' && t[1]) return t[1]
  return null
}

/** Parent immédiat cité (tag `e` minuscule). Null si la réponse vise la racine. */
export function parentIdOf(ev: NostrEvent): string | null {
  const root = tagValue(ev, 'E')
  for (const t of ev.tags) {
    if (t[0] !== 'e' || !t[1]) continue
    if (t[3] === 'root') continue
    if (root && t[1] === root) continue
    return t[1]
  }
  return null
}

/** Titre d'un topic : tag `title`, sinon première ligne du contenu. */
export function topicTitle(ev: NostrEvent): string {
  const t = tagValue(ev, 'title') ?? tagValue(ev, 'subject')
  if (t) return t.trim()
  const first = ev.content.trim().split('\n')[0] ?? ''
  return first.length > 90 ? `${first.slice(0, 90)}…` : first || '(sans titre)'
}

/* ------------------------------------------------------------ classement */

/**
 * Ordre de la colonne de topics : **le dernier message posté remonte le topic**,
 * comme sur tout forum. Le volume ne départage que les rangées touchées dans la
 * même seconde.
 *
 * Renoncement assumé à la vélocité (spec §5.3), pour une raison qui ne se lit
 * pas dans la formule : la vélocité dépend de l'heure et pas seulement des
 * messages. Elle changeait donc de valeur à chaque recalcul (2 s) **sans qu'un
 * message arrive**, et deux topics quasi à égalité s'échangeaient leur rang en
 * boucle sous les yeux du lecteur. Un ordre qui ne bouge que quand quelqu'un
 * poste s'explique en une phrase, et ne bouge presque jamais.
 *
 * Le prix, accepté : un « up » sur un topic mort le remet en tête, et sur un forum
 * au repos la tête de liste peut être un topic à une réponse — c'est exactement
 * l'ordre que ce fichier tenait auparavant pour un bug (voir
 * `test/ranking.test.ts`). Le up est une pratique de forum. La vélocité reste le
 * rail de chauffe et « ça parle maintenant » : elle informe, elle ne déplace plus
 * personne.
 *
 * ⚠️ `lastAt` doit arriver ici **déjà plafonné à maintenant**. La date est
 * déclarée par l'auteur (§2.4) : sans plafond, un message daté dans le futur
 * tiendrait la tête de liste pour toujours. Le plafond est posé à l'ingestion —
 * `stores/topics.ts` côté client, `apps/indexer/src/index.ts` côté tick.
 */
export function compareTopicRows(x: TopicRow, y: TopicRow): number {
  return y.lastAt - x.lastAt || y.replies - x.replies
}

/* -------------------------------------------------------------- identité */

/**
 * Pseudo par défaut (spec §3.1) : `khey_` + 8 premiers hex de la clé
 * publique. Déterministe, sans état, et déjà une identité — aucun event
 * kind 0 n'est nécessaire pour exister.
 */
export function kheyHandle(pubkey: string): string {
  return `khey_${pubkey.slice(0, 8)}`
}

/**
 * Discriminant de clé, à afficher **toujours** à côté d'un pseudo choisi
 * (spec §3.5) : sur Nostr le nom n'est pas unique, donc un pseudo seul
 * ne distingue pas deux comptes.
 */
export function keyDiscriminator(pubkey: string): string {
  return pubkey.slice(0, 6)
}

/* ----------------------------------------------------------- clé privée */

export type SecretInput = { ok: true; secret: Uint8Array; pubkey: string } | { ok: false; error: string }

/**
 * Décode une clé privée saisie à la main — `nsec…` (NIP-19) ou 64 hex.
 *
 * Pur et sans effet : sert aussi bien à l'import réel (store identité) qu'à la
 * prévisualisation pendant la frappe (« tu redeviendras X »), qui ne doit
 * surtout PAS toucher l'identité courante.
 */
export function decodeSecretInput(input: string): SecretInput {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'rien à importer' }

  let bytes: Uint8Array | null = null
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    const lower = raw.toLowerCase()
    bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(lower.slice(i * 2, i * 2 + 2), 16)
  } else if (raw.startsWith('nsec')) {
    try {
      const decoded = decode(raw)
      if (decoded.type === 'nsec') bytes = decoded.data
    } catch {
      return { ok: false, error: 'nsec illisible (somme de contrôle invalide ?)' }
    }
  } else if (raw.startsWith('npub')) {
    return { ok: false, error: 'ceci est une clé PUBLIQUE (npub) — il faut la clé privée (nsec)' }
  }

  if (!bytes || bytes.length !== 32) {
    return { ok: false, error: 'format non reconnu — attendu une nsec… ou 64 caractères hex' }
  }

  try {
    return { ok: true, secret: bytes, pubkey: getPublicKey(bytes) }
  } catch {
    return { ok: false, error: 'clé invalide sur la courbe secp256k1' }
  }
}

/* ------------------------------------------------------------ identicon */

function hexBytes(hex: string): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
  return out
}

/**
 * Identicon dérivé **directement** de la clé publique — pas de hachage
 * intermédiaire : une clé publique est déjà 32 octets uniformes. Grille 5×5
 * symétrique, teinte dérivée des deux premiers octets.
 *
 * Visuellement, l'identité EST la clé : deux clés ne peuvent pas produire le
 * même avatar, ce qui en fait une défense directe contre l'usurpation de pseudo
 * (spec §3.5).
 */
export function identiconSvg(pubkey: string, size = 64): string {
  const b = hexBytes(pubkey)
  if (b.length < 5) return ''
  const hue = (((b[0] ?? 0) << 8) | (b[1] ?? 0)) % 360
  const fg = `hsl(${hue} 62% 52%)`
  const bg = `hsl(${hue} 30% 14%)`

  const cells: boolean[] = []
  for (let i = 0; i < 15; i++) {
    cells.push((((b[2 + (i >> 3)] ?? 0) >> (i & 7)) & 1) === 1)
  }

  const cell = size / 5
  let rects = ''
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const col = x < 3 ? x : 4 - x
      if (cells[y * 3 + col]) {
        rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="${bg}"/>` +
    `<g fill="${fg}">${rects}</g></svg>`
  )
}

/**
 * Une URI par clé, mémoïsée. Le SVG est vectoriel : le générer à taille fixe et
 * laisser `<img width/height>` afficher la bonne ne change rien à l'écran, mais
 * le même auteur produit désormais LA MÊME URI dans le fil (60 px), la liste
 * (52 px) et l'en-tête — une seule génération, une seule entrée de cache image.
 */
const IDENTICON_SIZE = 80
const identiconCache = new Map<string, string>()

export function identiconDataUri(pubkey: string): string {
  const cached = identiconCache.get(pubkey)
  if (cached !== undefined) return cached
  const svg = identiconSvg(pubkey, IDENTICON_SIZE)
  const uri = svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : ''
  // borne large : au-delà, on jette tout plutôt que de gérer un LRU pour des
  // chaînes d'un demi-kilooctet
  if (identiconCache.size > 2000) identiconCache.clear()
  identiconCache.set(pubkey, uri)
  return uri
}

/* ------------------------------------------------------------ permaliens */

/**
 * Permalien canonique (spec §6.4) : l'`nevent`, jamais le numéro de post.
 * Il fonctionne dans n'importe quel autre client Nostr.
 */
export function neventFor(ev: NostrEvent, relays: string[] = []): string {
  try {
    return neventEncode({ id: ev.id, author: ev.pubkey, kind: ev.kind, relays: relays.slice(0, 2) })
  } catch {
    return ev.id
  }
}

export function npubFor(pubkey: string): string {
  try {
    return npubEncode(pubkey)
  } catch {
    return pubkey
  }
}
