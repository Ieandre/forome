/**
 * Copier, et le dire. Le retour « copié » est la seule confirmation qu'on ait :
 * le presse-papier est invisible, sans lui rien ne distingue un clic qui a
 * marché d'un clic dans le vide.
 *
 * Le refus est silencieux (contexte non sécurisé, permission) : partout où on
 * copie, la valeur reste sélectionnable à la main — une erreur à l'écran
 * n'apprendrait rien de plus et ferait du bruit sur un geste facultatif.
 *
 * ⚠️ Le minuteur est annulé à la sortie de portée : sans ça, un composant démonté
 * pendant sa seconde de « copié » écrit dans une ref qui n'a plus d'écran.
 */
import { ref, onScopeDispose } from 'vue'

const RESET_MS = 1500

export function useCopy() {
  const copied = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false
    }
    copied.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), RESET_MS)
    return true
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  return { copied, copy }
}
