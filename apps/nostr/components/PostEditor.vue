<template>
  <form class="pe" @submit.prevent="save">
    <MarkupToolbar
      class="pe__toolbar"
      :uploading="images.busy.value"
      :sticker-open="stickerOpen"
      @inline="editorEl?.toggleInline($event)"
      @block="editorEl?.toggleBlock($event)"
      @link="editorEl?.insertLink()"
      @image="pickImage"
      @sticker="stickerOpen = !stickerOpen"
    />

    <!-- `submit-on-enter` désactivé, contrairement au composeur : ici on reprend
         un texte déjà écrit, souvent long, et une frappe d'Entrée par réflexe
         publierait une correction à moitié faite. Un message se poste d'un
         geste ; il se relit avec les deux mains. -->
    <RichEditor
      ref="editorEl"
      class="pe__input"
      label="Corriger ce message"
      placeholder="le message"
      :submit-on-enter="false"
      @update:model-value="draft = $event"
      @files="attachImages"
      @image-resize="onImageResize"
    />

    <LazyStickerDrawer
      v-if="stickerOpen"
      class="pe__stickers"
      @pick="onSticker"
      @close="stickerOpen = false"
    />

    <input
      ref="fileEl"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
      multiple
      class="visually-hidden"
      @change="onFilePicked"
    />

    <!-- Ce que corriger veut dire ici, dit une fois et à l'endroit où la
         question se pose. Sans cette phrase, l'auteur croit effacer sa faute :
         il en publie une correction, et l'original reste lisible pour toujours
         par quiconque le cherche. C'est la propriété du réseau, pas un défaut de
         ce forum — mais la découvrir après coup serait une trahison. -->
    <p class="pe__note">
      La version d'origine reste publiée : une correction s'ajoute, elle ne remplace rien.
      Le message portera la mention « modifié », et les deux versions resteront lisibles.
    </p>

    <p v-if="images.error.value" class="pe__error">Image : {{ images.error.value }}</p>

    <div class="pe__actions">
      <button type="submit" class="btn btn--sm btn--primary" :disabled="!canSave">
        Publier la correction
      </button>
      <button type="button" class="btn btn--sm btn--ghost" @click="emit('cancel')">annuler</button>

      <span class="pe__spacer" />

      <!-- Retirer son propre message. Deux temps, sans boîte de dialogue : c'est
           le seul geste de cet encart qui ne se rattrape pas d'une frappe. -->
      <button
        v-if="!confirmingRetract"
        type="button"
        class="btn btn--sm btn--ghost pe__retract"
        @click="confirmingRetract = true"
      >
        retirer
      </button>
      <template v-else>
        <button type="button" class="btn btn--sm btn--danger" @click="retract">
          confirmer le retrait
        </button>
        <button type="button" class="btn btn--sm btn--ghost" @click="confirmingRetract = false">
          non
        </button>
      </template>
    </div>

    <p v-if="confirmingRetract" class="pe__note pe__note--warn">
      Le texte sera remplacé par « retiré par son auteur ». Il ne disparaît pas :
      il reste dans l'historique de ce message, et sur les relais qui l'ont déjà.
    </p>
  </form>
</template>

<script setup lang="ts">
/**
 * Correction d'un message déjà publié (spec v2 §2.5).
 *
 * Le composeur en plus petit, moins ce qui n'a pas de sens ici : pas d'encart
 * d'identité (on écrit depuis des mois si on corrige), pas de destinataire, pas
 * de preuve de travail affichée. Il ne publie rien lui-même — il rend un texte
 * et des tags à `PostFeed`, qui détient les events et l'affichage optimiste.
 */
import { ref, computed, onMounted } from 'vue'
import { imetaTags, type ImageMeta } from '~/utils/media'
import type { MarkupKind, BlockKind } from '~/utils/serialize'

const props = defineProps<{
  /** Le balisage de la version en vigueur, tel qu'il a été publié. */
  content: string
  /** `imeta` de cette version, pour ne pas les perdre à la republication. */
  imeta?: Record<string, ImageMeta>
}>()
const emit = defineEmits<{ save: [content: string, tags: string[][]]; cancel: [] }>()

