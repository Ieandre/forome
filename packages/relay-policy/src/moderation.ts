/**
 * Modèle de modération (`docs/moderation-staff.md`).
 *
 * **Partagé délibérément entre le client et le relais**, comme la policy juste à
 * côté et pour la même raison : le client replie ce que le relais refuse, et
 * deux dérivations qui divergeraient produiraient un forum où « bannir » masque
 * sans bloquer — la pire des deux moitiés. Ce qui est testé ici est ce qui
 * tourne des deux côtés.
 *
 * Ce module est **pur** : il ne lit ni le réseau ni le disque. On lui donne des
 * events déjà vérifiés, il rend l'état en vigueur.
 *
 * ⚠️ Il ne vérifie **aucune signature**. L'appelant doit ne lui passer que des
 * events dont la signature est établie — le pool `nostr-tools` côté client,
 * `evaluate()` côté relais. Lui faire confiance sur des events bruts
 * laisserait n'importe qui se déclarer modérateur.
 */
import { decode } from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/core'

/** NIP-78 : données applicatives adressables. Le roster et les listes en sont. */
export const KIND_APP_DATA = 30078
/** Le roster, signé par la clé racine du forum et par elle seule. */
export const STAFF_D_TAG = 'forome.staff'
/** La liste d'actions d'UN modérateur. Une par clé de staff. */
export const MODERATION_D_TAG = 'forome.moderation'

export type Role = 'admin' | 'moderator'

export interface StaffMember {
  pubkey: string
  role: Role
  since: number
}

/**
 * Les types vont par paires (`hide`/`show`…) parce qu'un modérateur doit pouvoir
 * défaire la décision d'un autre, et qu'il ne peut pas écrire dans la liste
 * d'autrui : c'est le plus récent qui l'emporte, pas le propriétaire de la
 * ligne. Sans ça, un modérateur en vacances bloquerait une correction.
 */
export type ActionType =
  | 'hide'
  | 'show'
  | 'ban'
  | 'unban'
  | 'lock'
  | 'unlock'
  | 'pin'
  | 'unpin'
  | 'ignore'

/**
 * Régime de masquage (doc §5). `editorial` se déplie d'un clic ; `illegal`
 * n'offre pas de bouton **et** entre dans l'ensemble purgé du relais — les deux
 * gestes vont ensemble, sans quoi retirer le bouton ne retire rien.
 */
export type HideClass = 'editorial' | 'illegal'

export interface ModAction {
  type: ActionType
  /** id d'event (`hide`), clé publique (`ban`), id de topic (`lock`, `pin`). */
  target: string
  reason: string
  at: number
  /** Seulement sur `hide`. Absent = `editorial`. */
  class?: HideClass
}

/** Une action et la clé qui l'a signée. L'interface n'affiche jamais l'une sans l'autre. */
export interface AppliedAction extends ModAction {
  by: string
}

export interface ModerationState {
  /** clé publique → rôle. Contient toujours la clé racine. */
  staff: Map<string, Role>
  /** id d'event → masquage en vigueur */
  hidden: Map<string, AppliedAction>
  /** clé publique → bannissement en vigueur */
  banned: Map<string, AppliedAction>
  /** id de topic → verrou en vigueur */
  locked: Map<string, AppliedAction>
  /** id de topic → épinglage en vigueur */
  pinned: Map<string, AppliedAction>
  /** cible → signalement classé sans suite */
  ignored: Map<string, AppliedAction>
}

const HEX64 = /^[0-9a-f]{64}$/

/** Longueur max d'un motif. Voir `MAX_ACTIONS_PER_LIST` pour le pourquoi. */
export const MAX_REASON_LEN = 140

/**
 * Borne d'écriture par liste. `maxContentBytes` vaut 32 Ko et une action pèse
 * ~145 octets : au-delà, la liste se ferait refuser par la policy — c'est-à-dire
 * qu'un modérateur perdrait silencieusement sa capacité d'agir. On borne donc
 * **avant** de publier, pas après le refus.
 */
export const MAX_ACTIONS_PER_LIST = 200

/** Quelle famille d'état une action alimente. `null` = type inconnu. */
function familyOf(type: ActionType): keyof Omit<ModerationState, 'staff'> | null {
  switch (type) {
    case 'hide':
    case 'show':
      return 'hidden'
    case 'ban':
    case 'unban':
      return 'banned'
    case 'lock':
    case 'unlock':
      return 'locked'
    case 'pin':
    case 'unpin':
      return 'pinned'
    case 'ignore':
      return 'ignored'
    default:
      return null
  }
}

