<template>
  <div
    class="stk"
    :class="{ 'stk--dragging': dragging }"
    :style="dragY ? { transform: `translateY(${dragY}px)` } : undefined"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <!-- Poignée : le seul élément propre à la feuille mobile. En desktop le
         panneau est dans le flux, il n'y a rien à faire glisser. -->
    <div
      class="stk__grip"
      aria-hidden="true"
      @pointerdown="onGripDown"
      @pointermove="onGripMove"
      @pointerup="onGripUp"
      @pointercancel="onGripUp"
    />

    <div class="stk__head">
      <input
        ref="searchEl"
        v-model="query"
        type="search"
        class="stk__search"
        placeholder="chercher un sticker"
        aria-label="chercher un sticker"
        autocomplete="off"
      />
      <button type="button" class="tool stk__close" @click="emit('close')">fermer</button>
    </div>

    <!-- Les onglets disparaissent pendant une recherche : ils ne s'appliquent
         plus, et les laisser actifs ferait croire qu'on filtre le résultat. -->
    <div v-if="!searching" class="stk__tabs" role="tablist" aria-label="découverte">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        role="tab"
        class="stk__tab"
        :class="{ 'stk__tab--on': tab === t.key }"
        :aria-selected="tab === t.key"
        @click="select(t.key)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- Tags que RisiBank a reconnus dans la requête : ce sont ses mots-clés, donc
         le moyen le plus court d'affiner une recherche qui rate. -->
    <div v-else-if="tags.length" class="stk__tags">
      <button v-for="t in tags" :key="t" type="button" class="stk__tag" @click="query = t">{{ t }}</button>
    </div>

    <div class="stk__body">
      <p v-if="loadError" class="stk__msg stk__msg--bad">{{ loadError }}</p>
      <p v-else-if="picker.error.value" class="stk__msg stk__msg--bad">{{ picker.error.value }}</p>
      <p v-else-if="!loading && !shown.length" class="stk__msg">
        {{ searching ? 'aucun sticker pour cette recherche' : 'rien à afficher' }}
      </p>

      <div v-if="shown.length" class="stk__grid">
        <button
          v-for="s in shown"
          :key="s.id"
          type="button"
          class="stk__cell"
          :title="s.alt"
          :disabled="picker.busy.value"
          @click="choose(s)"
        >
          <!-- `loading="lazy"` n'est pas un détail : un GIF de sticker peut peser
               1 Mo et une page en compte 80. Sans lui, ouvrir le tiroir tirerait
               des dizaines de mégaoctets d'un coup. -->
          <img class="stk__img" :src="stickerSrc(s.id)" :alt="s.alt" loading="lazy" decoding="async" />
        </button>
      </div>

      <p v-if="loading" class="stk__msg">chargement…</p>

      <button v-else-if="canLoadMore" type="button" class="tool stk__more" @click="loadMore">
        en voir plus
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Tiroir de stickers (spec §8, §570).
 *
 * ## Ce qu'il montre en s'ouvrant
 *
 * Les **populaires du moment** — le rail `hot` de RisiBank. Les quatre rails
 * arrivent en une seule requête amont, donc les onglets sont gratuits une fois le
 * tiroir ouvert.
 *
 * ## Codes forum, pas codes chat
 *
 * En desktop, ce panneau est **dans le flux** sous la barre d'outils : il pousse
 * l'éditeur vers le bas, comme la boîte à smileys d'un phpBB. Pas un popover
 * flottant — un tiroir de stickers qui recouvre le message qu'on écrit est un
 * geste de messagerie instantanée. Sous 700 px il devient une feuille qui monte
 * du bas et qu'on renvoie en la faisant glisser, ce que la spec §570 demande.
 *
 * Le sticker choisi s'insère **dans le corps du message**, comme une image : il
 * fait partie du texte signé. Une rangée de stickers-réactions sous un post
 * serait, là encore, un code de chat.
 *
 * ## Ce qu'il ne montre pas
 *
 * Ni empreinte, ni nombre de résultats, ni « déjà copié / à copier ». Le lecteur
 * n'a pas à savoir lesquels demandent un dépôt : c'est de l'instrumentation
 * technique, et le geste est le même dans les deux cas.
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { ImageMeta } from '~/utils/media'
import { pictureSha } from '~/utils/media'
import { stickerSrc, type MirrorEntry, type StickerRef } from '~/composables/useStickerPicker'

const emit = defineEmits<{ pick: [meta: ImageMeta]; close: [] }>()

type Rail = 'top' | 'hot'

/**
 * Deux rails, et « les classiques » d'abord : c'est ce qu'on vient chercher neuf
 * fois sur dix. Libellés en français courant plutôt que les noms de l'API — « hot »
 * et « top » ne disent rien, « du moment » contre « les classiques » est la
 * distinction que fait un habitué.
 *
 * RisiBank en expose deux autres (`new`, `rand`) qu'on n'affiche pas : ils ne
 * répondent à aucune intention au moment d'écrire un message.
 */
