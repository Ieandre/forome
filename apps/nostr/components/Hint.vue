<template>
  <span
    ref="anchor"
    class="hint"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focusin="onFocusIn"
    @focusout="onLeave"
  >
    <slot />

    <Teleport to="body">
      <span
        v-if="open"
        ref="layer"
        class="hint__bubble"
        :class="[`hint__bubble--${side}`, { 'hint__bubble--placed': placed }]"
        :style="style"
        aria-hidden="true"
      >
        {{ text }}
        <span class="hint__arrow" :style="{ left: `${arrowLeft}px` }" />
      </span>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
/**
 * La bulle qui NOMME une commande. Sa jumelle `Explain` fait lire une
 * explication ; ici on passe, on ne clique pas.
 *
 * Purement visuelle : la bulle est `aria-hidden`, le nom accessible est posé
 * sur le déclencheur par `nameChild()`.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Le libellé. Court : c'est un nom, pas une phrase. */
    text: string
    /** Côté préféré. Il bascule tout seul si la place manque. */
    placement?: 'top' | 'bottom'
    /**
     * Coupe la bulle sans démonter le composant. Sert aux déclencheurs qui
     * ouvrent une couche à eux : la bulle se poserait alors PAR-DESSUS le
     * panneau qu'on vient d'ouvrir, et elle nommerait un bouton dont le contenu
     * est déjà à l'écran.
     */
    disabled?: boolean
  }>(),
  { placement: 'top' },
)

const { anchor, layer, open, placed, side, style, arrowLeft, show, hide } = useAnchoredLayer(
  props.placement,
)

/** Assez long pour qu'un curseur qui traverse la barre d'outils n'allume pas
 *  six bulles au passage. Le focus clavier, lui, est délibéré : zéro attente. */
const HOVER_DELAY = 120
let timer: ReturnType<typeof setTimeout> | null = null

function clear(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
function onEnter(): void {
  clear()
  if (props.disabled) return
  timer = setTimeout(() => void show(), HOVER_DELAY)
}
function onFocusIn(): void {
  clear()
  if (props.disabled) return
  void show()
}
function onLeave(): void {
  clear()
  hide()
}
/**
 * Écriture directe dans le DOM assumée : le déclencheur est un slot, on ne peut
 * pas lui passer d'attribut. L'alternative répétait la chaîne à chaque appel.
 */
function nameChild(): void {
  const el = anchor.value?.firstElementChild
  if (!(el instanceof HTMLElement)) return
  if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return
  if (el.textContent?.trim()) return
  el.setAttribute('aria-label', props.text)
}

// La fermeture par Échap est portée par `useAnchoredLayer`, qui n'écoute que
// pendant l'ouverture. Elle était ici, sur `window`, dès le montage : un fil de
// 150 messages posait alors des milliers d'écouteurs `keydown` que chaque frappe
// du composeur parcourait.
onMounted(nameChild)
watch(() => props.text, nameChild)
watch(
  () => props.disabled,
  (off) => {
    if (off) {
      clear()
      hide()
    }
  },
)
onBeforeUnmount(clear)
</script>

<style scoped>
.hint {
  display: contents;
}

/* Un quasi-noir identique dans les deux thèmes : une bulle qui s'inverserait se
   lirait comme du contenu, celle-ci est du chrome. C'est le dernier usage des
   tokens `--bar`, qui ne servent plus la barre de site depuis qu'elle est
   claire — ils survivent pour ça, et ça seul. */
.hint__bubble {
  position: fixed;
  z-index: 60;
  max-width: 15rem;
  padding: 6px 10px;
  border-radius: var(--r-pastille);
  background: var(--bar);
  color: var(--bar-ink);
  font-size: var(--fs-sm);
  font-weight: 500;
  line-height: 1.4;
  box-shadow: var(--shadow-pop);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.09s ease, transform 0.09s ease;
}
.hint__bubble--top {
  transform: translateY(3px);
}
.hint__bubble--bottom {
  transform: translateY(-3px);
}
/* ⚠️ APRÈS les règles de côté : même spécificité, l'ordre du fichier tranche. */
.hint__bubble--placed {
  opacity: 1;
  transform: none;
}

.hint__arrow {
  position: absolute;
  width: 0;
  height: 0;
  margin-left: -4px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
}
.hint__bubble--top .hint__arrow {
  top: 100%;
  border-top: 4px solid var(--bar);
}
.hint__bubble--bottom .hint__arrow {
  bottom: 100%;
  border-bottom: 4px solid var(--bar);
}
</style>
