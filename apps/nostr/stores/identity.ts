/**
 * Identité locale (spec §3.1, §3.2, §3.6).
 *
 * Le modèle en une phrase : **la paire de clés EST le compte.** Pas de base
 * `users`, pas d'inscription, pas de session. La clé est générée à la première
 * visite et vit en localStorage.
 *
 * ⚠️ Ce que ce fichier ne peut pas faire, et qu'il ne faut pas croire acquis :
 *   - **pas de révocation.** Une clé compromise est une identité perdue (§3.2).
 *     Le signeur distant (NIP-46) est le seul vrai remède.
 *   - **pas de rotation.** Nostr n'a pas de standard adopté pour « cette clé
 *     remplace celle-là » (§15.2). Ne pas inventer un mécanisme maison.
 *   - **le pseudo n'est pas unique** (§3.5). L'identité est la clé publique ;
 *     tout affichage de pseudo doit porter son discriminant.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
// Type seul : le module nip46 (et sa chaîne nip04/nip44) ne se charge qu'à la
// connexion d'un bunker — `init()` tourne sur CHAQUE chargement de page, et la
// quasi-totalité des sessions n'utilisent jamais de signeur distant.
import type { BunkerSigner, BunkerPointer } from 'nostr-tools/nip46'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import { kheyHandle, keyDiscriminator, decodeSecretInput } from '~/utils/nostr'

const SK_KEY = 'forome.sk'
const POSTS_KEY = 'forome.posts'
const SAVED_KEY = 'forome.keySaved'
const ENCART_KEY = 'forome.encartSeen'
const SIGNER_KEY = 'forome.signer'
/** clé locale servant à parler au bunker — n'est PAS l'identité */
const BUNKER_CLIENT_SK = 'forome.bunker.clientSk'
const BUNKER_URI_KEY = 'forome.bunker.uri'

/** Nombre de posts avant le nudge de sauvegarde — « après quelques posts, pas au premier ». */
export const NUDGE_AFTER_POSTS = 3

/**
 * Ce qu'on demande au signeur distant, kind par kind.
 *
 * Énumérer plutôt que laisser vide : un signeur qui ne sait pas d'avance ce
 * qu'on va lui demander redemande à chaque signature, et poster devient une
 * file de notifications à valider. Tout kind oublié ici marchera quand même —
 * au prix d'une demande de plus.
 */
const CONNECT_PERMS = [
  'get_public_key',
  'nip44_encrypt',
  'nip44_decrypt',
  ...[0, 1, 3, 11, 13, 1059, 1111, 1984, 10000, 22242, 24242, 30078].map((k) => `sign_event:${k}`),
]

export type SignerMode = 'local' | 'nip07' | 'nip46'

/** Interface minimale d'une extension NIP-07. */
interface Nip07 {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate & { pubkey?: string }): Promise<VerifiedEvent>
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