const images = useImageUpload()

const draft = ref(props.content)
const stickerOpen = ref(false)
const confirmingRetract = ref(false)
const editorEl = ref<{
  toggleInline: (k: MarkupKind) => void
  toggleBlock: (k: BlockKind) => void
  insertLink: () => void
  insertImage: (img: ImageMeta) => void
  seed: (markup: string) => void
  focus: () => void
} | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)

onMounted(() => {
  editorEl.value?.seed(props.content)
  /*
   * Réadopte les images déjà dans le message.
   *
   * `imetaTags` ne produit un tag que pour une image **connue de cette session**.
   * Sans cette boucle, corriger une faute dans un message illustré le
   * republierait sans dimensions ni empreinte : les images se remettraient à
   * décaler le fil au chargement, et plus rien ne serait vérifiable. Une perte
   * silencieuse, causée par une virgule.
   */
  for (const meta of Object.values(props.imeta ?? {})) images.adopt(meta)
  editorEl.value?.focus()
})

const imageTags = computed(() => imetaTags(draft.value, images.attached.value))

/**
 * Republier un texte identique produirait un event de plus, définitif, pour
 * rien — et poserait la mention « modifié » sur un message qui ne l'est pas.
 * Une taille d'image redimensionnée ne vit que dans les tags, pas dans le
 * texte : elle compte comme une modification à part.
 */
const resized = ref(false)
const changed = computed(() => resized.value || draft.value.trim() !== props.content.trim())
const canSave = computed(() => !!draft.value.trim() && changed.value && !images.busy.value)

function save(): void {
  if (!canSave.value) return
  emit('save', draft.value, imageTags.value)
}

/**
 * Le retrait est une correction vers le vide, pas une suppression : NIP-09 est
 * une *demande* qu'aucun relais n'est tenu d'honorer, et ce forum n'accepte même
 * pas le kind 5. Ce qu'on peut promettre, c'est que notre client cesse de
 * l'afficher et dise pourquoi — jamais qu'il disparaisse.
 */
function retract(): void {
  emit('save', '', [])
}

function pickImage(): void {
  fileEl.value?.click()
}

function onSticker(meta: ImageMeta): void {
  images.adopt(meta)
  editorEl.value?.insertImage(meta)
}

function onImageResize(url: string, width: number): void {
  images.resize(url, width)
  resized.value = true
}

function onFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement
  void attachImages([...(input.files ?? [])])
  input.value = ''
}

async function attachImages(files: File[]): Promise<void> {
  await images.addMany(files, (meta) => editorEl.value?.insertImage(meta))
}
</script>

<style scoped>
/* Même gabarit que l'encart de modération : un tiroir creusé DANS le message,
   pas une carte posée à côté. Le fil ne doit pas avoir l'air d'avoir gagné un
   objet parce qu'on corrige une faute. */
.pe {
  margin: 8px 0 0;
  padding: 10px 11px;
  background: var(--surface-sunken);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-control);
}

.pe__toolbar {
  margin-bottom: 7px;
}

.pe__input {
  min-height: 68px;
  max-height: 320px;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-size: var(--fs-base);
  line-height: 1.55;
  color: var(--ink);
}
.pe__input:focus-within {
  border-color: var(--link);
  box-shadow: var(--ring);
}

.pe__stickers {
  margin-top: 7px;
}

.pe__note {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink-4);
}
.pe__note--warn {
  color: var(--ink-2);
}

.pe__error {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  color: var(--warn);
}

.pe__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

.pe__spacer {
  flex: 1;
}

/* Le retrait est à l'opposé des actions d'écriture, et sans couleur tant qu'il
   n'est pas confirmé : c'est une sortie, pas une proposition. */
.pe__retract {
  color: var(--ink-4);
}
.pe__retract:hover {
  color: var(--warn);
}
</style>
