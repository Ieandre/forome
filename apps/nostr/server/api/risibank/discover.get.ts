/**
 * Ce qui s'affiche à l'ouverture du tiroir : « les classiques » et « du moment ».
 *
 * `top` (les classiques) est le rail par défaut côté client. Les deux arrivent en
 * **une seule** requête amont — `GET /medias` les renvoie ensemble — donc basculer
 * d'un onglet à l'autre ne coûte rien de plus que l'ouverture.
 *
 * Chaque réponse est annotée par `mirrors` : les stickers déjà copiés chez nous,
 * avec leur empreinte et leurs dimensions. Le tiroir sait ainsi lesquels
 * s'insèrent instantanément, sans dépôt ni signature (voir `stickerMirror.ts`).
 */
import { discoverStickers } from '../../utils/risibank'
import { stickerMemo } from '../../utils/stickerMirror'

export default defineEventHandler(async () => {
  const rails = await discoverStickers().catch((e: unknown) => {
    throw createError({
      statusCode: 502,
      statusMessage: e instanceof Error ? e.message : 'découverte indisponible',
    })
  })

  const memo = stickerMemo()
  await memo.load()

  const ids = [...rails.top, ...rails.hot].map((s) => s.id)
  return { rails, mirrors: memo.pick(ids) }
})
