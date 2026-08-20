/** Page suivante d'un rail de découverte, pour le « en voir plus » du tiroir. */
import { railPage } from '../../utils/risibank'
import { stickerMemo } from '../../utils/stickerMirror'

const RAILS = new Set(['top', 'hot'] as const)

type Rail = 'top' | 'hot'

const MAX_PAGE = 200

export default defineEventHandler(async (event) => {
  const q = getQuery(event)

  const rail = String(q.rail ?? '')
  if (!RAILS.has(rail as Rail)) throw createError({ statusCode: 400, statusMessage: 'rail inconnu' })

  const page = Number(q.page ?? 1)
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw createError({ statusCode: 400, statusMessage: 'page invalide' })
  }

  const stickers = await railPage(rail as Rail, page).catch((e: unknown) => {
    throw createError({
      statusCode: 502,
      statusMessage: e instanceof Error ? e.message : 'rail indisponible',
    })
  })

  const memo = stickerMemo()
  await memo.load()

  return { stickers, mirrors: memo.pick(stickers.map((s) => s.id)) }
})
