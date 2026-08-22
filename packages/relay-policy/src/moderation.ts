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
/**
 * Les points attribués à la main par UN membre du staff. Une liste par clé.
 *
 * Vit ici, avec la modération, et pas dans `@forome/points` : une attribution
 * n'est pas un pli sur du contenu public, c'est **une décision signée par une
 * autorité épinglée**. C'est exactement la nature d'une action de modération, et
 * c'est cette parenté qui donne gratuitement les trois propriétés qui comptent —
 * révocable en republiant la liste, annulée en bloc si la clé quitte le roster,
 * auditable publiquement.
 *
 * Corollaire volontaire : **l'indexeur n'en sait rien.** Il reste un pli pur sur
 * les events publics ; c'est le client qui additionne. Bénéfice réel — les
 * attributions vivent dans des events signés, donc elles survivent à une perte
 * de l'état de l'indexeur, là où les points gagnés sont la partie périssable.
 */
export const GRANTS_D_TAG = 'forome.points.grants'

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

/**
 * Des points donnés — ou retirés — à la main, pour ce que le barème ne sait pas
 * voir (spec §16.8).
 *
 * `amount` est **signé** : positif pour récompenser, négatif pour retirer. Les
 * deux vivent dans la même liste et se somment, parce que ce sont le même geste
 * dans deux sens — une main qui corrige un score, motif à l'appui.
 *
 * Le total attribué peut donc être négatif. Ce qui **ne** peut pas l'être, c'est
 * le score affiché : le client le plancherise à zéro (`stores/points.ts`). Un
 * nombre négatif dans un classement public serait un pilori permanent, ce qui est
 * un acte bien plus fort que « retirer des points » — et le retrait reste
 * intégralement lisible, ligne par ligne, sur le profil.
 */
export interface PointGrant {
  /** Clé visée. Peut être celle de l'auteur : s'attribuer des points est permis. */
  target: string
  /** Signé : > 0 récompense, < 0 retire. Jamais 0. */
  amount: number
  /** Pourquoi. C'est lui qui fait la différence entre une récompense et un passe-droit. */
  reason: string
  at: number
}

