/**
 * Bascule clair / sombre.
 *
 * Le thème par défaut est **la préférence système** : rien n'est écrit dans
 * `localStorage` tant que l'utilisateur n'a pas choisi explicitement. Dès qu'il
 * choisit, `data-theme` sur `<html>` gagne dans les deux sens (voir
 * `assets/css/main.css`), et le choix survit au rechargement.
 *
 * L'application initiale se fait dans un script inline de `nuxt.config.ts`,
 * avant le montage : en SPA (`ssr: false`) un thème appliqué au montage ferait
 * clignoter la page en blanc à chaque chargement.
 */
import { ref, computed } from 'vue'

type Choice = 'light' | 'dark' | null

/** ⚠️ Dupliqué dans le script inline de `nuxt.config.ts` : changer les deux. */
const STORAGE_KEY = 'forome.theme'

/** Portée module : un seul état pour toute l'app, quel que soit l'appelant. */
const choice = ref<Choice>(null)
const systemDark = ref(false)
let started = false

export function useTheme() {
  if (import.meta.client && !started) {
    started = true
    const stored = localStorage.getItem(STORAGE_KEY)
    choice.value = stored === 'light' || stored === 'dark' ? stored : null

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mq.matches
    // `change` sur le media query, pas de listener de scroll ni de polling
    mq.addEventListener('change', (e) => (systemDark.value = e.matches))
  }

  const isDark = computed(() => (choice.value ? choice.value === 'dark' : systemDark.value))

  function toggle(): void {
    const next = isDark.value ? 'light' : 'dark'
    choice.value = next
    if (import.meta.client) {
      document.documentElement.dataset.theme = next
      localStorage.setItem(STORAGE_KEY, next)
    }
  }

  return { isDark, toggle }
}
