/**
 * Format des révisions (spec §2.5).
 *
 * Sur Nostr, kinds 11 et 1111 ne sont pas remplaçables : rien n'écrase rien.
 * Corriger un message est donc **publier un nouvel event qui référence
 * l'ancien**, et l'historique existe qu'on le veuille ou non : ici c'est le
 * protocole qui l'impose, pas une décision de produit.
 *
 * ## Le format
 *
 * Une révision est un **kind 1111** qui reprend les tags de fil de l'original
 * (`E` racine, `e` parent, `p`) et ajoute :
 *
 *     ['edit', <id de l'event révisé>]
 *
 * Trois conséquences, dans l'ordre où elles comptent :
 *
 *   1. **Elle descend par le tuyau qui existe déjà.** Le fil interroge `#E` /
 *      `#e` sur le topic ; une révision qui porte le même `E` arrive avec les
 *      réponses, sans requête ni souscription supplémentaire. C'est ce qui rend
 *      sans conséquence le fait que `edit` ne soit pas indexable (NIP-01
 *      n'indexe que les tags à une lettre, donc `#edit` serait inqueryable).
 *   2. **La citation reste intacte.** En recopiant le `e` de l'original, la
 *      révision ne s'insère pas comme une réponse à ce qu'elle corrige. Un
 *      marqueur posé dans `e` aurait été lu comme un parent par
 *      `parentIdOf()`, et le fil aurait affiché « X a écrit… » citant le
 *      message que X vient de reformuler.
 *   3. **Même la révision du message racine est un kind 1111.** Un kind 11
 *      révisé tomberait dans l'ingestion des racines et apparaîtrait comme un
 *      **nouveau topic** dans la liste.
 *
 * ## Ce que ce module ne peut pas faire, et personne à sa place
 *
 * `evaluate()` valide la **forme** d'un tag `edit`. Il ne peut pas valider
 * l'**autorité** : la policy est sans état, elle ne détient pas l'event visé et
 * ne sait donc pas qui en est l'auteur. La règle « seul l'auteur révise son
 * message » est vérifiée à la résolution (`resolveRevisions`), c'est-à-dire
 * chez le lecteur. C'est exactement le régime annoncé par §2.5 — convention de
 * client, pas garantie de protocole — et c'est **la** ligne de sécurité de la
 * fonctionnalité : sans elle, n'importe qui réécrit le message de n'importe qui.
 */
import type { Event } from 'nostr-tools/core'

/** Nom du tag qui fait d'un event une révision. */
export const EDIT_TAG = 'edit'

const HEX64 = /^[0-9a-f]{64}$/

/**
 * L'id de l'event que cette révision corrige, ou `null` si ce n'en est pas une.
 *
 * Strict sur trois points, et chacun évite une ambiguïté plutôt qu'une attaque :
 *   - **un seul** tag `edit` — deux cibles ne se départagent pas, et deviner
 *     serait pire que traiter l'event comme un message ordinaire
 *   - un id de 64 hexa, sinon la cible ne désigne rien
 *   - jamais soi-même : un event ne peut pas être sa propre révision
 */
export function editTargetOf(ev: Event): string | null {
  let found: string | null = null
  for (const t of ev.tags) {
    if (t[0] !== EDIT_TAG) continue
    if (found !== null) return null
    found = t[1] ?? ''
  }
  if (found === null || !HEX64.test(found) || found === ev.id) return null
  return found
}

export function isRevision(ev: Event): boolean {
  return editTargetOf(ev) !== null
}

/**
 * Ordre de la chaîne de versions : date déclarée, départagée par l'id.
 *
 * Le départage n'est pas un détail : `created_at` est une déclaration de
 * l'auteur (§2.4), donc deux révisions peuvent porter la même seconde — et deux
 * lecteurs qui les ordonneraient différemment afficheraient deux textes
 * différents pour le même message. Même convention que la réconciliation
 * initiale du fil, pour la même raison.
 */
function byAge(a: Event, b: Event): number {
  return a.created_at - b.created_at || (a.id < b.id ? -1 : 1)
}

/**
 * La chaîne de versions d'un message : l'original d'abord, la version en
 * vigueur en dernier.
 *
 * Deux règles de sélection, et la première est la seule qui protège quelque
 * chose :
 *
 *   - **même clé publique que l'original.** Sans ça, publier un event taguant
 *     `edit: <ton id>` suffirait à réécrire ton message chez tous les lecteurs.
 *     Le relais ne peut pas l'empêcher (voir l'en-tête), donc c'est ici, et
 *     c'est non négociable.
 *   - **l'ancre participe au tri.** Une révision antidatée avant l'original ne
 *     prend donc pas le dessus : elle reste dans l'historique et l'original
 *     garde la main. Personne ne peut faire exister une correction « déjà là
 *     avant » le message qu'elle corrige.
 *
 * Les révisions pointent toujours l'**original**, jamais la version précédente :
 * une chaîne se résoudrait de proche en proche, et un maillon manquant — cas
 * banal sur un réseau où personne ne détient tout — rendrait l'état indécidable.
 */
export function resolveRevisions<T extends Event>(anchor: T, candidates: Iterable<T>): T[] {
  const chain = new Map<string, T>([[anchor.id, anchor]])
  for (const ev of candidates) {
    if (ev.pubkey !== anchor.pubkey) continue
    if (editTargetOf(ev) !== anchor.id) continue
    chain.set(ev.id, ev)
  }
  return [...chain.values()].sort(byAge)
}

/** La version en vigueur d'un message, ses révisions connues étant données. */
export function latestRevision<T extends Event>(anchor: T, candidates: Iterable<T>): T {
  const chain = resolveRevisions(anchor, candidates)
  return chain[chain.length - 1] ?? anchor
}
