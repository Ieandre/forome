/**
 * Dépôt d'un avatar : recadrage, autorisation signée, envoi.
 *
 * L'utilisateur choisit un fichier et ne voit jamais d'adresse — c'est ce qui
 * remplace l'ancien champ « adresse d'image », qui supposait qu'il héberge déjà
 * son image quelque part.
 *
 * L'envoi lui-même vit dans `utils/blossom.ts`, partagé avec les images des
 * messages : c'est la même autorisation signée et le même proxy.
 */
import { ref } from 'vue'
import { uploadToBlossom } from '~/utils/blossom'

export function useAvatarUpload() {
  const identity = useIdentityStore()

  const busy = ref(false)
  const error = ref<string | null>(null)
  /** Aperçu local, affiché dès le recadrage — donc avant que le réseau réponde. */
  const preview = ref<string | null>(null)

  function clearPreview(): void {
    if (preview.value) URL.revokeObjectURL(preview.value)
    preview.value = null
  }

  /**
   * Reçoit l'image **déjà recadrée** par `AvatarCropper` : le cadrage est un choix
   * de l'utilisateur, il n'a rien à faire ici.
   *
   * Renvoie l'URL canonique de l'hôte (celle qui va dans le kind 0), ou null.
   */
  async function upload(blob: Blob, type: string): Promise<string | null> {
    if (busy.value) return null
    busy.value = true
    error.value = null

    try {
      if (!identity.pubkey) throw new Error('aucune identité')

      clearPreview()
      preview.value = URL.createObjectURL(blob)

      const out = await uploadToBlossom(blob, type, identity.sign, 'avatar Forome')
      return out.url
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'le dépôt a échoué'
      // L'aperçu tombe avec l'échec : le garder laisserait croire que c'est pris.
      clearPreview()
      return null
    } finally {
      busy.value = false
    }
  }

  return { busy, error, preview, upload, clearPreview }
}
