/**
 * Classement d'un event du canal personnel : réponse ou citation ?
 *
 * Pur et sans réseau, délibérément. La distinction pourrait se faire en allant
 * chercher le message parent sur un relais — mais un centre de notifications qui
 * ferait une requête par ligne serait inutilisable, et sur un réseau où un event
 * peut n'être nulle part, la moitié des lignes resterait indéterminée.
 *
 * Tout est déjà dans les tags (NIP-22, voir `replyTags` dans `usePublisher`) :
 *
 *   ['E', <id racine>,  <relais>, <clé de l'auteur de la racine>]
 *   ['e', <id parent>,  <relais>, <clé de l'auteur du parent>]
 *   ['p', <clé de l'auteur du parent>, <relais>]
 *
 * Le 4ᵉ élément d'un tag `e` n'est une clé qu'en NIP-22 ; en vieux style NIP-10
 * c'est un marqueur (`"root"`, `"reply"`, `"mention"`). D'où le test
 * hexadécimal partout plutôt qu'une confiance dans la position.
 */
import { KIND_THREAD, type NostrEvent } from '~/types/nostr'
import { tagValue } from '~/utils/nostr'

const HEX64 = /^[0-9a-f]{64}$/

export type NotifKind = 'reply' | 'mention' | 'follow' | 'dm'

/**
 * Le message parent d'après les seuls tags. Même logique de sélection que
 * `parentIdOf` (utils/nostr) : on saute le marqueur NIP-10 `root` et le tag qui
 * répète la racine, ce qui reste est le parent immédiat.
 */
export function parentRef(ev: NostrEvent): { id: string; author: string | null } | null {
  const root = tagValue(ev, 'E')
  for (const t of ev.tags) {
    if (t[0] !== 'e' || !t[1]) continue
    if (t[3] === 'root') continue
    if (root && t[1] === root) continue
    return { id: t[1], author: t[3] && HEX64.test(t[3]) ? t[3] : null }
  }
  return null
}

/**
 * Réponse ou citation, du plus sûr au plus tolérant :
 *
 *   1. l'auteur du parent est dans le tag `e` — verdict certain
 *   2. pas de parent distinct : la réponse vise la racine, dont l'auteur est
 *      dans le tag `E`
 *   3. sinon, le créneau NIP-22 de l'auteur du parent est le PREMIER tag `p`
 *
 * En dernier ressort c'est « citation », et le choix n'est pas neutre : dire
 * « t'a cité » d'une réponse est une imprécision, dire « t'a répondu » d'une
 * simple mention est un mensonge.
 */
export function notifKindOf(ev: NostrEvent, me: string): 'reply' | 'mention' {
  /*
   * Un kind 11 EST la racine : il n'a pas de parent, donc y être tagué ne peut
   * être qu'une mention. Sans ce test, le repli sur le premier tag `p` annonce
   * « t'a répondu » sur un topic qu'on vient d'ouvrir en te citant — le mensonge
   * que le reste de cette fonction s'applique à éviter.
   */
  if (ev.kind === KIND_THREAD) return 'mention'

  const parent = parentRef(ev)
  if (parent?.author) return parent.author === me ? 'reply' : 'mention'

  if (!parent) {
    const rootAuthor = ev.tags.find((t) => t[0] === 'E')?.[3]
    if (rootAuthor && HEX64.test(rootAuthor)) return rootAuthor === me ? 'reply' : 'mention'
  }

  return tagValue(ev, 'p') === me ? 'reply' : 'mention'
}
