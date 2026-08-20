/**
 * Sérialisation DOM → balisage, pour l'éditeur WYSIWYG.
 *
 * C'est l'inverse de `richtext.ts` : celui-ci lit du balisage pour l'afficher,
 * celui-là lit ce que l'utilisateur a composé pour le publier.
 *
 * ## Pourquoi une liste blanche stricte
 *
 * `contenteditable` est une boîte à HTML arbitraire. Le navigateur y produit ses
 * propres balises (`<b>` chez l'un, `<strong>` chez l'autre, des `<div>` et des
 * `<font>` selon les versions), et un collage depuis une page web y injecte
 * n'importe quoi — styles, tableaux, scripts, attributs d'événement.
 *
 * Donc **on n'inspecte que ce qu'on reconnaît** : chaque balise hors liste est
 * traversée pour son texte et rien d'autre. Aucun attribut n'est lu sauf `href`
 * (avec la même liste blanche de schémas que le parseur). Ce qui sort est du
 * texte avec des marqueurs, jamais du HTML — donc rien de ce qui a été collé ne
 * peut survivre au voyage vers le relais.
 *
 * Le collage est en outre forcé en texte brut côté éditeur : cette fonction est
 * la seconde barrière, pas la première.
 */

import { parseRichText, type Block, type InlineToken } from '~/utils/richtext'
import { postImageSrc } from '~/utils/media'

/** Mises en forme en ligne proposées par la barre d'outils. */
export type MarkupKind = 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler' | 'code'
/** Mises en forme de bloc. */
export type BlockKind = 'quote' | 'ul' | 'ol' | 'codeblock'

const SAFE_SCHEMES = ['http://', 'https://', 'nostr:', 'mailto:']

function isSafeHref(href: string): boolean {
  const lower = href.trim().toLowerCase()
  return SAFE_SCHEMES.some((s) => lower.startsWith(s))
}

/** Marqueurs produits, alignés sur ce que `richtext.ts` sait relire. */
const INLINE_WRAP: Record<string, string> = {
  STRONG: '**',
  B: '**',
  EM: '*',
  I: '*',
  U: '++',
  S: '~~',
  STRIKE: '~~',
  DEL: '~~',
}

/** Balises de bloc traitées à part, jamais encadrées comme de l'inline. */
const BLOCK_TAGS = new Set(['P', 'DIV', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'BR'])

/**
 * Échappe les caractères qui seraient relus comme du balisage.
 *
 * Sans ça, écrire littéralement `**` dans l'éditeur produirait du gras à
 * l'affichage — l'utilisateur verrait son texte changer de sens en le publiant.
 */
