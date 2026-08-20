/**
 * Suivre, bloquer, web of trust (spec v2 §11.2, §12.3).
 *
 * ## Suivre et bloquer, pas d'amis réciproques
 *
 * Décision v1 conservée : l'amitié réciproque coûte cher (demandes,
 * acceptations, états intermédiaires) et JVC fonctionne très bien sans. Suivre
 * (kind 3, asymétrique) et bloquer (kind 10000, asymétrique, dur) suffisent.
 *
 * ## Le piège des events remplaçables
 *
 * kind 3 et kind 10000 sont **remplaçables** : publier écrase la version
 * précédente. Publier une liste partielle **détruit** donc les follows de
 * l'utilisateur. C'est particulièrement vicieux avec une clé importée depuis un
 * autre client, où la liste peut être longue et invisible pour nous.
 *
 * Règle appliquée : **on ne publie jamais sans avoir lu la liste courante**, et
 * on refuse de publier si la lecture a échoué. Un follow qui échoue est un
 * désagrément ; une liste de contacts effacée est irréversible.
 *
 * ## Ce que ça expose, et qui n'était pas le cas en v1
 *
 * La liste de follows est **publique** : qui tu suis est lisible par tout le
 * monde, pour toujours. NIP-51 permet des entrées chiffrées dans le contenu ;
 * on ne s'en sert pas ici, mais le blocage mériterait de l'être — bloquer
 * quelqu'un publiquement est en soi une information.
 */
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { KIND_CONTACTS, KIND_MUTE_LIST, type NostrEvent } from '~/types/nostr'

/** Niveau de confiance d'une clé, du plus fort au plus faible. */
export type Trust =
  | 'self'
  | 'followed' // je la suis directement
  | 'network' // suivie par au moins une personne que je suis
  | 'unknown' // jamais vue dans mon graphe
  | 'muted'

const WOT_FETCH_BATCH = 100

