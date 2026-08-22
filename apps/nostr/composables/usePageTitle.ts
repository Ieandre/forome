/**
 * Titre de l'onglet : « <libellé de la page> — Forome », précédé du compte de
 * non-lus s'il y en a.
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
 *
 * ## Pourquoi le compte est ICI et pas dans le layout
 *
 * `useHead` se résout du plus général au plus précis : le titre posé par une
 * page écrase celui du layout. Le préfixe doit donc vivre au même endroit que le
 * libellé, sinon il disparaît sur toutes les routes — c'est-à-dire partout.
 *
 * Contrepartie assumée : une page qui n'appelle pas ce composable n'a pas le
 * compte. Les huit pages l'appellent.
 *
 * ## Pourquoi le compte GLOBAL et pas les seuls MP
 *
 * C'est le nombre de la cloche, à l'identique. Un onglet qui dirait « (2) »
 * pendant que la pastille dit « 5 » à 200 px de là obligerait à choisir lequel
 * croire — et le lecteur choisirait de n'en croire aucun. Un seul nombre pour
 * « ce qui t'attend », quel qu'en soit le canal.
 */
import { toValue, type MaybeRefOrGetter } from 'vue'

export function usePageTitle(label: MaybeRefOrGetter<string | null | undefined>): void {
  const notifs = useNotificationStore()

  useHead({
    title: () => {
      const value = toValue(label)
      const base = value ? `${value} — Forome` : 'Forome'
      const n = notifs.unreadCount
      // Au-delà de 99 le nombre exact n'aide plus, comme sur la pastille.
      return n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base
    },
  })
}