const TABS: { key: Rail; label: string }[] = [
  { key: 'top', label: 'les classiques' },
  { key: 'hot', label: 'du moment' },
]

/** Au-delà, un glissement est une intention de fermer, pas un tremblement. */
const DISMISS_PX = 90

/** Frappe au clavier : on attend la fin du mot plutôt que d'interroger par lettre. */
const DEBOUNCE_MS = 250

const picker = useStickerPicker()

const searchEl = ref<HTMLInputElement | null>(null)
const tab = ref<Rail>('top')
const query = ref('')

const rails = ref<Record<Rail, StickerRef[]> | null>(null)
const results = ref<StickerRef[]>([])
const tags = ref<string[]>([])
/** Ce que le carnet sait, accumulé au fil des réponses. Clé = id en chaîne. */
const mirrors = ref<Record<string, MirrorEntry>>({})

const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)

const searching = computed(() => query.value.trim().length > 0)

const shown = computed<StickerRef[]>(() =>
  searching.value ? results.value : (rails.value?.[tab.value] ?? []),
)

/**
 * Une recherche sait si elle a une suite (`has_more`) ; un rail, non — RisiBank
 * renvoie une page de 80 sans dire s'il en reste. On propose donc toujours la
 * suite sur un rail, et une page vide se voit simplement à l'écran.
 */
const canLoadMore = computed(() => (searching.value ? hasMore.value : true))

function absorb(found: Record<string, MirrorEntry> | undefined): void {
  if (found) mirrors.value = { ...mirrors.value, ...found }
}

function fail(e: unknown): void {
  loadError.value = e instanceof Error ? e.message : 'les stickers sont indisponibles'
}

async function loadDiscover(): Promise<void> {
  if (rails.value || loading.value) return
  loading.value = true
  loadError.value = null
  try {
    const out = await $fetch<{ rails: Record<Rail, StickerRef[]>; mirrors: Record<string, MirrorEntry> }>(
      '/api/risibank/discover',
    )
    rails.value = out.rails
    absorb(out.mirrors)
  } catch (e) {
    fail(e)
  } finally {
    loading.value = false
  }
}

async function runSearch(): Promise<void> {
  const q = query.value.trim()
  if (!q) return
  loading.value = true
  loadError.value = null
  page.value = 1
  try {
    const out = await $fetch<{
      stickers: StickerRef[]
      tags: string[]
      hasMore: boolean
      mirrors: Record<string, MirrorEntry>
    }>('/api/risibank/search', { query: { q, page: 1 } })
    results.value = out.stickers
    tags.value = out.tags
    hasMore.value = out.hasMore
    absorb(out.mirrors)
  } catch (e) {
    results.value = []
    fail(e)
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (loading.value) return
  loading.value = true
  loadError.value = null
  const next = page.value + 1
  try {
    if (searching.value) {
      const out = await $fetch<{ stickers: StickerRef[]; hasMore: boolean; mirrors: Record<string, MirrorEntry> }>(
        '/api/risibank/search',
        { query: { q: query.value.trim(), page: next } },
      )
      results.value = [...results.value, ...out.stickers]
      hasMore.value = out.hasMore
      absorb(out.mirrors)
    } else {
      const out = await $fetch<{ stickers: StickerRef[]; mirrors: Record<string, MirrorEntry> }>(
        '/api/risibank/rail',
        { query: { rail: tab.value, page: next } },
      )
      const current = rails.value
      if (current) current[tab.value] = [...(current[tab.value] ?? []), ...out.stickers]
      absorb(out.mirrors)
    }
    page.value = next
  } catch (e) {
    fail(e)
  } finally {
    loading.value = false
  }
}

function select(key: Rail): void {
  tab.value = key
  // Chaque rail a sa propre pagination : changer d'onglet sans remettre le
  // compteur ferait sauter des pages au « en voir plus » suivant.
  page.value = 1
}

let timer: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (timer) clearTimeout(timer)
  if (!searching.value) {
    results.value = []
    tags.value = []
    return
  }
  timer = setTimeout(() => void runSearch(), DEBOUNCE_MS)
})

async function choose(sticker: StickerRef): Promise<void> {
  const known = mirrors.value[String(sticker.id)] ?? null
  const meta = await picker.pick(sticker, known)
  if (!meta) return

  // Premier usage : on vient de le copier. Le retenir localement rend le
  // deuxième clic gratuit, sans attendre un rechargement de la page de résultats.
  if (!known && meta.mime && meta.width && meta.height) {
    const sha = pictureSha(meta.url)
    if (sha) {
      mirrors.value = {
        ...mirrors.value,
        [String(sticker.id)]: {
          sha256: sha,
          url: meta.url,
          mime: meta.mime,
          width: meta.width,
          height: meta.height,
        },
      }
    }
  }

  emit('pick', meta)
}

