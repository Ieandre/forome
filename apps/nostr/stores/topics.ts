/**
 * La liste de topics, calculée côté client.
 *
 * ⚠️ C'est ici que l'absence d'indexeur se paie (spec §5.4). Le tri par
 * vélocité veut UN instantané calculé une fois et diffusé identique à tout le
 * monde. Sans indexeur, chaque client doit souscrire large et calculer son
 * propre classement sur ce qu'il a vu passer — donc :
 *
 *   - la vue est **partielle** : on classe ce qui est arrivé depuis l'ouverture
 *     de l'onglet, pas l'état réel du réseau
 *   - le coût est **par client**, pas amorti
 *
 * C'est exactement le piège décrit en §5.4, et c'est pourquoi l'indexeur
 * publie un tick signé. Ce calcul local est le repli : il suffit à faire vivre
 * la liste quand aucun tick n'arrive, sans prétendre valoir l'instantané.
 */
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import {
  KIND_COMMENT,
  KIND_NOTE,
  KIND_THREAD,
  KIND_APP_DATA,
  TICK_D_TAG,
  FIREHOSE_TOPIC_ID,
  communityFilter,
  inCommunity,
  isRevision,
  type NostrEvent,
  type SourceMode,
  type TopicRow,
  type TickPayload,
  type RankingSource,
} from '~/types/nostr'
import { rootIdOf, topicTitle, compareTopicRows } from '~/utils/nostr'
import type { SubHandle } from '~/stores/relays'

const WINDOW_S = 600 // fenêtre de vélocité (10 min)
const RECENT_S = 120 // fenêtre courte (accélération)
const MAX_STAMPS = 200 // borne mémoire par topic
const TICK_MS = 2000 // cadence de recalcul — l'équivalent local du tick signé
const MAX_TRACKED = 500

/**
 * Garde-fou de dernier recours sur l'état de chargement.
 *
 * **Le chiffre est calculé, pas choisi**, et c'est le cœur du bug corrigé ici.
 * nostr-tools borne l'attente d'un relais en deux temps qui s'ajoutent :
 * `maxWaitForConnection` (3 s) puis `baseEoseTimeout` (4,4 s), ce dernier ne
 * démarrant qu'une fois la socket ouverte. Le pire cas honnête d'un `oneose` est
 * donc **7,4 s**, pas 4,4.
 *
 * Le filet était à 6 s : sur un démarrage à froid (DNS, TLS, cinq relais) il
 * tombait donc AVANT l'EOSE réel, l'attente cessait sans que rien ne soit
 * arrivé, et la liste vide se racontait « personne n'a encore lancé de topic
 * ici ». Au rechargement les connexions étaient chaudes, l'EOSE passait large
 * sous les 6 s, et tout s'affichait — d'où « il faut recharger pour que ça
 * marche ». Au-delà de 7,4 s, ce minuteur redevient ce que son nom dit : un
 * garde-fou qu'on n'atteint pas.
 */
const LOAD_DEADLINE_MS = 9000

interface Activity {
  stamps: number[]
  people: Set<string>
  lastAt: number
  lastPubkey: string
  lastText: string
  replies: number
}

function nowS(): number {
  return Math.floor(Date.now() / 1000)
}

function emptyActivity(): Activity {
  return { stamps: [], people: new Set(), lastAt: 0, lastPubkey: '', lastText: '', replies: 0 }
}

/** Lecture seule : le repli des topics sans réponse — jamais muté, donc partagé. */
const NO_ACTIVITY: Activity = emptyActivity()

/**
 * Au-delà de ce délai, le tick de l'indexeur est considéré périmé et on repasse
 * au calcul local : un classement figé serait pire qu'un classement partiel.
 */
const TICK_STALE_S = 30
const INDEXER_OVERRIDE_KEY = 'forome.dev.indexer'

