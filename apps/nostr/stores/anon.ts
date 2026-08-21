/**
 * Mode anonyme (spec §3.7).
 *
 * Poster sans lier le message à son compte, **sans changer d'identité** : une
 * paire de clés éphémère signe l'event à la place de celle du compte. C'est le
 * grain fin de « ↻ new khey » (§3.6) — là où `newKhey()` remplace l'identité,
 * ici on la met de côté le temps d'un fil.
 *
 * ## Une clé par topic, et pas par message
 *
 * Le choix n'est pas une commodité, il tranche un arbitrage. Une clé par message
 * rend deux messages du même auteur indistinguables de deux personnes — donc
 * permet de se répondre à soi-même en paraissant deux, dans le fil qu'on a
 * ouvert. Une clé par topic donne au contraire un « Anonyme·a3f81b » stable
 * **dans ce fil** : la même voix se voit, et rien ne la relie à un autre fil.
 * C'est le poster ID de 4chan, et c'est la borne de §3.6 appliquée au grain du
 * message.
 *
 * ## Ce que ça ne protège pas, et qu'il faut dire à l'écran
 *
 * **Le relais voit la connexion.** Il reçoit l'event anonyme par la même socket,
 * depuis la même IP, dans la même session que les messages signés du compte : il
 * peut corréler. L'anonymat offert ici vaut vis-à-vis des **lecteurs**, pas de
 * l'opérateur. Un forum qui promet l'anonymat sans dire contre qui ment par
 * omission — d'où la phrase dans la carte de première fois (`Composer.vue`).
 *
 * Conséquence, moins visible et plus coûteuse : **on ne s'abonne jamais aux
 * clés anonymes** (voir `stores/notifications.ts`). Demander au relais
 * `{"#p": [ma clé, mes clés anonymes]}` inscrirait le lien dans une requête,
 * là où il n'est aujourd'hui qu'inférable. Le prix est qu'une réponse à un
 * message anonyme ne notifie pas : on la voit en rouvrant le fil.
 *
 * ## Pourquoi les clés vivent ici et nulle part ailleurs
 *
 * Elles restent en localStorage parce que **corriger son message demande de le
 * resigner** (§2.5 : l'autorité de révision se tranche sur `pubkey`). Perdre le
 * stockage, c'est perdre le droit de se relire — pas le message. Elles ne sont
 * ni exportées avec la `nsec` ni synchronisées : un message anonyme n'est pas
 * réclamable depuis un autre appareil, et c'est une propriété, pas un manque.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'

const KEYS_KEY = 'forome.anon.keys'
const ON_KEY = 'forome.anon.on'
const SEEN_KEY = 'forome.anon.seen'

/**
 * Le topic qu'on est en train d'ouvrir n'a pas encore d'id — c'est l'event lui
 * même qui le portera. Sa clé attend donc sous cette entrée, et `bindDraft()`
 * la range sous le vrai id une fois le topic publié.
 */
const DRAFT_SLOT = '·draft'

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Sous quelle voix un event est publié.
 *
 * L'abstraction existe pour que `usePublisher` n'ait pas à savoir qu'il existe
 * un mode anonyme : il reçoit de quoi signer, il signe. Sans elle, chaque
 * fonction de publication porterait un `if (anonyme)` — et celle qu'on
 * oublierait publierait sous le compte un message qu'on croyait anonyme, sur un
 * réseau où rien ne s'efface.
 */
export interface Voice {
  pubkey: string
  sign(unsigned: EventTemplate & { pubkey?: string; tags: string[][] }): Promise<VerifiedEvent>
}