/** true si le type défait au lieu de poser. */
function isUndo(type: ActionType): boolean {
  return type === 'show' || type === 'unban' || type === 'unlock' || type === 'unpin'
}

/**
 * Ramène une clé publique à sa forme hexadécimale, qu'on lui donne 64 caractères
 * hex ou une `npub…`.
 *
 * Existe parce que **l'interface ne montre jamais l'hexadécimal** : le profil
 * affiche et copie une `npub`, et c'est elle que quelqu'un colle. Exiger l'hex
 * là où l'app ne le donne pas produit un rejet silencieux — pas de staff, pas de
 * message, rien à comprendre. Le cas s'est présenté dès la première utilisation.
 *
 * `null` si l'entrée n'est ni l'un ni l'autre, ou si la npub désigne autre chose
 * qu'une clé publique (`note1…`, `nevent1…`).
 */
export function normalizePubkey(input: string | null | undefined): string | null {
  const raw = input?.trim()
  if (!raw) return null
  if (HEX64.test(raw)) return raw
  if (HEX64.test(raw.toLowerCase())) return raw.toLowerCase()
  if (!raw.startsWith('npub')) return null
  try {
    const decoded = decode(raw)
    return decoded.type === 'npub' && HEX64.test(decoded.data) ? decoded.data : null
  } catch {
    return null
  }
}

export function tagValue(ev: Event, name: string): string | null {
  for (const t of ev.tags) if (t[0] === name && t[1]) return t[1]
  return null
}

/**
 * Lit le roster.
 *
 * Refuse tout event qui ne vient pas de `rootAdmin` : c'est la racine de la
 * chaîne de confiance, et accepter le roster d'un inconnu reviendrait à lui
 * donner le pouvoir de nommer des modérateurs chez nos lecteurs.
 *
 * **La clé racine est admin même si elle s'oublie elle-même** — sans cette
 * règle, un roster malformé referme la porte définitivement, et Nostr n'offre
 * aucun moyen de la rouvrir.
 */
export function parseStaff(ev: Event, rootAdmin: string): Map<string, Role> | null {
  if (!HEX64.test(rootAdmin) || ev.pubkey !== rootAdmin) return null
  if (ev.kind !== KIND_APP_DATA || tagValue(ev, 'd') !== STAFF_D_TAG) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(ev.content)
  } catch {
    return null
  }
  const body = parsed as { v?: unknown; staff?: unknown }
  if (body?.v !== 1 || !Array.isArray(body.staff)) return null

  const out = new Map<string, Role>([[rootAdmin, 'admin']])
  for (const raw of body.staff) {
    const m = raw as { pubkey?: unknown; role?: unknown }
    if (typeof m?.pubkey !== 'string' || !HEX64.test(m.pubkey)) continue
    if (m.role !== 'admin' && m.role !== 'moderator') continue
    if (m.pubkey === rootAdmin) continue // déjà admin, et rien ne peut l'en priver
    out.set(m.pubkey, m.role)
  }
  return out
}

/** Lit une liste d'actions. Les entrées invalides sont ignorées, pas fatales. */
export function parseActions(ev: Event): ModAction[] | null {
  if (ev.kind !== KIND_APP_DATA || tagValue(ev, 'd') !== MODERATION_D_TAG) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(ev.content)
  } catch {
    return null
  }
  const body = parsed as { v?: unknown; actions?: unknown }
  if (body?.v !== 1 || !Array.isArray(body.actions)) return null

  const out: ModAction[] = []
  for (const raw of body.actions) {
    const a = raw as Partial<ModAction>
    if (typeof a?.type !== 'string' || familyOf(a.type as ActionType) === null) continue
    if (typeof a.target !== 'string' || !HEX64.test(a.target)) continue
    if (typeof a.at !== 'number' || !Number.isFinite(a.at)) continue
    const reason = typeof a.reason === 'string' ? a.reason.trim().slice(0, MAX_REASON_LEN) : ''
    const action: ModAction = { type: a.type as ActionType, target: a.target, reason, at: a.at }
    if (a.class === 'illegal' || a.class === 'editorial') action.class = a.class
    out.push(action)
  }
  return out
}

