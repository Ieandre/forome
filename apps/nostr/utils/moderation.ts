/**
 * Traitement des signalements — fonctions pures, pas d'état, pas de réseau.
 *
 * L'enjeu tient en une phrase : **la file ne doit pas se trier au nombre de
 * signalements**, sinon le premier groupe organisé décide de la modération.
 * C'est le substitut retenu au §9.6 de la spec — l'heuristique de diversité,
 * version pauvre — et il tient dans `distinctVoices` ci-dessous.
 */
import type { NostrEvent } from '~/types/nostr'
import type { ReportGroup } from '~/types/moderation'

const HEX64 = /^[0-9a-f]{64}$/

/**
 * Ce que vise un signalement NIP-56, et pourquoi.
 *
 * NIP-56 met le motif en **troisième position du tag**, pas dans le contenu :
 * `["e", <id>, "spam"]`. Le contenu est un commentaire libre facultatif.
 * Un signalement qui porte les deux tags vise le message — c'est le cas
 * courant, le `p` n'étant là que pour désigner l'auteur du message visé.
 */
export function reportTargetOf(
  ev: NostrEvent,
): { target: string; targetKind: 'event' | 'pubkey'; type: string } | null {
  let pubkeyTag: { target: string; type: string } | null = null

  for (const t of ev.tags) {
    const value = t[1]
    if (!value || !HEX64.test(value)) continue
    const type = typeof t[2] === 'string' && t[2] ? t[2] : 'other'
    if (t[0] === 'e') return { target: value, targetKind: 'event', type }
    if (t[0] === 'p' && !pubkeyTag) pubkeyTag = { target: value, type }
  }

  return pubkeyTag ? { ...pubkeyTag, targetKind: 'pubkey' } : null
}

/**
 * Voix distinctes parmi des signalants (spec §9.6).
 *
 * On construit le graphe « se suit, dans un sens ou dans l'autre » entre les
 * signalants — le graphe des kind 3, déjà chargé par le store social — et on en
 * prend un **ensemble indépendant** par glouton : aucun des retenus ne suit un
 * autre retenu.
 *
 * Trois comptes qui se suivent comptent donc pour **1**, trois inconnus l'un de
 * l'autre pour **3**. Un brigade ne remonte plus la file quel que soit son
 * nombre — et ça coûte une fonction, pas un produit (§9.6 écarte Community
 * Notes pour cette raison).
 *
 * Glouton par degré croissant : c'est une borne inférieure de l'ensemble
 * indépendant maximum, qui est NP-difficile. Sous-estimer est le bon sens de
 * l'erreur — on préfère qu'un signalement légitime attende qu'un abusif passe.
 */
export function distinctVoices(
  reporters: Iterable<string>,
  followsOf: (pubkey: string) => Iterable<string>,
): number {
  const keys = [...new Set(reporters)]
  if (keys.length <= 1) return keys.length

  const inSet = new Set(keys)
  const edges = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]))
  for (const k of keys) {
    for (const followed of followsOf(k)) {
      if (followed === k || !inSet.has(followed)) continue
      edges.get(k)?.add(followed)
      edges.get(followed)?.add(k) // le lien compte dans les deux sens
    }
  }

  // Départage par la clé à degré égal : deux clients doivent compter pareil.
  const ordered = keys.sort((a, b) => {
    const d = (edges.get(a)?.size ?? 0) - (edges.get(b)?.size ?? 0)
    return d !== 0 ? d : a < b ? -1 : 1
  })

  const chosen = new Set<string>()
  for (const k of ordered) {
    let free = true
    for (const neighbour of edges.get(k) ?? []) {
      if (chosen.has(neighbour)) {
        free = false
        break
      }
    }
    if (free) chosen.add(k)
  }
  return chosen.size
}

/**
 * Regroupe des kind 1984 par cible et calcule les voix.
 *
 * `ignored` sort les cibles déjà classées sans suite : sans ça, un signalement
 * abusif remonterait la file indéfiniment, et le modérateur reverrait chaque
 * jour la décision qu'il a déjà prise.
 */
export function groupReports(
  events: Iterable<NostrEvent>,
  opts: {
    followsOf: (pubkey: string) => Iterable<string>
    ignored?: ReadonlySet<string>
    /** cibles déjà traitées (masquées, bannies) — hors file */
    resolved?: ReadonlySet<string>
  },
): ReportGroup[] {
  const groups = new Map<string, ReportGroup>()

  for (const ev of events) {
    const ref = reportTargetOf(ev)
    if (!ref) continue
    if (opts.ignored?.has(ref.target) || opts.resolved?.has(ref.target)) continue

    let group = groups.get(ref.target)
    if (!group) {
      group = {
        target: ref.target,
        targetKind: ref.targetKind,
        reporters: new Set(),
        types: new Map(),
        notes: [],
        lastAt: 0,
        voices: 0,
      }
      groups.set(ref.target, group)
    }

    // Un même compte qui signale trois fois reste une voix : on compte des
    // signalants, pas des events.
    if (!group.reporters.has(ev.pubkey)) {
      group.reporters.add(ev.pubkey)
      group.types.set(ref.type, (group.types.get(ref.type) ?? 0) + 1)
      const note = ev.content.trim()
      if (note) group.notes.push(note)
    }
    if (ev.created_at > group.lastAt) group.lastAt = ev.created_at
  }

  const out = [...groups.values()]
  for (const group of out) group.voices = distinctVoices(group.reporters, opts.followsOf)
  // Voix d'abord, puis le plus récent : à corroboration égale, ce qui se passe
  // maintenant passe devant ce qui est déjà refroidi.
  return out.sort((a, b) => b.voices - a.voices || b.lastAt - a.lastAt)
}
