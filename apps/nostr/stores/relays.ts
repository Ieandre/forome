/**
 * La couche relais (spec §5.1).
 *
 * Le modèle à garder en tête : il n'y a pas UNE socket vers un serveur qui
 * garantirait l'ordre et l'unicité, mais N sockets vers des relais qui ne se
 * connaissent pas, qui renvoient les mêmes events en double et dans n'importe
 * quel ordre. Le dédoublonnage par `id` est ce qui rend la réplication
 * invisible — et c'est le but.
 *
 * La vérification de signature est active par défaut (`pool.verifyEvent`), donc
 * un relais ne peut pas nous injecter un event forgé.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { SimplePool } from 'nostr-tools/pool'
import type { Filter } from 'nostr-tools/filter'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure'
import type { NostrEvent } from '~/types/nostr'
import {
  isLocalRelay,
  isThirdPartyRelay,
  readTargets,
  writeTargets,
  type RelayPlan,
} from '~/utils/relayTargets'

export interface SubHandle {
  close: () => void
}

export interface PublishResult {
  accepted: string[]
  rejected: { url: string; reason: string }[]
}

/** Ce qu'on retient du document NIP-11 d'un relais. */
export interface RelayInfo {
  name: string | null
  /** true = refuse les écritures d'un non-abonné */
  paymentRequired: boolean
  /**
   * `limitation.auth_required` du document NIP-11, purement informatif.
   *
   * ⚠️ Ne pas s'en servir pour décider de s'authentifier : strfry n'émet jamais
   * ce champ alors qu'il exige bel et bien l'AUTH pour lire les kinds de MP. Un
   * relais peut donc réclamer NIP-42 sans que rien ici ne l'annonce — c'est le
   * refus `auth-required` qui fait autorité, et lui seul (voir `authSigner`).
   */
  authRequired: boolean
  /** difficulté de PoW annoncée, 0 si aucune */
  minPow: number
  /** false quand le document dit explicitement qu'on ne peut pas y écrire */
  writable: boolean
}

const RELAYS_OVERRIDE_KEY = 'forome.dev.relays'
/** Autorisation d'écrire sur un relais tiers en dev (`?public=1`). */
const ALLOW_PUBLIC_KEY = 'forome.dev.allowPublic'

/**
 * Plafond d'attente d'un relais à la publication. Court : il ne borne que le
 * moment où l'on cesse d'espérer une réponse, pas la publication elle-même
 * (l'appelant n'attend que le premier accusé — voir `publishSplit`).
 */
const PUBLISH_MAX_WAIT_MS = 3000

