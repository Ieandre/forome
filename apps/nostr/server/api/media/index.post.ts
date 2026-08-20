/**
 * Dépose un avatar sur l'hôte Blossom, pour le compte du navigateur.
 *
 * Pourquoi ne pas déposer directement depuis le client : la spec §8 (l. 606) veut
 * les tiers derrière un proxy serveur, et ça supprime la dépendance aux en-têtes
 * CORS d'un hôte qu'on ne maîtrise pas.
 *
 * L'autorisation reste celle de l'utilisateur : le navigateur envoie un event
 * kind 24242 signé par SA clé (Blossom BUD-02), qu'on transmet tel quel. Ce
 * serveur ne signe rien et ne détient aucune clé — il ne fait que relayer.
 */
import { createHash } from 'node:crypto'

/**
 * 4 Mo : un avatar recadré pèse ~200 ko, mais la même route sert les images des
 * messages, et un GIF part tel quel (le ré-encoder le figerait — voir
 * `prepareForPost`).
 */
const MAX_BYTES = 4 * 1024 * 1024

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export default defineEventHandler(async (event) => {
  const base = useRuntimeConfig(event).blossomServer
  if (!base) throw createError({ statusCode: 503, statusMessage: 'aucun hôte média configuré' })

  const auth = getHeader(event, 'x-nostr-auth')
  if (!auth) throw createError({ statusCode: 401, statusMessage: 'autorisation Nostr manquante' })

  const type = (getHeader(event, 'content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!ALLOWED_TYPES.has(type)) throw createError({ statusCode: 415, statusMessage: 'type refusé' })

  const body = await readRawBody(event, false)
  if (!body || !(body instanceof Buffer)) throw createError({ statusCode: 400, statusMessage: 'corps vide' })
  if (body.byteLength > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'image trop lourde' })

  /*
   * Le hash des octets reçus doit être celui que l'autorisation annonce (`x`).
   * Sans cette vérification, une autorisation interceptée servirait à déposer
   * n'importe quoi d'autre sous la clé de son auteur.
   */
  const sha = createHash('sha256').update(body).digest('hex')
  let declared: string | null = null
  try {
    const parsed = JSON.parse(Buffer.from(auth, 'base64').toString('utf8')) as {
      tags?: string[][]
    }
    declared = parsed.tags?.find((t) => t[0] === 'x')?.[1]?.toLowerCase() ?? null
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'autorisation illisible' })
  }
  if (declared !== sha) {
    throw createError({ statusCode: 400, statusMessage: "l'autorisation ne correspond pas au fichier" })
  }

  const upstream = await fetch(`${base.replace(/\/+$/, '')}/upload`, {
    method: 'PUT',
    headers: { authorization: `Nostr ${auth}`, 'content-type': type },
    body: new Uint8Array(body),
  }).catch(() => null)

  if (!upstream) throw createError({ statusCode: 502, statusMessage: 'hôte média injoignable' })
  if (!upstream.ok) {
    // Le motif du refus vient de l'hôte (quota, clé non autorisée, type) et il est
    // utile à l'utilisateur : on ne le remplace pas par un message générique.
    const why = (await upstream.text().catch(() => '')).slice(0, 200)
    throw createError({
      statusCode: 502,
      statusMessage: why ? `dépôt refusé : ${why}` : 'dépôt refusé par l’hôte média',
    })
  }

  const result = (await upstream.json().catch(() => null)) as { url?: string; sha256?: string } | null
  const url = result?.url
  if (!url) throw createError({ statusCode: 502, statusMessage: 'réponse inattendue de l’hôte média' })

  // On renvoie l'URL canonique de l'hôte, pas celle du proxy : c'est elle qui part
  // dans le kind 0, pour que le profil reste lisible par les autres clients Nostr.
  return { url, sha256: result?.sha256 ?? sha }
})
