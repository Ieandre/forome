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
  const sending = ref(false)
  const lastError = ref<string | null>(null)
  const unwrapFailures = ref(0)
  const readUpTo = ref(new Map<string, number>())

  let subs: { close: () => void }[] = []

  /** Disponible seulement avec une clé locale — voir `secretKeyForDm`. */
  const available = computed(() => !!identity.secretKeyForDm())

  /* --------------------------------------------------------- déballage */

  function ingestWrap(wrap: NostrEvent): void {
    const sk = identity.secretKeyForDm()
    if (!sk) return
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
    } catch {
      // Emballage illisible : soit il ne nous est pas destiné, soit il est
      // corrompu. Les deux sont normaux sur un relais public — on compte, on
      // n'alerte pas.
      unwrapFailures.value++
    }
  }

  /* ------------------------------------------------------------- envoi */

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
   * Envoie un MP. `wrapManyEvents` produit **deux** emballages : un pour le
   * destinataire, un pour soi — sinon l'expéditeur ne relit pas ses propres MP.
   * NIP-17 le prescrit : deux boîtes par message, une par lecteur légitime.
   */
  async function send(peer: string, text: string): Promise<boolean> {
    const sk = identity.secretKeyForDm()
    if (!sk) {
      lastError.value = 'MP indisponibles avec une extension NIP-07 à cette étape'
      return false
    }
    const content = text.trim()
    if (!content || !/^[0-9a-f]{64}$/.test(peer)) return false

    sending.value = true
    lastError.value = null
    try {
      // La rumeur (kind 14) n'est PAS signée — un message signé et déchiffré
      // serait republiable par le destinataire comme preuve publique.
      const rumor = createRumor(
        { kind: KIND_CHAT, content, tags: [['p', peer]] },
        sk,
      )
      // Le sceau (kind 13) EST signé par l'expéditeur : c'est ce qui rend un MP
      // signalé prouvablement authentique (§10.2).
      const seal = createSeal(rumor, sk, peer)

      // Deux emballages : un pour le destinataire, un pour soi — sinon on ne
      // relit pas ses propres MP. NIP-17 le prescrit.
      const me = identity.pubkey!
      const wraps = await Promise.all([
        wrapWithPow(seal, peer, miner.difficulty.value),
        wrapWithPow(createSeal(rumor, sk, me), me, miner.difficulty.value),
      ])

      const results = await Promise.all(wraps.map((w) => relayStore.publish(w)))
      const accepted = results.filter((r) => r.accepted.length > 0).length

      if (accepted === 0) {
        const reason = results[0]?.rejected[0]?.reason ?? 'aucun relais joignable'
        lastError.value = `refusé : ${reason}`
        return false
      }
      if (accepted < wraps.length) {
        // Cas réel à ne pas taire : si seule la copie du destinataire passe,
        // le message est délivré mais absent de NOTRE historique.
        lastError.value = `${accepted}/${wraps.length} copies acceptées — historique peut-être incomplet`
      }
      // Affichage immédiat : on déballe nos propres emballages plutôt que de
      // fabriquer un message optimiste à la main, ce qui garantit que ce qui
      // s'affiche est bien ce qui a été chiffré.
      for (const w of wraps) ingestWrap(w)
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      sending.value = false
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
        { onevent: ingestWrap },
        'dm',
        { authenticate: true },
      ),
    )
  }

  function stop(): void {
    for (const s of subs) s.close()
    subs = []
  }

  function reset(): void {
    stop()
    byId.value = new Map()
    readUpTo.value = new Map()
    unwrapFailures.value = 0
  }

  return {
    available,
    sending,
    lastError,
    unwrapFailures,
    threads,
    inbox,
    requests,
    unreadCount,
    send,
    watch,
    stop,
    reset,
    markRead,
    threadWith,
  }
})