export const useRelayStore = defineStore('relays', () => {
  const config = useRuntimeConfig()

  /** Le plan tel que la config le décrit — voir `utils/relayTargets.ts`. */
  function plan(): RelayPlan {
    return {
      dev: !!import.meta.dev,
      homeRelay: (config.public.homeRelay as string) ?? '',
      devRelay: (config.public.devRelay as string) ?? '',
      publicRelays: [...((config.public.relays as string[]) ?? [])],
    }
  }

  /**
   * Ce qu'on interroge, et la surcharge de dev `?relays=ws://localhost:7447`.
   *
   * ⚠️ La surcharge est **persistée en sessionStorage**, et ce n'est pas du
   * confort : sans ça, toute navigation ou tout rechargement qui perd la query
   * (la pré-ouverture du topic chaud réécrit l'URL, le HMR recharge la page)
   * ferait repartir le client vers le défaut — silencieusement.
   *
   * Le défaut, lui, n'est plus le réseau public : `readTargets()` rend le relais
   * local en développement. C'est ce qui manquait le soir où un « test » est
   * parti sur quatre relais publics, la surcharge ayant expiré avec la session.
   */
  function initialRelays(): string[] {
    const fromConfig = readTargets(plan())
    if (!import.meta.client) return fromConfig

    const params = new URLSearchParams(window.location.search)
    // Persistée comme la surcharge de relais, et volatile pour la même raison
    // inversée : elle doit survivre à une réécriture d'URL, pas à la journée.
    if (params.get('public') === '1') sessionStorage.setItem(ALLOW_PUBLIC_KEY, '1')

    const fromUrl = params.get('relays')
    const stored = sessionStorage.getItem(RELAYS_OVERRIDE_KEY)
    const raw = fromUrl ?? stored
    if (!raw) return fromConfig

    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^wss?:\/\//.test(s))
    if (list.length === 0) return fromConfig
    if (fromUrl) sessionStorage.setItem(RELAYS_OVERRIDE_KEY, fromUrl)
    return list
  }

  /** true si les relais viennent d'une surcharge de dev et non de la config. */
  const overridden = computed(
    () => import.meta.client && !!sessionStorage.getItem(RELAYS_OVERRIDE_KEY),
  )

  const relays = ref<string[]>(initialRelays())

  /** url → connecté (true) / en échec (false) / absent = pas encore tenté */
  const status = ref(new Map<string, boolean>())
  const eventsSeen = ref(0)

  /**
   * Document d'information du relais (NIP-11), lu une fois au démarrage.
   *
   * Pourquoi ça compte : **la joignabilité n'est pas la publiabilité.** Un relais
   * peut se connecter, laisser lire, et refuser toute écriture parce qu'il est
   * payant. Sans ce document, on lui envoie chaque publication et on récolte un
   * refus permanent — indistinguable d'une vraie panne pour l'utilisateur.
   * `nostr.wine` faisait exactement ça, et rien dans l'état de connexion ne le
   * montrait.
   *
   * `minPow` est le second gain, et il touche la réactivité : un relais qui
   * annonce sa difficulté minimale permet de miner juste ce qu'il faut **avant**
   * d'essayer, au lieu de l'apprendre par un refus puis de reminer.
   */
  const info = ref(new Map<string, RelayInfo>())

  let pool: SimplePool | null = null

  function ensurePool(): SimplePool {
    if (pool) return pool
    const p = new SimplePool()
    p.onRelayConnectionSuccess = (url: string) => {
      status.value.set(normalize(url), true)
      status.value = new Map(status.value)
    }
    p.onRelayConnectionFailure = (url: string) => {
      status.value.set(normalize(url), false)
      status.value = new Map(status.value)
    }
    pool = p
    return p
  }

  function normalize(url: string): string {
    return url.replace(/\/$/, '')
  }

  /**
   * Lit le document NIP-11 de chaque relais, une fois.
   *
   * Tolérance à l'échec **délibérée** : beaucoup de relais ne servent pas ce
   * document, ou n'autorisent pas CORS depuis un navigateur. Un échec ne dit
   * rien — on suppose alors le relais écrivable, ce qui est le défaut sûr : au
   * pire on tente une écriture qui échoue, comme aujourd'hui. Traiter l'absence
   * de réponse comme « non écrivable » exclurait la majorité des relais.
   */
  async function loadRelayInfo(): Promise<void> {
    if (!import.meta.client) return
    const targets = relays.value.filter((url) => !info.value.has(normalize(url)))
    if (targets.length === 0) return

    const results = await Promise.allSettled(
      targets.map(async (url) => {
        const https = url.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')
        const res = await fetch(https, {
          headers: { Accept: 'application/nostr+json' },
          signal: AbortSignal.timeout(4000),
        })
        if (!res.ok) throw new Error(String(res.status))
        const doc = (await res.json()) as {
          name?: unknown
          limitation?: { payment_required?: unknown; auth_required?: unknown; min_pow_difficulty?: unknown }
        }
        const lim = doc.limitation ?? {}
        const paymentRequired = lim.payment_required === true
        const parsed: RelayInfo = {
          name: typeof doc.name === 'string' ? doc.name : null,
          paymentRequired,
          authRequired: lim.auth_required === true,
          minPow: typeof lim.min_pow_difficulty === 'number' ? lim.min_pow_difficulty : 0,
          // Seul le paiement exclut l'écriture de façon non ambiguë. `auth_required`
          // est trop flou dans NIP-11 (lecture ? écriture ? MP seulement ?) pour
          // qu'on exclue sur cette base : on le signale sans l'appliquer.
          writable: !paymentRequired,
        }
        return { url: normalize(url), parsed }
      }),
    )

    const next = new Map(info.value)
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') next.set(r.value.url, r.value.parsed)
      else {
        // pas de document lisible : écrivable par défaut, difficulté inconnue
        next.set(normalize(targets[i]!), {
          name: null,
          paymentRequired: false,
          authRequired: false,
          minPow: 0,
          writable: true,
        })
      }
    })
    info.value = next
  }

  function infoOf(url: string): RelayInfo | null {
    return info.value.get(normalize(url)) ?? null
  }

  /**
   * Relais où l'on peut espérer écrire : vivants, et pas connus comme payants.
   *
   * Séparé de `activeRelays()` parce que lire et écrire n'ont pas les mêmes
   * conditions — un relais payant reste parfaitement utile en lecture.
   */
  function writeRelays(): string[] {
    // Une surcharge de dev (`?relays=`) vaut pour les deux sens : celui qui la
    // pose pilote, et lui imposer une cible d'écriture différente de ce qu'il
    // lit serait incompréhensible.
    const targets = overridden.value ? relays.value : writeTargets(plan())
    const alive = targets.filter((url) => status.value.get(normalize(url)) !== false)
    const base = alive.length > 0 ? alive : targets
    const writable = base.filter((url) => infoOf(url)?.writable !== false)
    // Si le filtrage vide la liste, on préfère tenter et échouer visiblement
    // plutôt que de ne rien envoyer sans le dire.
    return writable.length > 0 ? writable : base
  }

  /**
   * Dernier verrou avant le réseau, en développement seulement.
   *
   * Il ne devrait jamais se déclencher — `writeTargets()` ne rend que le relais
   * local en dev. Il existe parce que la cible d'écriture peut aussi venir d'une
   * surcharge d'URL, d'une variable d'environnement ou d'un futur réglage, et
   * qu'une publication sur Nostr ne se rattrape pas. Un garde-fou qui ne sert
   * jamais coûte une comparaison de chaînes ; son absence a coûté quatre relais.
   *
   * Le contournement est **délibérément volatil** (`?public=1`, en
   * sessionStorage) : une autorisation d'écrire sur le réseau public doit
   * expirer toute seule, à l'inverse d'une surcharge de confort.
   */
  function publicWriteBlocked(targets: string[]): string[] {
    if (!import.meta.dev || !import.meta.client) return []
    if (sessionStorage.getItem(ALLOW_PUBLIC_KEY) === '1') return []
    return targets.filter((url) => isThirdPartyRelay(url, plan().homeRelay))
  }

  /**
   * Où partiraient les publications, indépendamment de l'état des connexions.
   *
   * Distinct de `writeRelays()`, qui écarte les relais morts : celle-ci sert à
   * *dire* ce qu'on fait, et une cible momentanément injoignable reste une
   * cible. C'est l'ensemble qui porte la promesse « personne ne peut effacer
   * partout » — donc celui qu'il faut montrer, pas l'ensemble de lecture.
   */
  const writeList = computed(() =>
    overridden.value ? relays.value : writeTargets(plan()),
  )

  /** true quand rien de ce qui est publié ne quitte la machine. */
  const localOnly = computed(
    () => writeList.value.length > 0 && writeList.value.every((url) => isLocalRelay(url)),
  )

  /** true si l'écriture vers un tiers a été explicitement autorisée (`?public=1`). */
  const publicWriteAllowed = computed(
    () => import.meta.client && sessionStorage.getItem(ALLOW_PUBLIC_KEY) === '1',
  )

  /** Relais joignables mais en lecture seule (payants) — à distinguer des morts. */
  const readOnlyRelays = computed(() =>
    relays.value.filter(
      (url) => status.value.get(normalize(url)) !== false && infoOf(url)?.writable === false,
    ),
  )

  /**
   * Difficulté de PoW la plus élevée annoncée par les relais où l'on écrira.
   *
   * Sert à miner juste ce qu'il faut du premier coup. Sans ça, le client mine
   * sa difficulté calibrée, se fait refuser, apprend l'exigence du refus et
   * remine — ce qui marche mais fait payer un aller-retour à l'utilisateur.
   */
  const declaredMinPow = computed(() => {
    let max = 0
    for (const url of writeRelays()) {
      const d = infoOf(url)?.minPow ?? 0
      if (d > max) max = d
    }
    return max
  })

  const connectedCount = computed(() => {
    let n = 0
    for (const ok of status.value.values()) if (ok) n++
    return n
  })
  const connected = computed(() => connectedCount.value > 0)

  /**
   * Nombre de relais dont la connexion a **définitivement échoué**.
   *
   * Existe pour piloter une couleur, pas pour afficher un nombre. Le rapport
   * « connectés / total » ne suffit pas : au démarrage il passe par 0/5, 2/5,
   * 4/5 pendant que les connexions s'établissent, ce qui est normal et ne doit
   * rien signaler. `connectedCount` seul ne distingue donc pas « en cours de
   * connexion » de « en échec » — c'est exactement ce que ceci apporte.
   *
   * ⚠️ Si plus rien ne l'appelle, ne pas la supprimer sans vérifier le chrome :
   * elle a déjà été retirée une fois comme « inutilisée » alors que le besoin
   * était réel, juste pas encore câblé.
   */
  const deadCount = computed(() => {
    let n = 0
    for (const ok of status.value.values()) if (ok === false) n++
    return n
  })

  /**
   * URLs des relais en échec, pour pouvoir **nommer** le fautif plutôt que
   * d'annoncer un nombre. « 2 injoignables » n'aide personne à diagnostiquer ;
   * savoir lequel, si.
   */
  const deadRelays = computed(() =>
    relays.value.filter((url) => status.value.get(normalize(url)) === false),
  )

  /**
   * Relais à interroger : tous, **moins ceux dont la connexion a déjà échoué**.
   *
   * Sans ce filtre, un seul relais injoignable impose son timeout à chaque
   * requête — et comme la résolution des profils passe par là, toute l'interface
   * devenait poussive à cause d'un relais mort dans la liste par défaut.
   *
   * On retombe sur la liste complète si aucun relais n'est encore connu bon :
   * au démarrage rien n'a été tenté, et exclure par défaut ne connecterait rien.
   */
  function activeRelays(): string[] {
    const all = relays.value
    const alive = all.filter((url) => status.value.get(normalize(url)) !== false)
    return alive.length > 0 ? alive : [...all]
  }

  /**
   * Signature du défi NIP-42, **sur demande explicite seulement**.
   *
   * Pourquoi ce n'est pas branché par défaut sur toutes les souscriptions : un
   * relais peut envoyer un défi pour n'importe quel filtre. Signer sans y penser
   * revient à lui offrir notre clé publique pour un simple parcours du forum, et
   * à lier ce parcours à une identité — alors que lire n'a jamais rien exigé.
   * Un relais tiers hostile n'aurait qu'à demander.
   *
   * Le seul cas où l'AUTH ne coûte rien est celui des MP : le filtre porte déjà
   * notre clé en `#p`, donc le relais la connaît de toute façon. C'est pour ça
   * que `stores/dms.ts` est le seul appelant à passer `authenticate`.
   *
   * `nostr-tools` construit le gabarit (kind 22242, tags `relay` et `challenge`)
   * — on ne fournit que la signature. La reprise de la souscription, elle, n'est
   * pas automatique en pratique : voir `answerAuth`.
   */
  function authSigner(): ((evt: EventTemplate) => Promise<VerifiedEvent>) | undefined {
    const identity = useIdentityStore()
    if (!identity.pubkey) return undefined
    return (evt) => identity.sign(evt)
  }

  /**
   * Répond au défi NIP-42 des relais qui ont refusé, puis rend la main.
   *
   * ⚠️ **`nostr-tools` a déjà cette reprise, et elle ne se déclenche jamais chez
   * nous** : elle exige que la raison du CLOSED commence par « auth-required: »
   * (la forme que NIP-01 recommande), or strfry la préfixe par « ERROR: »
   * (`RelayServer.h`, `sendClosedError`). La comparaison échoue en silence, la
   * souscription reste fermée, et les MP étaient acceptés à l'écriture puis
   * jamais relus. D'où cette reprise à nous, qui compare sans supposer la forme.
   *
   * `relay.auth()` est idempotent par connexion (il renvoie l'AUTH déjà en vol),
   * et rejette si aucun défi n'est arrivé — d'où `allSettled` : un relais qui n'a
   * rien demandé n'a rien à signer.
   */
  async function answerAuth(
    urls: string[],
    signer: (evt: EventTemplate) => Promise<VerifiedEvent>,
  ): Promise<void> {
    const p = ensurePool()
    await Promise.allSettled(
      urls.map(async (url) => {
        const relay = await p.ensureRelay(url)
        await relay.auth(signer)
      }),
    )
  }

  /**
   * Souscription live. `onevent` ne reçoit chaque `id` qu'une fois, quel que
   * soit le nombre de relais qui l'ont envoyé.
   *
   * `authenticate` répond à un refus `auth-required` par une AUTH NIP-42 — à ne
   * demander que si le filtre ne peut de toute façon pas être anonyme. Voir
   * `authSigner`.
   */
  function subscribe(
    filter: Filter,
    handlers: { onevent: (ev: NostrEvent) => void; oneose?: () => void },
    label?: string,
    opts?: { authenticate?: boolean },
  ): SubHandle {
    if (!import.meta.client) return { close: () => {} }
    const p = ensurePool()
    const seen = new Set<string>()
    const signer = opts?.authenticate ? authSigner() : undefined

    let closer: SubHandle | null = null
    let stopped = false
    // Une seule reprise : si le relais referme encore après une AUTH réussie,
    // c'est qu'il refuse ce filtre pour une autre raison, et réessayer en
    // boucle ne ferait que marteler la connexion.
    let retried = false

    const start = (): void => {
      if (stopped) return
      // `activeRelays()` et non `relays.value`, pour la même raison que `query` :
      // un relais dont la connexion a définitivement échoué n'apportera rien, et
      // le pool paierait une tentative de reconnexion par souscription.
      closer = p.subscribe(activeRelays(), filter, {
        label,
        // Pour un relais conforme à NIP-01, la reprise intégrée suffit ; pour
        // strfry, c'est `onclose` juste en dessous qui fait le travail.
        onauth: signer,
        onevent(ev) {
          if (seen.has(ev.id)) return
          seen.add(ev.id)
          eventsSeen.value++
          handlers.onevent(ev)
        },
        oneose() {
          handlers.oneose?.()
        },
        onclose(closes) {
          if (!signer || retried || stopped) return
          const refused = closes.filter((c) => c.reason.includes('auth-required'))
          if (refused.length === 0) return
          retried = true
          void answerAuth(
            refused.map((c) => c.url),
            signer,
          ).then(start)
        },
      })
    }

    start()
    return {
      close: () => {
        stopped = true
        closer?.close()
      },
    }
  }

  /**
   * Requête ponctuelle (backfill, profils, chargement d'anciens messages).
   *
   * `maxWait` court **délibérément** : `querySync` attend la fin de TOUS les
   * relais interrogés, donc un seul relais mort ou lent impose son délai à
   * l'appelant. Comme les profils passent par ici, un `maxWait` généreux rendait
   * toute l'interface poussive. Mieux vaut une réponse partielle tout de suite
   * qu'une réponse complète dans quatre secondes : les events manquants
   * arriveront par la souscription live.
   */
  async function query(filter: Filter, maxWait = 1500): Promise<NostrEvent[]> {
    if (!import.meta.client) return []
    const p = ensurePool()
    const events = await p.querySync(activeRelays(), filter, { maxWait })
    const byId = new Map<string, NostrEvent>()
    for (const ev of events) byId.set(ev.id, ev)
    return [...byId.values()]
  }

  /**
   * Publication. `pool.publish` rend **une promesse par relais** : on les
   * rapporte toutes plutôt qu'un « envoyé » global qui mentirait — sur Nostr,
   * « accepté par 2 relais sur 5 » est l'état normal, pas une erreur.
   *
   * Un relais peut refuser pour des raisons parfaitement légitimes : PoW
   * insuffisante, quota, relais payant, kind non accepté (§12.2).
   */
  async function publish(ev: NostrEvent): Promise<PublishResult> {
    return publishSplit(ev).settled
  }

  /**
   * Publication en deux temps, et c'est le cœur de la réactivité perçue.
   *
   * `firstAck` résout **dès qu'un relais a accepté** ; `settled` attend le
   * verdict complet. La première version n'exposait que `settled`, qui attend
   * `Promise.allSettled` sur TOUS les relais : un seul relais mort imposait donc
   * son timeout (6 s) à chaque publication, et l'interface restait bloquée alors
   * que l'event était déjà accepté ailleurs depuis 40 ms.
   *
   * On garde `settled` parce que « accepté par 2 relais sur 5 » est un état réel
   * qu'il faut pouvoir rapporter — mais l'utilisateur n'a pas à l'attendre.
   */
  function publishSplit(ev: NostrEvent): {
    firstAck: Promise<boolean>
    settled: Promise<PublishResult>
  } {
    if (!import.meta.client) {
      return { firstAck: Promise.resolve(false), settled: Promise.resolve({ accepted: [], rejected: [] }) }
    }
    const targets = writeRelays()

    const forbidden = publicWriteBlocked(targets)
    if (forbidden.length > 0) {
      const reason =
        `publication bloquée en développement : ${forbidden.join(', ')} ${
          forbidden.length > 1 ? 'ne sont pas des relais à nous' : 'n’est pas un relais à nous'
        }. Sur Nostr rien ne s’efface. Lance « npm run dev:strfry » et ouvre ?relays=ws://localhost:7778, ` +
        `ou ajoute ?public=1 à l’URL si tu veux vraiment publier sur le réseau.`
      return {
        firstAck: Promise.resolve(false),
        settled: Promise.resolve({ accepted: [], rejected: forbidden.map((url) => ({ url, reason })) }),
      }
    }

    const p = ensurePool()
    const perRelay = p.publish(targets, ev, { maxWait: PUBLISH_MAX_WAIT_MS })

    let resolveFirst: (ok: boolean) => void
    const firstAck = new Promise<boolean>((r) => (resolveFirst = r))
    let settledCount = 0
    let anyAccepted = false

    const accepted: string[] = []
    const rejected: { url: string; reason: string }[] = []

    const settled = new Promise<PublishResult>((resolveAll) => {
      perRelay.forEach((promise, i) => {
        const url = targets[i] ?? '?'
        promise
          .then(() => {
            accepted.push(url)
            if (!anyAccepted) {
              anyAccepted = true
              resolveFirst(true)
            }
          })
          .catch((err: unknown) => {
            rejected.push({
              url,
              reason: String((err as Error)?.message ?? err ?? 'refusé'),
            })
          })
          .finally(() => {
            if (++settledCount === perRelay.length) {
              // aucun relais n'a accepté : il faut le dire, pas attendre indéfiniment
              if (!anyAccepted) resolveFirst(false)
              resolveAll({ accepted, rejected })
            }
          })
      })
      if (perRelay.length === 0) {
        resolveFirst(false)
        resolveAll({ accepted, rejected })
      }
    })

    return { firstAck, settled }
  }

  function destroy(): void {
    pool?.destroy()
    pool = null
    status.value = new Map()
  }

  return {
    relays,
    status,
    connected,
    connectedCount,
    deadCount,
    deadRelays,
    readOnlyRelays,
    writeList,
    localOnly,
    publicWriteAllowed,
    declaredMinPow,
    info,
    infoOf,
    loadRelayInfo,
    writeRelays,
    overridden,
    eventsSeen,
    subscribe,
    query,
    publish,
    publishSplit,
    destroy,
  }
})
