/**
 * L'équipe et ses décisions (`docs/moderation-staff.md`).
 *
 * Trois maillons, tous des events signés, tous vérifiables par n'importe qui :
 *
 *     clé racine ──signe──▶ roster ──désigne──▶ modérateurs ──signent──▶ actions
 *
 * Ce store lit la chaîne et en dérive l'état en vigueur. La dérivation
 * elle-même vit dans `@forome/relay-policy/moderation` et est **partagée avec le
 * relais** : le client doit replier exactement ce que le relais refuse.
 *
 * ⚠️ Ce que ce fichier ne fait pas, et qu'il ne faut pas croire acquis :
 *   - **il ne supprime rien.** Masquer replie ; le message reste sur le réseau
 *     et un autre client le sert (§9.3). Seule la catégorie `illegal` va plus
 *     loin, et encore : côté relais, en cessant de servir, pas en effaçant
 *   - **il ne modère pas les MP.** NIP-17 chiffre le contenu et masque
 *     l'expéditeur (§10.2) : le staff ne peut pas, et ne doit pas
 */
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import {
  deriveState,
  blockedKeys,
  lockedThreads,
  purgedEvents,
  STAFF_D_TAG,
  MODERATION_D_TAG,
  MAX_ACTIONS_PER_LIST,
  MAX_REASON_LEN,
  normalizePubkey,
  type ModerationState,
  type ModAction,
  type AppliedAction,
  type ActionType,
  type HideClass,
  type Role,
} from '@forome/relay-policy/moderation'
import { KIND_APP_DATA, type NostrEvent } from '~/types/nostr'
import { KIND_REPORT, type HiddenNotice } from '~/types/moderation'
import { groupReports } from '~/utils/moderation'
import type { SubHandle } from '~/stores/relays'

