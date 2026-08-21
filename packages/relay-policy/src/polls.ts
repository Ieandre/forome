/**
 * Format des sondages et dépouillement.
 *
 * Partagé entre le client et le relais pour la même raison que les révisions :
 * celui qui *pose* le format et celui qui l'*exige* doivent lire la même
 * définition. Un désaccord donnerait des sondages publiés qu'aucun lecteur ne
 * sait compter — et sur Nostr, ils resteraient là.
 *
 * ## Le format : le sondage est le topic
 *
 * Un sondage n'est pas un event à part, c'est **le topic lui-même** (kind 11)
 * qui porte ses réponses en tags :
 *
 *     ['title', '<la question>']              (le titre du topic EST la question)
 *     ['poll_option', '<id>', '<intitulé>']
 *     ['polltype', 'singlechoice' | 'multiplechoice']
 *     ['endsAt', '<secondes unix>']           (facultatif)
 *
 * Un vote est un **kind 1018** qui nomme le topic et ses choix, exactement comme
 * NIP-88 le prévoit :
 *
 *     ['e', '<id du topic>']
 *     ['response', '<id d'option>']           (répété si plusieurs réponses)
 *
 * ## Pourquoi pas un kind 1068 séparé, comme NIP-88 le décrit
 *
 * Parce qu'un sondage se crée **avec** son topic, et qu'un event séparé ne peut
 * pas : il nomme le topic par son id, qui n'existe qu'une fois le topic signé et
 * publié. Il faudrait donc deux publications enchaînées, dont la seconde peut
 * échouer seule — et sur un réseau sans suppression, ça laisse un topic
 * définitif privé de son sondage, avec un brouillon perdu dans la page qu'on
 * vient de quitter.
 *
 * En le portant sur le topic, il n'y a qu'un event : aucun état bancal n'existe.
 * Et trois règles disparaissent avec lui — pas de souscription en plus (le fil
 * détient déjà sa racine), pas de « le sondage vient-il de l'auteur du topic »
 * (il est *dans* le topic signé, donc oui par construction), pas de « lequel
 * garder si l'auteur en publie deux ».
 *
 * Contrepartie assumée : un client NIP-88 générique cherche un kind 1068, il ne
 * verra donc pas le bulletin. Il ne voyait déjà pas nos topics — ce sont des
 * kind 11. Les **votes**, eux, restent du NIP-88 mot pour mot : c'est la moitié
 * qui compte, celle qu'un tiers pourrait vouloir émettre ou dépouiller.
 *
 * ## Ce qui n'est pas dans le protocole, et qui est décidé ici
 *
 * Personne ne dit comment compter. Or « compter » est là où tout se joue sur un
 * réseau sans suppression : les quatre règles de `tallyPoll` sont ce qui fait
 * qu'un résultat est le même chez deux lecteurs. Elles sont documentées une par
 * une là-bas.
 */
import type { Event } from 'nostr-tools/core'

/** NIP-88 : un vote. Un event par votant, le dernier compte. */
export const KIND_POLL_VOTE = 1018

export const POLL_OPTION_TAG = 'poll_option'
export const POLL_TYPE_TAG = 'polltype'
export const POLL_ENDS_TAG = 'endsAt'
export const POLL_RESPONSE_TAG = 'response'

export type PollType = 'singlechoice' | 'multiplechoice'

export interface PollOption {
  id: string
  label: string
}

/** Bornes de forme, vérifiées par la policy — voir `badPoll`. */
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 10
export const MAX_OPTION_LABEL = 120
/** Un id d'option est un jeton court : il voyage dans chaque vote. */
const OPTION_ID = /^[A-Za-z0-9_-]{1,24}$/
const HEX64 = /^[0-9a-f]{64}$/

/** true si ce topic porte un sondage. */
export function hasPoll(ev: Pick<Event, 'tags'>): boolean {
  return ev.tags.some((t) => t[0] === POLL_OPTION_TAG)
}