function escapeMarkers(text: string): string {
  return text.replace(/([*~+|`\\[\]])/g, '\\$1')
}

interface Ctx {
  /** préfixe appliqué à chaque ligne (citation, éléments de liste) */
  linePrefix: string
  /** true à l'intérieur d'un bloc de code : aucun échappement, aucun marqueur */
  raw: boolean
}

function serializeNode(node: Node, ctx: Ctx): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    return ctx.raw ? text : escapeMarkers(text)
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as HTMLElement
  const tag = el.tagName

  if (tag === 'BR') return '\n'

  // Spoiler et code en ligne : pas d'équivalent `execCommand`, donc marqués par
  // un attribut de données que l'éditeur pose lui-même.
  const custom = el.dataset.markup
  if (custom === 'spoiler') return `||${childrenOf(el, ctx)}||`
  if (custom === 'code') return `\`${childrenOf(el, { ...ctx, raw: true })}\``

  if (tag === 'CODE' && el.parentElement?.tagName !== 'PRE') {
    return `\`${childrenOf(el, { ...ctx, raw: true })}\``
  }

  if (tag === 'PRE') {
    const body = childrenOf(el, { ...ctx, raw: true }).replace(/\n+$/, '')
    // `data-lang` n'est jamais posé par la frappe — la barre d'outils ne propose
    // pas de langage. Il l'est par `markupToDom`, qui rouvre un message existant :
    // sans lui, corriger une faute dans un message contenant ```js le republierait
    // en ```, et la coloration disparaîtrait sans que personne ait rien demandé.
    const lang = /^\w{1,20}$/.test(el.dataset.lang ?? '') ? el.dataset.lang : ''
    return `\n\`\`\`${lang}\n${body}\n\`\`\`\n`
  }

  if (tag === 'BLOCKQUOTE') {
    const inner = childrenOf(el, { ...ctx, linePrefix: '' }).trim()
    const quoted = inner
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    return `\n${quoted}\n`
  }

  if (tag === 'UL' || tag === 'OL') {
    const items = [...el.children].filter((c) => c.tagName === 'LI')
    const lines = items.map((li, i) => {
      const marker = tag === 'OL' ? `${i + 1}. ` : '- '
      return marker + childrenOf(li as HTMLElement, { ...ctx, linePrefix: '' }).trim()
    })
    return `\n${lines.join('\n')}\n`
  }

  /*
   * Image : on publie l'URL **nue**, à sa place dans la phrase, et non `![](…)`.
   *
   * C'est la convention de Nostr — l'adresse est posée dans le contenu, les
   * métadonnées vont dans le tag `imeta` (NIP-92). Un message ainsi écrit
   * s'affiche comme une image dans les autres clients, alors que du Markdown y
   * apparaîtrait avec ses crochets. `data-url` porte l'adresse canonique de
   * l'hôte ; `src`, lui, est l'aperçu par le proxy et n'a pas à voyager.
   *
   * ⚠️ Encadrée d'espaces, pas de sauts de ligne. Le saut forcé déplaçait
   * l'image sur sa propre ligne alors que l'auteur venait de l'insérer au milieu
   * de sa phrase — faux pour une image jointe, et franchement faux pour un
   * sticker, dont l'usage même est d'être DANS la ligne. Les espaces suffisent au
   * parseur pour isoler l'URL (voir `BARE_URL`), et une image trop large pour
   * partager la ligne s'isole d'elle-même au rendu, par sa largeur.
   */
  if (tag === 'IMG') {
    const url = (el.dataset.url ?? '').trim()
    return isSafeHref(url) ? ` ${url} ` : ''
  }

  if (tag === 'A') {
    const href = el.getAttribute('href') ?? ''
    const label = childrenOf(el, ctx).trim()
    // Lien dont le libellé EST l'URL : inutile de le baliser, le parseur
    // détecte les URLs nues.
    if (!isSafeHref(href)) return label
    if (label === href.trim()) return href.trim()
    return `[${label}](${href.trim()})`
  }

  const wrap = INLINE_WRAP[tag]
  if (wrap && !ctx.raw) {
    const inner = childrenOf(el, ctx)
    // Ne pas produire `****` sur un élément vide : le parseur y verrait un
    // marqueur non fermé et l'afficherait littéralement.
    if (!inner.trim()) return inner
    return `${wrap}${inner}${wrap}`
  }

  // Bloc générique (`P`, `DIV`) : sépare les lignes. Tout le reste — `SPAN`,
  // `FONT`, `TABLE`, l'inconnu — est traversé pour son texte seulement.
  const inner = childrenOf(el, ctx)
  if (BLOCK_TAGS.has(tag)) return `${inner}\n`
  return inner
}

/**
 * Balises qui préfixent leur sortie d'un saut de ligne pour garantir de démarrer
 * en début de ligne. Voir `childrenOf` : ce saut est retiré quand on y est déjà.
 */
const SELF_PREFIXED = new Set(['PRE', 'BLOCKQUOTE', 'UL', 'OL'])

function childrenOf(el: HTMLElement, ctx: Ctx): string {
  let out = ''
  for (const child of el.childNodes) {
    let piece = serializeNode(child, ctx)
    /*
     * Le saut de tête d'un bloc est une garantie, pas un blanc voulu : si la
     * sortie est déjà en début de ligne, il produit une ligne VIDE que personne
     * n'a tapée. Sans conséquence tant qu'on ne fait qu'écrire — le parseur
     * ignore les lignes vides entre blocs — mais rouvrir un message pour le
     * corriger en ajoutait une devant chaque liste, citation et bloc de code, à
     * chaque passage. Le texte republié n'était plus celui qu'on avait écrit.
     *
     * Testé par l'aller-retour de `test/serialize.test.ts`, qui est l'endroit où
     * ça se voit.
     */
    const tag = child.nodeType === Node.ELEMENT_NODE ? (child as HTMLElement).tagName : ''
    if (SELF_PREFIXED.has(tag) && piece.startsWith('\n') && (out === '' || out.endsWith('\n'))) {
      piece = piece.slice(1)
    }
    out += piece
  }
  return out
}

/**
 * Convertit le contenu d'un élément éditable en balisage publiable.
 *
 * Normalise les blancs en sortie : `contenteditable` produit volontiers des
 * cascades de `<div>` vides quand on appuie sur Entrée, ce qui donnerait des
 * lignes vides en série dans le message publié.
 */
export function serializeToMarkup(root: HTMLElement): string {
  const raw = childrenOf(root, { linePrefix: '', raw: false })
  return raw
    .replace(/ /g, ' ') // les espaces insécables du navigateur
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* --------------------------------------------------------- balisage → DOM
 *
 * L'inverse exact de ce qui précède, et il n'existe que pour **rouvrir un
 * message déjà publié** dans l'éditeur (spec v2 §2.5).
 *
 * ## Pourquoi ici, et pas en réutilisant `RichText`
 *
 * `RichText`/`RichInline` savent déjà rendre l'arbre de blocs — mais ils le
 * rendent pour un LECTEUR : le spoiler y est un `<button>`, l'image un `<a>`
 * autour d'un `<img>` dont le `src` passe par le proxy et qui n'a pas de
 * `data-url`. Rouvrir ce DOM-là dans l'éditeur puis re-sérialiser perdrait
 * silencieusement les spoilers ET toutes les images. Le seul DOM qui se
 * re-sérialise sans perte est celui que `serializeNode` sait relire — donc
 * celui-ci, écrit en face de lui et testé contre lui (`test/serialize.test.ts`).
 *
 * ## L'écart assumé avec l'en-tête de `RichEditor`
 *
 * L'éditeur dit ne pas reconstruire son contenu depuis `modelValue`, et il a
 * raison : un aller-retour à chaque frappe repositionnerait le curseur. Ici la
 * reconstruction a lieu **une fois**, à l'ouverture, avant toute frappe. C'est
 * l'exception qui rend l'édition possible, pas une remise en cause de la règle.
 */

function inlineToNode(t: InlineToken, doc: Document): Node {
  switch (t.type) {
    case 'text':
      return doc.createTextNode(t.value)
    case 'code': {
      // `data-markup` et non `<code>` : c'est le marqueur que pose l'éditeur, et
      // celui que `serializeNode` relit sans dépendre de la balise.
      const el = doc.createElement('span')
      el.dataset.markup = 'code'
      el.className = 're-code'
      el.textContent = t.value
      return el
    }
    case 'spoiler': {
      const el = doc.createElement('span')
      el.dataset.markup = 'spoiler'
      el.className = 're-spoiler'
      appendInline(el, t.children, doc)
      return el
    }
    case 'link': {
      const el = doc.createElement('a')
      el.setAttribute('href', t.href)
      el.textContent = t.label
      return el
    }
    case 'image': {
      const el = doc.createElement('img')
      // `data-url` porte l'adresse publiée — c'est elle que la sérialisation
      // relit. `src` est l'aperçu par le proxy, exactement comme à l'insertion.
      el.dataset.url = t.href
      el.setAttribute('src', postImageSrc(t.href))
      el.setAttribute('alt', t.alt)
      el.className = 're-img'
      return el
    }
    default: {
      const el = doc.createElement(
        t.type === 'bold' ? 'strong' : t.type === 'italic' ? 'em' : t.type === 'strike' ? 's' : 'u',
      )
      appendInline(el, t.children, doc)
      return el
    }
  }
}

/**
 * Pose les tokens en ligne, en réglant l'espace autour des images.
 *
 * `serializeNode` encadre une image d'espaces (` url `) parce que le parseur en
 * a besoin pour isoler l'URL nue. Le parseur, lui, laisse ces espaces dans les
 * tokens de texte voisins. Sans correction, chaque aller-retour par l'éditeur
 * ajouterait donc un espace de chaque côté de chaque image — un message
 * gagnerait des blancs à chaque correction.
 */
function appendInline(parent: HTMLElement, tokens: InlineToken[], doc: Document): void {
  const nodes = tokens.map((t) => inlineToNode(t, doc))
  for (let i = 0; i < nodes.length; i++) {
    if (tokens[i]!.type !== 'image') continue
    const before = nodes[i - 1]
    if (before && before.nodeType === 3) {
      before.textContent = (before.textContent ?? '').replace(/ $/, '')
    }
    const after = nodes[i + 1]
    if (after && after.nodeType === 3) {
      after.textContent = (after.textContent ?? '').replace(/^ /, '')
    }
  }
  for (const n of nodes) parent.appendChild(n)
}

function blockToNode(b: Block, doc: Document): HTMLElement {
  switch (b.type) {
    case 'quote': {
      const el = doc.createElement('blockquote')
      appendBlocks(el, b.children, doc)
      return el
    }
    case 'list': {
      const el = doc.createElement(b.ordered ? 'ol' : 'ul')
      for (const item of b.items) {
        const li = doc.createElement('li')
        appendInline(li, item, doc)
        el.appendChild(li)
      }
      return el
    }
    case 'codeblock': {
      const el = doc.createElement('pre')
      if (b.lang) el.dataset.lang = b.lang
      el.textContent = b.value
      return el
    }
    default: {
      const el = doc.createElement('div')
      appendInline(el, b.children, doc)
      return el
    }
  }
}

/**
 * Deux blocs que la relecture fusionnerait s'ils se touchaient.
 *
 * C'est la seule raison d'insérer une ligne vide entre eux. Elle n'est PAS
 * nécessaire dès que le second se signale tout seul — une liste par sa puce, une
 * citation par son chevron, un bloc de code par sa clôture. En mettre partout
 * ajoutait un blanc devant chacun d'eux, c'est-à-dire modifiait le message de
 * quelqu'un pour lui rendre service.
 */
function needsGap(prev: Block, next: Block): boolean {
  if (prev.type === 'paragraph' && next.type === 'paragraph') return true
  if (prev.type === 'quote' && next.type === 'quote') return true
  if (prev.type === 'list' && next.type === 'list') return prev.ordered === next.ordered
  return false
}

function appendBlocks(parent: HTMLElement, blocks: Block[], doc: Document): void {
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1]
    if (prev && needsGap(prev, b)) {
      const gap = doc.createElement('div')
      gap.appendChild(doc.createElement('br'))
      parent.appendChild(gap)
    }
    parent.appendChild(blockToNode(b, doc))
  })
}

/**
 * Construit le DOM éditable correspondant à un balisage publié.
 *
 * Le passage par `parseRichText` n'est pas un détour : c'est le parseur testé de
 * l'affichage, donc ce qui s'ouvre dans l'éditeur est exactement ce que le fil
 * montrait — pas une seconde interprétation du même texte.
 */
export function markupToDom(markup: string, doc: Document = document): DocumentFragment {
  const frag = doc.createDocumentFragment()
  const host = doc.createElement('div')
  appendBlocks(host, parseRichText(markup), doc)
  while (host.firstChild) frag.appendChild(host.firstChild)
  return frag
}
