/**
 * Ancrage d'une couche flottante, partagé par `Hint` et `Explain`.
 *
 * `position: fixed` et non `absolute` : les conteneurs de l'app sont en
 * `overflow-y: auto` et rogneraient la couche. En contrepartie le fixed ne suit
 * pas le défilement, d'où la fermeture au scroll plutôt qu'un repositionnement.
 */
import { ref, nextTick, onBeforeUnmount, type Ref } from 'vue'

export type Placement = 'top' | 'bottom'

const GUTTER = 8
const GAP = 7
const ARROW_INSET = 13

export interface AnchoredLayer {
  anchor: Ref<HTMLElement | null>
  layer: Ref<HTMLElement | null>
  open: Ref<boolean>
  /** false tant que la position n'est pas mesurée : évite le saut au montage. */
  placed: Ref<boolean>
  side: Ref<Placement>
  style: Ref<Record<string, string>>
  arrowLeft: Ref<number>
  show: () => Promise<void>
  hide: () => void
}

export function useAnchoredLayer(prefer: Placement = 'top'): AnchoredLayer {
  const anchor = ref<HTMLElement | null>(null)
  const layer = ref<HTMLElement | null>(null)
  const open = ref(false)
  const placed = ref(false)
  const side = ref<Placement>(prefer)
  const style = ref<Record<string, string>>({})
  const arrowLeft = ref(0)

  async function place(): Promise<void> {
    await nextTick()
    const a = anchor.value
    const l = layer.value
    if (!a || !l) return

    // Les composants enveloppent leur déclencheur dans un `display: contents`,
    // qui ne génère aucune boîte : il faut alors mesurer l'enfant.
    const own = a.getBoundingClientRect()
    const ar = own.width || own.height ? own : (a.firstElementChild?.getBoundingClientRect() ?? own)
    const lr = l.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    const roomAbove = ar.top - GAP - GUTTER
    const roomBelow = vh - ar.bottom - GAP - GUTTER
    let s = prefer
    if (s === 'top' && lr.height > roomAbove) s = 'bottom'
    if (s === 'bottom' && lr.height > roomBelow) s = roomAbove > roomBelow ? 'top' : 'bottom'
    side.value = s

    const top = s === 'top' ? ar.top - GAP - lr.height : ar.bottom + GAP
    const centered = ar.left + ar.width / 2 - lr.width / 2
    const left = Math.min(Math.max(centered, GUTTER), Math.max(GUTTER, vw - GUTTER - lr.width))

    // La flèche suit l'ancre et non le centre de la couche : après recadrage en
    // bord d'écran les deux ne coïncident plus.
    arrowLeft.value = Math.min(
      Math.max(ar.left + ar.width / 2 - left, ARROW_INSET),
      Math.max(ARROW_INSET, lr.width - ARROW_INSET),
    )

    style.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` }
    placed.value = true
  }

  function onDismissEvent(): void {
    hide()
  }

  function onDismissKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') hide()
  }

  /**
   * Les écouteurs ne vivent QUE pendant l'ouverture, et c'est un point de
   * performance, pas de propreté.
   *
   * `Hint` posait son `keydown` sur `window` au montage : un fil de 150 messages
   * porte une quinzaine de bulles par message, donc **plus de deux mille
   * écouteurs globaux** que chaque frappe au clavier du composeur parcourait. Une
   * seule couche peut être ouverte à la fois — il n'en faut donc jamais plus d'un.
   */
  function bind(): void {
    // `capture` : le défilement d'un conteneur interne ne bouillonne pas jusqu'à
    // `window`, et la couche resterait accrochée dans le vide.
    window.addEventListener('scroll', onDismissEvent, true)
    window.addEventListener('resize', onDismissEvent)
    window.addEventListener('keydown', onDismissKey)
  }
  function unbind(): void {
    window.removeEventListener('scroll', onDismissEvent, true)
    window.removeEventListener('resize', onDismissEvent)
    window.removeEventListener('keydown', onDismissKey)
  }

  async function show(): Promise<void> {
    if (open.value) return
    placed.value = false
    open.value = true
    bind()
    await place()
  }

  function hide(): void {
    if (!open.value) return
    open.value = false
    placed.value = false
    unbind()
  }

  onBeforeUnmount(unbind)

  return { anchor, layer, open, placed, side, style, arrowLeft, show, hide }
}