function nowS(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Horodatage **strictement croissant** pour un event adressable.
 *
 * Un kind 30078 est remplacé par (clé, kind, `d`) **sur `created_at`** : à
 * horodatage égal, un relais garde la version qu'il a déjà — tout en répondant
 * `OK`. Deux décisions prises dans la même seconde donnaient donc une seconde
 * publication acceptée et sans effet, invisible depuis le panneau.
 *
 * Nostr compte en secondes (§types) et un modérateur clique plus vite que ça.
 * Trouvé par `scripts/smoke-moderation.ts`, pas anticipé.
 */
function nextStamp(previous: number | undefined): number {
  const now = nowS()
  return previous !== undefined && previous >= now ? previous + 1 : now
}

function emptyState(): ModerationState {
  return {
    staff: new Map(),
    hidden: new Map(),
    banned: new Map(),
    locked: new Map(),
    pinned: new Map(),
    ignored: new Map(),
  }
}

export const useModerationStore = defineStore('moderation', () => {
  const relayStore = useRelayStore()
  const identity = useIdentityStore()
  const config = useRuntimeConfig()

  /** Events bruts de la chaîne, indexés par (clé, tag `d`). */
  const chain = shallowRef(new Map<string, NostrEvent>())
  const reportEvents = shallowRef(new Map<string, NostrEvent>())

  /** true dès qu'on a lu la chaîne : condition pour publier sans écraser. */
  const loaded = ref(false)
  const publishing = ref(false)
  const lastError = ref<string | null>(null)

  let subs: SubHandle[] = []
  let staffSub: SubHandle | null = null
  let reportSub: SubHandle | null = null

  /**
   * Clé racine du forum : **configuration seulement**, jamais l'URL.
   *
   * `?relays=` et `?indexer=` existent comme surcharges de développement ; celle-ci
   * a été essayée puis retirée, et l'écart mérite d'être expliqué. Ces deux-là
   * changent ce qu'on voit et dans quel ordre. Une clé racine, elle, décide ce
   * qui est **retiré de la vue au nom du forum** : un lien piégé
   * `?admin=<clé de l'attaquant>` aurait fait replier chez la victime n'importe
   * quel message, sous l'étiquette « masqué par la modération ». Même forme,
   * autre gravité.
   *
   * L'installation passe donc par `npm run setup:moderation`, qui écrit le
   * `.env` lu **à la fois** par ce client et par le relais — la seule façon que
   * les deux moitiés du système ne divergent pas.
   *
   * Vide par défaut, délibérément : **sans clé épinglée, aucun staff et aucune
   * action appliquée** — même raisonnement que le tick de l'indexeur (§5.2).
   */
  const rootAdmin = ref<string | null>(
    normalizePubkey(config.public.adminPubkey as string | undefined),
  )
  const configured = computed(() => !!rootAdmin.value)

  /* --------------------------------------------------------------- lecture */

  /**
   * L'état en vigueur, **dérivé** et non recalculé à la main.
   *
   * C'était un `shallowRef` mis à jour à chaque event reçu, et ça cachait le pire
   * cas possible : sur un forum neuf, aucun roster n'a encore été publié, donc
   * aucun event n'arrivait, donc l'état restait vide — et la clé racine
   * elle-même n'était pas reconnue comme administratrice. `deriveState` la
   * nomme pourtant d'office ; c'est l'appel qui manquait, pas la règle. En
   * computed, le cas « rien n'est encore arrivé » se traite tout seul.
   */
  const state = computed<ModerationState>(() =>
    rootAdmin.value ? deriveState(chain.value.values(), rootAdmin.value) : emptyState(),
  )

  function ingest(ev: NostrEvent): void {
    const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const key = `${ev.pubkey}:${d}`
    const prev = chain.value.get(key)
    if (prev && prev.created_at >= ev.created_at) return

    const next = new Map(chain.value)
    next.set(key, ev)
    chain.value = next

    // Le roster a changé : les listes à écouter ne sont plus les mêmes.
    if (d === STAFF_D_TAG) watchStaffLists()
  }

  /**
   * Souscrit aux listes d'actions des modérateurs **actuellement** au roster.
   *
   * Rappelée à chaque changement de roster : une clé révoquée cesse d'être
   * écoutée, ce qui est cohérent avec `deriveState` qui cesse de la compter.
   */
  function watchStaffLists(): void {
    const authors = [...state.value.staff.keys()]
    if (authors.length === 0) return
    staffSub?.close()
    staffSub = relayStore.subscribe(
      { kinds: [KIND_APP_DATA], authors, '#d': [MODERATION_D_TAG] },
      { onevent: ingest },
      'mod-actions',
    )
  }

  async function load(): Promise<void> {
    const admin = rootAdmin.value
    if (!admin) {
      loaded.value = true
      return
    }
    lastError.value = null
    try {
      const roster = await relayStore.query({
        kinds: [KIND_APP_DATA],
        authors: [admin],
        '#d': [STAFF_D_TAG],
      })
      for (const ev of roster) ingest(ev)

      const authors = [...state.value.staff.keys()]
      if (authors.length > 0) {
        const lists = await relayStore.query({
          kinds: [KIND_APP_DATA],
          authors,
          '#d': [MODERATION_D_TAG],
        })
        for (const ev of lists) ingest(ev)
      }
      loaded.value = true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      loaded.value = false
    }
  }

  function start(): void {
    const admin = rootAdmin.value
    if (!admin || subs.length > 0) return
    subs.push(
      relayStore.subscribe(
        { kinds: [KIND_APP_DATA], authors: [admin], '#d': [STAFF_D_TAG] },
        { onevent: ingest },
        'mod-roster',
      ),
    )
    void load().then(watchStaffLists)
  }

  /** Les signalements ne concernent que le staff : personne d'autre ne les charge. */
  function watchReports(): void {
    if (!amStaff.value || reportSub) return
    reportSub = relayStore.subscribe(
      { kinds: [KIND_REPORT], limit: 500 },
      {
        onevent: (ev) => {
          if (reportEvents.value.has(ev.id)) return
          const next = new Map(reportEvents.value)
          next.set(ev.id, ev)
          reportEvents.value = next
        },
      },
      'reports',
    )
  }

  function stop(): void {
    for (const s of subs) s.close()
    subs = []
    staffSub?.close()
    staffSub = null
    reportSub?.close()
    reportSub = null
  }

  /* --------------------------------------------------------------- lecture */

  function roleOf(pubkey: string): Role | null {
    return state.value.staff.get(pubkey) ?? null
  }
  function isStaff(pubkey: string): boolean {
    return state.value.staff.has(pubkey)
  }

  const amStaff = computed(() => !!identity.pubkey && state.value.staff.has(identity.pubkey))
  const amAdmin = computed(
    () => !!identity.pubkey && state.value.staff.get(identity.pubkey) === 'admin',
  )

  /**
   * Ce qu'il faut afficher à la place d'un message masqué — jamais rien, jamais
   * un trou. Le §9.2 refuse la censure silencieuse autant que la censure : la
   * rangée reste, avec le motif et le nom de qui a décidé.
   */
  function hiddenNotice(eventId: string): HiddenNotice | null {
    const action = state.value.hidden.get(eventId)
    if (!action) return null
    return {
      reason: action.reason,
      by: action.by,
      // La catégorie `illegal` n'offre pas de bouton : ce serait un chemin vers
      // un contenu dont l'opérateur répond (doc §5.2).
      revealable: action.class !== 'illegal',
    }
  }

  function isBanned(pubkey: string): boolean {
    return state.value.banned.has(pubkey)
  }
  function banNotice(pubkey: string): AppliedAction | null {
    return state.value.banned.get(pubkey) ?? null
  }
  function isLocked(topicId: string): boolean {
    return state.value.locked.has(topicId)
  }
  function lockNotice(topicId: string): AppliedAction | null {
    return state.value.locked.get(topicId) ?? null
  }
  function isPinned(topicId: string): boolean {
    return state.value.pinned.has(topicId)
  }

  /**
   * Les décisions en vigueur, les plus récentes d'abord.
   *
   * ⚠️ C'est **l'état courant, pas un historique** : les listes sont
   * remplaçables, donc une action retirée par son auteur disparaît d'ici et des
   * relais. Un journal inaltérable demanderait un event par action (doc §11).
   */
  const journal = computed<AppliedAction[]>(() => {
    const s = state.value
    return [...s.hidden.values(), ...s.banned.values(), ...s.locked.values(), ...s.pinned.values()].sort(
      (a, b) => b.at - a.at,
    )
  })

  /** Mes propres actions — c'est cette liste que je republie. */
  const myActions = computed<ModAction[]>(() => {
    const me = identity.pubkey
    if (!me) return []
    const ev = chain.value.get(`${me}:${MODERATION_D_TAG}`)
    if (!ev) return []
    try {
      const body = JSON.parse(ev.content) as { actions?: ModAction[] }
      return Array.isArray(body.actions) ? body.actions : []
    } catch {
      return []
    }
  })

  /** File des signalements, triée par voix distinctes (§9.6). */
  const reportQueue = computed(() => {
    const social = useSocialStore()
    const s = state.value
    return groupReports(reportEvents.value.values(), {
      followsOf: (pk) => social.followsOfCached(pk),
      ignored: new Set(s.ignored.keys()),
      resolved: new Set([...s.hidden.keys(), ...s.banned.keys()]),
    })
  })

  /* ----------------------------------------------------------- publication */

  /**
   * Republie ma liste complète.
   *
   * Garde-fou repris du store social : **sans lecture réussie, on ne publie
   * pas.** La liste est remplaçable, donc republier sans connaître l'existant
   * effacerait des décisions — y compris celles prises depuis un autre appareil.
   */
  async function publishActions(actions: ModAction[]): Promise<boolean> {
    if (!loaded.value) {
      lastError.value = 'état de modération non chargé — publication refusée pour ne pas l’écraser'
      return false
    }
    if (!amStaff.value) {
      lastError.value = 'cette clé n’est pas au roster'
      return false
    }
    if (actions.length > MAX_ACTIONS_PER_LIST) {
      lastError.value = `liste pleine (${MAX_ACTIONS_PER_LIST} actions) — archiver ou déléguer avant d’en ajouter`
      return false
    }
    publishing.value = true
    lastError.value = null
    try {
      const me = identity.pubkey ?? ''
      const at = nextStamp(chain.value.get(`${me}:${MODERATION_D_TAG}`)?.created_at)
      const outcome = await usePublisher().publishAppData(
        MODERATION_D_TAG,
        { v: 1, at, actions },
        at,
      )
      return !!outcome && outcome.result.accepted.length > 0
    } finally {
      publishing.value = false
    }
  }

  /**
   * Pose une action. Une seule entrée par cible dans ma liste : reposer sur la
   * même cible remplace, sinon la liste enflerait d'un historique qu'elle n'a
   * pas vocation à porter (voir la borne de taille).
   */
  async function act(
    type: ActionType,
    target: string,
    reason: string,
    klass?: HideClass,
  ): Promise<boolean> {
    const trimmed = reason.trim().slice(0, MAX_REASON_LEN)
    if (!trimmed) {
      lastError.value = 'motif obligatoire — une action sans motif est une censure silencieuse signée'
      return false
    }
    const entry: ModAction = { type, target, reason: trimmed, at: nowS() }
    // `illegal` engage l'opérateur et déclenche une purge : admins seulement
    // (doc §12.6). La dérivation partagée dégraderait de toute façon, mais
    // laisser le bouton mentir jusqu'à la publication serait pire.
    if (klass) {
      if (klass === 'illegal' && !amAdmin.value) {
        lastError.value = 'seul un administrateur peut classer un contenu en illégal'
        return false
      }
      entry.class = klass
    }
    const next = myActions.value.filter((a) => !(a.target === target && sameFamily(a.type, type)))
    next.push(entry)
    return publishActions(next)
  }

  function sameFamily(a: ActionType, b: ActionType): boolean {
    const family = (t: ActionType): string =>
      t === 'hide' || t === 'show'
        ? 'hidden'
        : t === 'ban' || t === 'unban'
          ? 'banned'
          : t === 'lock' || t === 'unlock'
            ? 'locked'
            : t === 'pin' || t === 'unpin'
              ? 'pinned'
              : 'ignored'
    return family(a) === family(b)
  }

  const hide = (id: string, reason: string, klass: HideClass = 'editorial'): Promise<boolean> =>
    act('hide', id, reason, klass)
  const show = (id: string, reason: string): Promise<boolean> => act('show', id, reason)
  const ban = (pubkey: string, reason: string): Promise<boolean> => act('ban', pubkey, reason)
  const unban = (pubkey: string, reason: string): Promise<boolean> => act('unban', pubkey, reason)
  const lock = (topicId: string, reason: string): Promise<boolean> => act('lock', topicId, reason)
  const unlock = (topicId: string, reason: string): Promise<boolean> => act('unlock', topicId, reason)
  const pin = (topicId: string, reason: string): Promise<boolean> => act('pin', topicId, reason)
  const unpin = (topicId: string, reason: string): Promise<boolean> => act('unpin', topicId, reason)
  const ignoreReport = (target: string, reason: string): Promise<boolean> =>
    act('ignore', target, reason)

  /**
   * Nomme ou révoque. Le roster est signé par la **clé racine** et par elle
   * seule : cette fonction n'aboutit que si l'identité courante EST la clé
   * racine — en pratique, une session bunker ouverte pour l'occasion.
   */
  async function publishRoster(staff: { pubkey: string; role: Role; since: number }[]): Promise<boolean> {
    if (identity.pubkey !== rootAdmin.value) {
      lastError.value = 'seule la clé racine du forum peut modifier le roster'
      return false
    }
    publishing.value = true
    lastError.value = null
    try {
      const at = nextStamp(chain.value.get(`${rootAdmin.value}:${STAFF_D_TAG}`)?.created_at)
      const outcome = await usePublisher().publishAppData(STAFF_D_TAG, { v: 1, at, staff }, at)
      return !!outcome && outcome.result.accepted.length > 0
    } finally {
      publishing.value = false
    }
  }

  function currentRoster(): { pubkey: string; role: Role; since: number }[] {
    const admin = rootAdmin.value
    const ev = admin ? chain.value.get(`${admin}:${STAFF_D_TAG}`) : null
    if (!ev) return []
    try {
      const body = JSON.parse(ev.content) as { staff?: { pubkey: string; role: Role; since: number }[] }
      return Array.isArray(body.staff) ? body.staff : []
    } catch {
      return []
    }
  }

  async function appoint(input: string, role: Role): Promise<boolean> {
    const pubkey = normalizePubkey(input)
    if (!pubkey) {
      lastError.value = 'clé publique non reconnue — attendu une npub… ou 64 caractères hexadécimaux'
      return false
    }
    const next = currentRoster().filter((m) => m.pubkey !== pubkey)
    next.push({ pubkey, role, since: nowS() })
    return publishRoster(next)
  }

  /**
   * Révoque. **Toutes les actions de cette clé cessent d'être appliquées** — ce
   * n'est pas un effet de bord, c'est ce qui rend la révocation crédible. Le
   * panneau doit le dire avant, et proposer de reprendre les décisions à son
   * compte (doc §11).
   */
  async function revoke(pubkey: string): Promise<boolean> {
    return publishRoster(currentRoster().filter((m) => m.pubkey !== pubkey))
  }

  /** Ce qu'un modérateur perdrait si on le révoquait maintenant. */
  function actionsBy(pubkey: string): AppliedAction[] {
    return journal.value.filter((a) => a.by === pubkey)
  }

  async function report(args: {
    target: string
    targetKind: 'event' | 'pubkey'
    author?: string | null
    type: string
    note?: string
  }): Promise<boolean> {
    const outcome = await usePublisher().publishReport(args)
    return !!outcome && outcome.result.accepted.length > 0
  }

  /**
   * L'état à appliquer côté relais (doc §6). Le panneau l'affiche et le donne à
   * copier : c'est un fichier lu par le plugin strfry, pas une API — un bouton
   * qui prétendrait piloter un relais de production qu'il ne connaît pas serait
   * le même mensonge qu'un « bannir » qui ne bannit rien.
   */
  const relayState = computed(() => ({
    blocked: [...blockedKeys(state.value)],
    locked: [...lockedThreads(state.value)],
  }))

  /** Ids que le relais doit cesser de servir, et que strfry doit effacer. */
  const toPurge = computed(() => [...purgedEvents(state.value)])

  return {
    rootAdmin,
    configured,
    state,
    loaded,
    publishing,
    lastError,
    amStaff,
    amAdmin,
    journal,
    myActions,
    reportQueue,
    relayState,
    toPurge,
    start,
    stop,
    load,
    watchReports,
    roleOf,
    isStaff,
    hiddenNotice,
    isBanned,
    banNotice,
    isLocked,
    lockNotice,
    isPinned,
    currentRoster,
    actionsBy,
    hide,
    show,
    ban,
    unban,
    lock,
    unlock,
    pin,
    unpin,
    ignoreReport,
    appoint,
    revoke,
    report,
  }
})