/**
 * Les options du sondage, dans l'ordre où l'auteur les a écrites.
 *
 * L'ordre des tags **est** l'ordre d'affichage, et il n'y a pas d'autre source :
 * trier par intitulé ou par score ferait bouger le bulletin sous le doigt de qui
 * vote, et deux lecteurs ne verraient pas la même liste.
 *
 * Les doublons d'id sont écartés (le premier gagne) plutôt que rejetés : à la
 * lecture, un sondage à moitié lisible vaut mieux qu'un sondage qui disparaît.
 * C'est `badPoll` qui refuse de les créer.
 */
export function pollOptionsOf(ev: Pick<Event, 'tags'>): PollOption[] {
  const out: PollOption[] = []
  const seen = new Set<string>()
  for (const t of ev.tags) {
    if (t[0] !== POLL_OPTION_TAG) continue
    const id = t[1] ?? ''
    const label = (t[2] ?? '').trim()
    if (!OPTION_ID.test(id) || !label || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label })
  }
  return out
}

/**
 * Le type du sondage. `singlechoice` par défaut, comme le veut NIP-88 : c'est
 * le cas restrictif, donc celui qu'on suppose quand le tag est absent ou
 * illisible — supposer l'inverse accorderait plusieurs voix à un votant sur un
 * sondage qui n'en donnait qu'une.
 */
export function pollTypeOf(ev: Pick<Event, 'tags'>): PollType {
  for (const t of ev.tags) {
    if (t[0] === POLL_TYPE_TAG && t[1] === 'multiplechoice') return 'multiplechoice'
  }
  return 'singlechoice'
}

/** La date de fermeture en secondes, ou `null` si le sondage reste ouvert. */
export function pollEndsAt(ev: Pick<Event, 'tags'>): number | null {
  for (const t of ev.tags) {
    if (t[0] !== POLL_ENDS_TAG) continue
    const n = Number(t[1])
    if (Number.isSafeInteger(n) && n > 0) return n
  }
  return null
}

export function isPollClosed(poll: Pick<Event, 'tags'>, nowS: number): boolean {
  const end = pollEndsAt(poll)
  return end !== null && nowS > end
}

/**
 * L'id du topic visé par un vote.
 *
 * Strict sur le nombre : **un seul** tag `e`. Un vote qui nomme deux sondages ne
 * se départage pas, et deviner serait pire que l'ignorer — le vote resterait
 * compté quelque part sans que son auteur sache où.
 */
export function voteTargetOf(ev: Pick<Event, 'tags'>): string | null {
  let found: string | null = null
  for (const t of ev.tags) {
    if (t[0] !== 'e') continue
    if (found !== null) return null
    found = t[1] ?? ''
  }
  return found !== null && HEX64.test(found) ? found : null
}

/** Les options choisies par un vote, telles qu'écrites (ni filtrées ni bornées). */
export function voteChoicesOf(ev: Pick<Event, 'tags'>): string[] {
  const out: string[] = []
  for (const t of ev.tags) {
    if (t[0] === POLL_RESPONSE_TAG && t[1]) out.push(t[1])
  }
  return out
}

/**
 * Les choix d'un vote ramenés à ce que le sondage autorise : options connues,
 * sans doublon, et **une seule** si le sondage est à choix unique.
 *
 * Tronquer plutôt que rejeter le vote entier : un client qui coche trop a quand
 * même exprimé une préférence, et NIP-88 demande de retenir la première. Rejeter
 * effacerait aussi le vote précédent du même votant (règle du dernier), donc une
 * maladresse d'un autre client coûterait sa voix à quelqu'un.
 */
export function normalizeChoices(poll: Pick<Event, 'tags'>, choices: readonly string[]): string[] {
  const known = new Set(pollOptionsOf(poll).map((o) => o.id))
  const out: string[] = []
  for (const c of choices) {
    if (!known.has(c) || out.includes(c)) continue
    out.push(c)
    if (pollTypeOf(poll) === 'singlechoice') break
  }
  return out
}

