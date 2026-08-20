/**
 * Relit un avatar depuis l'hôte Blossom et le sert depuis notre origine.
 *
 * Raison d'être : sans ça, afficher l'avatar de quelqu'un ferait charger une image
 * chez un tiers par le navigateur du lecteur, qui lui livrerait son IP à chaque
 * profil consulté (spec §8, l. 612).
 *
 * ⚠️ L'entrée est un sha256, **jamais une URL** — voir `utils/media.ts`. Le hash
 * est validé avant tout appel réseau : sans ça, ce point d'entrée serait un relais
 * ouvert utilisable pour frapper n'importe quel hôte depuis notre IP.
 */
const SHA256_RE = /^[0-9a-f]{64}$/

/** Un avatar dépasse rarement 200 ko après recadrage ; 2 Mo laisse de la marge. */
const MAX_BYTES = 2 * 1024 * 1024

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export default defineEventHandler(async (event) => {
  const sha = (getRouterParam(event, 'sha') ?? '').toLowerCase()
  if (!SHA256_RE.test(sha)) throw createError({ statusCode: 400, statusMessage: 'sha256 attendu' })

  const base = useRuntimeConfig(event).blossomServer
  if (!base) throw createError({ statusCode: 503, statusMessage: 'aucun hôte média configuré' })

  const upstream = await fetch(`${base.replace(/\/+$/, '')}/${sha}`).catch(() => null)
  if (!upstream?.ok) throw createError({ statusCode: 502, statusMessage: 'média introuvable' })

  // On ne renvoie que des images, et seulement des types que le navigateur rend.
  // Relayer un type arbitraire depuis un hôte tiers sur notre origine ferait
  // exécuter son contenu dans notre contexte — un SVG suffit à porter du script.
  const type = (upstream.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!ALLOWED_TYPES.has(type)) throw createError({ statusCode: 415, statusMessage: 'type refusé' })

  const declared = Number(upstream.headers.get('content-length') ?? '0')
  if (declared > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'média trop lourd' })

  const body = new Uint8Array(await upstream.arrayBuffer())
  // `content-length` est déclaratif : on revérifie sur les octets reçus.
  if (body.byteLength > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'média trop lourd' })

  setHeader(event, 'content-type', type)
  // Immuable sans réserve : l'adresse EST le hash du contenu, donc elle ne peut
  // pas désigner autre chose plus tard.
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  setHeader(event, 'content-security-policy', "default-src 'none'; sandbox")
  setHeader(event, 'x-content-type-options', 'nosniff')
  return body
})