/** Une attribution et la clé qui l'a signée. L'interface n'affiche jamais l'une sans l'autre. */
export interface AppliedGrant extends PointGrant {
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
  /**
   * clé récompensée → attributions en vigueur.
   *
   * Une **liste** et non une entrée unique, à la différence de tout ce qui
   * précède : un masquage est un état (il y en a un seul en vigueur), une
   * récompense est un fait qui s'ajoute. Trois distinctions valent trois lignes
   * sur un profil, et leur somme fait les points.
   */
  grants: Map<string, AppliedGrant[]>
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

/** Même borne, même raison, pour la liste d'attributions d'un membre du staff. */
export const MAX_GRANTS_PER_LIST = 200

/**
 * Plafond par attribution, **en valeur absolue**.
 *
 * Ce n'est pas une limite de politique — donner ou retirer autant qu'on veut est
 * le propos. C'est une borne d'ingénierie : la courbe des niveaux passe par une
 * racine carrée, et un `amount` absurde (ou `Infinity`, qu'un JSON écrit sans
 * effort) rendrait un niveau `NaN` affiché à la place d'un nombre. Un million de
 * points vaut déjà le niveau 283.
 */
export const MAX_GRANT_AMOUNT = 1_000_000

/**
 * Les familles qu'une ACTION alimente. `staff` et `grants` n'en sont pas : le
 * roster vient d'ailleurs, et une attribution n'est pas un état à remplacer —
 * l'exclure ici est ce qui empêche de traiter une récompense comme un masquage.
 */
type ActionFamily = keyof Omit<ModerationState, 'staff' | 'grants'>

/** Quelle famille d'état une action alimente. `null` = type inconnu. */
function familyOf(type: ActionType): ActionFamily | null {
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

/**
 * Lit une liste d'attributions de points.
 *
 * **Un motif vide est accepté ici**, alors que l'écriture l'exige (voir
 * `grant()` côté client). Ce n'est pas une incohérence, c'est la leçon déjà
 * apprise sur `normalizePubkey` : être strict à la lecture produit un rejet
 * silencieux — le staff donne 300 points, rien ne se passe, et il n'y a rien à
 * comprendre. On refuse donc au moment où on peut expliquer, et on lit
 * largement.
 */
export function parseGrants(ev: Event): PointGrant[] | null {
  if (ev.kind !== KIND_APP_DATA || tagValue(ev, 'd') !== GRANTS_D_TAG) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(ev.content)
  } catch {
    return null
  }
  const body = parsed as { v?: unknown; grants?: unknown }
  if (body?.v !== 1 || !Array.isArray(body.grants)) return null

  const out: PointGrant[] = []
  for (const raw of body.grants) {
    const g = raw as Partial<PointGrant>
    if (typeof g?.target !== 'string' || !HEX64.test(g.target)) continue
    if (typeof g.amount !== 'number' || !Number.isFinite(g.amount)) continue
    // `trunc` et non `floor` : sur un retrait, `floor(-12.9)` donnerait -13, soit
    // un point de plus que ce que la personne a signé.
    const amount = Math.trunc(g.amount)
    if (amount === 0 || Math.abs(amount) > MAX_GRANT_AMOUNT) continue
    if (typeof g.at !== 'number' || !Number.isFinite(g.at)) continue
    const reason = typeof g.reason === 'string' ? g.reason.trim().slice(0, MAX_REASON_LEN) : ''
    out.push({ target: g.target, amount, reason, at: g.at })
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
    grants: new Map(),
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

  /*
   * Les attributions (spec §16.8). Deux règles :
   *   1. **même règle 1 que les actions** — seules comptent celles d'une clé
   *      actuellement au roster, donc révoquer quelqu'un annule tout ce qu'il a
   *      donné, d'un geste, y compris à lui-même
   *   2. **ça s'additionne**, ça ne se remplace pas — contrairement à tout ce qui
   *      précède. Une attribution n'est pas un état : en recevoir trois, c'est
   *      trois lignes, pas la dernière qui gagne. Et c'est ce qui permet à un
   *      retrait de corriger la générosité d'un autre modérateur.
   *
   * **S'attribuer des points à soi-même est permis.** L'auto-crédit est interdit
   * dans le pli automatique (`@forome/points`) parce qu'il y est invisible, non
   * attribuable et farmable à grande échelle ; aucune des trois ne vaut ici. Une
   * attribution est signée, publique, motivée, et l'interface dit « par
   * soi-même » quand l'auteur est la cible. Le garde-fou n'est pas une règle de
   * dérivation, c'est le roster : abuser se voit, et se révoque.
   */
  for (const [author, ev] of newestByAuthor(all, GRANTS_D_TAG)) {
    if (!state.staff.has(author)) continue // règle 1
    let kept = 0
    for (const g of parseGrants(ev) ?? []) {
      if (++kept > MAX_GRANTS_PER_LIST) break
      const list = state.grants.get(g.target)
      if (list) list.push({ ...g, by: author })
      else state.grants.set(g.target, [{ ...g, by: author }])
    }
  }
  for (const list of state.grants.values()) list.sort((a, b) => b.at - a.at)

  for (const action of winner.values()) {
    if (isUndo(action.type)) continue
    const family = familyOf(action.type)
    if (family) state[family].set(action.target, action)
  }
  return state
}

/**
 * Somme **signée** de ce que le staff a attribué à cette clé : les récompenses
 * moins les retraits. Peut donc être négative — c'est l'appelant qui décide
 * quoi en faire (le client plancherise le score affiché à zéro).
 */
export function grantedPoints(state: ModerationState, pubkey: string): number {
  let total = 0
  for (const g of state.grants.get(pubkey) ?? []) total += g.amount
  return total
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