export const useSocialStore = defineStore('social', () => {
  const relayStore = useRelayStore()
  const identity = useIdentityStore()

  const follows = ref(new Set<string>())
  const mutes = ref(new Set<string>())
  /** clé → nombre de personnes que je suis qui la suivent */
  const network = shallowRef(new Map<string, number>())

  /**
   * clé → ce qu'elle suit, tel qu'on l'a lu.
   *
   * Le WoT n'en tirait qu'un compteur et jetait les ensembles ; la file de
   * modération, elle, a besoin du **graphe** pour compter des voix distinctes
   * plutôt que des signalements (spec v2 §9.6). On garde donc ce qui était déjà
   * chargé, au lieu de le relire ailleurs.
   */
  const followSets = shallowRef(new Map<string, Set<string>>())
  const EMPTY: ReadonlySet<string> = new Set()

  const loaded = ref(false)
  const loadError = ref<string | null>(null)
  const publishing = ref(false)
  const wotBuilding = ref(false)

  let subs: { close: () => void }[] = []

  /* ------------------------------------------------------------- lecture */

  function pubkeysFromTags(ev: NostrEvent): Set<string> {
    const out = new Set<string>()
    for (const t of ev.tags) {
      if (t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/.test(t[1])) out.add(t[1])
    }
    return out
  }

  let loadInFlight: Promise<void> | null = null

  /**
   * Charge mes propres listes. Doit réussir avant toute publication.
   *
   * Idempotent : le layout, la page MP et la page profil l'appellent chacun
   * « au cas où » — c'est voulu, une arrivée directe ne passe pas par le layout
   * dans le bon ordre. Sans cette garde, arriver sur `/dm` lançait trois fois
   * les mêmes requêtes kind 3/10000 **et trois `buildWot()`** (jusqu'à 100
   * kind 3, les events les plus lourds du réseau) en parallèle du premier
   * rendu. Le retour à zéro passe par `reset()`, au changement d'identité.
   */
  function load(): Promise<void> {
    if (loaded.value) return Promise.resolve()
    if (loadInFlight) return loadInFlight
    loadInFlight = doLoad().finally(() => {
      loadInFlight = null
    })
    return loadInFlight
  }

  async function doLoad(): Promise<void> {
    const me = identity.pubkey
    if (!me) return
    loadError.value = null
    try {
      const events = await relayStore.query({
        kinds: [KIND_CONTACTS, KIND_MUTE_LIST],
        authors: [me],
      })
      // remplaçables : garder le plus récent par kind
      const newest = new Map<number, NostrEvent>()
      for (const ev of events) {
        const prev = newest.get(ev.kind)
        if (!prev || ev.created_at > prev.created_at) newest.set(ev.kind, ev)
      }
      const contacts = newest.get(KIND_CONTACTS)
      const muteList = newest.get(KIND_MUTE_LIST)
      if (contacts) follows.value = pubkeysFromTags(contacts)
      if (muteList) mutes.value = pubkeysFromTags(muteList)
      loaded.value = true
      void buildWot()
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : String(err)
      loaded.value = false
    }
  }

  /**
   * Construit le web of trust : les kind 3 des gens que je suis.
   *
   * C'est **l'anti-spam le plus efficace et le plus juste** (§12.3) — il ne coûte
   * rien à un habitué et beaucoup à une ferme de clés. Mais il ne marche pas à
   * trente utilisateurs : sans follows, le graphe est vide et tout le monde est
   * `unknown`. D'où l'ordre de la spec : PoW et policy de relais d'abord.
   */
  async function buildWot(): Promise<void> {
    const authors = [...follows.value].slice(0, WOT_FETCH_BATCH)
    if (authors.length === 0) {
      network.value = new Map()
      return
    }
    wotBuilding.value = true
    try {
      const lists = await relayStore.query({ kinds: [KIND_CONTACTS], authors })
      const newestPerAuthor = new Map<string, NostrEvent>()
      for (const ev of lists) {
        const prev = newestPerAuthor.get(ev.pubkey)
        if (!prev || ev.created_at > prev.created_at) newestPerAuthor.set(ev.pubkey, ev)
      }
      const counts = new Map<string, number>()
      const sets = new Map(followSets.value)
      for (const ev of newestPerAuthor.values()) {
        const followed = pubkeysFromTags(ev)
        sets.set(ev.pubkey, followed)
        for (const pk of followed) counts.set(pk, (counts.get(pk) ?? 0) + 1)
      }
      network.value = counts
      followSets.value = sets
    } catch {
      // graphe indisponible : tout le monde reste `unknown`, ce qui est le
      // comportement sûr — on ne dégrade rien, on ne priorise personne
    } finally {
      wotBuilding.value = false
    }
  }

  /* ---------------------------------------------------------- publication */

  async function publishList(kind: number, keys: Set<string>): Promise<boolean> {
    const publisher = usePublisher()
    // Garde-fou : sans lecture réussie, publier écraserait une liste qu'on ne
    // connaît pas. Voir l'en-tête de ce fichier.
    if (!loaded.value) {
      loadError.value = 'liste courante non chargée — publication refusée pour ne pas l’écraser'
      return false
    }
    publishing.value = true
    try {
      const tags = [...keys].map((pk) => ['p', pk])
      const outcome = await publisher.publishList(kind, tags)
      return !!outcome && outcome.result.accepted.length > 0
    } finally {
      publishing.value = false
    }
  }

  async function follow(pubkey: string): Promise<boolean> {
    if (!pubkey || pubkey === identity.pubkey) return false
    const next = new Set(follows.value)
    next.add(pubkey)
    const ok = await publishList(KIND_CONTACTS, next)
    if (ok) {
      follows.value = next
      void buildWot()
    }
    return ok
  }

  async function unfollow(pubkey: string): Promise<boolean> {
    const next = new Set(follows.value)
    if (!next.delete(pubkey)) return true
    const ok = await publishList(KIND_CONTACTS, next)
    if (ok) {
      follows.value = next
      void buildWot()
    }
    return ok
  }

  async function mute(pubkey: string): Promise<boolean> {
    if (!pubkey || pubkey === identity.pubkey) return false
    const next = new Set(mutes.value)
    next.add(pubkey)
    const ok = await publishList(KIND_MUTE_LIST, next)
    if (ok) mutes.value = next
    return ok
  }

  async function unmute(pubkey: string): Promise<boolean> {
    const next = new Set(mutes.value)
    if (!next.delete(pubkey)) return true
    const ok = await publishList(KIND_MUTE_LIST, next)
    if (ok) mutes.value = next
    return ok
  }

  /* ------------------------------------------------------------- lecture */

  function trustOf(pubkey: string): Trust {
    if (pubkey === identity.pubkey) return 'self'
    if (mutes.value.has(pubkey)) return 'muted'
    if (follows.value.has(pubkey)) return 'followed'
    if ((network.value.get(pubkey) ?? 0) > 0) return 'network'
    return 'unknown'
  }

  /** Combien de personnes que je suis suivent cette clé. */
  function networkCount(pubkey: string): number {
    return network.value.get(pubkey) ?? 0
  }

  /** Ce que suit cette clé, si on l'a lu. Vide sinon — jamais de requête ici. */
  function followsOfCached(pubkey: string): ReadonlySet<string> {
    return followSets.value.get(pubkey) ?? EMPTY
  }

  /**
   * Charge les kind 3 de clés arbitraires — les signalants, en pratique.
   *
   * Ne relit pas ce qu'on a déjà : la file de modération se recalcule à chaque
   * signalement reçu, et refetcher le graphe à chaque fois rendrait le panneau
   * inutilisable pendant un raid, c'est-à-dire au seul moment qui compte.
   */
  async function fetchFollowsFor(pubkeys: Iterable<string>): Promise<void> {
    const missing = [...new Set(pubkeys)].filter((pk) => !followSets.value.has(pk))
    if (missing.length === 0) return
    try {
      const lists = await relayStore.query({
        kinds: [KIND_CONTACTS],
        authors: missing.slice(0, WOT_FETCH_BATCH),
      })
      const sets = new Map(followSets.value)
      const newest = new Map<string, NostrEvent>()
      for (const ev of lists) {
        const prev = newest.get(ev.pubkey)
        if (!prev || ev.created_at > prev.created_at) newest.set(ev.pubkey, ev)
      }
      for (const ev of newest.values()) sets.set(ev.pubkey, pubkeysFromTags(ev))
      // Une clé sans kind 3 est notée comme telle : sans ça, on la redemanderait
      // à chaque recalcul, et une clé neuve n'en a par définition pas.
      for (const pk of missing) if (!sets.has(pk)) sets.set(pk, new Set())
      followSets.value = sets
    } catch {
      // graphe indisponible : chaque signalant compte pour une voix, ce qui est
      // le comportement sûr — on ne fusionne pas des comptes qu'on ne sait pas liés
    }
  }

  function isFollowed(pubkey: string): boolean {
    return follows.value.has(pubkey)
  }
  function isMuted(pubkey: string): boolean {
    return mutes.value.has(pubkey)
  }

  /**
   * Vrai si on considère la clé digne de confiance pour ouvrir sa boîte de MP
   * (§10.2). Volontairement strict : le gift wrap rend le filtrage par
   * expéditeur impossible côté relais, donc c'est la seule barrière.
   */
  function inWot(pubkey: string): boolean {
    const t = trustOf(pubkey)
    return t === 'self' || t === 'followed' || t === 'network'
  }

  const wotSize = computed(() => network.value.size)

  /** Suivre les changements de mes listes venus d'un autre client. */
  function watch(): void {
    const me = identity.pubkey
    if (!me || subs.length > 0) return
    subs.push(
      relayStore.subscribe(
        { kinds: [KIND_CONTACTS, KIND_MUTE_LIST], authors: [me] },
        {
          onevent: (ev) => {
            if (ev.kind === KIND_CONTACTS) {
              follows.value = pubkeysFromTags(ev)
              void buildWot()
            } else if (ev.kind === KIND_MUTE_LIST) {
              mutes.value = pubkeysFromTags(ev)
            }
            loaded.value = true
          },
        },
        'social',
      ),
    )
  }

  function stop(): void {
    for (const s of subs) s.close()
    subs = []
  }

  function reset(): void {
    stop()
    follows.value = new Set()
    mutes.value = new Set()
    network.value = new Map()
    loaded.value = false
  }

  return {
    follows,
    mutes,
    loaded,
    loadError,
    publishing,
    wotBuilding,
    wotSize,
    load,
    watch,
    stop,
    reset,
    buildWot,
    follow,
    unfollow,
    mute,
    unmute,
    trustOf,
    networkCount,
    followsOfCached,
    fetchFollowsFor,
    isFollowed,
    isMuted,
    inWot,
  }
})
