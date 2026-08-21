<template>
  <form class="nt" @submit.prevent="submit">
    <!-- Mêmes valeurs que `.topic-head` (ForumShell) : lire un topic et en ouvrir
         un sont le même panneau, ils ne peuvent pas commencer à deux hauteurs
         différentes. L'en-tête porte aussi le seul retour disponible en mobile,
         où la liste est masquée. -->
    <header class="nt__head">
      <div class="nt__col nt__head-col">
        <Hint text="retour à la liste" placement="bottom">
          <button type="button" class="nt__back" @click="leave">
            <span aria-hidden="true">←</span>
            <span class="visually-hidden">retour à la liste</span>
          </button>
        </Hint>

        <UserAvatar v-if="identity.pubkey" :pubkey="identity.pubkey" :size="26" class="nt__av" />

        <div class="nt__ident">
          <h1 class="nt__kicker">Nouveau topic</h1>
          <p class="nt__by">
            par <strong>{{ identity.displayName }}</strong>
          </p>
        </div>
      </div>
    </header>

    <div class="nt__body">
      <div class="nt__col">
        <!-- Le titre se saisit à la taille et dans la couleur où il sera lu :
             taper, c'est déjà le voir. Pas d'étiquette au-dessus — le corps de
             24 px et la ligne d'aide en dessous le désignent mieux qu'un mot. -->
        <div class="nt__field">
          <textarea
            ref="titleEl"
            v-model="title"
            class="nt__title"
            rows="1"
            :maxlength="TITLE_MAX"
            placeholder="titre du topic"
            aria-label="Titre du topic"
            autocomplete="off"
            @input="fitTitle"
            @keydown.enter.prevent="editorEl?.focus()"
          />
          <p class="nt__hint">
            <span>Le titre ne pourra plus être réécrit.</span>
            <span
              v-if="titleLeft <= 40"
              class="nt__count mono"
              :class="{ 'nt__count--low': titleLeft <= 10 }"
              >{{ titleLeft }}</span
            >
          </p>
        </div>

        <div class="nt__field nt__field--grow">
          <div class="nt__editor">
            <MarkupToolbar
              class="nt__toolbar"
              :uploading="images.busy.value"
              :sticker-open="stickerOpen"
              @inline="editorEl?.toggleInline($event)"
              @block="editorEl?.toggleBlock($event)"
              @link="editorEl?.insertLink()"
              @image="pickImage"
              @sticker="stickerOpen = !stickerOpen"
            />
            <!-- Même éditeur que le fil : la mise en forme s'affiche pendant la
                 frappe. `submit-on-enter` désactivé — dans un formulaire à
                 plusieurs champs, Entrée va à la ligne, elle ne publie pas. -->
            <RichEditor
              ref="editorEl"
              class="nt__input"
              label="Message"
              placeholder="ton message"
              :submit-on-enter="false"
              :mentions="mentions"
              @update:mention-query="mentionQuery = $event"
              @update:model-value="body = $event"
              @files="attachImages"
              @image-resize="images.resize"
            />
            <input
              ref="fileEl"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              multiple
              class="visually-hidden"
              @change="onFilePicked"
            />
          </div>

          <!-- Hors de `.nt__editor`, qui est une colonne à hauteur bornée : dedans,
               le tiroir et la zone de texte se disputeraient les mêmes pixels. -->
          <LazyStickerDrawer
            v-if="stickerOpen"
            @pick="onSticker"
            @close="stickerOpen = false"
          />
        </div>
      </div>
    </div>

    <!-- Le pied est collé au bas du panneau, comme le composeur du fil l'est au
         bas d'un topic : c'est la même action au même endroit. -->
    <footer class="nt__foot">
      <div class="nt__col">
        <p v-if="errorText" class="nt__error">{{ errorText }}</p>
        <div class="nt__row">
          <p class="nt__note" :class="{ 'nt__note--miss': !!missing }">{{ missing ?? IRREVERSIBLE }}</p>
          <!-- Réglage du client, pas information de forum : sous `?dev=1`. -->
          <Explain
            v-if="devTools"
            term="preuve de travail"
            placement="top"
            :body="[
              `Publier ce topic coûtera ${publisher.miner.difficulty.value} bits de calcul.`,
              'Certains relais n\'acceptent un message que s\'il a coûté un peu de temps machine. Ça freine le spam sans demander de compte.',
            ]"
          >
            <span class="nt__pow mono">PoW {{ publisher.miner.difficulty.value }}</span>
          </Explain>
          <button type="button" class="btn btn--ghost nt__cancel" @click="leave">Annuler</button>
          <button type="submit" class="btn btn--primary" :disabled="!canSubmit">
            {{ publisher.publishing.value ? 'Publication…' : 'Publier le topic' }}
          </button>
        </div>
      </div>
    </footer>
  </form>
