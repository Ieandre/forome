/**
 * Outils de dev, hors de la vue du lecteur.
 *
 * Les compteurs de la barre de forum et la bascule de débit brut décrivent le
 * **client**, pas le forum : « 80 topics » est la taille du tampon de cet onglet
 * (plafonnée par le `limit` de la souscription kind 11), pas le nombre de topics
 * des lieux. Affiché à côté du fil d'Ariane, un lecteur le lit comme une stat de
 * forum et croit en connaître la taille. Ils restent indispensables au
 * développement, donc ils ne sont pas supprimés : ils passent derrière `?dev=1`.
 *
 * Persisté en sessionStorage pour la même raison que `?relays=` : la
 * pré-ouverture du topic chaud et le HMR réécrivent l'URL, et une surcharge qui
 * disparaît au milieu d'une session est pire qu'absente. `?dev=0` la lève, sans
 * quoi on resterait coincé avec les outils affichés jusqu'à fermer l'onglet.
 */
import { ref } from 'vue'

const STORAGE_KEY = 'forome.dev.tools'

/** Portée module : un seul état pour toute l'app, quel que soit l'appelant. */
const enabled = ref(false)
let started = false

export function useDevTools() {
  if (import.meta.client && !started) {
    started = true
    const fromUrl = new URLSearchParams(window.location.search).get('dev')
    if (fromUrl === '1') sessionStorage.setItem(STORAGE_KEY, '1')
    else if (fromUrl === '0') sessionStorage.removeItem(STORAGE_KEY)
    enabled.value = sessionStorage.getItem(STORAGE_KEY) === '1'
  }
  return enabled
}
