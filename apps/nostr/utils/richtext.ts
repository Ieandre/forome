/**
 * Texte enrichi des posts : analyse d'un sous-ensemble Markdown en arbre de
 * tokens.
 *
 * ## Pourquoi du Markdown et pas le balisage de JVC
 *
 * JVC utilise son propre balisage (`'''gras'''`). Le reprendre tel quel aurait
 * enfermé les posts : aucun autre client Nostr ne le rendrait, et un message
 * apparaîtrait avec ses apostrophes visibles partout ailleurs — ce qui abîme
 * exactement l'interopérabilité qui justifiait le pivot (spec v2 §0).
 *
 * Le Markdown n'est pas un standard Nostr, mais il **dégrade proprement** :
 * `**gras**` reste lisible en texte brut, et plusieurs clients le rendent déjà.
 * La barre d'outils, elle, garde le comportement JVC — c'est l'ergonomie qui
 * compte pour l'utilisateur, pas les caractères choisis.
 *
 * ## Pourquoi un parseur maison plutôt qu'une bibliothèque
 *
 * Le contenu vient de **relais tiers**, donc d'inconnus. La plupart des
 * bibliothèques Markdown produisent du HTML, qu'il faut ensuite injecter avec
 * `v-html` puis assainir — deux étapes où une faille XSS se glisse, sur un
 * chemin parcouru par chaque message affiché.
 *
 * Ici, l'analyse produit un **arbre de données**. Aucun HTML n'est jamais
 * construit, ni analysé, ni injecté : le renderer mappe les tokens sur des
 * éléments Vue. Le HTML présent dans le texte source n'est pas interprété, il
 * est affiché comme du texte — `<script>` s'affiche littéralement.
 *
 * C'est aussi ce qui rend le tout testable sans navigateur.
 */

/* ------------------------------------------------------------------ types */

import { isImageUrl } from '~/utils/media'

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: InlineToken[] }
  | { type: 'italic'; children: InlineToken[] }
  | { type: 'strike'; children: InlineToken[] }
  | { type: 'underline'; children: InlineToken[] }
  | { type: 'spoiler'; children: InlineToken[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; label: string }
  /**
   * Image. `href` est l'adresse **d'origine**, celle que l'auteur a publiée :
   * c'est elle qui est signée, et le proxy d'affichage est un détail du client
   * (voir `postImageSrc`). Le rendu la remplace au dernier moment.
   */
  | { type: 'image'; href: string; alt: string }

export type Block =
  | { type: 'paragraph'; children: InlineToken[] }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'codeblock'; value: string; lang: string | null }

/** Longueurs bornées : un post hostile ne doit pas pouvoir faire ramer le rendu. */
const MAX_INLINE_DEPTH = 4
const MAX_BLOCKS = 400
const MAX_LIST_ITEMS = 200

/* --------------------------------------------------------------- marqueurs
 *
 * Ordre significatif : les marqueurs longs d'abord, sinon `**` serait lu comme
 * deux `*` et le gras deviendrait de l'italique vide.
 */
interface Marker {
  open: string
  type: 'bold' | 'italic' | 'strike' | 'underline' | 'spoiler'
}
const MARKERS: Marker[] = [
  { open: '**', type: 'bold' },
  { open: '~~', type: 'strike' },
  { open: '++', type: 'underline' },
  { open: '||', type: 'spoiler' },
  { open: '*', type: 'italic' },
]

/**
 * Schémas autorisés dans un lien.
 *
 * Liste blanche, jamais liste noire : `javascript:`, `data:` et `vbscript:`
 * exécutent du code quand ils atterrissent dans un `href`. Tout ce qui n'est pas
 * explicitement autorisé est rendu comme du texte, pas comme un lien.
 */
const SAFE_SCHEMES = ['http://', 'https://', 'nostr:', 'mailto:']

function isSafeHref(href: string): boolean {
  const lower = href.trim().toLowerCase()
  return SAFE_SCHEMES.some((s) => lower.startsWith(s))
}