/** Garde la version la plus récente de chaque event adressable (pubkey, kind, `d`). */
function newestByAuthor(events: Iterable<Event>, dTag: string): Map<string, Event> {
  const out = new Map<string, Event>()
  for (const ev of events) {
    if (ev.kind !== KIND_APP_DATA || tagValue(ev, 'd') !== dTag) continue
    const prev = out.get(ev.pubkey)
    if (!prev || ev.created_at > prev.created_at) out.set(ev.pubkey, ev)
  }
  return out
}

/**
 * Dérive l'état en vigueur (doc §3.4).
 *
 * Trois règles qui ne sont pas des détails :
 *   1. seules comptent les actions d'une clé **actuellement** dans le roster —
 *      c'est ce qui fait qu'une révocation annule tout le travail d'un
 *      modérateur d'un seul geste, sans avoir à défaire ses actions une à une
 *   2. par cible, **le `at` le plus récent gagne**, quel que soit l'auteur
 *   3. une action visant une clé du roster est **ignorée** — sinon deux
 *      modérateurs en désaccord se bannissent mutuellement et l'état effectif
 *      dépend de qui a publié en dernier
 */
export function deriveState(events: Iterable<Event>, rootAdmin: string): ModerationState {
  const all = [...events]
  const state: ModerationState = {
    staff: new Map(),
    hidden: new Map(),
    banned: new Map(),
    locked: new Map(),
    pinned: new Map(),
    ignored: new Map(),
  }
  if (!HEX64.test(rootAdmin)) return state

  const rosters = newestByAuthor(all, STAFF_D_TAG)
  const rosterEvent = rosters.get(rootAdmin)
  state.staff = rosterEvent ? (parseStaff(rosterEvent, rootAdmin) ?? new Map()) : new Map()
  if (state.staff.size === 0) state.staff.set(rootAdmin, 'admin')

  // Le gagnant courant par (famille, cible), pour appliquer la règle 2 sans
  // dépendre de l'ordre d'arrivée des events.
  const winner = new Map<string, AppliedAction>()

  for (const [author, ev] of newestByAuthor(all, MODERATION_D_TAG)) {
    const role = state.staff.get(author)
    if (!role) continue // règle 1
    for (const action of parseActions(ev) ?? []) {
      const family = familyOf(action.type)
      if (!family) continue
      if (family === 'banned' && state.staff.has(action.target)) continue // règle 3

      const key = `${family}:${action.target}`
      const prev = winner.get(key)
      // Égalité de `at` : on départage par la clé de l'auteur pour que deux
      // clients arrivent au même état. Arbitraire, mais déterministe — et le cas
      // ne se produit qu'à la seconde près entre deux modérateurs.
      if (prev && (prev.at > action.at || (prev.at === action.at && prev.by <= author))) continue

      const applied: AppliedAction = { ...action, by: author }
      // Classer en `illegal` engage l'opérateur et déclenche une purge : réservé
      // aux admins (doc §12.6). Un modérateur qui l'invoque obtient un masquage
      // éditorial — dégradation silencieuse côté état, signalée côté panneau.
      if (applied.class === 'illegal' && role !== 'admin') applied.class = 'editorial'
      winner.set(key, applied)
    }
  }

  for (const action of winner.values()) {
    if (isUndo(action.type)) continue
    const family = familyOf(action.type)
    if (family) state[family].set(action.target, action)
  }
  return state
}

/* ------------------------------------------------- vues pour le relais */

/** Clés refusées à l'écriture. */
export function blockedKeys(state: ModerationState): Set<string> {
  return new Set(state.banned.keys())
}

/** Topics dont les réponses sont refusées. */
export function lockedThreads(state: ModerationState): Set<string> {
  return new Set(state.locked.keys())
}

/**
 * Events que le relais **cesse de servir** (doc §5.2, §6.1).
 *
 * C'est la seule chose qui ressemble à une suppression et qui soit vraie ici :
 * on ne retire rien du réseau, on cesse de le distribuer. Ne concerne que le
 * masquage classé `illegal`.
 */
export function purgedEvents(state: ModerationState): Set<string> {
  const out = new Set<string>()
  for (const [id, action] of state.hidden) if (action.class === 'illegal') out.add(id)
  return out
}
