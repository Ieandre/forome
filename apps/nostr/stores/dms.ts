/**
 * Messages privés NIP-17 (spec §10).
 *
 * **Le seul endroit du projet où le chiffrement a un sens.** Le E2EE n'a aucun
 * sens sur du contenu public : chiffrer pour un groupe = tout le monde.
 *
 * ## La chaîne, et pourquoi elle a trois couches
 *
 *   1. **rumeur** (kind 14) — le message, *non signé*. Non signé délibérément :
 *      un message signé et déchiffré serait republiable par le destinataire comme
 *      preuve publique.
 *   2. **sceau** (kind 13) — la rumeur chiffrée en NIP-44 vers le destinataire,
 *      **signée par l'expéditeur**. C'est ce qui rend un MP signalé prouvablement
 *      authentique (§10.2).
 *   3. **emballage** (kind 1059) — le sceau rechiffré, signé par une **clé
 *      éphémère**. C'est lui qui masque les métadonnées aux relais.
 *
 * ## Ce que le gift wrap achète, et ce qu'il casse
 *
 * Ce que ça achète : les relais ne savent pas qui parle à qui. Seul le
 * destinataire apparaît, en tag `p` de l'emballage.
 *
 * Ce que ça coûte : **le blocage côté serveur devient impossible** (§10.2). Le
 * relais ne peut pas connaître l'expéditeur, donc il ne peut pas filtrer sur lui.
 * Toute la défense passe côté client, après déchiffrement — d'où la file séparée
 * pour les clés hors web of trust, et la PoW exigée sur l'emballage.
 *
 * ## Pas de forward secrecy
 *
 * Une fuite de la clé rend tout l'historique lisible. Compromis assumé, et
 * affiché dans l'interface — ne jamais laisser croire à mieux que ce qui est.
 */
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { unwrapEvent } from 'nostr-tools/nip17'
import { createRumor, createSeal } from 'nostr-tools/nip59'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44'
import { getPow, minePow } from 'nostr-tools/nip13'
import { KIND_GIFT_WRAP, type NostrEvent } from '~/types/nostr'

/** kind du sceau NIP-59. */
const KIND_SEAL = 13
/** kind du message de chat NIP-17. */
const KIND_CHAT = 14
/**
 * Antidatage de l'emballage, comme `randomNow()` de NIP-59 : si l'emballage
 * portait l'heure réelle, un relais corrélerait les deux copies publiées
 * simultanément et en déduirait la conversation.
 */
const TWO_DAYS_S = 2 * 24 * 3600

export interface DmMessage {
  /** id de la rumeur (kind 14), stable */
  id: string
  /** clé publique de l'auteur réel, extraite du sceau */
  pubkey: string
  /** l'autre partie de la conversation */
  peer: string
  fromMe: boolean
  createdAt: number
  content: string
  /** PoW de l'emballage — l'anti-spam des MP (§10.2) */
  wrapPow: number
}

export interface DmThread {
  peer: string
  messages: DmMessage[]
  lastAt: number
  unread: number
  /** true si la clé est dans mon web of trust */
  trusted: boolean
}

