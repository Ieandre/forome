/**
 * Les octets d'un sticker, servis depuis **notre** origine.
 *
 * C'est ce que le tiroir met dans ses `src`, et c'est aussi la source que le
 * navigateur relit quand il doit déposer un sticker encore inconnu. Dans les deux
 * cas, le lecteur ne contacte jamais RisiBank : sinon ouvrir le tiroir livrerait
 * son IP, et le contenu du tiroir dirait ce qu'il s'apprête à poster (spec §8).
 *
 * L'entrée est un **id**, pas une URL : ce point d'entrée ne peut donc viser que
 * `risibank.fr` (voir `safeCacheUrl`). C'est la même discipline que
 * `/api/media/:sha`, qui n'accepte qu'un hash — un proxy qui prend une URL
 * arbitraire est un relais ouvert, et `/api/img` ne l'assume que parce que les
 * images des autres clients Nostr vivent à des adresses qu'on ne choisit pas.
 */
import { stickerBytes } from '../../utils/risibank'

export default defineEventHandler(async (event) => {
  const id = Number(getQuery(event).id)
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'id de sticker attendu' })
  }

  const found = await stickerBytes(id)
  if (!found) throw createError({ statusCode: 404, statusMessage: 'sticker introuvable' })

  // Le type vient des octets, pas de l'en-tête de RisiBank : on ressert depuis
  // notre origine, donc l'étiquette qu'on pose engage notre contexte.
  setHeader(event, 'content-type', found.header.mime)
  // Une journée, comme `/api/img` sans empreinte : l'adresse n'est pas adressée
  // par contenu, donc rien ne garantit qu'elle désignera le même fichier demain.
  setHeader(event, 'cache-control', 'public, max-age=86400')
  setHeader(event, 'content-security-policy', "default-src 'none'; sandbox")
  setHeader(event, 'x-content-type-options', 'nosniff')
  return found.bytes
})