/** URL nue, pour la détection automatique. Bornée pour rester lisible. */
const BARE_URL = /(https?:\/\/[^\s<>"'`)\]]{1,2000})/

/* ------------------------------------------------------------------ inline */

function pushText(out: InlineToken[], value: string): void {
  if (!value) return
  const last = out[out.length - 1]
  if (last?.type === 'text') last.value += value
  else out.push({ type: 'text', value })
}

/**
 * Analyse le contenu en ligne. `depth` borne l'imbrication : sans ça, une
 * entrée du type `**`×1000 ferait exploser la pile.
 */
export function parseInline(src: string, depth = 0): InlineToken[] {
  const out: InlineToken[] = []
  let i = 0
  let plain = ''

  const flush = (): void => {
    if (plain) {
      linkifyInto(out, plain)
      plain = ''
    }
  }

  while (i < src.length) {
    const ch = src[i]!

    // échappement : `\*` produit une étoile littérale
    if (ch === '\\' && i + 1 < src.length) {
      plain += src[i + 1]
      i += 2
      continue
    }

    // code en ligne : contenu jamais réanalysé, c'est le point du code
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ type: 'code', value: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    // image explicite ![alt](href) — le libellé peut être vide, contrairement
    // au lien : une image sans texte de remplacement reste une image.
    if (ch === '!' && src[i + 1] === '[') {
      const parsed = parseLinkAt(src, i + 1, true)
      if (parsed && parsed.token.type === 'link') {
        flush()
        out.push({ type: 'image', href: parsed.token.href, alt: parsed.token.label })
        i = parsed.next
        continue
      }
    }

    // lien explicite [label](href)
    if (ch === '[') {
      const parsed = parseLinkAt(src, i)
      if (parsed) {
        flush()
        out.push(parsed.token)
        i = parsed.next
        continue
      }
    }

    const marker = depth < MAX_INLINE_DEPTH ? MARKERS.find((m) => src.startsWith(m.open, i)) : undefined
    if (marker) {
      const close = src.indexOf(marker.open, i + marker.open.length)
      if (close > i + marker.open.length) {
        const inner = src.slice(i + marker.open.length, close)
        flush()
        out.push({ type: marker.type, children: parseInline(inner, depth + 1) } as InlineToken)
        i = close + marker.open.length
        continue
      }
    }

    plain += ch
    i++
  }

  flush()
  return out
}

/** `[label](href)` — le href doit passer la liste blanche, sinon c'est du texte. */
function parseLinkAt(
  src: string,
  start: number,
  allowEmptyLabel = false,
): { token: InlineToken; next: number } | null {
  const closeLabel = src.indexOf(']', start + 1)
  if (closeLabel === -1 || src[closeLabel + 1] !== '(') return null
  const closeHref = src.indexOf(')', closeLabel + 2)
  if (closeHref === -1) return null

  const label = src.slice(start + 1, closeLabel)
  const href = src.slice(closeLabel + 2, closeHref).trim()
  if ((!label && !allowEmptyLabel) || !isSafeHref(href)) return null

  return { token: { type: 'link', href, label }, next: closeHref + 1 }
}

/**
 * Détecte les URLs nues dans un fragment de texte déjà sûr.
 *
 * Une URL d'image devient une **image**, pas un lien : c'est la convention de
 * Nostr (l'adresse est posée nue dans le contenu, les métadonnées vont dans le
 * tag `imeta`), donc c'est ce que produisent les autres clients — et c'est ce
 * que notre composeur produit, pour rester lisible chez eux.
 */
function linkifyInto(out: InlineToken[], text: string): void {
  let rest = text
  for (;;) {
    const m = BARE_URL.exec(rest)
    if (!m || m.index === undefined) break
    pushText(out, rest.slice(0, m.index))
    const url = m[1]!
    // Ponctuation finale : « voir https://x.fr. » ne doit pas l'avaler.
    const trimmed = url.replace(/[.,;:!?)\]]+$/, '')
    out.push(
      isImageUrl(trimmed)
        ? { type: 'image', href: trimmed, alt: '' }
        : { type: 'link', href: trimmed, label: trimmed },
    )
    rest = rest.slice(m.index + trimmed.length)
  }
  pushText(out, rest)
}

/* ------------------------------------------------------------------ blocks */

/**
 * Découpe en blocs : citations, listes, blocs de code, paragraphes.
 *
 * Volontairement simple — un post de forum n'a pas besoin de tableaux ni de
 * titres, et chaque construction supplémentaire est une surface d'analyse en
 * plus sur un chemin qui traite du contenu hostile.
 */
export function parseRichText(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  let i = 0

  while (i < lines.length && blocks.length < MAX_BLOCKS) {
    const line = lines[i]!

    if (!line.trim()) {
      i++
      continue
    }

    // bloc de code ```lang
    const fence = /^```(\w{0,20})\s*$/.exec(line)
    if (fence) {
      const lang = fence[1] || null
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!)
        i++
      }
      i++ // consomme la clôture, absente si le bloc n'est pas fermé
      blocks.push({ type: 'codeblock', value: body.join('\n'), lang })
      continue
    }

    // citation : lignes contiguës commençant par >
    if (/^\s*>/.test(line)) {
      const inner: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        inner.push(lines[i]!.replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', children: parseRichText(inner.join('\n')) })
      continue
    }

    // liste, à puces ou numérotée
    const bullet = /^\s*[-*+]\s+(.*)$/
    const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = !bullet.test(line)
      const re = ordered ? numbered : bullet
      const items: InlineToken[][] = []
      while (i < lines.length && items.length < MAX_LIST_ITEMS) {
        const m = re.exec(lines[i]!)
        if (!m) break
        items.push(parseInline(m[1] ?? ''))
        i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // paragraphe : jusqu'à la ligne vide ou le début d'un autre bloc
    const para: string[] = []
    while (i < lines.length) {
      const l = lines[i]!
      if (!l.trim() || /^\s*>/.test(l) || /^```/.test(l) || bullet.test(l) || numbered.test(l)) break
      para.push(l)
      i++
    }
    blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) })
  }

  return blocks
}

/**
 * true si le texte contient au moins un balisage reconnu. Sert à ne pas payer
 * le rendu enrichi pour la grande majorité des messages, qui sont du texte nu.
 *
 * ⚠️ Une URL nue compte comme un balisage : `linkifyInto` en fait un lien, donc
 * un message qui n'a QUE ça doit passer par le rendu enrichi. Sinon il tombe sur
 * le chemin texte nu et l'URL s'affiche en encre morte, non cliquable — alors
 * que la même URL accompagnée d'un `**gras**` devenait un lien.
 *
 * Le test est volontairement plus large que le parseur : **un seul** caractère
 * de marqueur suffit. Les deux erreurs ne coûtent pas la même chose — un faux
 * positif paye une analyse pour rien, un faux négatif montre les `++` au
 * lecteur. Chaque marqueur reconnu par `MARKERS` doit donc figurer ici.
 */
export function hasMarkup(src: string): boolean {
  return /(\*|~~|\+\+|\|\||`|^\s*[->*+]\s|^\s*\d{1,3}[.)]\s|\[[^\]]+\]\(|https?:\/\/)/m.test(src)
}
