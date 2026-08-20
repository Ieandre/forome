/**
 * Enregistre au carnet qu'un sticker vient d'être copié chez nous.
 *
 * Appelé par le navigateur juste après son dépôt sur l'hôte média, pour que les
 * suivants n'aient plus rien à déposer. C'est le seul point d'entrée qui écrit
 * dans le carnet, et ce qu'il y écrit finira dans le tag `imeta` d'events signés
 * **par d'autres utilisateurs** — d'où quatre vérifications avant d'accepter.
 *
 * Rien de ce que le client envoie n'est cru :
 *
 *   1. l'empreinte est **recalculée** sur les octets lus chez RisiBank, jamais
 *      reprise du corps de la requête ;
 *   2. l'adresse doit être sur l'hôte média qu'on a configuré — sinon on
 *      publierait aux suivants une adresse tierce quelconque ;
 *   3. l'adresse doit **porter** cette empreinte (adressage par contenu) ;
 *   4. le fichier doit exister à cette adresse et ses octets doivent redonner
 *      la même empreinte. Sans ce dernier point, une requête suffirait à
 *      inscrire une adresse morte, et tous les suivants publieraient un `imeta`
 *      pointant sur du vide.
 *
 * Ce point d'entrée n'est pas authentifié, comme `/api/img` et pour la même
 * raison (SPA, `ssr: false`). Il n'en a pas besoin : les quatre contrôles ne
 * laissent passer qu'une vérité vérifiable indépendamment du demandeur. Le pire
 * qu'obtienne un client hostile est de faire enregistrer un dépôt qui a
 * réellement eu lieu.
 */
import { createHash } from 'node:crypto'
import { stickerBytes } from '../../utils/risibank'
import { stickerMemo, urlCarriesSha, type MirrorEntry } from '../../utils/stickerMirror'

/** Aligné sur le plafond de dépôt (`server/api/media/index.post.ts`). */
const MAX_BYTES = 4 * 1024 * 1024

const TIMEOUT_MS = 8000

export default defineEventHandler(async (event) => {
  const blossom = useRuntimeConfig(event).blossomServer
  if (!blossom) throw createError({ statusCode: 503, statusMessage: 'aucun hôte média configuré' })

  const body = await readBody<{ id?: unknown; url?: unknown }>(event).catch(() => null)
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'id de sticker attendu' })
  }
  if (typeof body?.url !== 'string' || !body.url) {
    throw createError({ statusCode: 400, statusMessage: 'adresse de dépôt attendue' })
  }

  const memo = stickerMemo()
  await memo.load()

  // Déjà connu : le premier arrivé garde la main. Deux navigateurs qui déposent
  // le même sticker en même temps est un cas normal, pas une erreur.
  const known = memo.get(id)
  if (known) return { entry: known }

  const found = await stickerBytes(id)
  if (!found) throw createError({ statusCode: 404, statusMessage: 'sticker introuvable' })
  const sha256 = createHash('sha256').update(found.bytes).digest('hex')

  let url: URL
  try {
    url = new URL(body.url)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'adresse illisible' })
  }
  if (url.origin !== new URL(blossom).origin) {
    throw createError({ statusCode: 400, statusMessage: 'adresse hors de notre hôte média' })
  }
  if (!urlCarriesSha(url.href, sha256)) {
    throw createError({ statusCode: 400, statusMessage: "l'adresse ne porte pas l'empreinte du sticker" })
  }

  const deposited = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'image/*' },
  }).catch(() => null)
  if (!deposited?.ok) throw createError({ statusCode: 502, statusMessage: 'dépôt introuvable à cette adresse' })

  const bytes = new Uint8Array(await deposited.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'dépôt trop lourd' })
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw createError({ statusCode: 400, statusMessage: "le dépôt ne correspond pas au sticker" })
  }

  const entry: MirrorEntry = {
    sha256,
    url: url.href,
    mime: found.header.mime,
    width: found.header.width,
    height: found.header.height,
  }
  if (!memo.put(id, entry)) {
    throw createError({ statusCode: 507, statusMessage: 'carnet plein' })
  }

  return { entry }
})
