/**
 * Forme d'un fil : où est la racine, où est le parent (spec §2.3, NIP-22).
 *
 * ## Pourquoi ces trois fonctions sont partagées
 *
 * Elles étaient écrites deux fois — dans le client et dans l'indexeur — et
 * l'ont supporté tant que le seul enjeu était de ranger un message sous le bon
 * topic. Les points (§16) changent ça : « qui est le parent de cette réponse »
 * décide **à qui va un crédit**. Deux implémentations qui divergeraient
 * créditeraient deux personnes différentes pour le même message, et le lecteur
 * verrait un score que l'auteur ne verrait pas — sans que rien ne casse.
 *
 * C'est le même raisonnement que pour les révisions et les sondages, qui vivent
 * déjà ici : la définition d'un format n'a qu'un exemplaire.
 */
import type { Event } from 'nostr-tools/core'

/** Premier tag `name` qui porte une valeur. */
export function tagValue(ev: Pick<Event, 'tags'>, name: string): string | null {
  for (const t of ev.tags) if (t[0] === name && t[1]) return t[1]
  return null
}

/**
 * Racine du fil auquel appartient cet event.
 *
 * NIP-22 met la racine en tag MAJUSCULE `E` et le parent immédiat en `e`. On
 * tolère aussi le vieux style NIP-10 (`e` marqué « root ») pour ne pas ignorer
 * les events des clients qui n'y sont pas encore passés.
 *
 * `threadKind` est le kind qui *est* sa propre racine (11 chez nous) : le passer
 * en paramètre évite d'importer la constante ici et garde la fonction utilisable
 * sur un event de n'importe quelle provenance.
 */
export function rootIdOf(ev: Pick<Event, 'kind' | 'id' | 'tags'>, threadKind: number): string | null {
  if (ev.kind === threadKind) return ev.id
  const upper = tagValue(ev, 'E')
  if (upper) return upper
  for (const t of ev.tags) if (t[0] === 'e' && t[3] === 'root' && t[1]) return t[1]
  for (const t of ev.tags) if (t[0] === 'e' && t[1]) return t[1]
  return null
}

/**
 * Parent immédiat cité (tag `e` minuscule), ou `null` si la réponse vise la
 * racine. Le marqueur NIP-10 `root` et le tag qui répète la racine sont sautés :
 * sans ça, une réponse de premier niveau se croirait la réponse d'un message.
 */
export function parentIdOf(ev: Pick<Event, 'tags'>): string | null {
  const root = tagValue(ev, 'E')
  for (const t of ev.tags) {
    if (t[0] !== 'e' || !t[1]) continue
    if (t[3] === 'root') continue
    if (root && t[1] === root) continue
    return t[1]
  }
  return null
}
