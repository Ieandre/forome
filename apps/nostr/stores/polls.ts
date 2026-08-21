/**
 * Le sondage du topic ouvert et son dépouillement en direct.
 *
 * Le format et les règles de comptage ne sont **pas** ici : ils vivent dans
 * `@forome/relay-policy/polls`, partagés avec le relais et testés à part. Ce
 * store ne fait que ce que le module pur ne peut pas faire — écouter les voix,
 * afficher la nôtre tout de suite, et la publier.
 *
 * ## Il n'y a rien à charger pour le bulletin
 *
 * Le sondage est porté par les tags du topic, donc `PostFeed` et `ForumShell`
 * l'ont déjà : la racine est dans `stores/topics.ts`. Ce store ne souscrit qu'aux
 * **votes** — c'est tout ce qui reste à aller chercher, et c'est ce qui rend la
 * fonctionnalité gratuite sur les topics qui n'ont pas de sondage : sans tags de
 * sondage sur la racine, on n'ouvre aucune souscription.
 *
 * ## Pourquoi le vote s'affiche avant d'exister
 *
 * Un vote est un event : il faut le miner, le signer (une extension NIP-07 met
 * des centaines de ms, un bunker NIP-46 fait un aller-retour), puis le diffuser.
 * Cocher une case et attendre une seconde que la case se coche donne un site
 * cassé. `myVote` porte donc le choix **dès le clic**, et le dépouillement le lit
 * comme si l'event était déjà là.
 *
 * La façon de le faire mérite un mot : on fabrique un faux event local et on le
 * passe au compteur pur avec les vrais. C'est volontaire et c'est sans risque —
 * le dépouillement ne vérifie aucune signature (il ne peut pas : le pool l'a
 * déjà fait à la réception), et la seule clé qu'on puisse contrefaire est la
 * nôtre, donc le seul écran qu'on puisse tromper est le nôtre. En échange, la
 * règle du dernier vote, la troncature du choix unique et la fermeture
 * s'appliquent au vote optimiste exactement comme aux autres, sans une seule
 * ligne de comptage dupliquée ici.
 */
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import {
  KIND_POLL_VOTE,
  hasPoll,
  isPollClosed,
  pollOptionsOf,
  pollTypeOf,
  pollEndsAt,
  tallyPoll,
  type NostrEvent,
  type PollTally,
} from '~/types/nostr'
import type { SubHandle } from '~/stores/relays'

/** Id du faux event qui porte le vote en vol. Jamais publié, jamais 64 hexa. */
const LOCAL_VOTE_ID = 'vote-local'

const EMPTY_TALLY: PollTally = { voters: 0, counts: new Map(), mine: [], closed: false }

