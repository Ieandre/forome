<template>
  <!-- La zone de frappe reçoit la classe posée par l'appelant, donc son padding
       et son défilement — un wrapper la rendrait injoignable de l'extérieur.
       Le Teleport voisin force le passage explicite par `$attrs` (deux racines,
       plus d'héritage automatique), mais ne l'emballe pas. -->
  <div
    ref="el"
    v-bind="$attrs"
    class="re__field"
    contenteditable="true"
    role="textbox"
    aria-multiline="true"
    :aria-label="label"
    :data-placeholder="placeholder"
    @input="onInput"
    @paste="onPaste"
    @drop="onDrop"
    @keydown="onKeydown"
    @click="onClick"
  />

  <!-- Menu de mentions. Au `body` comme la poignée, et pour la même raison : le
       champ défile, un enfant serait rogné par son overflow. Il suit le caret,
       donc il se replace au défilement au lieu de se fermer — on est en train
       d'écrire dedans. -->
  <Teleport to="body">
    <div v-if="menuOpen" ref="menuEl" class="re-mn" :style="menuStyle">
      <p v-if="atCap" class="re-mn__note">
        {{ MAX_MENTIONS }} mentions au maximum dans un message.
      </p>
      <ul v-else class="re-mn__list" role="listbox" aria-label="mentionner quelqu'un">
        <li v-for="(c, i) in mentions" :key="c.pubkey" role="option" :aria-selected="i === active">
          <!-- `mousedown.prevent` : sans lui le champ perd le focus avant le clic,
               donc la sélection à remplacer n'existe plus au moment d'insérer. -->
          <button
            type="button"
            class="re-mn__item"
            :class="{ 're-mn__item--on': i === active }"
            @mousedown.prevent="pickMention(i)"
          >
            <span class="re-mn__name">{{ c.name }}</span>
            <span v-if="c.disc" class="re-mn__disc mono">·{{ c.disc }}</span>
          </button>
        </li>
      </ul>
    </div>
  </Teleport>

  <!-- Poignée de redimensionnement de l'image sélectionnée. Au `body` et en
       `fixed` : le champ défile, un enfant serait rogné par son overflow. En
       contrepartie elle ne suit pas le défilement — d'où la fermeture au scroll,
       comme `useAnchoredLayer`. -->
  <Teleport to="body">
    <div v-if="picked" ref="rzEl" class="re-rz" :style="rzStyle">
      <span class="re-rz__size">{{ rzWidth }} px</span>
      <span
        class="re-rz__handle"
        role="presentation"
        @pointerdown="onHandleDown"
        @pointermove="onHandleMove"
        @pointerup="onHandleUp"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Éditeur de texte enrichi — le texte s'affiche **stylisé pendant la frappe**,
 * pas dans un aperçu séparé.
 *
 * ## Ce que ça implique, et qu'il faut traiter
 *
 * `contenteditable` est une boîte à HTML arbitraire : le navigateur y produit ses
 * propres balises, et un collage depuis une page web y injecte tout ce qu'elle
 * contient. Deux barrières :
 *
 *   1. **le collage est forcé en texte brut.** C'est aussi ce qu'attend
 *      quelqu'un qui colle depuis un traitement de texte : il veut son texte, pas
 *      ses polices. Le glisser-déposer est bloqué pour la même raison.
 *   2. **la sérialisation ne lit qu'une liste blanche** (`utils/serialize.ts`).
 *      Ce qui sort est du texte avec des marqueurs, jamais du HTML.
 *
 * ## `execCommand`, en connaissance de cause
 *
 * Il est déprécié et il n'a aucun remplaçant : mettre en gras une sélection dans
 * un `contenteditable` n'a pas d'API moderne. Il est implémenté partout, et le
 * jour où il disparaîtra, la sérialisation par liste blanche fera qu'un
 * changement de sortie du navigateur restera lisible. On l'appelle avec
 * `styleWithCSS = false` pour obtenir des balises (`<b>`) et non des styles en
 * ligne (`<span style>`), que la sérialisation ignorerait.
 *
 * ## Flux de données à sens unique
 *
 * L'éditeur est la source de vérité : il émet le balisage sérialisé. Il ne
 * reconstruit **pas** son contenu depuis `modelValue` — ça demanderait un
 * second renderer balisage → DOM, et un aller-retour à chaque frappe
 * repositionnerait le curseur. Pour vider, l'appelant utilise `clear()`.
 */
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { serializeToMarkup, markupToDom, type NameOf } from '~/utils/serialize'
import type { MarkupKind, BlockKind } from '~/utils/serialize'
import { postImageSrc, IMG_DISPLAY_MIN, IMG_DISPLAY_MAX } from '~/utils/media'
import { MAX_MENTIONS, type MentionCandidate } from '~/utils/mentions'

// Deux racines (le champ + le Teleport de la poignée) : l'héritage automatique
// des attributs ne joue plus, le champ les reprend par `v-bind="$attrs"`.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    placeholder?: string
    label?: string
    submitOnEnter?: boolean
    /**
     * Candidats à afficher pour la frappe `@…` en cours. L'éditeur détecte la
     * frappe et remonte la requête ; c'est l'hôte qui sait **qui** proposer —
     * lui seul connaît les gens du fil et les suivis. Voir l'en-tête : cet
     * éditeur ne parle ni aux stores ni au réseau.
     */
    mentions?: MentionCandidate[]
  }>(),
  { placeholder: '', label: 'Message', submitOnEnter: true, mentions: () => [] },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  /** Images déposées dans le champ (collage, glisser-déposer) — à téléverser. */
  files: [files: File[]]
  /** L'auteur a donné une largeur d'affichage à une image (poignée de coin). */
  imageResize: [url: string, width: number]
  /** Frappe `@requête` en cours, ou `null` quand il n'y en a plus. */
  'update:mentionQuery': [query: string | null]
}>()

