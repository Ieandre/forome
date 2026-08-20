/**
 * Choisir un sticker : de l'id RisiBank à une image insérable, copiée chez nous.
 *
 * ## Le chemin normal ne parle à personne
 *
 * Le tiroir reçoit, avec chaque page de résultats, la liste des stickers déjà
 * copiés sur notre stockage (`mirrors`). Cliquer sur l'un d'eux ne déclenche donc
 * **aucune requête, aucun dépôt, aucune signature** : on connaît déjà son
 * adresse, son empreinte et ses dimensions. C'est le cas de la quasi-totalité des
 * clics, et c'est ce qui rend le geste aussi léger qu'il doit l'être — un sticker
 * se poste vingt fois par soirée.
 *
 * ## Le premier usage d'un sticker, lui, le copie
 *
 * Personne ne l'avait encore posté sur Forome : le navigateur lit les octets par
 * notre proxy, les dépose sur l'hôte média avec **sa** clé (le serveur ne détient
 * aucune clé, voir `utils/blossom.ts`), puis annonce le résultat au carnet. Les
 * suivants retombent sur le chemin normal.
 *
 * C'est ce qui satisfait la spec §8 sans clé côté serveur : le hash est dans
 * l'event signé, et si RisiBank ré-encode ou disparaît, notre copie reste
 * vérifiable.
 */
import { ref } from 'vue'
import { sha256Hex, uploadToBlossom } from '~/utils/blossom'
import type { ImageMeta } from '~/utils/media'

/** Ce que le carnet sait d'un sticker déjà copié (voir `server/utils/stickerMirror.ts`). */
export interface MirrorEntry {
  sha256: string
  url: string
  mime: string
  width: number
  height: number
}

export interface StickerRef {
  id: number
  alt: string
}

/**
 * L'adresse d'affichage d'un sticker. Toujours notre origine : ouvrir le tiroir
 * ne doit pas livrer à RisiBank l'IP du lecteur ni ce qu'il regarde (spec §8).
 */
export function stickerSrc(id: number): string {
  return `/api/risibank/bytes?id=${id}`
}

type Resolved =
  | { known: true; entry: MirrorEntry }
  | { known: false; sha256: string; mime: string; width: number; height: number }

export function useStickerPicker() {
  const identity = useIdentityStore()

  const busy = ref(false)
  const error = ref<string | null>(null)

  /**
   * Hauteur d'insertion commune à tous les stickers — les originaux RisiBank
   * vont de 60 px à plus de 800 px. C'est un DÉFAUT, plus une loi : le `dim`
   * publié est une taille d'affichage, que le fil respecte (voir `frameStyle`
   * de `RichInline`), et l'auteur peut en dévier à la poignée de l'éditeur.
   * Même valeur que l'aperçu du composeur (`.re-img`, max-height 160).
   */
  const STICKER_DISPLAY_HEIGHT = 160

  function metaOf(sticker: StickerRef, entry: MirrorEntry): ImageMeta {
    const scale = entry.height > 0 ? STICKER_DISPLAY_HEIGHT / entry.height : 1
    return {
      url: entry.url,
      mime: entry.mime,
      width: Math.max(1, Math.round(entry.width * scale)),
      height: Math.max(1, Math.round(entry.height * scale)),
      alt: sticker.alt,
      risibank: sticker.id,
    }
  }

  /**
   * L'image insérable, ou null si ça a échoué (le motif est dans `error`).
   *
   * `known` vient du tiroir : le passer évite l'aller-retour dans le cas courant.
   */
  async function pick(sticker: StickerRef, known: MirrorEntry | null): Promise<ImageMeta | null> {
    if (known) return metaOf(sticker, known)
    if (busy.value) return null

    busy.value = true
    error.value = null
    try {
      const resolved = await $fetch<Resolved>('/api/risibank/mirror', { query: { id: sticker.id } })
      if (resolved.known) return metaOf(sticker, resolved.entry)

      if (!identity.pubkey) throw new Error('aucune identité')

      const res = await fetch(stickerSrc(sticker.id))
      if (!res.ok) throw new Error("ce sticker n'a pas pu être lu")
      const blob = await res.blob()

      /*
       * Le serveur a mesuré ces mêmes octets et c'est SON empreinte qui fera
       * autorité au carnet. Un écart ici signifie qu'on ne tient pas le même
       * fichier que lui : déposer quand même ferait signer aux suivants un `x`
       * qui ne correspond pas à l'image qu'ils affichent.
       */
      if ((await sha256Hex(blob)) !== resolved.sha256) {
        throw new Error('ce sticker a changé pendant la copie')
      }

      const out = await uploadToBlossom(blob, resolved.mime, identity.sign, 'sticker Forome')
      const entry: MirrorEntry = {
        sha256: out.sha256,
        url: out.url,
        mime: resolved.mime,
        width: resolved.width,
        height: resolved.height,
      }

      /*
       * L'inscription au carnet est un service rendu aux suivants, pas une
       * condition de ce post : le dépôt a réussi, l'image est là, elle est
       * insérable. Si l'inscription échoue, le prochain utilisateur redéposera
       * les mêmes octets et retrouvera la même adresse — le stockage est adressé
       * par contenu, donc c'est du gâchis, pas une incohérence.
       */
      await $fetch('/api/risibank/mirror', {
        method: 'POST',
        body: { id: sticker.id, url: out.url },
      }).catch(() => null)

      return metaOf(sticker, entry)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'ce sticker n’a pas pu être ajouté'
      return null
    } finally {
      busy.value = false
    }
  }

  return { busy, error, pick }
}
