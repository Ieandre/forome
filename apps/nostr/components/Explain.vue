<template>
  <span ref="anchor" class="explain">
    <button
      type="button"
      class="explain__trigger"
      :class="`explain__trigger--${variant}`"
      :aria-expanded="open"
      :aria-describedby="`${uid}-desc`"
      @click="toggle"
      @keydown.escape="close"
    >
      <slot />
    </button>

    <!-- Toujours présent, donc lu à la prise de focus sans dépendre de
         l'ouverture. Le panneau visuel est `aria-hidden` : sinon, doublon. -->
    <span :id="`${uid}-desc`" class="visually-hidden">{{ describedText }}</span>

    <Teleport to="body">
      <div
        v-if="open"
        ref="layer"
        class="explain__panel"
        :class="[`explain__panel--${side}`, { 'explain__panel--placed': placed }]"
        :style="style"
        aria-hidden="true"
      >
        <!-- Anatomie du bloc message de la charte. Le terme est répété en tête
             parce que le déclencheur fait souvent quatre lettres. -->
        <p class="explain__term">{{ term }}</p>
        <div class="explain__body">
          <p v-for="(p, i) in paragraphs" :key="i">{{ p }}</p>
          <ul v-if="items.length" class="explain__list">
            <li v-for="(it, i) in items" :key="i">{{ it }}</li>
          </ul>
        </div>
      </div>
    </Teleport>
  </span>
</template>

<script lang="ts">
/**
 * Un seul panneau ouvert à la fois, d'où cet état de module. Sans risque en
 * SSR : il n'est écrit que dans des gestionnaires d'événement.
 */
import { ref } from 'vue'
const openId = ref<string | null>(null)
</script>

<script setup lang="ts">
/**
 * Le panneau qui fait LIRE une explication : vocabulaire du forum et du
 * protocole. Sa jumelle `Hint` se contente de nommer un bouton.
 *
 * Clic et non survol — mélanger les deux fait clignoter le panneau au passage
 * du curseur et rend le clic ambigu. Le pointillé enseigne le geste.
 */
import { computed, watch, onBeforeUnmount, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Le terme défini, repris en tête du panneau. */
    term: string
    /** L'explication. Un tableau donne un paragraphe par entrée. */
    body: string | string[]
    /** Données brutes listées sous l'explication (URL de relais, clés…). */
    items?: string[]
    /**
     * `text`  : pointillé sous le mot (le cas courant)
     * `chip`  : le déclencheur est déjà une étiquette bordée — son trait passe
     *           en tirets plutôt que de lui ajouter un soulignement.
     */
    variant?: 'text' | 'chip'
    placement?: 'top' | 'bottom'
  }>(),
  { variant: 'text', placement: 'bottom', items: () => [] },
)

const uid = useId()
const { anchor, layer, open, placed, side, style, show, hide } = useAnchoredLayer(props.placement)

const paragraphs = computed(() => (Array.isArray(props.body) ? props.body : [props.body]))
const items = computed(() => props.items ?? [])
const describedText = computed(() => [...paragraphs.value, ...items.value].join(' '))

function toggle(): void {
  openId.value = open.value ? null : uid
}
function close(): void {
  if (openId.value === uid) openId.value = null
}

watch(openId, (id) => {
  if (id === uid) {
    bindDismiss()
    void show()
  } else {
    unbindDismiss()
    hide()
  }
})

function onPointerDown(e: PointerEvent): void {
  const t = e.target
  if (!(t instanceof Node)) return
  // Le panneau est téléporté hors de `anchor` : tester les deux, sinon un clic
  // dedans le refermerait.
  if (anchor.value?.contains(t) || layer.value?.contains(t)) return
  close()
}
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  close()
  // Sans ça, Échap laisse le clavier au début du document.
  anchor.value?.querySelector('button')?.focus()
}

