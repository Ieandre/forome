/**
 * L'apparence, au moment du rendu (spec §16.9).
 *
 * ## Le portier est ici, et il ne peut être qu'ici
 *
 * Une customisation vit dans le kind 0, **que la personne signe elle-même**. Il
 * n'y a donc aucun portier possible à l'écriture : n'importe quelle clé neuve
 * peut déclarer `forome_gradient: "arc-en-ciel"`, et n'importe quel client tiers
 * l'affichera sans rien vérifier. Ce qui protège le forum n'est pas un refus
 * d'écriture — il n'y en a pas — mais **notre décision de ne rendre que ce qui
 * est gagné**, en confrontant la revendication aux points (`grantStyle`).
 *
 * C'est la même doctrine que la modération : le lecteur décide de ce qu'il
 * affiche (§9.4). Et c'est aussi ce qui rend l'interrupteur ci-dessous cohérent
 * plutôt que défensif.
 *
 * ## Les deux thèmes voyagent ensemble
 *
 * Chaque couleur est un couple (clair, sombre) et **les deux partent dans le
 * DOM**, en variables CSS. Le choix se fait en CSS, par les mêmes sélecteurs de
 * thème que la charte (`assets/css/main.css`). C'est ce qui fait qu'un pseudo
 * cramoisi reste lisible quand le lecteur bascule le thème — un calcul en JS
 * aurait figé la valeur du thème actif au moment du rendu.
 */
import { computed, ref } from 'vue'
import { EMPTY_STYLE, colorById, gradientById, grantStyle, type StyleClaim } from '~/types/nostr'

/** ⚠️ Aucun rapport avec `forome.theme` : c'est un autre réglage d'affichage. */
const STORAGE_KEY = 'forome.apparences'

/**
 * Portée module : un seul état pour toute l'app.
 *
 * Allumé par défaut. L'interrupteur existe pour deux raisons — un fil devenu
 * illisible pour quelqu'un, et le principe qui veut que le lecteur tranche ce
 * qu'il affiche. On saura qu'on est allé trop loin par les gens qui l'éteignent,
 * pas par une intuition.
 */
const enabled = ref(true)
let started = false

export function useApparence() {
  const profiles = useProfileStore()
  const points = useUserPointsStore()

  if (import.meta.client && !started) {
    started = true
    enabled.value = localStorage.getItem(STORAGE_KEY) !== '0'
  }

  function toggle(): void {
    enabled.value = !enabled.value
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, enabled.value ? '1' : '0')
  }

  /**
   * L'apparence **accordée** à cette clé : ce qu'elle revendique, filtré par ce
   * que son niveau ouvre.
   *
   * Rend le vide quand le niveau est inconnu (pas d'indexeur épinglé, rien
   * encore reçu) : afficher une revendication sans pouvoir la vérifier serait
   * exactement le trou que ce fichier existe pour fermer.
   */
  function styleOf(pubkey: string): StyleClaim {
    if (!enabled.value) return EMPTY_STYLE
    const claim = profiles.get(pubkey)?.style
    if (!claim) return EMPTY_STYLE
    const level = points.levelOf(pubkey)
    if (level === null) return EMPTY_STYLE
    return grantStyle(claim, level)
  }

  /** Le titre libre accordé, ou `null`. */
  function titleOf(pubkey: string): string | null {
    return styleOf(pubkey).title
  }

  /**
   * À poser sur le pseudo : `v-bind` d'une classe et de variables CSS.
   *
   * Le dégradé gagne sur la couleur unie quand les deux sont accordés — il est
   * plus haut dans le catalogue, donc c'est le choix le plus récent que la
   * personne a pu faire. Garder les deux en mémoire lui évite de reperdre sa
   * couleur si elle retire son dégradé.
   */
  function pseudoBind(pubkey: string): Record<string, unknown> {
    const s = styleOf(pubkey)
    const grad = gradientById(s.gradient)
    if (grad) {
      return {
        class: ['pseudo--degrade', s.animated ? 'pseudo--anime' : null],
        style: {
          '--grad-l': grad.light.join(', '),
          '--grad-d': grad.dark.join(', '),
        },
      }
    }
    const col = colorById(s.color)
    if (col) {
      return {
        class: 'pseudo--couleur',
        style: { '--pseudo-l': col.light, '--pseudo-d': col.dark },
      }
    }
    return {}
  }

  /**
   * À poser sur l'avatar. Un anneau, et non une teinte de fond : il se pose
   * aussi bien sur une photo que sur un identicon, ce qui est tout l'intérêt —
   * c'est le seul axe visible dans le fil qu'une photo de profil n'efface pas.
   */
  function ringBind(pubkey: string): Record<string, unknown> {
    const s = styleOf(pubkey)
    if (s.ring === 'none') return {}
    const grad = gradientById(s.gradient)
    if (s.ring === 'gradient' && grad) {
      return {
        class: 'cadre--degrade',
        style: { '--grad-l': grad.light.join(', '), '--grad-d': grad.dark.join(', ') },
      }
    }
    const col = colorById(s.color)
    if (col) {
      return { class: 'cadre--couleur', style: { '--pseudo-l': col.light, '--pseudo-d': col.dark } }
    }
    // Un cadre en dégradé accordé mais dont le dégradé a disparu : `grantStyle`
    // l'a déjà rétrogradé, donc on n'arrive ici que si la couleur manque aussi.
    return {}
  }

  return {
    enabled: computed(() => enabled.value),
    toggle,
    styleOf,
    titleOf,
    pseudoBind,
    ringBind,
  }
}