</template>

<script setup lang="ts">
/**
 * Création de topic (spec v2 §2.3) : kind 11 avec un tag `title`.
 *
 * L'écran est composé comme le topic qu'il va produire — en-tête d'auteur,
 * titre, corps, action en bas — parce que c'est le seul repère qu'on a avant
 * publication : rien ici n'est modifiable après coup.
 */
import { ref, computed, onMounted } from 'vue'
import { topicPath } from '~/utils/permalink'
import type { MarkupKind, BlockKind } from '~/utils/serialize'
import { imetaTags, type ImageMeta } from '~/utils/media'

const TITLE_MAX = 180
const IRREVERSIBLE = 'Publier envoie ce topic sur le réseau : tu ne pourras plus le retirer.'

const title = ref('')
const body = ref('')

/**
 * Complétion `@…` : ici le vivier n'a pas de fil d'où tirer des participants —
 * un topic qui n'existe pas encore n'a personne dedans. Restent les suivis.
 */
const mentionQuery = ref<string | null>(null)
const mentions = useMentionSuggestions(mentionQuery)
const titleEl = ref<HTMLTextAreaElement | null>(null)
const editorEl = ref<{
  toggleInline: (k: MarkupKind) => void
  toggleBlock: (k: BlockKind) => void
  insertLink: () => void
  insertImage: (img: ImageMeta) => void
  focus: () => void
} | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const stickerOpen = ref(false)

const identity = useIdentityStore()
const publisher = usePublisher()
const devTools = useDevTools()
const router = useRouter()
const images = useImageUpload()

// On vient là pour écrire : le curseur est déjà dans le titre.
onMounted(() => titleEl.value?.focus())

/**
 * Le titre s'écrit sur plusieurs lignes et la zone suit sa hauteur. En `input`
 * d'une ligne, un titre long défilait hors du champ : on ne pouvait plus relire
 * ce qu'on venait de taper, sur la seule chaîne de l'écran qui ne se corrige
 * plus après publication.
 */
function fitTitle(): void {
  const el = titleEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** Compteur affiché seulement en approche de la limite — sinon c'est du bruit. */
const titleLeft = computed(() => TITLE_MAX - title.value.length)

/**
 * Ce qui manque, dit seulement quand l'autre moitié est écrite : sur un écran
 * vierge, « il manque le titre » serait un reproche fait à quelqu'un qui vient
 * d'arriver.
 */
const missing = computed<string | null>(() => {
  const hasTitle = !!title.value.trim()
  const hasBody = !!body.value.trim()
  if (hasTitle && !hasBody) return 'Il manque le premier message.'
  if (hasBody && !hasTitle) return 'Il manque le titre.'
  return null
})

const errorText = computed(() =>
  images.error.value ? `Image : ${images.error.value}` : publisher.lastError.value,
)

const canSubmit = computed(
  () =>
    !!title.value.trim() &&
    !!body.value.trim() &&
    !publisher.publishing.value &&
    // Un dépôt en cours : publier maintenant partirait sans l'image ajoutée.
    !images.busy.value &&
    identity.ready,
)

/** Rien n'est enregistré nulle part : sortir d'ici perd le brouillon. */
function leave(): void {
  const dirty = !!title.value.trim() || !!body.value.trim()
  if (dirty && !window.confirm('Ce brouillon sera perdu. Quitter quand même ?')) return
  void router.push('/')
}

function pickImage(): void {
  fileEl.value?.click()
}

function onFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement
  void attachImages([...(input.files ?? [])])
  // Sans ça, choisir deux fois le même fichier ne déclencherait pas `change`.
  input.value = ''
}