export const usePollStore = defineStore('polls', () => {
  const relayStore = useRelayStore()
  const identity = useIdentityStore()
  const publisher = usePublisher()

  /** La racine du topic ouvert, si elle porte un sondage. */
  const poll = shallowRef<NostrEvent | null>(null)

  /**
   * Voix reçues, **mutées en place** avec un compteur de révision pour
   * l'invalidation — même schéma que `stores/topics.ts`, et pour la même raison :
   * un sondage animé peut recevoir des dizaines de voix, et recopier la Map à
   * chaque event coûterait plus que le dépouillement lui-même.
   */
  const votes = shallowRef(new Map<string, NostrEvent>())
  const rev = ref(0)

  /** Cadence de réévaluation : c'est elle qui fait fermer un sondage à l'heure. */
  const clock = ref(0)

  /** Le choix cliqué, tant que son event n'est pas revenu des relais. */
  const myVote = shallowRef<{ choices: string[]; at: number } | null>(null)
  const voting = ref(false)
  const lastError = ref<string | null>(null)

  let sub: SubHandle | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  function nowS(): number {
    return Math.floor(Date.now() / 1000)
  }

  function ingestVote(ev: NostrEvent): void {
    if (ev.kind !== KIND_POLL_VOTE || votes.value.has(ev.id)) return
    votes.value.set(ev.id, ev)
    // Notre propre voix nous revient par la souscription : le vote optimiste n'a
    // plus de raison d'être, et le garder ferait vivre un doublon dont l'un est
    // daté de maintenant — donc gagnant à jamais sur les corrections suivantes.
    if (ev.pubkey === identity.pubkey) myVote.value = null
    rev.value++
  }

  /**
   * Suit le sondage de la racine donnée. Idempotent : `ForumShell` rappelle à
   * chaque changement de rangée, y compris quand rien n'a bougé, et la racine
   * arrive parfois après l'id du topic (permalien → `fetchRoot`).
   *
   * `root` à `null`, ou un topic sans tags de sondage, ferme tout : il n'y a
   * alors ni bulletin à montrer ni voix à écouter.
   */
  function follow(root: NostrEvent | null): void {
    if (!root || !hasPoll(root)) {
      if (poll.value) close()
      return
    }
    if (poll.value?.id === root.id) return

    close()
    poll.value = root
    sub = relayStore.subscribe(
      { kinds: [KIND_POLL_VOTE], '#e': [root.id] },
      { onevent: ingestVote },
      'poll:votes',
    )
    if (!timer) timer = setInterval(() => clock.value++, 1000)
  }

  function close(): void {
    sub?.close()
    sub = null
    if (timer) clearInterval(timer)
    timer = null
    poll.value = null
    votes.value = new Map()
    myVote.value = null
    lastError.value = null
    rev.value++
  }

  /* ------------------------------------------------------------------ vues */

  const options = computed(() => (poll.value ? pollOptionsOf(poll.value) : []))
  const type = computed(() => (poll.value ? pollTypeOf(poll.value) : 'singlechoice'))
  const endsAt = computed(() => (poll.value ? pollEndsAt(poll.value) : null))

  const closed = computed(() => {
    void clock.value
    return !!poll.value && isPollClosed(poll.value, nowS())
  })

  /**
   * Le dépouillement, voix en vol comprise.
   *
   * Le faux event local est fabriqué ici et nulle part ailleurs — voir l'en-tête
   * pour la raison. Il porte `created_at: now`, donc la règle du dernier vote le
   * fait gagner sur nos voix précédentes sans traitement particulier.
   *
   * Pas de dépendance à la cadence, délibérément : aucune règle de comptage ne
   * dépend de l'heure courante (celle de la fermeture compare les voix à
   * `endsAt`, pas à maintenant). L'y brancher recalculerait tout le dépouillement
   * chaque seconde pour rendre le même résultat — c'est `closed` seul qui a
   * besoin de l'horloge.
   */
  const tally = computed<PollTally>(() => {
    void rev.value
    const p = poll.value
    if (!p) return EMPTY_TALLY

    const pending = myVote.value
    const all =
      pending && identity.pubkey
        ? [
            ...votes.value.values(),
            {
              id: LOCAL_VOTE_ID,
              pubkey: identity.pubkey,
              created_at: pending.at,
              kind: KIND_POLL_VOTE,
              tags: [['e', p.id], ...pending.choices.map((c) => ['response', c])],
              content: '',
              sig: '',
            } as NostrEvent,
          ]
        : votes.value.values()

    return tallyPoll(p, all, { nowS: nowS(), me: identity.pubkey ?? null })
  })

  /** Ce qu'on a voté, en vol ou confirmé. Vide quand on n'a pas voté. */
  const mine = computed(() => tally.value.mine)
  const hasVoted = computed(() => mine.value.length > 0)

  /** Le sondage attend notre voix : ouvert, et on ne s'est pas prononcé. */
  const awaitingMe = computed(() => !!poll.value && !closed.value && !hasVoted.value && identity.ready)

  /* --------------------------------------------------------------- écriture */

  /**
   * Enregistre une voix. Le choix est à l'écran avant que l'event existe ; en cas
   * d'échec la voix en vol est retirée et l'affichage retombe sur ce que les
   * relais connaissent — jamais sur un état inventé.
   *
   * `choices` vide est le **retrait** de sa voix : c'est le seul geste possible
   * pour se dédire sur un réseau qui ne sait rien effacer.
   */
  async function vote(choices: string[]): Promise<boolean> {
    const p = poll.value
    if (!p || closed.value || !identity.ready) return false

    lastError.value = null
    myVote.value = { choices: [...choices], at: nowS() }
    voting.value = true
    try {
      const outcome = await publisher.publishVote({ poll: p, choices })
      if (!outcome) {
        myVote.value = null
        lastError.value = publisher.lastError.value ?? 'vote non publié'
        return false
      }
      // L'event existe : on l'ingère nous-mêmes plutôt que d'attendre l'écho des
      // relais, qui peut mettre une seconde ou ne jamais venir si aucun de ceux
      // qu'on lit ne l'a accepté. C'est ce qui remplace la voix en vol par une
      // voix réelle, donc comptée avec sa vraie date.
      ingestVote(outcome.event)
      if (outcome.result.accepted.length === 0) {
        lastError.value = publisher.lastError.value ?? 'aucun relais n’a accepté ce vote'
        return false
      }
      return true
    } finally {
      voting.value = false
    }
  }

  return {
    poll,
    options,
    type,
    endsAt,
    closed,
    tally,
    mine,
    hasVoted,
    awaitingMe,
    voting,
    lastError,
    follow,
    close,
    vote,
  }
})
