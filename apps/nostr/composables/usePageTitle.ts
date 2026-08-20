/**
 * Titre de l'onglet : « <libellé de la page> — Forome ».
 *
 * Le libellé accepte un getter, parce que les deux pages qui en ont le plus
 * besoin — un topic, un profil — ne le connaissent pas au montage : il arrive
 * des relais. `null` en attendant, et l'onglet dit « Forome » tant que le vrai
 * nom n'est pas là plutôt qu'un intitulé de remplissage qu'il faudrait ensuite
 * démentir.
 *
 * Pas de `titleTemplate` : celui de `nuxt.config.ts` ne peut pas être une
 * fonction (la config est sérialisée), et la forme `'%s — Forome'` suffixerait
 * aussi le titre par défaut du shell — « Forome — Forome » sur l'accueil.
 */
import { toValue, type MaybeRefOrGetter } from 'vue'

export function usePageTitle(label: MaybeRefOrGetter<string | null | undefined>): void {
  useHead({
    title: () => {
      const value = toValue(label)
      return value ? `${value} — Forome` : 'Forome'
    },
  })
}