async function attachImages(files: File[]): Promise<void> {
  await images.addMany(files, (meta) => editorEl.value?.insertImage(meta))
}

/** Même chemin que dans le fil : voir `Composer.vue`. */
function onSticker(meta: ImageMeta): void {
  images.adopt(meta)
  editorEl.value?.insertImage(meta)
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const outcome = await publisher.publishTopic({
    title: title.value,
    content: body.value,
    tags: imetaTags(body.value, images.attached.value),
  })
  if (outcome && outcome.result.accepted.length > 0) {
    await router.push(topicPath(outcome.event.id, title.value))
  }
}
</script>

<style scoped>
/* ------------------------------------------------------------------ coquille
   Colonne pleine hauteur : en-tête et pied fixes, corps qui défile. C'est ce
   qui permet à la zone d'écriture d'absorber la place restante — sans elle, le
   panneau finissait sur une bande vide sous les boutons. */
.nt {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--surface);
}

/* Mesure de lecture partagée par l'en-tête, le corps et le pied. */
.nt__col {
  width: 100%;
  max-width: var(--topic-col, 880px);
  margin: 0 auto;
  padding-inline: 20px;
}

/* ----------------------------------------------------------------- en-tête */
/* Le bandeau garde son filet sur toute la largeur, son contenu descend dans
   `.nt__col` : sans ça la tête commençait au bord du panneau et le formulaire
   au bord de la colonne — deux départs pour un même écran, d'autant plus
   visibles depuis que la colonne s'est resserrée. */
.nt__head {
  flex-shrink: 0;
  padding: 14px 0;
  border-bottom: 1px solid var(--line-soft);
}
.nt__head-col {
  display: flex;
  align-items: center;
  gap: 14px;
}
.nt__back {
  display: none;
  flex-shrink: 0;
  padding: 5px 11px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  color: var(--ink-2);
  font-size: var(--fs-lg);
  line-height: 1.2;
}
.nt__back:hover {
  background: var(--surface-3);
}
.nt__av {
  flex-shrink: 0;
}
.nt__ident {
  min-width: 0;
}
.nt__kicker {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--ink);
}
/* Sous quel nom on signe. C'est la ligne que l'écran n'avait pas, et la seule
   qu'on ne peut pas retrouver après coup : un kind 11 est signé pour toujours. */