/**
 * Forme du sondage porté par un topic, pour la policy. On refuse ce qui serait
 * **définitivement illisible** : sur Nostr un bulletin sans réponse ne peut pas
 * être corrigé, il reste en tête du fil pour toujours.
 *
 * Rend `null` pour un topic sans sondage : ce n'est pas une faute, c'est la
 * grande majorité des topics.
 *
 * Le titre est exigé parce qu'il **est** la question (voir l'en-tête) : un
 * bulletin sans titre poserait des réponses à rien.
 */
export function badPoll(ev: Pick<Event, 'tags'>): string | null {
  const raw = ev.tags.filter((t) => t[0] === POLL_OPTION_TAG)
  if (raw.length === 0) return null

  const title = ev.tags.find((t) => t[0] === 'title')?.[1]?.trim()
  if (!title) return 'sondage sans question — le titre du topic la porte'

  const ids = new Set<string>()
  for (const t of raw) {
    const id = t[1] ?? ''
    const label = (t[2] ?? '').trim()
    if (!OPTION_ID.test(id)) return `id d'option invalide : ${JSON.stringify(t[1] ?? null)}`
    if (ids.has(id)) return `id d'option en doublon : ${id}`
    ids.add(id)
    if (!label) return `option ${id} sans intitulé`
    if (label.length > MAX_OPTION_LABEL) return `intitulé de ${label.length} caractères > ${MAX_OPTION_LABEL}`
  }
  if (raw.length < MIN_OPTIONS) return `${raw.length} réponse(s) < ${MIN_OPTIONS}`
  if (raw.length > MAX_OPTIONS) return `${raw.length} réponses > ${MAX_OPTIONS}`

  for (const t of ev.tags) {
    if (t[0] !== POLL_TYPE_TAG) continue
    if (t[1] !== 'singlechoice' && t[1] !== 'multiplechoice') return `type de sondage inconnu : ${t[1] ?? ''}`
  }
  for (const t of ev.tags) {
    if (t[0] !== POLL_ENDS_TAG) continue
    const n = Number(t[1])
    if (!Number.isSafeInteger(n) || n <= 0) return `date de fermeture invalide : ${t[1] ?? ''}`
  }
  return null
}

/**
 * Forme d'un kind 1018.
 *
 * ⚠️ **Zéro réponse est valide**, et ce n'est pas un oubli : c'est la seule façon
 * de retirer sa voix sur un réseau qui ne sait rien effacer. La règle du dernier
 * vote (voir `tallyPoll`) fait qu'un vote vide annule le précédent. Le refuser
 * enfermerait chaque votant dans son premier clic.
 */
export function badVote(ev: Pick<Event, 'tags'>): string | null {
  const targets = ev.tags.filter((t) => t[0] === 'e')
  if (targets.length === 0) return 'vote sans sondage visé'
  if (targets.length > 1) return `vote visant ${targets.length} sondages`
  if (!HEX64.test(targets[0]![1] ?? '')) return 'id de sondage invalide'
  for (const t of ev.tags) {
    if (t[0] !== POLL_RESPONSE_TAG) continue
    if (!OPTION_ID.test(t[1] ?? '')) return `id d'option invalide : ${JSON.stringify(t[1] ?? null)}`
  }
  return null
}

/**
 * Ordre de deux events : date déclarée, départagée par l'id.
 *
 * Même convention que les révisions et que la réconciliation du fil, et pour la
 * même raison : `created_at` est une déclaration de l'auteur, donc deux votes
 * peuvent porter la même seconde — et deux lecteurs qui les ordonneraient
 * autrement afficheraient deux résultats différents pour le même sondage.
 */
function byAge(a: Event, b: Event): number {
  return a.created_at - b.created_at || (a.id < b.id ? -1 : 1)
}

export interface PollTally {
  /** Votants distincts dont la voix compte, jamais la somme des voix. */
  voters: number
  /** Voix par id d'option ; toute option connue y figure, même à zéro. */
  counts: Map<string, number>
  /** Ce que la clé interrogée a voté, si elle a voté. */
  mine: string[]
  /** Le sondage n'accepte plus de voix. */
  closed: boolean
}