export const useTopicStore = defineStore('topics', () => {
  const relayStore = useRelayStore()
  const profiles = useProfileStore()
  const config = useRuntimeConfig()

  const mode = ref<SourceMode>('threads')

  /**
   * « On attend encore quelque chose. »
   *
   * ⚠️ **Ne pas s'en servir pour décider ce qu'un écran vide raconte** — c'est
   * précisément le bug corrigé ici. Il retombe aussi sur `LOAD_DEADLINE_MS`, donc
   * sans avoir rien reçu : l'interface basculait alors sur « Aucun topic sur ces
   * relais / personne n'a encore lancé de topic ici », qui se lit comme une panne
   * et ne se corrigeait qu'en rechargeant la page. Pour ça, c'est `settled`.
   */
  const loading = ref(true)

  /**
   * true seulement quand les relais ont **vraiment** rendu leur historique (EOSE),
   * ou qu'il n'y a plus rien à en attendre. C'est le seul état qui autorise à
   * conclure « il n'y a pas de topic » plutôt que « ça n'est pas encore arrivé ».
   */
  const settled = ref(false)
  /** incrémenté à chaque cadence : c'est lui qui déclenche le reclassement */
  const tick = ref(0)

  /**
   * Les maps sont **mutées en place**, et `rev` porte l'invalidation.
   *
   * L'ancien schéma copiait la Map entière à chaque event ingéré (`new
   * Map(old)`) : sur la synchro initiale (150 racines + 400 réponses), ça
   * faisait ~80 000 recopies d'entrées avant le premier affichage. Un compteur
   * incrémenté signale la même chose pour le prix d'une addition.
   */
  const roots = shallowRef(new Map<string, NostrEvent>())
  const activity = shallowRef(new Map<string, Activity>())
  const rev = ref(0)
  /**
   * Pas de réactivité profonde ici : le flux global encaisse jusqu'à des
   * dizaines d'events/s, et c'est la cadence (`tick`) qui rythme son unique
   * rangée — proxifier 200 stamps pour re-rendre à chaque event irait à
   * l'encontre de ce que ce mode teste.
   */
  const firehose = shallowRef(emptyActivity())

  /** Dernier tick reçu de l'indexeur, s'il y en a un (§5.2). */
  const tickPayload = shallowRef<TickPayload | null>(null)
  const tickAt = ref(0)
  const indexerPubkey = ref<string | null>(initialIndexer())

  /**
   * Surcharge par l'URL (`?indexer=<hex>`), persistée comme celle des relais et
   * pour la même raison : une réécriture d'URL ou un rechargement la perdrait
   * sinon, et le client repasserait au tri local sans le dire.
   */
  function initialIndexer(): string | null {
    const hex64 = /^[0-9a-f]{64}$/
    const fromConfig = (config.public.indexerPubkey as string | undefined)?.trim()
    if (import.meta.client) {
      const fromUrl = new URLSearchParams(window.location.search).get('indexer')?.trim()
      if (fromUrl && hex64.test(fromUrl)) {
        sessionStorage.setItem(INDEXER_OVERRIDE_KEY, fromUrl)
        return fromUrl
      }
      const stored = sessionStorage.getItem(INDEXER_OVERRIDE_KEY)
      if (stored && hex64.test(stored)) return stored
    }
    return fromConfig && hex64.test(fromConfig) ? fromConfig : null
  }

  let subs: SubHandle[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null
  const unknownRoots = new Set<string>()
  let rootFetchTimer: ReturnType<typeof setTimeout> | null = null

  /* ------------------------------------------------------------ vélocité */

  /**
   * Vélocité (spec §5.3) : participants distincts + rythme + accélération.
   * **Elle ne décide plus l'ordre** (voir `compareTopicRows`) — elle n'alimente
   * que le rail de chauffe et « ça parle maintenant ».
   */
  function velocityOf(a: Activity): number {
    const now = nowS()
    // La plupart des topics suivis sont silencieux : si le dernier message est
    // sorti de la fenêtre, tous les stamps le sont aussi — inutile de les lire.
    if (now - a.lastAt >= WINDOW_S) return 0
    let inWindow = 0
    let inRecent = 0
    for (const s of a.stamps) {
      const age = now - s
      if (age < WINDOW_S) inWindow++
      if (age < RECENT_S) inRecent++
    }
    if (inWindow === 0) return 0
    const ratePerMin = inWindow / (WINDOW_S / 60)
    const recentPerMin = inRecent / (RECENT_S / 60)
    const accel = Math.min(3, Math.max(0.5, recentPerMin / Math.max(ratePerMin, 0.2)))
    return ratePerMin * (1 + Math.log1p(a.people.size)) * accel
  }

  /* ------------------------------------------------------------- ingestion */

  function noteActivity(ev: NostrEvent, bucket: Activity): void {
    // La liste affiche la dernière voix de chaque topic : sans cette marque,
    // celle d'un masque (§3.7) y apparaîtrait sous son `khey_` par défaut, dans
    // le seul écran où l'on regarde justement qui parle où.
    profiles.noteAuthor(ev)
    // Plafond sur la date déclarée : c'est elle qui décide l'ordre de la colonne,
    // donc un event daté dans le futur s'y installerait en tête pour toujours.
    const at = Math.min(ev.created_at, nowS())
    bucket.stamps.push(at)
    if (bucket.stamps.length > MAX_STAMPS) bucket.stamps.splice(0, bucket.stamps.length - MAX_STAMPS)
    bucket.people.add(ev.pubkey)
    bucket.replies++
    if (at >= bucket.lastAt) {
      bucket.lastAt = at
      bucket.lastPubkey = ev.pubkey
      bucket.lastText = ev.content.replace(/\s+/g, ' ').trim().slice(0, 140)
    }
  }

  function ingestRoot(ev: NostrEvent): void {
    profiles.noteAuthor(ev)
    // Le filtre de souscription ne couvre pas tout : les racines manquantes sont
    // rattrapées **par id** (`scheduleRootFetch`, `fetchRoot`), donc sans
    // contrainte de périmètre. Un message marqué `forome` qui répond à un fil
    // extérieur ferait ainsi entrer ce fil dans la liste par la petite porte.
    if (!inCommunity(ev)) return
    const map = roots.value
    if (map.has(ev.id)) return
    map.set(ev.id, ev)
    // borne mémoire : on jette les racines les plus anciennes et sans activité
    if (map.size > MAX_TRACKED) {
      const sorted = [...map.values()].sort((a, b) => {
        const aa = activity.value.get(a.id)?.lastAt ?? a.created_at
        const bb = activity.value.get(b.id)?.lastAt ?? b.created_at
        return aa - bb
      })
      for (let i = 0; i < sorted.length - MAX_TRACKED; i++) map.delete(sorted[i]!.id)
    }
    rev.value++
    unknownRoots.delete(ev.id)
  }

  function ingestComment(ev: NostrEvent): void {
    // Une révision n'est pas un message (§2.5) : la compter remonterait le topic
    // en tête de liste et incrémenterait son nombre de réponses parce que
    // quelqu'un a corrigé une faute. Un « up » gratuit, et une liste qui bouge
    // sans que rien ne se soit dit.
    if (isRevision(ev)) return
    const rootId = rootIdOf(ev)
    if (!rootId) return
    let bucket = activity.value.get(rootId)
    if (!bucket) {
      bucket = emptyActivity()
      activity.value.set(rootId, bucket)
    }
    noteActivity(ev, bucket)
    rev.value++

    // Une réponse dont on n'a pas la racine : les topics les plus actifs sont
    // souvent plus anciens que notre fenêtre de souscription. On va la chercher.
    if (!roots.value.has(rootId)) {
      unknownRoots.add(rootId)
      scheduleRootFetch()
    }
  }

  function scheduleRootFetch(): void {
    if (rootFetchTimer) return
    rootFetchTimer = setTimeout(async () => {
      rootFetchTimer = null
      const ids = [...unknownRoots].slice(0, 100)
      if (ids.length === 0) return
      try {
        const found = await relayStore.query({ ids, kinds: [KIND_THREAD] })
        for (const ev of found) ingestRoot(ev)
      } catch {
        // sans la racine, l'activité reste comptée mais le topic n'est pas listé
      }
      for (const id of ids) unknownRoots.delete(id)
    }, 1200)
  }

  /* ------------------------------------------------- tick de l'indexeur */

  /**
   * Souscription au tick (spec §5.2). Sans `indexerPubkey` configurée, on
   * n'écoute rien : accepter le tick de n'importe qui donnerait à un inconnu le
   * pouvoir de décider l'ordre de l'écran principal.
   */
  function subscribeTick(): void {
    const author = indexerPubkey.value
    if (!author) return
    subs.push(
      relayStore.subscribe(
        { kinds: [KIND_APP_DATA], authors: [author], '#d': [TICK_D_TAG] },
        { onevent: ingestTick },
        'tick',
      ),
    )
  }

  function ingestTick(ev: NostrEvent): void {
    // La signature est déjà vérifiée par le pool, et l'auteur est contraint par
    // le filtre. Reste à se protéger d'un tick plus vieux que celui qu'on a.
    if (ev.created_at <= tickAt.value) return
    try {
      const parsed = JSON.parse(ev.content) as TickPayload
      if (parsed?.v !== 1 || !Array.isArray(parsed.topics)) return
      tickPayload.value = parsed
      tickAt.value = ev.created_at
      // Un tick est un classement complet : il n'y a plus rien à attendre.
      loading.value = false
      settled.value = true
    } catch {
      // tick illisible : on garde le précédent, et le calcul local reste le filet
    }
  }

  /** true si un tick frais est disponible. */
  const tickFresh = computed(() => {
    void tick.value
    return !!tickPayload.value && nowS() - tickAt.value < TICK_STALE_S
  })

  const rankingSource = computed<RankingSource>(() => (tickFresh.value ? 'indexer' : 'local'))

  const flaggedTopics = computed<Set<string>>(() =>
    tickFresh.value ? new Set(tickPayload.value?.flagged ?? []) : new Set(),
  )

  /* ---------------------------------------------------------- souscriptions */

  function start(): void {
    if (subs.length > 0) return
    loading.value = true
    settled.value = false

    if (mode.value === 'threads') {
      // On n'a fini que quand les DEUX souscriptions ont rendu leur historique :
      // sur le seul EOSE des topics, les rangées s'affichent à « 0 msg » et sans
      // date de dernière activité, puis se corrigent quand les réponses arrivent.
      let rootsDone = false
      let commentsDone = false
      const settle = (): void => {
        if (!rootsDone || !commentsDone) return
        settled.value = true
        loading.value = false
      }
      // `communityFilter()` est ce qui fait la différence entre un forum et une
      // fenêtre sur Nostr : sans lui, ces deux filtres ne contraignent que le
      // kind, donc ils rapatrient les fils de tous les clients du réseau — le
      // symptôme a été observé, un topic d'un inconnu est arrivé dans la liste.
      subs.push(
        relayStore.subscribe(
          { kinds: [KIND_THREAD], ...communityFilter(), limit: 150 },
          {
            onevent: ingestRoot,
            oneose: () => {
              rootsDone = true
              settle()
            },
          },
          'threads',
        ),
      )
      subs.push(
        relayStore.subscribe(
          { kinds: [KIND_COMMENT], ...communityFilter(), limit: 400 },
          {
            onevent: ingestComment,
            oneose: () => {
              commentsDone = true
              settle()
            },
          },
          'comments',
        ),
      )
      subscribeTick()
    } else {
      // Mode démo débit : un seul pseudo-topic alimenté par le flux global
      // kind 1. Sert uniquement à stresser le fil (tampon, ambiance, cap DOM) —
      // les kind 11 publics sont trop rares pour ça.
      subs.push(
        relayStore.subscribe(
          { kinds: [KIND_NOTE], limit: 80 },
          {
            onevent: (ev) => noteActivity(ev, firehose.value),
            oneose: () => {
              settled.value = true
              loading.value = false
            },
          },
          'firehose',
        ),
      )
    }

    startTicking()
    document.addEventListener('visibilitychange', onVisibility)
    deadlineTimer = setTimeout(() => {
      deadlineTimer = null
      settled.value = true
      loading.value = false
    }, LOAD_DEADLINE_MS)
  }

  function startTicking(): void {
    if (!timer) timer = setInterval(() => tick.value++, TICK_MS)
  }

  /**
   * Onglet caché : le reclassement s'arrête, les souscriptions continuent.
   *
   * Personne ne regarde la liste, donc recalculer la vélocité de 500 topics
   * toutes les 2 s ne sert qu'à chauffer la machine — c'est le premier poste de
   * CPU d'un onglet en arrière-plan. Les events, eux, continuent d'arriver et
   * d'être ingérés : au retour, un tick immédiat remet tout à l'heure juste.
   */
  function onVisibility(): void {
    if (document.hidden) {
      if (timer) clearInterval(timer)
      timer = null
    } else if (subs.length > 0) {
      tick.value++
      startTicking()
    }
  }

  /**
   * Coupe tout : souscriptions, cadence de reclassement, minuteurs en vol.
   *
   * ⚠️ Les minuteurs comptent autant que les souscriptions. Le filet de
   * chargement et la relance de racines survivaient à l'arrêt : le premier
   * repassait `loading` à false sur le mode SUIVANT (donc sur un écran qui
   * n'avait encore rien reçu), le second lançait une requête pour un mode
   * abandonné.
   */
  function stop(): void {
    for (const s of subs) s.close()
    subs = []
    document.removeEventListener('visibilitychange', onVisibility)
    if (timer) clearInterval(timer)
    timer = null
    if (deadlineTimer) clearTimeout(deadlineTimer)
    deadlineTimer = null
    if (rootFetchTimer) clearTimeout(rootFetchTimer)
    rootFetchTimer = null
    unknownRoots.clear()
  }

  function setMode(next: SourceMode): void {
    if (next === mode.value) return
    stop()
    mode.value = next
    roots.value = new Map()
    activity.value = new Map()
    firehose.value = emptyActivity()
    start()
  }

  /* ------------------------------------------------------------------ vues */

  /**
   * Réutilise les objets (et le tableau) du calcul précédent quand rien n'a
   * changé de visible.
   *
   * C'est ce qui rend la cadence de 2 s supportable : un computed Vue ne
   * notifie ses lecteurs que si sa **valeur** change (`Object.is`), donc rendre
   * LE MÊME tableau quand le forum est au repos évite de re-rendre les 80
   * rangées de `TopicList` toutes les 2 s pour rien. Et quand une seule rangée
   * bouge, les 79 autres gardent leur objet — leurs vnodes ne se recalculent
   * pas.
   */
  let prevRows: TopicRow[] = []
  function sameRow(a: TopicRow, b: TopicRow): boolean {
    return (
      a.id === b.id &&
      a.title === b.title &&
      a.pubkey === b.pubkey &&
      a.createdAt === b.createdAt &&
      a.lastAt === b.lastAt &&
      a.lastPubkey === b.lastPubkey &&
      a.lastText === b.lastText &&
      a.replies === b.replies &&
      a.people === b.people &&
      a.vel === b.vel
    )
  }
  function stabilize(next: TopicRow[]): TopicRow[] {
    const prev = prevRows
    const prevById = new Map(prev.map((r) => [r.id, r]))
    let identical = next.length === prev.length
    for (let i = 0; i < next.length; i++) {
      const old = prevById.get(next[i]!.id)
      if (old && sameRow(old, next[i]!)) next[i] = old
      if (identical && next[i] !== prev[i]) identical = false
    }
    if (identical) return prev
    prevRows = next
    return next
  }

  /**
   * Une racine + son activité en rangée de liste. Partagé par le classement et
   * par `rowFor` : ce sont les deux seuls endroits qui fabriquent un `TopicRow`
   * localement, et deux formes qui divergent donneraient une rangée qui change
   * de contenu selon qu'elle est classée ou rattrapée.
   */
  function rowFromRoot(root: NostrEvent, now: number): TopicRow {
    const a = activity.value.get(root.id) ?? NO_ACTIVITY
    return {
      id: root.id,
      title: topicTitle(root),
      pubkey: root.pubkey,
      createdAt: root.created_at,
      // même plafond que dans `noteActivity`, pour la racine cette fois : un
      // topic ouvert avec une date dans le futur tiendrait la tête de liste.
      lastAt: Math.min(a.lastAt || root.created_at, now),
      lastPubkey: a.lastPubkey || root.pubkey,
      lastText: a.lastText,
      replies: a.replies,
      people: a.people.size,
      vel: velocityOf(a),
    }
  }

  const rows = computed<TopicRow[]>(() => {
    // Dépendance explicite à la cadence : l'ORDRE n'a plus besoin d'elle (il ne
    // dépend que des dates de dernier message), mais la vélocité du rail de
    // chauffe, elle, se périme avec l'heure. `rev` apporte l'autre moitié :
    // l'arrivée d'un event (les maps sont mutées en place, voir plus haut).
    void tick.value
    void rev.value

    if (mode.value === 'firehose') {
      const a = firehose.value
      return stabilize([
        {
          id: FIREHOSE_TOPIC_ID,
          title: 'Flux global (démo débit)',
          pubkey: '00'.repeat(32),
          createdAt: 0,
          lastAt: a.lastAt,
          lastPubkey: a.lastPubkey,
          lastText: a.lastText,
          replies: a.replies,
          people: a.people.size,
          vel: velocityOf(a),
        },
      ])
    }

    // Chemin préféré : le tick de l'indexeur — un classement calculé une fois
    // sur la vue globale, reçu identique par tous (§5.2). Il remplace le calcul
    // local, qui n'est qu'un filet.
    if (tickFresh.value) {
      const payload = tickPayload.value!
      return stabilize(payload.topics.map((t) => ({
        id: t.id,
        title: t.title,
        pubkey: t.pubkey,
        createdAt: 0,
        lastAt: t.lastAt,
        lastPubkey: t.lastPubkey,
        lastText: t.lastText,
        replies: t.replies,
        people: t.ppl,
        vel: t.vel,
      })))
    }

    const now = nowS()
    const out: TopicRow[] = []
    for (const root of roots.value.values()) out.push(rowFromRoot(root, now))
    // La règle vit dans `compareTopicRows`, où elle est pure et testée.
    out.sort(compareTopicRows)
    return stabilize(out.slice(0, 80))
  })

  /**
   * Le topic le plus chaud — qui n'est plus le premier de la liste depuis que
   * l'ordre suit le dernier message. Il se cherche donc, il ne se lit plus au
   * rang 0.
   */
  const hottest = computed<TopicRow | null>(() =>
    rows.value.reduce<TopicRow | null>((best, r) => (!best || r.vel > best.vel ? r : best), null),
  )

  function rowById(id: string): TopicRow | null {
    return rows.value.find((r) => r.id === id) ?? null
  }

  /**
   * La rangée d'un topic **même hors classement**.
   *
   * `rowById` ne voit que les 80 rangées publiées : un topic atteint par
   * permalien, ou passé sous la barre pendant qu'on le lit, n'y figure pas — et
   * la liste perdait alors la rangée du topic ouvert, que le §7.1 dit de garder
   * visible quoi qu'il arrive à son rang. Il suffit d'avoir la racine.
   *
   * Rend `null` quand la racine est inconnue : `fetchRoot` la ramène, et la
   * rangée apparaît au `rev` suivant.
   */
  function rowFor(id: string): TopicRow | null {
    const listed = rowById(id)
    if (listed) return listed
    // `rowById` ne lit `rev`/`tick` que par `rows`, qui vient d'échouer : sans
    // ces deux-là, la rangée rattrapée resterait figée sur sa première valeur.
    void tick.value
    void rev.value
    const root = roots.value.get(id)
    return root ? rowFromRoot(root, nowS()) : null
  }

  function rootById(id: string): NostrEvent | null {
    // `roots` est mutée en place : sans cette dépendance, un computed qui nous
    // lit ne verrait jamais arriver la racine chargée par `fetchRoot`.
    void rev.value
    return roots.value.get(id) ?? null
  }

  /**
   * Charge la racine d'un topic atteint par permalien direct — elle n'est pas
   * forcément dans la fenêtre de souscription de la liste.
   */
  async function fetchRoot(id: string): Promise<NostrEvent | null> {
    const cached = roots.value.get(id)
    if (cached) return cached
    try {
      const found = await relayStore.query({ ids: [id], kinds: [KIND_THREAD] })
      const ev = found[0]
      if (ev) {
        ingestRoot(ev)
        return ev
      }
    } catch {
      // topic introuvable sur ces relais — l'en-tête restera minimal
    }
    return null
  }

  return {
    mode,
    loading,
    settled,
    tick,
    rows,
    hottest,
    indexerPubkey,
    rankingSource,
    flaggedTopics,
    start,
    stop,
    setMode,
    rowById,
    rowFor,
    rootById,
    fetchRoot,
  }
})