.nt__by {
  margin: 3px 0 0;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.nt__by strong {
  color: var(--ink-2);
  font-weight: 600;
}

/* -------------------------------------------------------------------- corps */
.nt__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.nt__body > .nt__col {
  display: flex;
  flex-direction: column;
  gap: 18px;
  /* Le contenu occupe au moins toute la zone : c'est ce que l'éditeur étire. */
  min-height: 100%;
  padding-block: 24px;
  box-sizing: border-box;
}

.nt__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.nt__field--grow {
  flex: 1;
}

/* --------------------------------------------------------------------- titre
   Le seul endroit audacieux de la page : le titre se saisit exactement tel
   qu'il sera lu en tête du topic. Champ sans cadre — un titre de ce corps dans
   une boîte bordée avait le langage du formulaire administratif ; le filet du
   bas suffit à dire qu'on y écrit. */
.nt__title {
  display: block;
  width: 100%;
  padding: 2px 0 10px;
  background: transparent;
  border: none;
  border-bottom: 2px solid var(--line);
  border-radius: 0;
  resize: none;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.25;
  outline: none;
  transition: border-color 0.14s ease;
}
.nt__title::placeholder {
  color: var(--ink-4);
  font-weight: 500;
}
.nt__title:focus {
  border-bottom-color: var(--link);
}

.nt__hint {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.nt__count {
  margin-left: auto;
  font-size: var(--fs-xs);
  letter-spacing: -0.02em;
  color: var(--ink-4);
}
.nt__count--low {
  color: var(--warn);
}

/* ------------------------------------------------------------------- éditeur
   Barre et zone de frappe dans un seul champ enfoncé : deux bordures qui se
   touchent feraient un double filet, et l'ensemble doit se lire comme un champ.
   Même traitement que le composeur du fil — c'est la même action. */
.nt__editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 220px;
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-panel);
  overflow: hidden;
  transition: background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
}
.nt__editor:focus-within {
  background: var(--surface);
  border-color: var(--link);
  box-shadow: var(--ring);
}
/* Retrait de 6px et non de 14 : les boutons portent 8px de padding interne, donc
   leur premier glyphe retombe sur la marge du texte au lieu de flotter 4px à
   droite de lui.

   Le filet va de bord à bord et reste au contraste de `--line` : la barre est le
   chrome du champ, la zone en dessous est le texte qu'on écrit. */
.nt__toolbar {
  flex-shrink: 0;
  padding: 7px 6px;
  border-bottom: 1px solid var(--line);
}
/* `:deep()` obligatoire : RichEditor est multi-racines, l'attribut de scope du
   parent ne tombe pas sur le champ — sans ça, aucune de ces règles ne matche. */
.nt__editor :deep(.nt__input) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 16px;
  font-size: var(--fs-lg);
  line-height: 1.6;
  color: var(--ink);
}

/* ---------------------------------------------------------------------- pied */
.nt__foot {
  flex-shrink: 0;
  padding-block: 12px 14px;
  border-top: 1px solid var(--line-soft);
  background: var(--surface);
}
.nt__row {
  display: flex;
  align-items: center;
  gap: 12px;
}
/* L'irréversibilité est dite ici, en une phrase et sans alarme : c'est au moment
   de cliquer qu'elle sert. En encart cramoisi permanent, elle criait pendant
   qu'on écrivait et n'apprenait rien à ce moment-là. */
.nt__note {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--ink-3);
}
.nt__note--miss {
  color: var(--ink-2);
  font-weight: 600;
}
.nt__error {
  margin: 0 0 10px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--warn);
}
.nt__pow {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
/* Le repoussoir est sur « Annuler » : l'action principale reste ainsi la plus à
   droite, là où le curseur remonte naturellement du champ de saisie. */
.nt__cancel {
  margin-left: auto;
}

/* Sous 820px la liste disparaît : le retour de l'en-tête est le seul chemin
   vers elle qui ne passe pas par « Annuler ». */
@media (max-width: 820px) {
  .nt__back {
    display: block;
  }
  .nt__head {
    padding-inline: 14px;
  }
}

@media (max-width: 700px) {
  .nt__col {
    padding-inline: 14px;
  }
  .nt__body > .nt__col {
    gap: 14px;
    padding-block: 18px;
  }
  .nt__title {
    font-size: 20px;
  }
  .nt__editor {
    min-height: 160px;
  }
  /* La phrase passe sur sa propre ligne plutôt que d'écraser les boutons. */
  .nt__row {
    flex-wrap: wrap;
  }
  .nt__note {
    flex-basis: 100%;
  }
}

/* Même raison que le composeur du fil (voir `Composer.vue`) : en paysage, le
   champ à 220 px poussait « Publier le topic » sous le pli. */
@media (max-height: 560px) {
  .nt__editor {
    min-height: 96px;
  }
  .nt__body > .nt__col {
    padding-block: 12px;
  }
}
</style>