const el = ref<HTMLElement | null>(null)

/**
 * Le dernier caret posé **dans le champ**.
 *
 * Toute commande de la barre d'outils passe par un bouton, et un tiroir de
 * stickers a en plus son champ de recherche : au moment où l'on insère, la
 * sélection du document est ailleurs. `focus()` seul ne la ramène pas — sur un
 * `contenteditable` sans sélection antérieure, il remet le curseur au début, et
 * le sticker s'écrivait donc en tête de message au lieu de l'endroit visé.
 */
let caret: Range | null = null

function rememberCaret(): void {
  const root = el.value
  const sel = window.getSelection()
  if (!root || !sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (root.contains(range.commonAncestorContainer)) caret = range.cloneRange()
  // Clic ou flèche ailleurs : le `@` qu'on complétait n'est plus sous le caret,
  // et un menu qui survit à ça insère la mention au mauvais endroit.
  if (trigger && range.startContainer !== trigger.node) closeMention()
}

/** Rend la main au champ, curseur là où l'auteur l'avait laissé. */
function restoreCaret(): void {
  const root = el.value
  if (!root) return
  root.focus()
  const sel = window.getSelection()
  if (!sel) return

  const range = document.createRange()
  // Le caret mémorisé peut pointer un nœud effacé depuis (frappe, `clear()`).
  if (caret && root.contains(caret.commonAncestorContainer)) {
    range.setStart(caret.startContainer, caret.startOffset)
    range.setEnd(caret.endContainer, caret.endOffset)
  } else {
    range.selectNodeContents(root)
    range.collapse(false)
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

onMounted(() => {
  // Balises plutôt que styles en ligne — voir l'en-tête.
  try {
    document.execCommand('styleWithCSS', false, 'false')
    // Firefox pose ses propres poignées sur les images d'un contenteditable :
    // elles écriraient un style que la sérialisation ignore, et doublonneraient
    // la nôtre.
    document.execCommand('enableObjectResizing', false, 'false')
  } catch {
    /* navigateur sans execCommand : la frappe marche, la barre d'outils non */
  }
  document.addEventListener('selectionchange', rememberCaret)
  // Capture : le champ lui-même défile pendant la frappe, et son scroll ne
  // remonte pas jusqu'à `window` autrement.
  window.addEventListener('scroll', onViewportShift, true)
  window.addEventListener('resize', onViewportShift)
})

function onViewportShift(): void {
  if (query.value !== null) void placeMenu()
}

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', rememberCaret)
  window.removeEventListener('scroll', onViewportShift, true)
  window.removeEventListener('resize', onViewportShift)
  unpick()
})

function emitValue(): void {
  if (el.value) emit('update:modelValue', serializeToMarkup(el.value))
}

function onInput(): void {
  // La frappe redessine le champ : la poignée, elle, resterait sur l'ancienne
  // position de l'image — et l'image sélectionnée a pu être effacée.
  unpick()
  detectMention()
  emitValue()
}

/** Les fichiers image d'un presse-papier ou d'un glisser-déposer. */
function imagesOf(files: FileList | undefined | null): File[] {
  return [...(files ?? [])].filter((f) => f.type.startsWith('image/'))
}

/**
 * Collage en texte brut : première barrière contre le HTML étranger.
 *
 * Sauf une image — coller une capture d'écran est le geste le plus courant pour
 * en poster une, et la refuser au motif qu'un collage peut transporter du HTML
 * reviendrait à interdire la fonctionnalité pour protéger le champ. Le fichier
 * ne touche pas au DOM : il part en dépôt, et c'est `insertImage` qui écrit.
 */
function onPaste(e: ClipboardEvent): void {
  const files = imagesOf(e.clipboardData?.files)
  if (files.length) {
    e.preventDefault()
    emit('files', files)
    return
  }
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (text) document.execCommand('insertText', false, text)
  emitValue()
}

/** Même raison que le collage : un glisser-déposer transporte du HTML. */
function onDrop(e: DragEvent): void {
  e.preventDefault()
  const files = imagesOf(e.dataTransfer?.files)
  if (files.length) {
    emit('files', files)
    return
  }
  const text = e.dataTransfer?.getData('text/plain') ?? ''
  if (text) document.execCommand('insertText', false, text)
  emitValue()
}

/**
 * Insère une image **déjà déposée** — l'éditeur ne connaît ni le réseau ni les
 * clés, il reçoit une adresse et l'écrit.
 *
 * Par nœud DOM et non par `insertHTML` : construire une chaîne de HTML avec une
 * URL dedans est exactement la manœuvre qui finit en injection le jour où
 * l'adresse contient un guillemet.
 */
function insertImage(img: {
  url: string
  alt?: string
  width?: number | null
  height?: number | null
  risibank?: number
}): void {
  const root = el.value
  if (!root) return
  restoreCaret()

  const node = document.createElement('img')
  // L'aperçu passe par le proxy, comme à l'affichage : l'auteur voit ce que
  // verront les lecteurs, et son propre navigateur ne contacte pas l'hôte.
  node.src = postImageSrc(img.url)
  node.dataset.url = img.url
  node.alt = img.alt ?? ''
  node.className = 're-img'
  // La largeur du fichier borne la poignée d'une photo — l'agrandir au-delà
  // n'afficherait que du flou. Pas pour un sticker : ses dimensions sont déjà
  // celles d'affichage (hauteur commune d'insertion, voir `useStickerPicker`),
  // et l'agrandir est un usage voulu, tant pis pour les pixels.
  if (img.width && !img.risibank) node.dataset.natw = String(img.width)

  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  range.insertNode(node)

  // Curseur après l'image, pour continuer à écrire dessous.
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  rememberCaret()

  emitValue()
}

/* ------------------------------------------------- redimensionnement d'image
 *
 * Cliquer une image la sélectionne et pose une poignée sur son coin bas-droit ;
 * la tirer règle la largeur, bornée entre `IMG_DISPLAY_MIN` et le plus petit de
 * `IMG_DISPLAY_MAX`, la largeur du fichier et celle du champ. Le geste ne
 * change PAS le texte sérialisé — l'URL reste nue — il remonte à l'hôte par
 * `imageResize`, qui met à jour les dimensions de l'`imeta` à publier.
 */

const picked = ref<HTMLImageElement | null>(null)
const rzEl = ref<HTMLElement | null>(null)
const rzStyle = ref<Record<string, string>>({})
const rzWidth = ref(0)
let drag: { startX: number; startW: number; moved: boolean } | null = null

function isResizable(t: EventTarget | null): t is HTMLImageElement {
  return t instanceof HTMLImageElement && t.classList.contains('re-img')
}

function onClick(e: MouseEvent): void {
  if (isResizable(e.target)) pick(e.target)
  else unpick()
}

function pick(img: HTMLImageElement): void {
  if (picked.value === img) return
  unpick()
  picked.value = img
  img.classList.add('re-img--picked')
  placeHandle()
  window.addEventListener('scroll', unpick, true)
  window.addEventListener('resize', unpick)
  document.addEventListener('pointerdown', onOutsidePointer, true)
}

function unpick(): void {
  const img = picked.value
  if (!img) return
  img.classList.remove('re-img--picked')
  picked.value = null
  drag = null
  window.removeEventListener('scroll', unpick, true)
  window.removeEventListener('resize', unpick)
  document.removeEventListener('pointerdown', onOutsidePointer, true)
}

function onOutsidePointer(e: PointerEvent): void {
  const t = e.target as Node
  if (t === picked.value || rzEl.value?.contains(t)) return
  unpick()
}

/** Pose le calque sur le coin bas-droit de l'image, en coordonnées d'écran. */
function placeHandle(): void {
  const img = picked.value
  if (!img) return
  const r = img.getBoundingClientRect()
  rzWidth.value = Math.round(r.width)
  rzStyle.value = { top: `${Math.round(r.bottom)}px`, left: `${Math.round(r.right)}px` }
}

function maxWidth(img: HTMLImageElement): number {
  const natural = Number(img.dataset.natw) || IMG_DISPLAY_MAX
  // -8 : la marge de l'image et sa bordure — au-delà, le CSS la rabattrait à
  // 100% et la poignée mentirait sur la taille réellement affichée.
  const field = el.value ? el.value.clientWidth - 8 : IMG_DISPLAY_MAX
  return Math.max(IMG_DISPLAY_MIN, Math.min(IMG_DISPLAY_MAX, natural, field))
}

function onHandleDown(e: PointerEvent): void {
  const img = picked.value
  if (!img) return
  e.preventDefault()
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  drag = { startX: e.clientX, startW: img.getBoundingClientRect().width, moved: false }
}

function onHandleMove(e: PointerEvent): void {
  const img = picked.value
  if (!drag || !img) return
  const w = Math.round(
    Math.min(Math.max(drag.startW + (e.clientX - drag.startX), IMG_DISPLAY_MIN), maxWidth(img)),
  )
  // `--sized` lève le plafond d'aperçu (160 px) : une fois la taille choisie,
  // l'aperçu doit la montrer, sinon la poignée règlerait une valeur invisible.
  img.classList.add('re-img--sized')
  img.style.width = `${w}px`
  drag.moved = true
  placeHandle()
}

function onHandleUp(): void {
  const img = picked.value
  if (drag?.moved && img) {
    // La largeur réellement rendue, pas celle demandée : c'est elle que le
    // lecteur verra, donc elle que l'imeta doit décrire.
    emit('imageResize', img.dataset.url ?? '', Math.round(img.getBoundingClientRect().width))
  }
  drag = null
}

/* ------------------------------------------------------------------ mentions
 *
 * Taper `@` ouvre un menu ; choisir quelqu'un remplace le `@requête` par une
 * pastille non éditable qui porte sa CLÉ (`data-mention`). La sérialisation en
 * fait un `nostr:npub1…` et le publieur en tire le tag `p` — voir
 * `utils/mentions.ts` pour le pourquoi de ce format.
 *
 * L'éditeur ne cherche pas les candidats lui-même : il remonte la requête et
 * reçoit la liste (prop `mentions`). Il ne connaît donc toujours ni les clés ni
 * le réseau, comme pour les images.
 */

const query = ref<string | null>(null)
const active = ref(0)
const menuEl = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const atCap = ref(false)

/** Le `@requête` en cours de frappe, à remplacer par la pastille. */
let trigger: { node: Text; start: number } | null = null

const menuOpen = computed(
  () => query.value !== null && (atCap.value || props.mentions.length > 0),
)

/**
 * Amorce d'une mention : un `@` en début de mot, suivi de ce qui a été tapé
 * depuis. Le `@` collé à la fin d'un mot (`a@b`) n'en est pas une — c'est une
 * adresse e-mail, et l'ouvrir sur chaque arobase rendrait le menu insupportable.
 */
const MENTION_TYPING = /(?:^|[\s(\[«"'])@([^\s@]{0,30})$/u

function closeMention(): void {
  trigger = null
  atCap.value = false
  if (query.value === null) return
  query.value = null
  emit('update:mentionQuery', null)
}

/** true dans un bloc ou un fragment de code, où une npub s'affiche littéralement. */
function inCode(node: Node): boolean {
  let cur: Node | null = node
  while (cur && cur !== el.value) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const e = cur as HTMLElement
      if (e.tagName === 'PRE' || e.tagName === 'CODE' || e.dataset.markup === 'code') return true
    }
    cur = cur.parentNode
  }
  return false
}

function detectMention(): void {
  const root = el.value
  const sel = window.getSelection()
  if (!root || !sel || sel.rangeCount === 0) return closeMention()

  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (!range.collapsed || !root.contains(node) || node.nodeType !== Node.TEXT_NODE) {
    return closeMention()
  }
  if (inCode(node)) return closeMention()

  const before = (node.textContent ?? '').slice(0, range.startOffset)
  const m = MENTION_TYPING.exec(before)
  if (!m) return closeMention()

  trigger = { node: node as Text, start: range.startOffset - (m[1]!.length + 1) }
  atCap.value = root.querySelectorAll('[data-mention]').length >= MAX_MENTIONS
  active.value = 0
  if (query.value !== m[1]) {
    query.value = m[1]!
    emit('update:mentionQuery', query.value)
  }
  void placeMenu()
}

/**
 * Pose le menu sous le `@` en cours, en coordonnées d'écran.
 *
 * La mesure porte sur un range **non replié** (du `@` au caret) : le rectangle
 * d'un range replié est vide dans plusieurs navigateurs, et le menu se
 * retrouvait dans le coin de la page.
 */
async function placeMenu(): Promise<void> {
  await nextTick()
  const t = trigger
  const sel = window.getSelection()
  if (!t || !sel || sel.rangeCount === 0) return

  const caret = sel.getRangeAt(0)
  const probe = document.createRange()
  try {
    probe.setStart(t.node, t.start)
    probe.setEnd(caret.endContainer, caret.endOffset)
  } catch {
    // le nœud du `@` a disparu entre-temps (frappe rapide, `clear()`)
    return closeMention()
  }
  const r = probe.getBoundingClientRect()
  if (!r.width && !r.height) return

  const h = menuEl.value?.getBoundingClientRect().height ?? 200
  const w = menuEl.value?.getBoundingClientRect().width ?? 240
  const below = window.innerHeight - r.bottom - 8
  const top = below >= h || below >= r.top ? r.bottom + 6 : r.top - 6 - h
  const left = Math.min(Math.max(r.left, 8), Math.max(8, window.innerWidth - 8 - w))
  menuStyle.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` }
}

function pickMention(i: number): void {
  const c = props.mentions[i]
  const t = trigger
  const root = el.value
  const sel = window.getSelection()
  if (!c || !t || !root || atCap.value || !sel || sel.rangeCount === 0) return

  const caret = sel.getRangeAt(0)
  const range = document.createRange()
  try {
    range.setStart(t.node, t.start)
    range.setEnd(caret.endContainer, caret.endOffset)
  } catch {
    return closeMention()
  }
  range.deleteContents()

  const chip = document.createElement('span')
  chip.dataset.mention = c.pubkey
  chip.className = 're-mention'
  // Non éditable : la pastille s'efface d'un seul retour arrière. Corriger le
  // pseudo à l'intérieur ne changerait de toute façon rien à la clé publiée.
  chip.setAttribute('contenteditable', 'false')
  chip.textContent = `@${c.name}`
  range.insertNode(chip)

  // Espace insécable après la pastille : une espace ordinaire en fin de champ est
  // effondrée par le navigateur, et sans séparateur le mot suivant se collerait à
  // l'URI — le parseur l'avalerait dans le bech32 et la mention deviendrait du
  // texte. La sérialisation la rend en espace ordinaire.
  const space = document.createTextNode('\u00a0')
  range.setStartAfter(chip)
  range.collapse(true)
  range.insertNode(space)

  range.setStartAfter(space)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  rememberCaret()

  closeMention()
  emitValue()
}

/** La liste change (profils arrivés, requête affinée) : replacer et recadrer. */
watch(
  () => props.mentions,
  () => {
    if (query.value === null) return
    if (active.value >= props.mentions.length) active.value = 0
    void placeMenu()
  },
)

const INLINE_COMMAND: Partial<Record<MarkupKind, string>> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikeThrough',
}

/** Enveloppe la sélection dans un span marqué — pour ce qu'`execCommand` ignore. */
function wrapSelection(kind: 'spoiler' | 'code'): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.value) return
  const range = sel.getRangeAt(0)
  if (!el.value.contains(range.commonAncestorContainer)) return

  const span = document.createElement('span')
  span.dataset.markup = kind
  span.className = kind === 'spoiler' ? 're-spoiler' : 're-code'
  try {
    span.appendChild(range.extractContents())
    if (!span.textContent) span.textContent = kind === 'spoiler' ? 'spoiler' : 'code'
    range.insertNode(span)
    // curseur après l'insertion, pour continuer à écrire hors du span
    range.setStartAfter(span)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    rememberCaret()
  } catch {
    /* sélection impossible à extraire (limites d'éléments) : on n'insiste pas */
  }
  emitValue()
}

function toggleInline(kind: MarkupKind): void {
  restoreCaret()
  const cmd = INLINE_COMMAND[kind]
  if (cmd) document.execCommand(cmd)
  else wrapSelection(kind === 'spoiler' ? 'spoiler' : 'code')
  emitValue()
}

function toggleBlock(kind: BlockKind): void {
  restoreCaret()
  switch (kind) {
    case 'quote':
      document.execCommand('formatBlock', false, 'blockquote')
      break
    case 'ul':
      document.execCommand('insertUnorderedList')
      break
    case 'ol':
      document.execCommand('insertOrderedList')
      break
    case 'codeblock':
      document.execCommand('formatBlock', false, 'pre')
      break
  }
  emitValue()
}

function insertLink(): void {
  restoreCaret()
  const sel = window.getSelection()
  const selected = sel?.toString() ?? ''
  const url = window.prompt('Adresse du lien', selected.startsWith('http') ? selected : 'https://')
  if (!url) return
  // Liste blanche ici aussi : `createLink` accepterait `javascript:`, et la
  // sérialisation le rejetterait ensuite — autant ne pas le créer du tout.
  if (!/^(https?:\/\/|nostr:|mailto:)/i.test(url.trim())) return
  // La boîte de dialogue a rendu la main entre-temps : sans ça, `createLink`
  // n'aurait plus de sélection sur laquelle mordre.
  restoreCaret()
  if (selected) document.execCommand('createLink', false, url.trim())
  else document.execCommand('insertHTML', false, '')
  emitValue()
}

function onKeydown(e: KeyboardEvent): void {
  /*
   * Le menu de mentions capte le clavier en premier : tant qu'il est ouvert,
   * Entrée choisit un candidat au lieu de poster le message. C'est l'ordre qui
   * compte ici — publier « salut @kh » à la place d'insérer la mention est une
   * erreur définitive sur un réseau sans suppression.
   */
  if (menuOpen.value) {
    const n = props.mentions.length
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMention()
      return
    }
    if (n > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        active.value = (active.value + 1) % n
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        active.value = (active.value - 1 + n) % n
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(active.value)
        return
      }
    }
  }

  if (e.key === 'Escape' && picked.value) {
    unpick()
    return
  }
  if (e.metaKey || e.ctrlKey) {
    const key = e.key.toLowerCase()
    if (key === 'b' || key === 'i' || key === 'u') {
      e.preventDefault()
      toggleInline(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline')
      return
    }
    if (key === 'k') {
      e.preventDefault()
      insertLink()
      return
    }
  }
  if (props.submitOnEnter && e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    emit('submit')
  }
}

function clear(): void {
  unpick()
  closeMention()
  if (el.value) el.value.innerHTML = ''
  caret = null
  emit('update:modelValue', '')
}

/**
 * Ouvre un message déjà publié pour le corriger (spec v2 §2.5).
 *
 * C'est l'unique dérogation au sens unique décrit en tête de fichier, et elle
 * tient parce qu'elle a lieu **une fois, avant la première frappe** : le curseur
 * n'existe pas encore, donc il n'y a rien à repositionner. Appeler `seed()`
 * pendant la frappe casserait la saisie — c'est réservé à l'ouverture.
 *
 * Par nœuds DOM et non `innerHTML` : `markupToDom` construit des éléments, rien
 * du contenu ne repasse jamais par une chaîne de HTML.
 */
function seed(markup: string, nameOf?: NameOf): void {
  const root = el.value
  if (!root) return
  unpick()
  closeMention()
  // `nameOf` : le pseudo à écrire dans les pastilles de mention du message
  // rouvert. Sans lui elles retomberaient sur `khey_…`, donc corriger une faute
  // changerait sous les yeux de l'auteur des pseudos qu'il n'a pas touchés.
  root.replaceChildren(markupToDom(markup, document, nameOf))
  caret = null
  emitValue()
}

function focus(): void {
  el.value?.focus()
}

defineExpose({ toggleInline, toggleBlock, insertLink, insertImage, clear, seed, focus })
</script>

<style scoped>
.re__field {
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Le champ vide affiche son invite : un `contenteditable` n'a pas de
   `placeholder` natif. */
.re__field:empty::before {
  content: attr(data-placeholder);
  color: var(--ink-4, #888);
  pointer-events: none;
}

/* Le rendu pendant la frappe doit ressembler au rendu publié, sinon l'éditeur
   mentirait sur le résultat. Ces règles visent les balises produites par
   `execCommand`, qui varient selon le navigateur — d'où les doublons. */
.re__field :deep(b),
.re__field :deep(strong) {
  font-weight: 700;
}
.re__field :deep(i),
.re__field :deep(em) {
  font-style: italic;
}
.re__field :deep(u) {
  text-decoration: underline;
}
.re__field :deep(s),
.re__field :deep(strike),
.re__field :deep(del) {
  text-decoration: line-through;
}
.re__field :deep(blockquote) {
  margin: 0.3em 0;
  padding-left: 10px;
  border-left: 2px solid var(--line-strong, currentColor);
  color: var(--ink-3, inherit);
}
.re__field :deep(ul),
.re__field :deep(ol) {
  margin: 0.3em 0;
  padding-left: 1.5em;
}
.re__field :deep(pre) {
  margin: 0.3em 0;
  padding: 6px 8px;
  background: var(--surface-sunken, var(--surface-2, transparent));
  border: 1px solid var(--line-soft, currentColor);
  border-radius: var(--r-control, 9px);
  font-family: var(--font-mono, monospace);
  white-space: pre-wrap;
}
.re__field :deep(a) {
  color: var(--link, currentColor);
  text-decoration: underline;
}
.re__field :deep(.re-code) {
  padding: 0 3px;
  background: var(--surface-sunken, var(--surface-3, transparent));
  border: 1px solid var(--line-soft, currentColor);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
}

/* L'image dans l'éditeur est un aperçu, pas le rendu final : plus petite qu'au
   fil, pour qu'une capture d'écran ne remplisse pas la zone de frappe. Elle se
   sélectionne et s'efface comme un caractère — c'est ce qui permet de la retirer
   sans chercher de bouton. */
.re__field :deep(.re-img) {
  /* `inline-block` et non `block` : l'image reste là où le curseur était. Un
     sticker inséré au milieu d'une phrase y reste, et une image trop large pour
     la ligne s'isole toute seule par sa largeur. */
  display: inline-block;
  /* `bottom` : sans lui, la ligne de base laisse un creux sous le sticker et le
     texte autour semble décalé vers le haut. */
  vertical-align: bottom;
  max-width: 100%;
  max-height: 160px;
  margin: 2px;
  border: 1px solid var(--line-soft, currentColor);
  border-radius: var(--r-control, 9px);
}

/* Une taille a été choisie à la poignée : le plafond d'aperçu saute, l'image
   s'affiche à cette taille — c'est elle qui sera publiée. `height: auto` pour
   que le ratio suive la largeur au lieu d'être écrasé par le max-height. */
.re__field :deep(.re-img--sized) {
  max-height: none;
  height: auto;
}

.re__field :deep(.re-img--picked) {
  outline: 2px solid var(--link, currentColor);
  outline-offset: 1px;
}

/* La poignée elle-même est téléportée au body : voir le Teleport du template. */
.re-rz {
  position: fixed;
  z-index: 80;
  width: 0;
  height: 0;
}
.re-rz__handle {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--surface, #fff);
  border: 2px solid var(--link, currentColor);
  cursor: nwse-resize;
  /* Sans ça, le doigt fait défiler la page au lieu de tirer la poignée. */
  touch-action: none;
}
.re-rz__size {
  position: absolute;
  bottom: 12px;
  right: 12px;
  padding: 1px 6px;
  background: var(--surface, #fff);
  border: 1px solid var(--line-soft, currentColor);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--ink-3, inherit);
  white-space: nowrap;
  pointer-events: none;
}

/* Le spoiler reste lisible pour son auteur — le masquer pendant qu'il écrit
   l'empêcherait de se relire. Il est marqué, pas caché. */
.re__field :deep(.re-spoiler) {
  padding: 0 3px;
  background: var(--surface-3, rgba(0, 0, 0, 0.1));
  border-bottom: 1px dashed var(--ink-4, currentColor);
}

/* Pastille de mention pendant la frappe : le même bleu qu'au fil (voir
   `PostMention`), en plus discret — ici elle est un objet qu'on peut effacer,
   pas un lien qu'on peut suivre. */
.re__field :deep(.re-mention) {
  color: var(--link, currentColor);
  font-weight: 600;
  white-space: nowrap;
  /* Le caret ne peut pas entrer dedans (`contenteditable=false`) : sans ce
     signal, on croit pouvoir corriger le pseudo à la main. */
  cursor: default;
}

/* Le menu de mentions, téléporté au body : voir le Teleport du template. */
.re-mn {
  position: fixed;
  z-index: 80;
  min-width: 180px;
  max-width: min(320px, calc(100vw - 16px));
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control, 9px);
  box-shadow: var(--shadow-pop);
}
.re-mn__list {
  margin: 0;
  padding: 0;
  list-style: none;
  /* Six candidats tiennent sans défilement ; au-delà, on cherche par la frappe
     plutôt qu'à la molette. */
  max-height: 232px;
  overflow-y: auto;
}
.re-mn__item {
  display: flex;
  align-items: baseline;
  gap: 5px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: var(--r-pastille, 6px);
  background: none;
  font: inherit;
  font-size: var(--fs-md);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
.re-mn__item--on,
.re-mn__item:hover {
  background: var(--surface-3);
}
.re-mn__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.re-mn__disc {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.re-mn__note {
  margin: 0;
  padding: 6px 8px;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
</style>