/* ------------------------------------------------------- feuille mobile */

const dragging = ref(false)
const dragY = ref(0)
let startY = 0

function onGripDown(e: PointerEvent): void {
  dragging.value = true
  startY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onGripMove(e: PointerEvent): void {
  // Vers le bas seulement : tirer vers le haut ne doit pas décoller la feuille
  // du bord de l'écran.
  if (dragging.value) dragY.value = Math.max(0, e.clientY - startY)
}

function onGripUp(): void {
  if (!dragging.value) return
  dragging.value = false
  const travelled = dragY.value
  dragY.value = 0
  if (travelled > DISMISS_PX) emit('close')
}

void loadDiscover()
// Le tiroir est monté à l'ouverture : le focus part sur la recherche, parce que
// chercher est ce qu'on fait neuf fois sur dix en l'ouvrant.
void nextTick(() => searchEl.value?.focus())
</script>

<style scoped>
.stk {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line, currentColor);
  border-radius: var(--r-panel, 10px);
  background: var(--surface-2, transparent);
}

/* La poignée n'existe que sur la feuille mobile. */
.stk__grip {
  display: none;
}

.stk__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stk__search {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--line, currentColor);
  border-radius: var(--r-control, 8px);
  background: var(--surface, transparent);
  color: var(--ink, inherit);
  font: inherit;
  font-size: var(--fs-sm, 13px);
}
.stk__search:focus-visible {
  outline: 2px solid var(--ring, currentColor);
  outline-offset: 1px;
}
.stk__close {
  flex: none;
}

.stk__tabs,
.stk__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.stk__tab,
.stk__tag {
  padding: 3px 9px;
  border: none;
  border-radius: var(--r-pastille, 6px);
  background: transparent;
  color: var(--ink-4, inherit);
  font-size: var(--fs-sm, 12px);
  font-weight: 600;
  transition: background 0.13s ease, color 0.13s ease;
}
.stk__tab:hover,
.stk__tag:hover {
  background: var(--surface-3, rgba(0, 0, 0, 0.06));
  color: var(--ink, inherit);
}
/* Onglet actif : bleu. C'est un état (« tu es dans ce rail »), et l'orange de la
   charte ne dit jamais ça — il dit « agis ». */
.stk__tab--on,
.stk__tab--on:hover {
  background: var(--link, currentColor);
  color: #fff;
}

.stk__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Le panneau ne doit pas repousser le bouton « Poster » hors de l'écran :
     au-delà, c'est la grille qui défile, pas la page. */
  max-height: 46vh;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.stk__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 4px;
}
.stk__cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 68px;
  padding: 2px;
  border: 1px solid transparent;
  border-radius: var(--r-pastille, 6px);
  background: transparent;
  transition: background 0.13s ease, border-color 0.13s ease;
}
.stk__cell:hover:not(:disabled) {
  border-color: var(--line-strong, currentColor);
  background: var(--surface-3, rgba(0, 0, 0, 0.06));
}
.stk__cell:disabled {
  opacity: 0.5;
}
.stk__img {
  max-width: 100%;
  max-height: 100%;
  /* `contain` : un sticker n'est pas une vignette à recadrer, la couper change ce
     qu'il dit. */
  object-fit: contain;
}

.stk__msg {
  margin: 0;
  color: var(--ink-3, inherit);
  font-size: var(--fs-sm, 13px);
}
.stk__msg--bad {
  color: var(--warn, inherit);
}
.stk__more {
  align-self: center;
}

/* ------------------------------------------- feuille qui monte du bas */
@media (max-width: 700px) {
  .stk {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    border-radius: var(--r-panel, 10px) var(--r-panel, 10px) 0 0;
    border-bottom: none;
    /* L'encoche et la barre système du téléphone mangent le bas de la feuille. */
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    box-shadow: var(--shadow-pop, 0 -8px 24px rgba(0, 0, 0, 0.2));
    animation: stk-rise 0.18s ease-out;
    touch-action: none;
  }
  .stk__grip {
    display: block;
    width: 42px;
    height: 4px;
    margin: 2px auto 4px;
    border-radius: 999px;
    background: var(--line-strong, currentColor);
    /* La zone tactile utile est plus grande que le trait qu'on voit. */
    padding: 10px 0;
    background-clip: content-box;
    cursor: grab;
  }
  /* Pendant le glissement, pas de transition : elle retarderait le doigt. */
  .stk--dragging {
    animation: none;
    transition: none;
  }
  .stk__body {
    max-height: 42vh;
  }
}

@keyframes stk-rise {
  from {
    transform: translateY(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .stk {
    animation: none;
  }
}
</style>