/**
 * Les deux écouteurs globaux ne vivent QUE pendant l'ouverture, et c'est une
 * question de coût, pas de style.
 *
 * Ils étaient posés au `setup` de chaque instance et ne faisaient rien tant que
 * `openId` ne désignait pas la leur. Mais un fil de 150 messages instancie des
 * centaines d'`Explain` : chaque frappe au clavier et chaque clic de la page
 * traversaient donc des centaines de gardes pour n'en retenir aucune. `openId`
 * est module-scopé — un seul panneau peut être ouvert —, donc un seul jeu suffit,
 * et le test `openId === uid` à l'intérieur devient inutile.
 */
let bound = false
function bindDismiss(): void {
  if (bound || !import.meta.client) return
  bound = true
  document.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKey)
}
function unbindDismiss(): void {
  if (!bound) return
  bound = false
  document.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('keydown', onKey)
}

onBeforeUnmount(() => {
  unbindDismiss()
  close()
})
</script>

<style scoped>
/* `display: contents` : le composant s'insère dans des mises en page déjà
   réglées au pixel. Sans boîte, il n'y a rien à décaler. */
.explain {
  display: contents;
}

/* ------------------------------------------------------------- déclencheur */
.explain__trigger {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: help;
  text-align: inherit;
}
.explain__trigger:focus-visible {
  outline: 2px solid var(--link);
  outline-offset: 2px;
  border-radius: var(--r-pastille);
}

/* Une seule idée, deux expressions : un mot porte le pointillé sous la ligne de
   base, une étiquette déjà bordée le porte dans son trait. La couleur vient de
   l'ambiance et non d'un gris fixe, sinon il disparaît sur la barre sombre. */
.explain__trigger--text {
  text-decoration: underline dotted color-mix(in srgb, currentColor 55%, transparent);
  text-underline-offset: 2px;
}
.explain__trigger--text:hover {
  text-decoration-color: currentColor;
}
.explain__trigger--text[aria-expanded='true'] {
  text-decoration-color: var(--link);
}

/* Les étiquettes n'ont plus de bordure à passer en pointillé : c'est un
   soulignement interne qui dit « celle-ci s'explique », et l'anneau qui dit
   « et son panneau est ouvert ». */
.explain__trigger--chip :deep(.tag) {
  text-decoration: underline dotted color-mix(in srgb, currentColor 45%, transparent);
  text-underline-offset: 2px;
}
.explain__trigger--chip[aria-expanded='true'] :deep(.tag) {
  text-decoration: none;
  box-shadow: 0 0 0 1.5px currentColor;
}

/* ------------------------------------------------------------------ panneau
   Pas de flèche : le terme reste souligné en rouge tant que le panneau est
   ouvert, et ce lien-là survit au recadrage en bord d'écran. */
.explain__panel {
  position: fixed;
  z-index: 60;
  width: max-content;
  max-width: 20rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.explain__panel--top {
  transform: translateY(4px);
}
.explain__panel--bottom {
  transform: translateY(-4px);
}
/* ⚠️ APRÈS les règles de côté : même spécificité, l'ordre tranche. */
.explain__panel--placed {
  opacity: 1;
  transform: none;
}

/* Le terme n'a plus sa bande grise à filet : à 20 rem de large, elle coupait le
   panneau en deux pour porter quatre lettres. L'espace suffit. */
.explain__term {
  margin: 0;
  padding: 12px 14px 0;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-4);
}

.explain__body {
  padding: 6px 14px 13px;
}
.explain__body p {
  margin: 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-2);
}
.explain__body p + p {
  margin-top: 7px;
}

.explain__list {
  margin: 8px 0 0;
  padding: 7px 0 0;
  border-top: 1px solid var(--line-soft);
  list-style: none;
}
.explain__list li {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--ink-3);
  /* Une URL n'a pas d'espace où se couper et déborderait du panneau. */
  overflow-wrap: anywhere;
}
</style>