export const useIdentityStore = defineStore('identity', () => {
  const secretKey = ref<Uint8Array | null>(null)
  const pubkey = ref<string | null>(null)
  const signerMode = ref<SignerMode>('local')
  const postCount = ref(0)
  const keySaved = ref(false)
  const bunkerConnecting = ref(false)
  const bunkerError = ref<string | null>(null)
  /**
   * Pourquoi l'identité affichée n'est pas celle attendue.
   *
   * Distinct de `bunkerError`, qui ne s'affiche que sur la carte d'appairage
   * NIP-46 : ceci se produit au démarrage, sans que l'utilisateur ait rien
   * demandé, et doit donc se lire là où il regarde son identité.
   */
  const signerError = ref<string | null>(null)
  /**
   * Invitation `nostrconnect://` en cours d'affichage, sinon null.
   *
   * Dans le state parce que c'est ce que le QR montre, et que sa disparition
   * *est* le signal que l'appairage a abouti ou a été annulé.
   */
  const connectUri = ref<string | null>(null)
  /** hors du state réactif : objet à connexion vive, pas une donnée */
  let bunker: BunkerSigner | null = null
  let connectAbort: AbortController | null = null
  /**
   * L'encart du premier post a déjà eu sa réponse. Persisté : il pose une
   * question qu'on ne repose pas. En mémoire seule, chaque rechargement de page
   * la reposait à quelqu'un qui avait déjà choisi son pseudo.
   */
  const encartSeen = ref(false)

  const nip07 = computed<Nip07 | null>(() =>
    import.meta.client ? ((window as unknown as { nostr?: Nip07 }).nostr ?? null) : null,
  )
  const hasExtension = computed(() => !!nip07.value)

  /**
   * Pseudo **par défaut** dérivé de la clé — `khey_xxxxxxxx`.
   *
   * ⚠️ Ce n'est PAS le nom à afficher. Il ignore le kind 0, donc l'utiliser dans
   * l'interface montre l'ancien pseudo à quelqu'un qui vient d'en choisir un.
   * C'est exactement le bug qui a été remonté. Pour afficher, utiliser
   * `displayName`.
   */
  const handle = computed(() => (pubkey.value ? kheyHandle(pubkey.value) : ''))

  /**
   * Le nom à afficher : celui du kind 0 s'il en existe un, sinon le défaut.
   * Vit ici plutôt qu'au point d'appel pour que le prochain composant qui
   * affiche l'identité n'ait pas à se souvenir de la distinction.
   */
  const displayName = computed(() => {
    if (!pubkey.value) return ''
    return useProfileStore().displayName(pubkey.value)
  })
  const discriminator = computed(() => (pubkey.value ? keyDiscriminator(pubkey.value) : ''))
  const ready = computed(() => !!pubkey.value)

  /** Le nudge de sauvegarde n'arrive qu'après quelques posts, et jamais si la clé est déjà sauvée. */
  const shouldNudgeBackup = computed(
    () => signerMode.value === 'local' && !keySaved.value && postCount.value >= NUDGE_AFTER_POSTS,
  )

  /**
   * Vrai tant que l'identité générée ici n'a jamais servi : aucun post, clé
   * jamais sauvegardée, pas de signeur externe. La remplacer ne perd rien —
   * c'est ce qui autorise à proposer « J'ai déjà un compte » et à taire les
   * avertissements de remplacement, qui protégeraient du vide.
   */
  const unusedIdentity = computed(
    () => signerMode.value === 'local' && postCount.value === 0 && !keySaved.value,
  )

  /**
   * Attend que l'extension NIP-07 se présente, brièvement.
   *
   * ⚠️ `window.nostr` n'est pas là au premier tour de boucle. Les extensions
   * l'injectent depuis un script de contenu, donc parfois APRÈS le démarrage de
   * l'app. Sans cette attente, une session en mode `nip07` retombait sur la
   * branche « clé locale » et **générait une identité neuve**, persistée aussitôt :
   * l'utilisateur arrivait sous un autre compte, et un rechargement — où
   * l'extension avait eu le temps d'arriver — le ramenait au bon. C'est le
   * scénario « il faut recharger pour que ça s'affiche correctement » dans sa
   * version la plus coûteuse, puisqu'elle change de qui on est.
   */
  async function waitForExtension(timeoutMs = 1200): Promise<Nip07 | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (nip07.value) return nip07.value
      await new Promise((r) => setTimeout(r, 50))
    }
    return nip07.value
  }

  /**
   * Génère la clé si besoin — **sans rien demander** (§3.1). L'utilisateur est
   * déjà `khey_xxxxxxxx` avant d'avoir cliqué quoi que ce soit.
   */
  function init(): void {
    if (!import.meta.client || pubkey.value) return

    postCount.value = Number(localStorage.getItem(POSTS_KEY) ?? 0) || 0
    keySaved.value = localStorage.getItem(SAVED_KEY) === '1'
    encartSeen.value = localStorage.getItem(ENCART_KEY) === '1'
    const storedMode = localStorage.getItem(SIGNER_KEY)

    if (storedMode === 'nip07') {
      // On ne génère PAS de clé locale en attendant : ce serait exactement la
      // seconde identité fantôme que la branche NIP-46 juste en dessous refuse.
      void waitForExtension().then(async (ext) => {
        if (ext && (await useExtension())) return
        // L'extension n'est jamais venue, ou a refusé : on le dit et on repart
        // sur une clé locale, plutôt que de rester sans identité du tout.
        signerError.value = ext
          ? 'ton extension Nostr a refusé de donner ta clé publique — tu es sur la clé de cet appareil'
          : 'ton extension Nostr n’a pas répondu — tu es sur la clé de cet appareil'
        localStorage.removeItem(SIGNER_KEY)
        signerMode.value = 'local'
        init()
      })
      return
    }
    if (storedMode === 'nip46') {
      // Reconnexion au bunker. On ne génère PAS de clé locale en attendant :
      // ce serait créer une seconde identité fantôme le temps du round-trip.
      void restoreBunker().then((ok) => {
        if (!ok) {
          bunkerError.value = 'reconnexion au signeur distant impossible'
          localStorage.removeItem(SIGNER_KEY)
          signerMode.value = 'local'
          init()
        }
      })
      return
    }

    const stored = localStorage.getItem(SK_KEY)
    if (stored && /^[0-9a-f]{64}$/.test(stored)) {
      secretKey.value = unhex(stored)
    } else {
      secretKey.value = generateSecretKey()
      localStorage.setItem(SK_KEY, hex(secretKey.value))
      // clé neuve = rien à perdre : ni encart, ni nudge, ni compteur
      postCount.value = 0
      keySaved.value = false
      encartSeen.value = false
      localStorage.setItem(POSTS_KEY, '0')
      localStorage.removeItem(SAVED_KEY)
      localStorage.removeItem(ENCART_KEY)
    }
    pubkey.value = getPublicKey(secretKey.value)
    signerMode.value = 'local'
  }

  /**
   * Échappatoire desktop (§3.2) : la clé reste dans l'extension, l'app ne la
   * voit jamais. C'est déjà un demi-pas vers NIP-46.
   */
  async function useExtension(): Promise<boolean> {
    const ext = nip07.value
    if (!ext) return false
    try {
      const pk = await ext.getPublicKey()
      pubkey.value = pk
      secretKey.value = null
      signerMode.value = 'nip07'
      signerError.value = null
      localStorage.setItem(SIGNER_KEY, 'nip07')
      return true
    } catch {
      signerError.value = 'ton extension Nostr a refusé de donner ta clé publique'
      return false
    }
  }

  function useLocalKey(): void {
    void disconnectBunker()
    signerError.value = null
    localStorage.removeItem(SIGNER_KEY)
    pubkey.value = null
    signerMode.value = 'local'
    init()
  }

  /* --------------------------------------------------- NIP-46 (bunker) */

  /**
   * Signeur distant NIP-46 (spec §3.2).
   *
   * **C'est la seule brique qui répond à la perte d'appareil.** Sans elle,
   * Nostr n'offre ni délégation ni révocation : un appareil perdu, c'est une clé
   * potentiellement compromise et une identité à abandonner. Avec un bunker, la
   * clé vit dans un seul endroit et ce client ne détient qu'une **autorisation**,
   * que le bunker peut retirer : la clé d'un côté, une autorisation révocable de
   * l'autre.
   *
   * Ce qui voyage et ce qui ne voyage pas : `bunkerClientSecret()` rend une clé
   * locale qui ne sert **qu'à parler au bunker**. Elle n'est pas l'identité, et
   * la compromettre ne donne pas la clé de l'utilisateur — seulement une
   * autorisation révocable.
   */
  async function connectBunker(input: string): Promise<{ ok: true; pubkey: string } | { ok: false; error: string }> {
    if (!import.meta.client) return { ok: false, error: 'client uniquement' }
    const trimmed = input.trim()
    if (!trimmed) return { ok: false, error: 'aucune URI' }
    // Deux chemins vers le même signeur : celui qu'on abandonne se referme, pour
    // ne pas laisser un abonnement relais tourner derrière.
    cancelNostrConnect()

    const { BunkerSigner, parseBunkerInput } = await import('nostr-tools/nip46')
    let pointer: BunkerPointer | null
    try {
      pointer = await parseBunkerInput(trimmed)
    } catch {
      pointer = null
    }
    if (!pointer) {
      return { ok: false, error: 'URI non reconnue — attendu bunker://… ou un identifiant NIP-05' }
    }

    bunkerConnecting.value = true
    bunkerError.value = null
    try {
      const signer = BunkerSigner.fromBunker(bunkerClientSecret(), pointer)
      await signer.connect()
      return { ok: true, pubkey: await adoptBunker(signer, trimmed) }
    } catch (err) {
      bunkerError.value = err instanceof Error ? err.message : String(err)
      return { ok: false, error: bunkerError.value }
    } finally {
      bunkerConnecting.value = false
    }
  }

  /**
   * Clé locale de dialogue avec le signeur, persistée.
   *
   * Sans persistance, chaque rechargement créerait une nouvelle identité de
   * client que le signeur devrait réautoriser à la main. Ce n'est PAS
   * l'identité : la compromettre ne donne pas la clé de l'utilisateur,
   * seulement une autorisation révocable.
   */
  function bunkerClientSecret(): Uint8Array {
    const stored = localStorage.getItem(BUNKER_CLIENT_SK)
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return unhex(stored)
    const fresh = generateSecretKey()
    localStorage.setItem(BUNKER_CLIENT_SK, hex(fresh))
    return fresh
  }

  /**
   * Passage effectif sous signeur distant — commun aux deux sens d'appairage.
   *
   * L'URI mémorisée est toujours une `bunker://` : c'est la seule forme que
   * `restoreBunker()` sait rejouer au démarrage. Une `nostrconnect://`, elle,
   * ne vaut que pour l'appairage qui vient de se produire.
   */
  async function adoptBunker(signer: BunkerSigner, bunkerUri: string): Promise<string> {
    const remotePubkey = await signer.getPublicKey()
    if (!/^[0-9a-f]{64}$/.test(remotePubkey)) {
      throw new Error('le signeur a renvoyé une clé publique invalide')
    }
    bunker = signer
    pubkey.value = remotePubkey
    secretKey.value = null
    signerMode.value = 'nip46'
    localStorage.setItem(SIGNER_KEY, 'nip46')
    localStorage.setItem(BUNKER_URI_KEY, bunkerUri)
    // Une identité pilotée par signeur n'a rien à sauvegarder ici : la clé
    // n'est pas sur cet appareil.
    keySaved.value = true
    markEncartSeen()
    return remotePubkey
  }

  /**
   * Appairage inversé (`nostrconnect://`) : même résultat que `connectBunker`,
   * geste inverse.
   *
   * C'est **nous** qui publions l'invitation, et l'app signeur qui vient la
   * chercher. Deux conséquences, et ce sont les seules raisons de préférer ce
   * chemin : il n'y a plus rien à recopier, et ce QR-ci **ne contient aucun
   * secret durable** — une clé publique de client et un jeton à usage unique,
   * inutiles à qui les photographie sans détenir la clé. À l'inverse du QR de
   * la `nsec`, le montrer n'est pas irréversible.
   */
  async function startNostrConnect(): Promise<{ ok: true; pubkey: string } | { ok: false; error: string }> {
    if (!import.meta.client) return { ok: false, error: 'client uniquement' }
    if (connectUri.value) return { ok: false, error: 'appairage déjà en cours' }

    // Les cibles d'écriture, pas de nouveaux relais : en développement elles se
    // réduisent au relais local, et l'appairage ne sort pas de la machine comme
    // le reste (`utils/relayTargets.ts`). Trois suffisent — le signeur imposera
    // ensuite les siens (`switchRelays`).
    const relays = useRelayStore().writeRelays().slice(0, 3)
    if (relays.length === 0) return { ok: false, error: 'aucun relais pour l’appairage' }

    const { BunkerSigner, createNostrConnectURI, toBunkerURL } = await import('nostr-tools/nip46')
    const clientSk = bunkerClientSecret()
    // Jeton à usage unique : le signeur doit le renvoyer tel quel. C'est ce qui
    // prouve que l'autorisation vient de qui a lu CE QR, et pas d'un tiers qui
    // aurait répondu à sa place.
    const secret = hex(generateSecretKey()).slice(0, 32)
    const uri = createNostrConnectURI({
      clientPubkey: getPublicKey(clientSk),
      relays,
      secret,
      perms: CONNECT_PERMS,
      name: 'Forome',
      url: window.location.origin,
    })

    // L'attente n'est pas `bunkerConnecting` : elle peut durer le temps
    // d'installer une app, et ce qui la dit à l'écran c'est le QR lui-même.
    // Marquer « connexion en cours » désactiverait le champ `bunker://` — le
    // repli qu'on veut justement laisser ouvert.
    const abort = new AbortController()
    connectAbort = abort
    connectUri.value = uri
    bunkerError.value = null
    try {
      const signer = await BunkerSigner.fromURI(clientSk, uri, {}, abort.signal)
      // L'URI mémorisée **perd le jeton** : il était à usage unique, et le
      // rejouer au prochain démarrage ferait refuser la reconnexion par un
      // signeur qui le vérifie. Ce qui autorise, ensuite, c'est la clé cliente.
      const bunkerUri = toBunkerURL({ ...signer.bp, secret: null })
      return { ok: true, pubkey: await adoptBunker(signer, bunkerUri) }
    } catch (err) {
      // Une annulation n'est pas une panne : elle ne laisse pas de message
      // d'erreur derrière elle.
      if (abort.signal.aborted) return { ok: false, error: 'appairage annulé' }
      bunkerError.value = err instanceof Error ? err.message : String(err)
      return { ok: false, error: bunkerError.value }
    } finally {
      connectUri.value = null
      connectAbort = null
    }
  }

  /** Referme l'invitation en cours — sinon l'abonnement reste ouvert. */
  function cancelNostrConnect(): void {
    connectAbort?.abort()
  }

  /** Reconnexion silencieuse au démarrage, si une session bunker existait. */
  async function restoreBunker(): Promise<boolean> {
    if (!import.meta.client) return false
    const uri = localStorage.getItem(BUNKER_URI_KEY)
    if (!uri) return false
    const res = await connectBunker(uri)
    return res.ok
  }

  async function disconnectBunker(): Promise<void> {
    const signer = bunker
    bunker = null
    if (!import.meta.client) return
    localStorage.removeItem(BUNKER_URI_KEY)
    if (signer) {
      try {
        // `logout` prévient le bunker : il peut retirer l'autorisation de sa
        // liste plutôt que de la garder ouverte indéfiniment.
        await signer.logout()
      } catch {
        // bunker injoignable : on abandonne la session localement quand même
      }
    }
  }

  /**
   * « ↻ new khey » (§3.6) — identité jetable en un clic.
   *
   * Action **secondaire et délibérée**, pas un mode : le défaut reste une
   * identité persistante. Si le jetable devient le défaut à l'usage, c'est un
   * signal d'échec produit, pas une victoire de l'anonymat.
   */
  function newKhey(): void {
    if (!import.meta.client) return
    void disconnectBunker()
    // Une identité jetée emporte ses masques (§3.7) : garder les clés anonymes
    // laisserait, dans le seul endroit qui le détenait, le lien entre l'identité
    // qu'on abandonne et les messages qu'on avait détachés d'elle.
    useAnonStore().wipe()
    localStorage.removeItem(SK_KEY)
    localStorage.removeItem(SIGNER_KEY)
    localStorage.removeItem(BUNKER_CLIENT_SK)
    localStorage.setItem(POSTS_KEY, '0')
    localStorage.removeItem(SAVED_KEY)
    localStorage.removeItem(ENCART_KEY)
    secretKey.value = null
    pubkey.value = null
    signerMode.value = 'local'
    postCount.value = 0
    keySaved.value = false
    encartSeen.value = false
    init()
  }

  /** Signe un event déjà miné (le nonce fait partie de l'id, donc du signé). */
  async function sign(unsigned: EventTemplate & { pubkey?: string; tags: string[][] }): Promise<VerifiedEvent> {
    if (signerMode.value === 'nip46') {
      if (!bunker) throw new Error('signeur distant non connecté')
      // ⚠️ Le gabarit part tel quel : le bunker ne doit RIEN réécrire. Un bunker
      // qui « rafraîchit » `created_at` détruit la PoW minée ici, et l'event se
      // fait refuser par la policy du relais. Piège d'interopérabilité réel,
      // documenté dans `scripts/dev-bunker.ts`.
      return bunker.signEvent({
        kind: unsigned.kind,
        created_at: unsigned.created_at,
        tags: unsigned.tags,
        content: unsigned.content,
      })
    }
    if (signerMode.value === 'nip07') {
      const ext = nip07.value
      if (!ext) throw new Error('extension NIP-07 indisponible')
      return ext.signEvent(unsigned)
    }
    if (!secretKey.value) throw new Error('aucune clé locale')
    return finalizeEvent(unsigned, secretKey.value)
  }

  function notePost(): void {
    postCount.value++
    if (import.meta.client) localStorage.setItem(POSTS_KEY, String(postCount.value))
  }

  function markEncartSeen(): void {
    encartSeen.value = true
    if (import.meta.client) localStorage.setItem(ENCART_KEY, '1')
  }

  function markKeySaved(): void {
    keySaved.value = true
    if (import.meta.client) localStorage.setItem(SAVED_KEY, '1')
  }

  /**
   * Accès brut à la clé privée — **uniquement** pour les MP NIP-17, qui exigent
   * la clé pour dériver le secret de conversation (ECDH) et pour sceller.
   *
   * Renvoie null en mode NIP-07 : la clé est dans l'extension, l'app ne la voit
   * pas. C'est l'intérêt du mode, et la conséquence est que les MP ne
   * fonctionnent pas avec une extension à cette étape — il faudrait passer par
   * `nip44Encrypt`/`nip44Decrypt` de NIP-07, optionnels et inégalement
   * implémentés. Limitation à afficher, pas à contourner.
   */
  function secretKeyForDm(): Uint8Array | null {
    return signerMode.value === 'local' ? secretKey.value : null
  }

  /**
   * Export de la clé. La `nsec` est un **secret au porteur** : qui l'a EST
   * l'utilisateur, pour toujours (§3.3). L'appelant doit le dire à l'écran.
   */
  function exportNsec(): string | null {
    if (!secretKey.value) return null
    try {
      return nsecEncode(secretKey.value)
    } catch {
      return null
    }
  }

  /**
   * Import d'une clé (spec §3.3) — la moitié « appareil neuf » du QR.
   *
   * C'est bien la **clé elle-même** qui voyage, pas une autorisation : il n'y a
   * ni délégation ni révocation sur Nostr (§3.2). Donc importer une clé sur un
   * appareil, c'est en faire une copie permanente et non révocable.
   *
   * Accepte une `nsec…` (NIP-19) ou 64 caractères hex. Ne remplace l'identité
   * courante que si la clé est valide — sinon l'utilisateur perdrait la sienne
   * sur une faute de frappe.
   */
  function importKey(input: string): { ok: true; pubkey: string } | { ok: false; error: string } {
    const res = decodeSecretInput(input)
    if (!res.ok) return res

    secretKey.value = res.secret
    pubkey.value = res.pubkey
    signerMode.value = 'local'
    if (import.meta.client) {
      localStorage.setItem(SK_KEY, hex(res.secret))
      localStorage.removeItem(SIGNER_KEY)
      // Une clé importée est par définition déjà sauvegardée ailleurs : ne pas
      // renudger. Le compteur de posts, lui, repart de ce qu'on sait sur CET
      // appareil — on n'a aucun moyen de connaître l'historique réel.
      localStorage.setItem(SAVED_KEY, '1')
    }
    keySaved.value = true
    markEncartSeen()
    return { ok: true, pubkey: res.pubkey }
  }

  return {
    pubkey,
    handle,
    displayName,
    discriminator,
    ready,
    signerMode,
    hasExtension,
    postCount,
    keySaved,
    encartSeen,
    shouldNudgeBackup,
    unusedIdentity,
    bunkerConnecting,
    bunkerError,
    signerError,
    connectUri,
    init,
    useExtension,
    useLocalKey,
    connectBunker,
    startNostrConnect,
    cancelNostrConnect,
    disconnectBunker,
    newKhey,
    sign,
    notePost,
    markEncartSeen,
    markKeySaved,
    exportNsec,
    importKey,
    secretKeyForDm,
  }
})