/**
 * Dépouille un sondage. **Les quatre règles sont ici, et nulle part ailleurs** —
 * c'est ce qui fait qu'un résultat est le même chez deux lecteurs qui ont reçu
 * les mêmes events.
 *
 *   1. **Une voix par clé, la dernière compte.** Rien ne se supprime sur Nostr :
 *      changer d'avis, c'est republier. Sans cette règle, chaque hésitation
 *      compterait une fois de plus.
 *   2. **Un vote antidaté avant le topic ne compte pas.** Personne ne peut faire
 *      exister une voix « déjà là avant » le bulletin — même garde-fou que les
 *      révisions antidatées.
 *   3. **Un vote après la fermeture ne compte pas.** `created_at` est déclaré par
 *      l'auteur (§2.4), donc la fermeture n'est pas opposable : elle ne borne pas
 *      qui peut écrire, seulement ce qui est compté. Le relais, lui, continue
 *      d'accepter — il ne détient pas le topic et ne connaît pas sa date.
 *   4. **Une voix pour une option inconnue ne compte pas**, mais elle remplace
 *      quand même le vote précédent de sa clé : c'est le mécanisme de retrait
 *      (voir `badVote`). D'où `voters`, qui ne compte que les clés dont le
 *      dernier vote retient au moins une option.
 */
export function tallyPoll(
  poll: Event,
  votes: Iterable<Event>,
  opts: { nowS?: number; me?: string | null } = {},
): PollTally {
  const nowS = opts.nowS ?? Math.floor(Date.now() / 1000)
  const end = pollEndsAt(poll)

  /** Dernier vote retenu par clé (règle 1). */
  const latest = new Map<string, Event>()
  for (const ev of votes) {
    if (ev.kind !== KIND_POLL_VOTE) continue
    if (voteTargetOf(ev) !== poll.id) continue
    if (ev.created_at < poll.created_at) continue // règle 2
    if (end !== null && ev.created_at > end) continue // règle 3
    const known = latest.get(ev.pubkey)
    if (!known || byAge(known, ev) < 0) latest.set(ev.pubkey, ev)
  }

  const counts = new Map<string, number>()
  for (const o of pollOptionsOf(poll)) counts.set(o.id, 0)

  let voters = 0
  let mine: string[] = []
  for (const [pubkey, ev] of latest) {
    const choices = normalizeChoices(poll, voteChoicesOf(ev))
    if (opts.me && pubkey === opts.me) mine = choices
    if (choices.length === 0) continue // règle 4 : retrait
    voters++
    for (const c of choices) counts.set(c, (counts.get(c) ?? 0) + 1)
  }

  return { voters, counts, mine, closed: end !== null && nowS > end }
}

/**
 * Part des votants qui ont retenu cette option, en pourcentage entier.
 *
 * Le dénominateur est le nombre de **votants**, pas la somme des voix : sur un
 * sondage à choix multiple les parts dépassent alors 100 % au total, et c'est
 * l'information juste (« 60 % des votants ont coché ceci »). Rapporter chaque
 * option à la somme des voix donnerait des parts qui rétrécissent quand les
 * gens cochent plus de cases, ce qui ne veut rien dire.
 */
export function pollShare(tally: PollTally, optionId: string): number {
  if (tally.voters === 0) return 0
  return Math.round(((tally.counts.get(optionId) ?? 0) / tally.voters) * 100)
}

/**
 * Les tags de sondage à poser sur un topic. Un seul endroit les fabrique, pour
 * que ce que le client écrit soit exactement ce que `badPoll` valide.
 *
 * Les ids sont des jetons de position (`o1`, `o2`, …) et non les intitulés :
 * chaque vote les recopie, et un intitulé ne peut de toute façon plus changer.
 */
export function pollTags(args: {
  options: readonly string[]
  type: PollType
  endsAt?: number | null
}): string[][] {
  const tags: string[][] = [[POLL_TYPE_TAG, args.type]]
  args.options.forEach((label, i) => {
    tags.push([POLL_OPTION_TAG, `o${i + 1}`, label.trim()])
  })
  if (args.endsAt) tags.push([POLL_ENDS_TAG, String(args.endsAt)])
  return tags
}
