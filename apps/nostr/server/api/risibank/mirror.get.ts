/**
 * Résout un sticker au moment où on le choisit : est-il déjà chez nous ?
 *
 * Deux réponses possibles :
 *
 *   - **connu** — le sticker a déjà été déposé par quelqu'un. On renvoie son
 *     empreinte, son adresse et ses dimensions ; le navigateur insère et publie
 *     sans rien déposer ni signer. C'est le cas de la quasi-totalité des clics.
 *   - **inconnu** — premier usage sur Forome. On mesure les octets *nous-mêmes*
 *     (empreinte, type, dimensions) et on les renvoie ; le navigateur dépose puis
 *     annonce le résultat à `mirror.post`.
 *
 * ⚠️ L'empreinte est calculée **ici**, sur les octets que nous avons lus chez
 * RisiBank — jamais reprise d'une valeur envoyée par le client. C'est ce qui rend
 * le carnet infalsifiable : `mirror.post` n'a plus qu'à vérifier que l'adresse
 * déposée porte bien cette empreinte-là.
 */
import { createHash } from 'node:crypto'
import { stickerBytes } from '../../utils/risibank'
import { stickerMemo } from '../../utils/stickerMirror'

export default defineEventHandler(async (event) => {
  const id = Number(getQuery(event).id)
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'id de sticker attendu' })
  }

  const memo = stickerMemo()
  await memo.load()

  const known = memo.get(id)
  if (known) return { known: true as const, entry: known }

  const found = await stickerBytes(id)
  if (!found) throw createError({ statusCode: 404, statusMessage: 'sticker introuvable' })

  return {
    known: false as const,
    sha256: createHash('sha256').update(found.bytes).digest('hex'),
    mime: found.header.mime,
    width: found.header.width,
    height: found.header.height,
  }
})
