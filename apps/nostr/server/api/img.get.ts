/**
 * Relit une image d'un message depuis son hôte et la sert depuis notre origine.
 *
 * Raison d'être, identique à celle des avatars : afficher l'image d'un post ferait
 * sinon charger un fichier chez un tiers par le navigateur de **chaque lecteur du
 * fil**, qui lui livrerait son IP sans l'avoir demandé (spec §8, l. 612). C'est
 * ce que la spec appelle « pas d'auto-embed » — ce que ce proxy rend caduc, parce
 * que le lecteur ne parle qu'à nous.
 *
 * Deux différences avec `/api/media/:sha`, qui reste réservé aux avatars :
 *   - l'entrée est une URL, pas un hash : les images publiées depuis un autre
 *     client Nostr vivent où leur auteur les a mises. D'où `imgGuard`, qui borne
 *     ce que le serveur accepte d'aller chercher ;
 *   - quand l'adresse est adressée par contenu, on **vérifie** le sha256 des
 *     octets reçus. C'est la thèse du §8 rendue exécutable : si l'hôte ré-encode
 *     ou substitue le fichier, on ne l'affiche pas.
 *
 * ⚠️ Ce point d'entrée n'est pas signé : n'importe qui peut demander n'importe
 * quelle image publique à travers notre IP. Le signer supposerait de construire
 * l'adresse côté serveur, or l'app est une SPA (`ssr: false`) — le `src` est
 * fabriqué dans le navigateur. Le coût est borné par le plafond de taille, le
 * délai et la liste blanche de types ; c'est un point à revoir si le trafic
 * devient un problème.
 */
import { createHash } from 'node:crypto'
import { pictureSha } from '~/utils/media'
import { IMAGE_TYPES, MAX_BYTES, MAX_REDIRECTS, TIMEOUT_MS, assertPublicHost, parseTarget } from '../utils/imgGuard'

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308])

export default defineEventHandler(async (event) => {
  const raw = getQuery(event).u
  if (typeof raw !== 'string' || !raw) throw createError({ statusCode: 400, statusMessage: 'adresse attendue' })

  let url: URL
  try {
    url = parseTarget(raw)
  } catch (e) {
    throw createError({ statusCode: 400, statusMessage: e instanceof Error ? e.message : 'adresse refusée' })
  }

  // Les redirections sont suivies à la main : chaque saut est une NOUVELLE
  // adresse fournie par un tiers, donc il repasse par les mêmes contrôles.
  let upstream: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await assertPublicHost(url.hostname)
    } catch (e) {
      throw createError({ statusCode: 400, statusMessage: e instanceof Error ? e.message : 'hôte refusé' })
    }

    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Aucun en-tête d'authentification, aucun cookie, aucun référent : ce
      // serveur ne relaie que la demande, jamais une identité.
      headers: { accept: 'image/*' },
    }).catch(() => null)
    if (!res) throw createError({ statusCode: 502, statusMessage: 'hôte injoignable' })

    if (!REDIRECT_CODES.has(res.status)) {
      upstream = res
      break
    }
    const location = res.headers.get('location')
    if (!location) throw createError({ statusCode: 502, statusMessage: 'redirection sans destination' })
    try {
      url = parseTarget(new URL(location, url).href)
    } catch (e) {
      throw createError({ statusCode: 400, statusMessage: e instanceof Error ? e.message : 'redirection refusée' })
    }
  }

  if (!upstream) throw createError({ statusCode: 502, statusMessage: 'trop de redirections' })
  if (!upstream.ok) throw createError({ statusCode: 502, statusMessage: 'image introuvable' })

  const type = (upstream.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!IMAGE_TYPES.has(type)) throw createError({ statusCode: 415, statusMessage: 'type refusé' })

  const declared = Number(upstream.headers.get('content-length') ?? '0')
  if (declared > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'image trop lourde' })

  const body = new Uint8Array(await upstream.arrayBuffer())
  // `content-length` est déclaratif : on revérifie sur les octets reçus.
  if (body.byteLength > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'image trop lourde' })

  // Adressée par contenu : le hash EST l'adresse, donc un écart signifie que ce
  // qu'on a reçu n'est pas ce que l'auteur a publié. On ne l'affiche pas.
  const expected = pictureSha(url.href)
  const actual = expected ? createHash('sha256').update(body).digest('hex') : null
  if (expected && actual !== expected) {
    throw createError({ statusCode: 502, statusMessage: 'le contenu ne correspond pas à son empreinte' })
  }

  setHeader(event, 'content-type', type)
  setHeader(
    event,
    'cache-control',
    // Sans empreinte, l'adresse peut désigner autre chose demain : une journée,
    // pas l'éternité.
    expected ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
  )
  setHeader(event, 'content-security-policy', "default-src 'none'; sandbox")
  setHeader(event, 'x-content-type-options', 'nosniff')
  return body
})
