/**
 * Images jointes à un message : préparation, dépôt, et mémoire de ce qui a été
 * déposé pendant la rédaction.
 *
 * Le composeur ne manipule jamais d'adresse à la main — il donne un fichier et
 * reçoit une image insérable. C'est ce qui rend les trois gestes (bouton,
 * collage, glisser-déposer) strictement équivalents.
 *
 * ⚠️ Écart assumé avec la spec §8, qui écartait l'upload utilisateur (« supprime
 * la pipeline, le risque de contenu illégal déposé, le hash-blocking »). Le
 * constat d'usage l'emporte : sur un forum de ce type, ne pas pouvoir poster
 * d'image n'est pas une contrainte de charte, c'est une fonctionnalité
 * manquante. Ce que la décision réintroduit — modération des images déposées et
 * responsabilité de l'hébergement — reste entier et n'est PAS traité ici.
 */
import { ref } from 'vue'
import { prepareForPost } from '~/utils/image'
import { uploadToBlossom } from '~/utils/blossom'
import { resizedDims } from '~/utils/media'
import type { ImageMeta } from '~/utils/media'

export function useImageUpload() {
  const identity = useIdentityStore()

  const busy = ref(false)
  const error = ref<string | null>(null)
  /**
   * Ce qui a été déposé pendant cette rédaction. Sert à construire les tags
   * `imeta` au moment de publier — l'appelant filtre sur le contenu final, une
   * image retirée de l'éditeur ne doit pas laisser sa métadonnée derrière elle.
   */
  const attached = ref<ImageMeta[]>([])
  /**
   * Le ratio d'origine de chaque image, tel qu'on l'a connu en premier. C'est
   * la base de tout redimensionnement : recalculer depuis des dimensions déjà
   * réduites accumulerait les arrondis, et le ratio dériverait à force de
   * reprises.
   */
  const naturals = new Map<string, { width: number; height: number }>()

  async function add(file: File): Promise<ImageMeta | null> {
    if (busy.value) return null
    busy.value = true
    error.value = null
    try {
      if (!identity.pubkey) throw new Error('aucune identité')

      const prepared = await prepareForPost(file)
      const out = await uploadToBlossom(prepared.blob, prepared.type, identity.sign, 'image Forome')

      const meta: ImageMeta = {
        url: out.url,
        mime: prepared.type,
        width: prepared.width,
        height: prepared.height,
        alt: '',
      }
      attached.value = [...attached.value, meta]
      naturals.set(out.url, { width: prepared.width, height: prepared.height })
      return meta
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'le dépôt a échoué'
      return null
    } finally {
      busy.value = false
    }
  }

  /**
   * Enregistre une image déjà déposée ailleurs, pour qu'elle compte dans les
   * `imeta` de cette rédaction.
   *
   * C'est la porte des stickers : ils sont copiés chez nous par
   * `useStickerPicker`, souvent sans aucun dépôt (le premier utilisateur l'a déjà
   * fait). Ils doivent pourtant produire un `imeta` exactement comme une image
   * jointe, sinon leur `dim` manquerait et le fil sauterait à leur chargement.
   */
  function adopt(meta: ImageMeta): void {
    if (attached.value.some((m) => m.url === meta.url)) return
    attached.value = [...attached.value, meta]
    // Pour un message rouvert, ces dimensions sont celles de la dernière
    // publication, pas du fichier — le ratio, lui, est le bon, et c'est lui
    // qui compte pour redimensionner.
    if (meta.width && meta.height && !naturals.has(meta.url)) {
      naturals.set(meta.url, { width: meta.width, height: meta.height })
    }
  }

  /**
   * L'auteur a donné une largeur d'affichage à une image (poignée de l'éditeur).
   * Les dimensions publiées dans `imeta` deviennent celles-là — voir
   * `resizedDims` pour ce que ça veut dire côté `dim`. Vaut aussi pour un
   * sticker : sa hauteur commune n'est qu'un défaut d'insertion (voir
   * `useStickerPicker`), pas une loi du fil.
   */
  function resize(url: string, displayWidth: number): void {
    const base = naturals.get(url)
    if (!base) return
    attached.value = attached.value.map((m) =>
      m.url === url ? { ...m, ...resizedDims(base, displayWidth) } : m,
    )
  }

  /** Dépôts en série : l'hôte reçoit un fichier à la fois, et l'ordre d'insertion suit celui des fichiers. */
  async function addMany(files: File[], onEach: (meta: ImageMeta) => void): Promise<void> {
    for (const file of files) {
      const meta = await add(file)
      if (!meta) return
      onEach(meta)
    }
  }

  function reset(): void {
    attached.value = []
    naturals.clear()
    error.value = null
  }

  return { busy, error, attached, add, addMany, adopt, resize, reset }
}
