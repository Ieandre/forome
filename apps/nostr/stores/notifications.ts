/**
 * Le canal personnel (spec v2 §5.1) : ce qui te concerne TOI, par opposition au
 * forum public. La spec le décrit en une ligne — « mentions (`{"#p":[<ma clé>]}`),
 * MP (kind 1059 adressés à moi) » — et sa moitié MP existait déjà
 * (`stores/dms.ts`). Celle-ci porte l'autre moitié, plus les suivis, et réunit
 * les trois dans une seule file lisible.
 *
 * ## Quatre sources, deux souscriptions
 *
 *   - **réponses et citations** — `{kinds:[11,1111], "#p":[ma clé]}`. Une seule
 *     souscription pour les deux : sur Nostr, être l'auteur du message parent et
 *     être cité produisent le même tag `p`. La distinction se fait ici, à la
 *     lecture (voir `notifKindOf`, dans `utils/notify.ts` — pur et testé).
 *   - **suivis** — `{kinds:[3], "#p":[ma clé]}` : toute liste de contacts qui
 *     contient ma clé.
 *   - **MP** — pas de souscription propre : on lit `dms.inbox`, qui a déjà la
 *     sienne et son propre état de lecture.
 *
 * ## Pourquoi aucun aller-retour réseau pour classer
 *
 * NIP-22 range l'auteur du message parent en **4ᵉ élément du tag `e`**, et celui
 * de la racine en 4ᵉ élément de `E` (voir `replyTags` dans `usePublisher`). On
 * sait donc si le parent est de nous sans aller chercher le parent sur un relais.
 * Un centre de notifications qui ferait une requête par ligne serait inutilisable
 * sur un fil actif.
 *
 * ## La ligne de base, et pourquoi elle existe
 *
 * À la toute première ouverture avec une clé donnée, `seenUpTo` est posé à
 * MAINTENANT et rien d'historique n'est marqué non lu. Sans ça, arriver sur
 * l'app allumerait une pastille à 200 sur des réponses vieilles de trois
 * semaines — le compteur ne voudrait rien dire dès le premier écran.
 *
 * ## La limite des suivis, assumée
 *
 * Kind 3 est **remplaçable** : quand quelqu'un suit une nouvelle personne, il
 * republie sa liste entière avec un `created_at` neuf. Se fier à ce
 * `created_at` re-notifierait « X te suit » à chaque fois qu'X suit quelqu'un
 * d'autre. On mémorise donc, par auteur, le **premier** `created_at` observé, et
 * c'est lui qui date la notification. Conséquence acceptée : on ne sait pas
 * distinguer un désabonnement suivi d'un réabonnement.
 */
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { KIND_COMMENT, KIND_CONTACTS, KIND_THREAD, isRevision, type NostrEvent } from '~/types/nostr'
import { rootIdOf } from '~/utils/nostr'
import { notifKindOf, type NotifKind } from '~/utils/notify'
import { quotePreview } from '~/utils/format'
import type { SubHandle } from '~/stores/relays'

const STORE_KEY = 'forome.notifs'

/**
 * Plafond de rétention des events de forum.
 *
 * Sans lui, la Map grossit indéfiniment : la souscription est bornée à l'HISTOIRE
 * (`limit`), pas au direct. Un onglet laissé ouvert sur un topic où l'on est
 * l'auteur reçoit une notification par réponse, sans fin — et `items` se
 * reconstruit et se retrie à chaque arrivée, donc le coût monte avec le temps
 * passé sur l'app.
 *
 * 300 est généreux pour ce qu'un panneau sert : au-delà, une notification n'est
 * plus consultée, elle est archivée — et on n'archive pas ce qu'on ne peut pas
 * relire. Même raisonnement que le cap DOM du fil (§6.2), pour la même raison.
 */
const MAX_KEPT = 300


/**
 * Une LIGNE du panneau, pas un event : plusieurs events s'y regroupent (voir
 * `items`). Un topic où l'on est l'auteur produisait sinon une rangée par
 * réponse, toutes identiques au pseudo près.
 */
export interface Notif {
  /** `<nature>:<topic>` pour le forum, `follow` / `dm:<clé>` pour le reste */
  id: string
  kind: NotifKind
  /** auteurs distincts, le plus récent en tête. Un seul, le plus souvent. */
  actors: string[]
  /**
   * Combien d'events la ligne réunit. Peut dépasser `actors.length` — une même
   * personne peut répondre cinq fois. Pour un MP, c'est le nombre de messages
   * non lus du fil.
   */
  count: number
  createdAt: number
  /** amorce du message le plus récent ; vide pour un suivi */
  preview: string
  /** topic concerné (réponses et citations seulement) */
  topicId: string | null
  /** message le plus récent, à viser dans le fil */
  eventId: string | null
  unread: boolean
}

interface Persisted {
  pubkey: string
  seenUpTo: number
  followers: Record<string, number>
}

