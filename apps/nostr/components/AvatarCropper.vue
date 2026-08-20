<template>
  <div class="crop">
    <!-- La fenêtre EST le cadrage : ce qu'on voit dans le carré est exactement ce
         qui sera découpé. Pas de rectangle à poignées par-dessus l'image, qui
         demande de comprendre deux repères au lieu d'un. -->
    <div
      ref="viewEl"
      class="crop__view"
      tabindex="0"
      role="application"
      :aria-label="`cadrer la photo — flèches pour déplacer, zoom ${zoom.toFixed(1)}×`"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown="onKey"
      @wheel.prevent="onWheel"
    >
      <img
        v-if="img"
        class="crop__img"
        :src="img.url"
        :style="{
          width: `${img.width * scale}px`,
          height: `${img.height * scale}px`,
          left: `${offset.x}px`,
          top: `${offset.y}px`,
        }"
        alt=""
        draggable="false"
      />
    </div>

    <div class="crop__tools">
      <label class="crop__zoom">
        <span class="crop__zoom-label">Zoom</span>
        <input
          v-model.number="zoom"
          type="range"
          min="1"
          :max="MAX_ZOOM"
          step="0.02"
          class="crop__range"
          aria-label="zoom"
        />
      </label>

      <div class="crop__acts">
        <button type="button" class="btn btn--sm btn--ghost" @click="emit('cancel')">Annuler</button>
        <button type="button" class="btn btn--sm btn--primary" :disabled="!img || busy" @click="confirm">
          {{ busy ? 'Un instant…' : 'Utiliser cette photo' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="field__error">{{ error }}</p>
    <p v-else class="field__hint">Fais glisser pour cadrer. La zone visible est ce qui sera enregistré.</p>
  </div>
</template>

<script setup lang="ts">
/**
 * Cadreur d'avatar : on déplace l'image sous une fenêtre carrée et on zoome.
 *
 * Un seul repère à comprendre — ce qui est dans le carré est ce qui est gardé.
 * Le zoom part de « l'image couvre juste la fenêtre », donc il n'existe aucun
 * état où un bord laisse du vide : l'offset est borné à chaque changement.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import {
  loadImage,
  renderAvatar,
  coverScale as coverScaleOf,
  clampOffset,
  cropFromView,
  MAX_ZOOM,
  type LoadedImage,
  type ViewState,
} from '~/utils/image'

const props = defineProps<{ file: File }>()
const emit = defineEmits<{ done: [blob: Blob, type: string]; cancel: [] }>()

/** Côté de la fenêtre, en px CSS. Doit rester égal à la taille dans le style. */
const VIEW = 232

/** Un cran de flèche. Assez pour cadrer au pixel sans y passer la journée. */
const STEP = 8

const img = ref<LoadedImage | null>(null)
const viewEl = ref<HTMLElement | null>(null)
const zoom = ref(1)
const offset = ref({ x: 0, y: 0 })
const busy = ref(false)
const error = ref<string | null>(null)

const scale = computed(() => {
  const i = img.value
  return i ? coverScaleOf(VIEW, i.width, i.height) * zoom.value : 1
})

/** L'état courant, sous la forme attendue par les fonctions pures de `utils/image`. */
function view(at: { x: number; y: number }): ViewState | null {
  const i = img.value
  if (!i) return null
  return { view: VIEW, imageW: i.width, imageH: i.height, scale: scale.value, offsetX: at.x, offsetY: at.y }
}

function clamp(next: { x: number; y: number }): { x: number; y: number } {
  const v = view(next)
  return v ? clampOffset(v) : { x: 0, y: 0 }
}

/** Recentre, puis borne : le cadrage par défaut est le centre de l'image. */
function center(): void {
  const i = img.value
  if (!i) return
  offset.value = clamp({
    x: (VIEW - i.width * scale.value) / 2,
    y: (VIEW - i.height * scale.value) / 2,
  })
}

// Le zoom garde le centre de la fenêtre : sans ça, zoomer fait fuir le sujet vers
// un coin et il faut le rattraper à chaque cran.
watch(zoom, (next, prev) => {
  const i = img.value
  if (!i || !prev) return
  const ratio = next / prev
  offset.value = clamp({
    x: (offset.value.x - VIEW / 2) * ratio + VIEW / 2,
    y: (offset.value.y - VIEW / 2) * ratio + VIEW / 2,
  })
})

watch(
  () => props.file,
  async (file) => {
    error.value = null
    release()
    try {
      img.value = await loadImage(file)
      zoom.value = 1
      center()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'image illisible'
    }
  },
  { immediate: true },
)

/* ------------------------------------------------------------------- gestes */

let dragging = false
let last = { x: 0, y: 0 }

function onDown(e: PointerEvent): void {
  if (!img.value) return
  dragging = true
  last = { x: e.clientX, y: e.clientY }
  // La capture évite de perdre le glissement quand le curseur sort du carré.
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (!dragging) return
  offset.value = clamp({
    x: offset.value.x + (e.clientX - last.x),
    y: offset.value.y + (e.clientY - last.y),
  })
  last = { x: e.clientX, y: e.clientY }
}

function onUp(e: PointerEvent): void {
  dragging = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
}

function onWheel(e: WheelEvent): void {
  zoom.value = Math.min(MAX_ZOOM, Math.max(1, zoom.value - e.deltaY * 0.002))
}

/** Le cadrage doit être atteignable sans souris : flèches pour bouger, +/− pour zoomer. */
function onKey(e: KeyboardEvent): void {
  const moves: Record<string, [number, number]> = {
    ArrowUp: [0, STEP],
    ArrowDown: [0, -STEP],
    ArrowLeft: [STEP, 0],
    ArrowRight: [-STEP, 0],
  }
  const move = moves[e.key]
  if (move) {
    e.preventDefault()
    offset.value = clamp({ x: offset.value.x + move[0], y: offset.value.y + move[1] })
    return
  }
  if (e.key === '+' || e.key === '=') {
    e.preventDefault()
    zoom.value = Math.min(MAX_ZOOM, zoom.value + 0.1)
  } else if (e.key === '-') {
    e.preventDefault()
    zoom.value = Math.max(1, zoom.value - 0.1)
  }
}

/* -------------------------------------------------------------------- sortie */

async function confirm(): Promise<void> {
  const i = img.value
  const v = view(offset.value)
  if (!i || !v || busy.value) return
  busy.value = true
  error.value = null
  try {
    const { blob, type } = await renderAvatar(i.bitmap, cropFromView(v))
    emit('done', blob, type)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'le recadrage a échoué'
  } finally {
    busy.value = false
  }
}

function release(): void {
  if (img.value) {
    URL.revokeObjectURL(img.value.url)
    img.value.bitmap.close()
    img.value = null
  }
}

onBeforeUnmount(release)
</script>

<style scoped>
.crop {
  margin-top: 8px;
}

/* Le carré est la seule chose qui explique le cadrage : bord franc, fond enfoncé
   pour qu'on voie qu'il est une ouverture et non une image posée. */
.crop__view {
  position: relative;
  width: 232px;
  height: 232px;
  overflow: hidden;
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.crop__view:active {
  cursor: grabbing;
}
.crop__img {
  position: absolute;
  max-width: none;
  /* `<img>` applique déjà l'orientation EXIF ; explicite pour que l'aperçu et le
     fichier rendu ne puissent pas diverger (voir `utils/image.ts`). */
  image-orientation: from-image;
  pointer-events: none;
}

.crop__tools {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 10px;
  max-width: 232px;
}
.crop__zoom {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.crop__zoom-label {
  color: var(--ink-3);
  font-size: var(--fs-xs);
  flex-shrink: 0;
}
.crop__range {
  flex: 1;
  min-width: 0;
  accent-color: var(--brand);
}
.crop__acts {
  display: flex;
  gap: 8px;
  width: 100%;
}
</style>