export const useAnonStore = defineStore('anon', () => {
  /** topic → clé privée éphémère, en hex. */
  const keys = ref<Record<string, string>>({})
  /** Topics où le composeur est en mode anonyme. Rémanent, voir `setEnabled`. */
  const enabled = ref<Set<string>>(new Set())
  /** La carte de première fois a déjà été montrée. */
  const seen = ref(false)
  const loaded = ref(false)

  /**
   * Les clés publiques anonymes de cet appareil.
   *
   * Dérivées et mémoïsées plutôt que stockées : le stockage ne contient que des
   * secrets, donc rien à tenir cohérent. C'est ce qui répond à « ce message
   * est-il de moi ? » sur chaque rangée du fil, d'où le `Set`.
   */
  const mine = computed(() => {
    const out = new Set<string>()
    for (const [topic, sk] of Object.entries(keys.value)) {
      if (topic === DRAFT_SLOT) continue
      try {
        out.add(getPublicKey(unhex(sk)))
      } catch {
        // clé illisible (stockage corrompu) : elle ne désigne personne
      }
    }
    return out
  })

  function load(): void {
    if (!import.meta.client || loaded.value) return
    loaded.value = true
    try {
      const raw = localStorage.getItem(KEYS_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object') {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) out[k] = v
        }
        keys.value = out
      }
      const on: unknown = JSON.parse(localStorage.getItem(ON_KEY) ?? '[]')
      if (Array.isArray(on)) enabled.value = new Set(on.filter((t): t is string => typeof t === 'string'))
      seen.value = localStorage.getItem(SEEN_KEY) === '1'
    } catch {
      // Stockage illisible : on repart à vide plutôt que de refuser de démarrer.
      // Le coût est de ne plus pouvoir corriger d'anciens messages anonymes.
    }
  }

  function persist(): void {
    if (!import.meta.client) return
    try {
      localStorage.setItem(KEYS_KEY, JSON.stringify(keys.value))
      localStorage.setItem(ON_KEY, JSON.stringify([...enabled.value]))
    } catch {
      // Quota plein : la clé ne survivra pas au rechargement, donc le message
      // partira mais ne sera plus corrigible. Rien à dire au moment du geste.
    }
  }

  /** Clé privée du fil, créée à la première demande. */
  function secretFor(topicId: string): Uint8Array {
    load()
    const existing = keys.value[topicId]
    if (existing) return unhex(existing)
    const sk = generateSecretKey()
    keys.value = { ...keys.value, [topicId]: hex(sk) }
    persist()
    return sk
  }

  /** La clé publique sous laquelle on parlera dans ce fil. */
  function pubkeyFor(topicId: string): string {
    return getPublicKey(secretFor(topicId))
  }

  /**
   * La voix anonyme d'un fil. Toujours une clé **locale**, quel que soit le mode
   * de signature du compte : une extension NIP-07 ou un bunker NIP-46 ne
   * détiennent pas cette clé et n'ont aucune raison de la connaître — leur
   * demander de signer relierait le message à l'identité qu'ils gardent.
   */
  function voiceFor(topicId: string): Voice {
    const sk = secretFor(topicId)
    return {
      pubkey: getPublicKey(sk),
      sign: (unsigned) => Promise.resolve(finalizeEvent(unsigned, sk)),
    }
  }

  /** La voix qui a signé cet event, si c'est une des nôtres. Sinon null. */
  function voiceOf(pubkey: string): Voice | null {
    load()
    for (const [topic, sk] of Object.entries(keys.value)) {
      if (topic === DRAFT_SLOT) continue
      const bytes = unhex(sk)
      try {
        if (getPublicKey(bytes) !== pubkey) continue
      } catch {
        continue
      }
      return { pubkey, sign: (unsigned) => Promise.resolve(finalizeEvent(unsigned, bytes)) }
    }
    return null
  }

  function isMine(pubkey: string): boolean {
    load()
    return mine.value.has(pubkey)
  }

  /* ------------------------------------------------------- topic à naître */

  /** La voix du topic qu'on est en train d'écrire — il n'a pas encore d'id. */
  function draftVoice(): Voice {
    return voiceFor(DRAFT_SLOT)
  }

  /**
   * Le mode, pour le topic en cours d'écriture. Deux fonctions dédiées plutôt
   * que le nom du casier exposé aux composants : `DRAFT_SLOT` est un détail de
   * rangement, et un appelant qui le passerait à `voiceFor` publierait un
   * message sous une clé que `bindDraft` déplacera sous ses pieds.
   */
  function isDraftEnabled(): boolean {
    return isEnabled(DRAFT_SLOT)
  }
  function setDraftEnabled(on: boolean): void {
    setEnabled(DRAFT_SLOT, on)
  }

  /**
   * Le topic est publié : sa clé prend son id pour nom.
   *
   * ⚠️ Le brouillon est **rangé, pas recréé**. Réutiliser `secretFor` produirait
   * une clé neuve sous le nouvel id, et le topic qu'on vient de publier
   * deviendrait le message de quelqu'un d'autre — non corrigible, et affiché
   * sous un « Anonyme » différent de celui des réponses qui suivraient.
   */
  function bindDraft(topicId: string): void {
    load()
    const sk = keys.value[DRAFT_SLOT]
    if (!sk) return
    const next = { ...keys.value, [topicId]: sk }
    delete next[DRAFT_SLOT]
    keys.value = next
    // Le casier du brouillon est libéré aussi côté mode : sinon le prochain
    // topic s'ouvrirait en anonyme sans que personne l'ait demandé.
    const on = new Set(enabled.value)
    on.delete(DRAFT_SLOT)
    enabled.value = on
    // Ouvrir un topic anonymement, c'est y être anonyme : sans ça l'auteur
    // répondrait dans son propre fil d'aveu sous son pseudo, au premier message.
    enabled.value = new Set([...enabled.value, topicId])
    persist()
  }

  /* ------------------------------------------------------------- le mode */

  function isEnabled(topicId: string): boolean {
    load()
    return enabled.value.has(topicId)
  }

  /**
   * Active ou coupe le mode dans un fil. **Rémanent** : le mode est un état de
   * « moi dans ce fil », pas une case à cocher par message — sans quoi, dans un
   * topic d'aveu, il faudrait le reprendre à chaque réponse et un oubli
   * exposerait. Ce que ça exige en échange, c'est que le composeur montre l'état
   * en permanence ; c'est le rôle du gabarit tireté (`Composer.vue`).
   */
  function setEnabled(topicId: string, on: boolean): void {
    load()
    const next = new Set(enabled.value)
    if (on) {
      next.add(topicId)
      // La clé est tirée maintenant, pas à l'envoi : le composeur annonce
      // « Anonyme·a3f81b » avant la frappe, et ce nom doit être celui qui
      // partira.
      secretFor(topicId)
    } else {
      next.delete(topicId)
    }
    enabled.value = next
    persist()
  }

  function markSeen(): void {
    seen.value = true
    if (import.meta.client) localStorage.setItem(SEEN_KEY, '1')
  }

  /**
   * Efface tout — appelé par « ↻ new khey ».
   *
   * Une identité jetée emporte ses masques : les garder ferait qu'un message
   * anonyme reste corrigible par quelqu'un qui a précisément voulu se détacher
   * de son historique, et le lien entre les deux identités survivrait dans le
   * seul endroit qui le détenait.
   */
  function wipe(): void {
    keys.value = {}
    enabled.value = new Set()
    seen.value = false
    if (!import.meta.client) return
    localStorage.removeItem(KEYS_KEY)
    localStorage.removeItem(ON_KEY)
    localStorage.removeItem(SEEN_KEY)
  }

  return {
    seen,
    load,
    isMine,
    isEnabled,
    setEnabled,
    pubkeyFor,
    voiceFor,
    voiceOf,
    draftVoice,
    isDraftEnabled,
    setDraftEnabled,
    bindDraft,
    markSeen,
    wipe,
  }
})