export const useNotificationStore = defineStore('notifications', () => {
  const relayStore = useRelayStore()
  const identity = useIdentityStore()
  const profiles = useProfileStore()
  const social = useSocialStore()
  const dms = useDmStore()

  const forumEvents = shallowRef(new Map<string, NostrEvent>())
  const followerFirstSeen = shallowRef(new Map<string, number>())
  const seenUpTo = ref(0)
  const loaded = ref(false)

  let subs: SubHandle[] = []

  /* ------------------------------------------------------------ stockage */

  function save(): void {
    if (!import.meta.client || !identity.pubkey) return
    const data: Persisted = {
      pubkey: identity.pubkey,
      seenUpTo: seenUpTo.value,
      followers: Object.fromEntries(followerFirstSeen.value),
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data))
    } catch {
      // Quota plein ou stockage refusé : l'état de lecture ne survivra pas au
      // rechargement, et c'est tout. Rien à dire au lecteur.
    }
  }

  /**
   * Charge l'état de lecture, ou pose la ligne de base. Le contrôle de `pubkey`
   * est ce qui empêche l'état d'une identité de fuiter sur la suivante après un
   * « new khey ».
   */
  function load(): void {
    if (!import.meta.client || loaded.value) return
    loaded.value = true
    try {
      const raw = localStorage.getItem(STORE_KEY)
      const data = raw ? (JSON.parse(raw) as Persisted) : null
      if (data && data.pubkey === identity.pubkey) {
        seenUpTo.value = Number(data.seenUpTo) || 0
        followerFirstSeen.value = new Map(
          Object.entries(data.followers ?? {}).map(([k, v]) => [k, Number(v) || 0]),
        )
        return
      }
    } catch {
      // JSON corrompu : on repart d'une ligne de base, ce qui est le
      // comportement le moins surprenant.
    }
    seenUpTo.value = Math.floor(Date.now() / 1000)
    followerFirstSeen.value = new Map()
    save()
  }

  /* ------------------------------------------------------------ ingestion */

  function ingestForum(ev: NostrEvent): void {
    const me = identity.pubkey
    if (!me || ev.pubkey === me) return
    // Une révision reporte les tags `p` de l'original : sans ça, corriger une
    // faute renotifierait tous ceux que le message mentionnait. Une notification
    // annonce que quelqu'un t'a parlé, pas qu'il s'est relu.
    if (isRevision(ev)) return
    // Un bloqué ne notifie pas. Le fil, lui, replie sans masquer (§12.3) — mais
    // une notification est une sollicitation, pas du contenu qu'on parcourt.
    if (social.isMuted(ev.pubkey)) return
    if (forumEvents.value.has(ev.id)) return
    profiles.want(ev.pubkey)
    const next = new Map(forumEvents.value)
    next.set(ev.id, ev)
    // L'élagage garde les plus RÉCENTS et non les derniers arrivés : au
    // chargement initial les events reviennent des relais en désordre, donc
    // couper par ordre d'arrivée jetterait parfois du neuf pour garder du vieux.
    if (next.size > MAX_KEPT) {
      const kept = [...next.values()]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, MAX_KEPT)
      forumEvents.value = new Map(kept.map((e) => [e.id, e]))
      return
    }
    forumEvents.value = next
  }

  function ingestContacts(ev: NostrEvent): void {
    const me = identity.pubkey
    if (!me || ev.pubkey === me) return
    if (social.isMuted(ev.pubkey)) return
    // Le filtre relais garantit déjà un tag `p` à ma clé, mais un relais permissif
    // peut renvoyer autre chose : on revérifie plutôt que de faire confiance.
    if (!ev.tags.some((t) => t[0] === 'p' && t[1] === me)) return

    const known = followerFirstSeen.value.get(ev.pubkey)
    if (known !== undefined && known <= ev.created_at) return
    profiles.want(ev.pubkey)
    const next = new Map(followerFirstSeen.value)
    next.set(ev.pubkey, Math.min(known ?? Number.POSITIVE_INFINITY, ev.created_at))
    followerFirstSeen.value = next
    save()
  }

  /* ----------------------------------------------------------------- vues */

  /**
   * Les lignes du panneau, REGROUPÉES.
   *
   * Une ligne par event donnait, sur un topic dont on est l'auteur, quatre-vingts
   * rangées « X t'a répondu sur ton topic » où seul le pseudo changeait. Les
   * plafonds de rétention et d'affichage empêchaient la casse, pas l'inutilité :
   * un panneau qu'on ne peut plus parcourir ne notifie plus rien.
   *
   * Le regroupement se fait par **(nature, topic)** et non par topic seul : une
   * réponse et une citation ne se disent pas avec le même verbe, donc les fondre
   * obligerait à en choisir un et à mentir sur l'autre.
   *
   * Les suivis se regroupent tous ensemble — ils n'ont pas de topic, et c'est la
   * catégorie la plus répétitive du réseau (les bots suivent en masse).
   */
  const items = computed<Notif[]>(() => {
    const me = identity.pubkey
    if (!me) return []
    const out: Notif[] = []

    const groups = new Map<string, NostrEvent[]>()
    for (const ev of forumEvents.value.values()) {
      const topicId = rootIdOf(ev)
      // Sans racine il n'y a rien à regrouper : la ligne reste seule, clé sur
      // l'id de l'event.
      const key = topicId ? `${notifKindOf(ev, me)}:${topicId}` : `solo:${ev.id}`
      const list = groups.get(key)
      if (list) list.push(ev)
      else groups.set(key, [ev])
    }

    for (const [key, evs] of groups) {
      evs.sort((a, b) => b.created_at - a.created_at)
      const last = evs[0]!
      out.push({
        id: key,
        kind: notifKindOf(last, me),
        actors: [...new Set(evs.map((e) => e.pubkey))],
        count: evs.length,
        createdAt: last.created_at,
        preview: quotePreview(last.content, 160),
        topicId: rootIdOf(last),
        eventId: last.id,
        unread: evs.some((e) => e.created_at > seenUpTo.value),
      })
    }

    const follows = [...followerFirstSeen.value.entries()].sort((a, b) => b[1] - a[1])
    if (follows.length > 0) {
      out.push({
        id: 'follow',
        kind: 'follow',
        actors: follows.map(([pk]) => pk),
        count: follows.length,
        createdAt: follows[0]![1],
        preview: '',
        topicId: null,
        eventId: null,
        unread: follows.some(([, at]) => at > seenUpTo.value),
      })
    }

    // Les MP ne passent pas par `seenUpTo` : ils ont leur propre état de lecture,
    // par fil, et c'est lui qui fait foi ici comme sur l'onglet MP.
    for (const t of dms.inbox) {
      if (t.unread === 0) continue
      const last = t.messages[t.messages.length - 1]
      out.push({
        id: `dm:${t.peer}`,
        kind: 'dm',
        actors: [t.peer],
        count: t.unread,
        createdAt: t.lastAt,
        preview: last ? quotePreview(last.content, 160) : '',
        topicId: null,
        eventId: null,
        unread: true,
      })
    }

    out.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
    return out
  })

  /**
   * Le compteur de la pastille. Il compte des ÉVÉNEMENTS et non des lignes : une
   * ligne « trois personnes t'ont répondu » vaut trois, sinon le regroupement
   * ferait mécaniquement baisser le compteur, ce qui reviendrait à cacher des
   * notifications en les rangeant.
   *
   * Calculé sur les sources brutes plutôt que sur `items`, donc indépendant de
   * la façon dont on regroupe. Les MP y comptent en MESSAGES, comme sur l'onglet
   * MP — deux nombres différents pour la même chose à 200 px d'écart seraient
   * illisibles.
   */
  const unreadCount = computed(() => {
    let n = dms.unreadCount
    for (const ev of forumEvents.value.values()) if (ev.created_at > seenUpTo.value) n++
    for (const at of followerFirstSeen.value.values()) if (at > seenUpTo.value) n++
    return n
  })

  /**
   * Tout ce qui est à l'écran devient lu. Appelé à la FERMETURE du panneau, pas
   * à son ouverture : tant qu'il est ouvert, les liserés orange montrent ce qui
   * était neuf, et c'est justement ce qu'on est venu voir.
   *
   * **Les MP ne sont pas concernés.** Un MP est du contenu qu'on lit, pas une
   * notification qu'on dispatche : il ne redevient lu qu'en ouvrant la
   * conversation (`dms.markRead`). La pastille garde donc le compte des MP en
   * attente après fermeture — et c'est juste, ils attendent toujours.
   */
  function markSeen(): void {
    if (unreadCount.value === 0) return
    seenUpTo.value = Math.floor(Date.now() / 1000)
    save()
  }

  /* ------------------------------------------------------ souscription */

  function watch(): void {
    const me = identity.pubkey
    if (!me || subs.length > 0) return
    load()
    subs.push(
      relayStore.subscribe(
        { kinds: [KIND_THREAD, KIND_COMMENT], '#p': [me], limit: 100 },
        { onevent: ingestForum },
        'notif:forum',
      ),
    )
    subs.push(
      relayStore.subscribe(
        { kinds: [KIND_CONTACTS], '#p': [me], limit: 200 },
        { onevent: ingestContacts },
        'notif:follow',
      ),
    )
  }

  function stop(): void {
    for (const s of subs) s.close()
    subs = []
  }

  function reset(): void {
    stop()
    forumEvents.value = new Map()
    followerFirstSeen.value = new Map()
    seenUpTo.value = 0
    loaded.value = false
  }

  return {
    items,
    unreadCount,
    seenUpTo,
    watch,
    stop,
    reset,
    markSeen,
  }
})
