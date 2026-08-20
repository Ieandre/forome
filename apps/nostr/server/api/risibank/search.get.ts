/**
 * Recherche de stickers.
 *
 * La requête de l'utilisateur ne sort **jamais** de notre serveur vers RisiBank
 * depuis son navigateur : ce qu'on cherche à poster est aussi révélateur que ce
 * qu'on poste, et un `fetch` direct livrerait les deux avec l'IP (spec §8).
 */
import { searchStickers } from '../../utils/risibank'
import { stickerMemo } from '../../utils/stickerMirror'

/** Aligné sur RisiBank, qui renvoie 80 résultats par page. */
const MAX_PAGE = 200

/** Au-delà, ce n'est plus une recherche de sticker. */
const MAX_QUERY = 100

export default defineEventHandler(async (event) => {
  const q = getQuery(event)

  const query = typeof q.q === 'string' ? q.q.trim().slice(0, MAX_QUERY) : ''
  const page = Number(q.page ?? 1)
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw createError({ statusCode: 400, statusMessage: 'page invalide' })
  }

  const rawCollection = q.collection
  const collectionId = rawCollection === undefined ? null : Number(rawCollection)
  if (collectionId !== null && (!Number.isInteger(collectionId) || collectionId < 1)) {
    throw createError({ statusCode: 400, statusMessage: 'collection invalide' })
  }

  const found = await searchStickers({ query, page, collectionId }).catch((e: unknown) => {
    throw createError({
      statusCode: 502,
      statusMessage: e instanceof Error ? e.message : 'recherche indisponible',
    })
  })

  const memo = stickerMemo()
  await memo.load()

  return { ...found, mirrors: memo.pick(found.stickers.map((s) => s.id)) }
})
