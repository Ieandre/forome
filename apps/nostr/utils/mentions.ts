/**
 * Mentions (NIP-27) : ce qui est écrit dans le message, et qui est prévenu.
 *
 * ## Le format de fil est `nostr:npub1…`, pas `@pseudo`
 *
 * Même raisonnement que le Markdown de `richtext.ts` : le balisage maison
 * enferme le message. Un `@pseudo` écrit dans le contenu ne désigne personne —
 * sur Nostr le nom n'est pas unique (spec §3.5) — et il ne veut rien dire chez
 * un autre client. L'URI NIP-27, elle, est la convention du réseau : les autres
 * clients la rendent, et la clé qu'elle porte reste juste quand son porteur
 * change de pseudo.
 *
 * ## Ce qui est tagué est exactement ce qui s'affiche
 *
 * Les tags `p` sont dérivés de **l'arbre analysé**, pas d'une expression
 * régulière sur le texte. C'est ce qui garantit qu'une npub citée dans un bloc
 * de code — que le rendu montre littéralement, sans en faire une mention — ne
 * réveille pas son porteur. Une notification qui n'a pas de mention visible en
 * face est un bug qu'on ne peut plus rattraper : l'event est parti.
 */
import { parseRichText, type Block, type InlineToken } from '~/utils/richtext'
import { npubFor, kheyHandle } from '~/utils/nostr'

/**
 * Plafond de mentions par message, appliqué **côté client** : au-delà, le
 * composeur refuse d'en insérer une de plus.
 *
 * Pourquoi pas dans la policy du relais, alors qu'elle est la seule vraie
 * barrière : un tag `p` de trop n'est pas propre à une mention. Plusieurs
 * clients Nostr taguent tous les participants d'un fil en répondant, donc un
 * plafond de `p` au relais refuserait des réponses parfaitement légitimes
 * venues d'ailleurs — on casserait l'interopérabilité pour borner une nuisance
 * que la PoW et le débit par clé bornent déjà (§12.1).
 */
export const MAX_MENTIONS = 8

/** L'URI à écrire dans le contenu pour mentionner cette clé. */
export function mentionUri(pubkey: string): string {
  return `nostr:${npubFor(pubkey)}`
}

function collectInline(tokens: InlineToken[], out: Set<string>): void {
  for (const t of tokens) {
    if (t.type === 'mention') out.add(t.pubkey)
    else if ('children' in t) collectInline(t.children, out)
  }
}

function collectBlocks(blocks: Block[], out: Set<string>): void {
  for (const b of blocks) {
    if (b.type === 'paragraph') collectInline(b.children, out)
    else if (b.type === 'quote') collectBlocks(b.children, out)
    else if (b.type === 'list') for (const item of b.items) collectInline(item, out)
  }
}

/**
 * Les clés mentionnées dans un message, dans l'ordre d'apparition et sans
 * doublon. Plafonnée : voir `MAX_MENTIONS`.
 */
export function mentionsIn(content: string, max = MAX_MENTIONS): string[] {
  const found = new Set<string>()
  collectBlocks(parseRichText(content), found)
  return [...found].slice(0, max)
}

/**
 * Tags `p` à ajouter à l'event pour que les mentionnés soient notifiés,
 * `already` étant les clés déjà taguées par le fil (l'auteur du parent).
 *
 * ⚠️ Ils s'ajoutent **après** les tags de fil, jamais devant : NIP-22 réserve le
 * PREMIER `p` à l'auteur du message parent, et `utils/notify.ts` s'en sert pour
 * distinguer « t'a répondu » de « t'a cité » quand rien d'autre ne le permet.
 */
export function mentionTags(content: string, already: Iterable<string> = []): string[][] {
  const seen = new Set(already)
  const tags: string[][] = []
  for (const pubkey of mentionsIn(content)) {
    if (seen.has(pubkey)) continue
    seen.add(pubkey)
    tags.push(['p', pubkey])
  }
  return tags
}

/* ------------------------------------------------------- suggestions de frappe */

export interface MentionCandidate {
  pubkey: string
  /** Pseudo affiché — déjà résolu par l'appelant (kind 0 connu, ou `khey_`). */
  name: string
  /** Discriminant de clé, présent seulement si le pseudo est déclaré (§3.5). */
  disc: string | null
}

/** Minuscule et sans accent : `@théo` doit trouver « Theo », et l'inverse. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Classe les candidats pour une frappe `@requête`.
 *
 * L'ordre de `pool` est la pertinence par défaut (les gens du fil ouvert avant
 * les suivis) : à score égal il est conservé, parce que le premier de la liste
 * est celui qu'on insère en appuyant sur Entrée. Un tri purement alphabétique
 * mettrait en tête un inconnu suivi il y a un an.
 *
 * La clé publique est cherchée comme un préfixe, pas comme un mot : c'est ce qui
 * permet de coller un début de npub hex quand deux personnes portent le même
 * pseudo — le seul recours réel quand le nom ne discrimine pas (§3.5).
 */
export function rankMentions(
  query: string,
  pool: MentionCandidate[],
  limit = 6,
): MentionCandidate[] {
  const seen = new Set<string>()
  const unique = pool.filter((c) => !seen.has(c.pubkey) && seen.add(c.pubkey))
  const q = fold(query.trim())
  if (!q) return unique.slice(0, limit)

  const scored: { c: MentionCandidate; score: number; rank: number }[] = []
  unique.forEach((c, rank) => {
    const name = fold(c.name)
    const handle = fold(kheyHandle(c.pubkey))
    let score: number
    if (name.startsWith(q)) score = 0
    else if (handle.startsWith(q) || c.pubkey.startsWith(q)) score = 1
    else if (name.includes(q)) score = 2
    else return
    scored.push({ c, score, rank })
  })

  return scored
    .sort((a, b) => a.score - b.score || a.rank - b.rank)
    .slice(0, limit)
    .map((s) => s.c)
}