export const useDmStore = defineStore('dms', () => {
  const relayStore = useRelayStore()
  const identity = useIdentityStore()
  const social = useSocialStore()
  const miner = usePowMiner()

  const byId = shallowRef(new Map<string, DmMessage>())
  /** Révision de `byId`, mutée en place — voir `ingestWrap`. */
  const dmRev = ref(0)
  const lastError = ref<string | null>(null)
  const unwrapFailures = ref(0)
  const readUpTo = ref(new Map<string, number>())
  /**
   * Vrai dès que la synchro initiale est finie (EOSE). C'est la SEULE façon de
   * distinguer un message qui arrive d'un message qu'on rattrape : les
   * emballages sont antidatés jusqu'à deux jours (voir `TWO_DAYS_S`), donc
   * `created_at` ne dit rien de leur fraîcheur.
   *
   * S'il n'y a pas d'EOSE, il n'y a pas d'annonce — jamais de rafale de bulles
   * sur tout un historique. La pastille, elle, reste juste dans tous les cas.
   */
  const synced = ref(false)
  /**
   * Le dernier message arrivé EN DIRECT et digne d'une annonce à l'écran
   * (`components/DmToast.vue`). Filtré ici et pas dans le composant : la
   * décision « qui a le droit de faire surgir quelque chose devant le lecteur »
   * appartient au même endroit que la file séparée (§10.2).
   */
  const arrival = shallowRef<DmMessage | null>(null)

  let subs: { close: () => void }[] = []

  /** Disponible seulement avec une clé locale — voir `secretKeyForDm`. */
  const available = computed(() => !!identity.secretKeyForDm())

  /* --------------------------------------------------------- déballage */

  function ingestWrap(wrap: NostrEvent): void {
    const sk = identity.secretKeyForDm()
    if (!sk) return
    // Retenu ici et annoncé APRÈS le `catch` : à l'intérieur, une exception de
    // `announce` serait comptée en `unwrapFailures`, c'est-à-dire attribuée à un
    // emballage illisible. Un compteur qui ment sur ce qu'il compte ne sert plus
    // à diagnostiquer.
    let fresh: DmMessage | null = null
    try {
      const rumor = unwrapEvent(wrap, sk)

      // ⚠️ Contrôle indispensable : `unwrapEvent` renvoie la rumeur telle
      // qu'elle était dans le sceau. Le pubkey de la rumeur doit être celui qui
      // a signé le sceau, sinon n'importe qui pourrait emballer une rumeur
      // attribuée à quelqu'un d'autre et usurper une conversation.
      // `nostr-tools` fait cette vérification en interne ; on refuse quand même
      // ce qui n'a pas d'auteur exploitable.
      if (!rumor.pubkey || !/^[0-9a-f]{64}$/.test(rumor.pubkey)) {
        unwrapFailures.value++
        return
      }

      const me = identity.pubkey
      const fromMe = rumor.pubkey === me
      // Le destinataire est dans un tag `p` de la rumeur ; pour un message reçu,
      // le pair est l'auteur.
      let peer = rumor.pubkey
      if (fromMe) {
        const to = rumor.tags.find((t) => t[0] === 'p' && t[1] && t[1] !== me)?.[1]
        peer = to ?? me
      }

      const msg: DmMessage = {
        id: rumor.id,
        pubkey: rumor.pubkey,
        peer,
        fromMe,
        createdAt: rumor.created_at,
        content: rumor.content,
        wrapPow: getPow(wrap.id),
      }
      if (byId.value.has(msg.id)) return
      // mutation en place + compteur : copier la Map entière par emballage
      // rendait la synchro initiale quadratique (comme `stores/topics.ts`)
      byId.value.set(msg.id, msg)
      dmRev.value++
      fresh = msg
    } catch {
      // Emballage illisible : soit il ne nous est pas destiné, soit il est
      // corrompu. Les deux sont normaux sur un relais public — on compte, on
      // n'alerte pas.
      unwrapFailures.value++
    }
    if (fresh) announce(fresh)
  }

  /**
   * Ce qui a le droit de surgir devant le lecteur, et pourquoi c'est si étroit.
   *
   * Quatre conditions, chacune ferme une porte :
   *   - `synced` — sinon l'historique entier défilerait en bulles à l'ouverture ;
   *   - `!fromMe` — la copie de nos propres MP (NIP-17 en publie deux) repasse
   *     ici, et s'annoncer à soi-même n'a pas de sens ;
   *   - `inWot` — **la file séparée ne fait pas surgir de bulle.** Une inconnue
   *     qui apparaît par-dessus l'écran serait exactement le harcèlement que
   *     §10.2 refuse, et le relais ne peut pas filtrer pour nous. Les inconnus
   *     se signalent sans interrompre, par le point de `SectionTabs` ;
   *   - `!isMuted` — bloquer doit valoir ici aussi, sinon bloquer ne bloque rien.
   */
  function announce(msg: DmMessage): void {
    if (!synced.value || msg.fromMe) return
    if (!social.inWot(msg.peer) || social.isMuted(msg.peer)) return
    arrival.value = msg
  }

  /** Annonce consommée : par le tap, par le renvoi, ou par l'expiration. */
  function clearArrival(): void {
    arrival.value = null
  }

  /* ------------------------------------------------------------- envoi */

  /**
   * Pose un message dans le fil sans passer par un emballage.
   *
   * Séparé de `ingestWrap` à dessein : ici il n'y a rien à déchiffrer ni à
   * authentifier — la rumeur sort de notre propre clé, et son id est déjà
   * définitif (`createRumor` le calcule). C'est ce qui rend l'écho exact :
   * l'emballage qui reviendra du relais porte la même rumeur, donc `ingestWrap`
   * reconnaîtra l'id et n'ajoutera pas de doublon.
   */
  function showLocal(rumor: { id: string; pubkey: string; created_at: number; content: string }, peer: string): void {
    byId.value.set(rumor.id, {
      id: rumor.id,
      pubkey: rumor.pubkey,
      peer,
      fromMe: true,
      createdAt: rumor.created_at,
      content: rumor.content,
      wrapPow: 0,
    })
    dmRev.value++
  }

  /** Retire un message affiché dont l'envoi n'a finalement abouti nulle part. */
  function drop(id: string): void {
    if (byId.value.delete(id)) dmRev.value++
  }

  /**
   * Emballage **avec preuve de travail** (spec §10.2, §12.2).
   *
   * Pourquoi ne pas utiliser `nip17.wrapEvent` de `nostr-tools` : il génère la
   * clé éphémère en interne et signe immédiatement. Or le nonce de la PoW est
   * dans les tags, donc dans l'id, donc dans ce qui est signé — impossible de
   * miner après coup sans invalider la signature. Il faut donc contrôler la clé
   * éphémère, ce qui impose de refaire l'emballage à la main.
   *
   * Ce n'est pas un caprice : sur les MP, la PoW est **la seule barrière
   * possible**. Le gift wrap masque l'expéditeur, donc le relais ne peut ni
   * appliquer de quota par identité ni filtrer un bloqué (§10.2).
   */
  async function wrapWithPow(
    seal: NostrEvent,
    recipient: string,
    difficulty: number,
  ): Promise<NostrEvent> {
    const ephemeralSk = generateSecretKey()
    const ephemeralPk = getPublicKey(ephemeralSk)
    const conversationKey = getConversationKey(ephemeralSk, recipient)
    const nowSec = Math.floor(Date.now() / 1000)

    const unsigned = {
      kind: KIND_GIFT_WRAP,
      pubkey: ephemeralPk,
      // Antidatage, comme `randomNow()` de NIP-59.
      created_at: nowSec - Math.round(Math.random() * TWO_DAYS_S),
      tags: [['p', recipient]],
      content: nip44Encrypt(JSON.stringify(seal), conversationKey),
    }

    // Minage à `created_at` FIGÉ : `minePow` de nostr-tools remettrait l'horloge
    // à l'heure courante et annulerait l'antidatage. Voir `mineFixedCreatedAt`
    // dans le worker.
    const mined = difficulty > 0 ? await miner.mineFixed(unsigned, difficulty) : unsigned

    return finalizeEvent(
      { kind: mined.kind, created_at: mined.created_at, tags: mined.tags, content: mined.content },
      ephemeralSk,
    )
  }

  /**
   * Envoie un MP. Deux emballages : un pour le destinataire, un pour soi —
   * sinon l'expéditeur ne relit pas ses propres MP. NIP-17 le prescrit : deux
   * boîtes par message, une par lecteur légitime.
   *
   * **Le message est à l'écran avant le minage et avant le réseau**, comme le
   * fil public (`usePublisher.run`). C'est ce qui manquait ici : l'envoi
   * attendait deux PoW — sérialisées, le worker de minage est unique — puis le
   * verdict COMPLET des deux publications, soit jusqu'à `PUBLISH_MAX_WAIT_MS`
   * imposé par le relais le plus lent alors qu'un autre avait déjà accepté. Le
   * composeur restait figé plusieurs secondes pour un message déjà parti.
   *
   * `onSending` est appelé au même instant, pour vider le composeur : un champ
   * encore plein pendant que « ça réfléchit » se lit comme un clic raté, et on
   * reclique.
   */
  async function send(
    peer: string,
    text: string,
    opts: { onSending?: () => void } = {},
  ): Promise<boolean> {
    const sk = identity.secretKeyForDm()
    if (!sk) {
      lastError.value = 'MP indisponibles avec une extension NIP-07 à cette étape'
      return false
    }
    const content = text.trim()
    if (!content || !/^[0-9a-f]{64}$/.test(peer)) return false

    const me = identity.pubkey!
    lastError.value = null
    let posted: string | null = null
    try {
      // La rumeur (kind 14) n'est PAS signée — un message signé et déchiffré
      // serait republiable par le destinataire comme preuve publique.
      const rumor = createRumor({ kind: KIND_CHAT, content, tags: [['p', peer]] }, sk)
      // Le sceau (kind 13) EST signé par l'expéditeur : c'est ce qui rend un MP
      // signalé prouvablement authentique (§10.2).
      const forPeer = createSeal(rumor, sk, peer)
      const forMe = createSeal(rumor, sk, me)

      posted = rumor.id
      showLocal(rumor, peer)
      opts.onSending?.()

      const wraps = await Promise.all([
        wrapWithPow(forPeer, peer, miner.difficulty.value),
        wrapWithPow(forMe, me, miner.difficulty.value),
      ])
      // La PoW n'existe qu'ici, alors que la bulle est affichée depuis le clic.
      const shown = byId.value.get(rumor.id)
      if (shown) {
        shown.wrapPow = getPow(wraps[0]!.id)
        dmRev.value++
      }

      const parts = wraps.map((w) => relayStore.publishSplit(w))
      const acks = await Promise.all(parts.map((p) => p.firstAck))

      if (!acks.some(Boolean)) {
        // `firstAck` ne rend false qu'une fois tous les relais départagés : le
        // verdict est déjà là, `settled` ne fait plus attendre.
        const result = await parts[0]!.settled
        drop(rumor.id)
        lastError.value = `refusé : ${result.rejected[0]?.reason ?? 'aucun relais joignable'}`
        return false
      }

      // Verdict complet en arrière-plan. Cas réel à ne pas taire : si seule la
      // copie du destinataire passe, le message est délivré mais absent de
      // NOTRE historique.
      void Promise.all(parts.map((p) => p.settled)).then((results) => {
        const accepted = results.filter((r) => r.accepted.length > 0).length
        if (accepted > 0 && accepted < results.length) {
          lastError.value = `${accepted}/${results.length} copies acceptées — historique peut-être incomplet`
        }
      })
      return true
    } catch (err) {
      if (posted) drop(posted)
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  /* -------------------------------------------------------------- vues */

  const threads = computed<DmThread[]>(() => {
    void dmRev.value
    const grouped = new Map<string, DmMessage[]>()
    for (const m of byId.value.values()) {
      const list = grouped.get(m.peer) ?? []
      list.push(m)
      grouped.set(m.peer, list)
    }
    const out: DmThread[] = []
    for (const [peer, messages] of grouped) {
      messages.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      const lastAt = messages[messages.length - 1]?.createdAt ?? 0
      const seenUpTo = readUpTo.value.get(peer) ?? 0
      out.push({
        peer,
        messages,
        lastAt,
        unread: messages.filter((m) => !m.fromMe && m.createdAt > seenUpTo).length,
        trusted: social.inWot(peer),
      })
    }
    out.sort((a, b) => b.lastAt - a.lastAt)
    return out
  })

  /**
   * File principale et file séparée (§10.2). Un MP d'une clé hors web of trust
   * n'atterrit **jamais** dans la boîte principale : c'est la seule protection
   * qui reste contre le harcèlement, puisque le relais ne peut pas filtrer.
   */
  const inbox = computed(() => threads.value.filter((t) => t.trusted && !social.isMuted(t.peer)))
  const requests = computed(() => threads.value.filter((t) => !t.trusted && !social.isMuted(t.peer)))

  const unreadCount = computed(() => inbox.value.reduce((n, t) => n + t.unread, 0))

  /**
   * Combien de fils INCONNUS attendent — en fils, jamais en messages.
   *
   * La file séparée doit se signaler (sinon elle est un trou noir : le premier
   * message de n'importe qui y tombe, réponse d'un correspondant qu'on a écrit
   * le premier comprise) sans jamais se compter avec la boîte. Un nombre de
   * messages inviterait à courir ; un nombre de fils dit seulement « il y a
   * quelque chose », et c'est tout ce qu'on veut promettre pour du non-sollicité.
   */
  const requestsUnread = computed(() => requests.value.filter((t) => t.unread > 0).length)

  function markRead(peer: string): void {
    const next = new Map(readUpTo.value)
    next.set(peer, Math.floor(Date.now() / 1000))
    readUpTo.value = next
  }

  function threadWith(peer: string): DmThread | null {
    return threads.value.find((t) => t.peer === peer) ?? null
  }

  /* ------------------------------------------------------ souscription */

  function watch(): void {
    const me = identity.pubkey
    if (!me || subs.length > 0 || !available.value) return
    // Les emballages nous sont adressés par un tag `p` ; l'auteur de l'event est
    // une clé éphémère, donc filtrer par `authors` serait vide de sens.
    //
    // `authenticate` : **la seule souscription du projet qui s'authentifie.**
    // strfry exige une AUTH NIP-42 pour lire les kinds de MP
    // (`auth.restrictedReadKinds`, « 4, 1059 » par défaut) — sinon n'importe qui
    // moissonnerait les emballages de n'importe qui et saurait qui reçoit des MP
    // et quand, ce que le gift wrap est justement censé cacher. Sans ça, le
    // relais accepte nos emballages puis ferme la souscription avec
    // `auth-required` : les MP partent et ne reviennent jamais.
    //
    // Ça ne concède rien : le filtre porte déjà notre clé en `#p`. Ailleurs,
    // s'authentifier lierait une simple lecture à une identité — voir
    // `authSigner` dans `stores/relays.ts`.
    subs.push(
      relayStore.subscribe(
        { kinds: [KIND_GIFT_WRAP], '#p': [me] },
        { onevent: ingestWrap, oneose: () => (synced.value = true) },
        'dm',
        { authenticate: true },
      ),
    )
  }

  function stop(): void {
    for (const s of subs) s.close()
    subs = []
    // La souscription repartira sur un historique complet : sans ça, la
    // resynchro rejouerait tout en annonces.
    synced.value = false
  }

  function reset(): void {
    stop()
    byId.value = new Map()
    readUpTo.value = new Map()
    unwrapFailures.value = 0
    arrival.value = null
  }

  return {
    available,
    lastError,
    unwrapFailures,
    threads,
    inbox,
    requests,
    unreadCount,
    requestsUnread,
    arrival,
    clearArrival,
    send,
    watch,
    stop,
    reset,
    markRead,
    threadWith,
  }
})
