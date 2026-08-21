/**
 * Pilotage du mineur de PoW (spec §12.1).
 *
 * ## Le point que la spec passait sous silence
 *
 * « La PoW se mine pendant que tu tapes » n'est **pas littéralement possible** :
 * la difficulté porte sur l'id de l'event, qui contient `content` et
 * `created_at`. Chaque frappe invalide tout le travail déjà fait.
 *
 * Ce qui est possible, et ce qui est fait ici : **miner spéculativement sur le
 * brouillon dès que la frappe s'arrête** (~150 ms). Les gens marquent une pause
 * avant d'appuyer sur Entrée, donc dans le cas courant le travail est déjà fait
 * au moment de l'envoi et la PoW est invisible. Sinon on mine à l'envoi, ce qui
 * coûte quelques centaines de millisecondes.
 *
 * Conséquence assumée : le minage spéculatif **fige `created_at`** au moment du
 * minage. Un envoi 3 s plus tard porte donc un horodatage de 3 s plus vieux.
 * C'est sans conséquence (l'auteur déclare son heure de toute façon, §2.4), mais
 * au-delà de `MAX_SPECULATION_AGE_S` on rejette et on remine — un horodatage
 * franchement périmé se ferait refuser par la fenêtre de tolérance d'un relais.
 *
 * Rien de tout ça n'est un chemin critique côté écran : le fil affiche la
 * réponse **au clic**, avant le minage (voir `provisionalId` et `run()` dans
 * `usePublisher`). La spéculation ne sert donc plus à masquer une attente, mais
 * à raccourcir le temps pendant lequel la rangée affichée n'a pas encore d'id.
 */
import { ref, watch } from 'vue'
import type { UnsignedEvent } from 'nostr-tools/pure'

/**
 * Cible de temps de minage — **une moyenne, pas un plafond.**
 *
 * Le nombre d'essais suit une loi géométrique : la variance est énorme, et
 * dépasser deux ou trois fois la moyenne est banal. Une cible à 400 ms produisait
 * donc régulièrement des attentes de 1 à 2 s au moment le plus sensible de
 * l'interaction — juste après l'appui sur Entrée. À 120 ms de moyenne, la queue
 * de distribution reste sous le seuil de perception.
 *
 * Ça coûte un bit ou deux de difficulté, donc un peu de confort pour un
 * spammeur. C'est le bon échange : la PoW n'a jamais été la barrière principale
 * (spec §12.1 le dit — elle relève le plancher, elle n'arrête personne de
 * motivé), alors que la lenteur au premier post, elle, coûte des utilisateurs.
 */
const TARGET_MS = 120
const MIN_DIFFICULTY = 10
const MAX_DIFFICULTY = 20
const FALLBACK_DIFFICULTY = 14
/**
 * Debounce du minage spéculatif. Court : les gens marquent une pause très brève
 * avant Entrée, et rater la spéculation fait payer le minage à l'envoi.
 */
const DEBOUNCE_MS = 150
/**
 * Fraîcheur au-delà de laquelle un travail spéculatif est jeté et le brouillon
 * reminé.
 *
 * Ce n'est pas la tolérance des relais qui fixe la valeur (elle est bien plus
 * large) mais **l'ordre du fil** : `created_at` figé veut dire message antidaté,
 * et un message antidaté se range avant des messages écrits avant lui au premier
 * rechargement. Reminer coûte ~120 ms une fois ; se voir remonter au milieu d'un
 * fil est définitif. 30 s couvre largement « je tape, je relis, j'envoie ».
 */
const MAX_SPECULATION_AGE_S = 30

export interface MinedEvent extends UnsignedEvent {
  id: string
}

interface Speculation {
  sig: string
  /** en vol tant que le worker n'a pas rendu — `mineFor` s'y raccroche */
  event: Promise<MinedEvent>
  at: number
}

/**
 * Signature de tout ce qui influence l'id **sauf** le nonce et `created_at`.
 * Deux brouillons de même signature partagent le même travail de minage.
 *
 * ⚠️ `created_at` en est exclu **volontairement**, et c'est ce qui fait vivre
 * tout le minage spéculatif : il change à chaque seconde, alors que le brouillon
 * spéculé et le brouillon envoyé sont construits à deux instants différents. Le
 * garder ici faisait rater la spéculation dès que l'envoi tombait dans une autre
 * seconde que la frappe — donc la plupart du temps, en silence, et le minage
 * était systématiquement repayé à l'appui sur « Poster ».
 *
 * La contrepartie est l'horodatage figé décrit en tête de fichier ; c'est
 * `MAX_SPECULATION_AGE_S` qui la borne.
 */
function draftSignature(u: UnsignedEvent): string {
  const tags = u.tags.filter((t) => t[0] !== 'nonce')
  return JSON.stringify([u.pubkey, u.kind, tags, u.content])
}

/**
 * **Singleton de module**, délibérément — un seul worker et une seule
 * calibration pour toute l'app.
 *
 * La première version créait une instance par composant. Conséquences vues à
 * l'écran : deux workers, deux calibrations, et surtout un indicateur qui
 * affichait « PoW off » dans le composeur alors que le minage fonctionnait
 * (`available` restait faux jusqu'au premier minage de CETTE instance). Un
 * indicateur qui ment sur l'état de la PoW est pire que pas d'indicateur.
 */
/**
 * Plancher de difficulté, appris des refus de relais.
 *
 * Un client ne peut pas deviner l'exigence d'un relais : NIP-11 permet de
 * l'annoncer, mais tous ne le font pas. Plutôt que de coder en dur une valeur
 * qui finira par diverger de la policy — ce qui est arrivé : le client a miné
 * 15 bits pendant que le relais en exigeait 16, et **tous les messages étaient
 * refusés en silence** — on relève le plancher au premier refus et on renvoie.
 */
const powFloor = ref(14)
const difficulty = ref(FALLBACK_DIFFICULTY)
const hashRate = ref<number | null>(null)
const mining = ref(false)
const lastMs = ref<number | null>(null)
const available = ref(false)

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (e: MinedEvent) => void; reject: (err: Error) => void }>()
let speculation: Speculation | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let warmupScheduled = false

export function usePowMiner() {

  function ensureWorker(): Worker | null {
    if (worker) return worker
    if (!import.meta.client || typeof Worker === 'undefined') return null
    try {
      worker = new Worker(new URL('../workers/pow.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg.type === 'calibrated') {
          hashRate.value = msg.hashRate
          // d tel que 2^d / rate ≈ TARGET_MS, jamais sous le plancher exigé
          const d = Math.floor(Math.log2((msg.hashRate * TARGET_MS) / 1000))
          difficulty.value = Math.max(
            powFloor.value,
            MIN_DIFFICULTY,
            Math.min(MAX_DIFFICULTY, d),
          )
          return
        }
        if (msg.type === 'mined') {
          lastMs.value = msg.ms
          pending.get(msg.id)?.resolve(msg.event)
          pending.delete(msg.id)
          if (pending.size === 0) mining.value = false
          return
        }
        if (msg.type === 'error') {
          pending.get(msg.id)?.reject(new Error(msg.message))
          pending.delete(msg.id)
          if (pending.size === 0) mining.value = false
        }
      }
      worker.onerror = () => {
        for (const [, p] of pending) p.reject(new Error('worker de minage en échec'))
        pending.clear()
        mining.value = false
        available.value = false
      }
      available.value = true
      worker.postMessage({ type: 'calibrate' })
      return worker
    } catch {
      available.value = false
      return null
    }
  }

  function mineNow(
    unsigned: UnsignedEvent,
    d = difficulty.value,
    mode: 'mine' | 'mineFixed' = 'mine',
  ): Promise<MinedEvent> {
    const w = ensureWorker()
    if (!w) {
      // Pas de worker (navigateur exotique, CSP) : on publie sans PoW plutôt que
      // de bloquer l'utilisateur. Un relais qui l'exige refusera — et c'est son
      // rôle, pas celui du client.
      return Promise.resolve({ ...unsigned, id: '' })
    }
    const id = nextId++
    mining.value = true
    return new Promise<MinedEvent>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      w.postMessage({ type: mode, id, unsigned, difficulty: d })
    })
  }

  /**
   * Minage à `created_at` figé — pour les emballages de MP, que NIP-59 antidate
   * volontairement. Voir le commentaire de `mineFixedCreatedAt` dans le worker.
   */
  function mineFixed(unsigned: UnsignedEvent, d = difficulty.value): Promise<MinedEvent> {
    return mineNow(unsigned, d, 'mineFixed')
  }

  /**
   * Minage spéculatif sur le brouillon courant, debouncé.
   *
   * La spéculation est enregistrée **dès le lancement**, pas à la résolution :
   * l'envoi tombe souvent pendant que le worker tourne encore, et n'enregistrer
   * qu'à la fin y lançait un second minage concurrent du premier — l'utilisateur
   * attendait alors le plus lent des deux, exactement dans le cas où la
   * spéculation était censée l'aider.
   */
  function speculate(build: () => UnsignedEvent | null): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      const unsigned = build()
      if (!unsigned || !unsigned.content.trim()) return
      const sig = draftSignature(unsigned)
      // Même brouillon ET travail encore frais : rien à refaire. La fraîcheur est
      // testée ici aussi, sinon un brouillon revenu à son texte d'il y a une
      // minute (une frappe puis un effacement) garderait une spéculation que
      // `mineFor` jettera pour son âge, sans jamais la remplacer.
      if (speculation?.sig === sig && Date.now() / 1000 - speculation.at < MAX_SPECULATION_AGE_S) return
      const event = mineNow(unsigned)
      const spec: Speculation = { sig, event, at: Date.now() / 1000 }
      speculation = spec
      event.catch(() => {
        if (speculation === spec) speculation = null
      })
    }, DEBOUNCE_MS)
  }

  /**
   * Récupère le travail spéculatif s'il correspond exactement au brouillon
   * envoyé et qu'il n'est pas périmé ; sinon mine maintenant.
   *
   * ⚠️ Le nonce miné l'a été sur le `created_at` de la spéculation, pas sur
   * celui du brouillon reçu ici : c'est l'event spéculé qui part, tel quel.
   * Recopier l'horodatage de l'appelant par-dessus invaliderait la PoW.
   */
  async function mineFor(unsigned: UnsignedEvent): Promise<MinedEvent> {
    const sig = draftSignature(unsigned)
    const spec = speculation
    speculation = null
    if (spec && spec.sig === sig && Date.now() / 1000 - spec.at < MAX_SPECULATION_AGE_S) {
      // Un échec du worker sur le travail spéculatif ne doit pas faire échouer
      // la publication : on remine.
      return spec.event.catch(() => mineNow(unsigned))
    }
    return mineNow(unsigned)
  }

  function reset(): void {
    speculation = null
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = null
  }

  /**
   * Relève le plancher à partir d'un refus de relais.
   *
   * Format visé : `pow: 15 bits < 16 requis`. Renvoie true si le plancher a
   * bougé — l'appelant peut alors renvoyer l'event avec la bonne difficulté.
   */
  function raiseFloorFromRejection(reason: string): boolean {
    const m = /pow:\s*\d+\s*bits?\s*<\s*(\d+)/i.exec(reason)
    if (!m) return false
    const required = Number(m[1])
    if (!Number.isFinite(required) || required <= powFloor.value) return false
    powFloor.value = Math.min(required, MAX_DIFFICULTY + 6)
    difficulty.value = Math.max(difficulty.value, powFloor.value)
    speculation = null // le travail spéculatif est sous-dimensionné, il est périmé
    return true
  }

  // Création et calibration **au premier moment d'inactivité**, pas à la
  // première publication ni au boot. L'exigence reste la même — calibré avant
  // le premier post, `available` sincère quand l'indicateur s'affiche — mais ce
  // composable est instancié par le layout, donc AVANT le premier rendu : la
  // calibration (~200 000 sha256) concurrençait le premier paint et l'ouverture
  // des sockets. Écrire demande d'abord de voir l'écran ; l'idle arrive bien
  // avant le premier brouillon, et `mineNow` crée le worker lui-même si on
  // publie plus vite que lui.
  if (import.meta.client && !warmupScheduled) {
    warmupScheduled = true
    const warmup = (): void => void ensureWorker()
    if ('requestIdleCallback' in window) requestIdleCallback(warmup, { timeout: 3000 })
    else setTimeout(warmup, 1500)
  }

  /**
   * Le plancher suit la difficulté **annoncée** par les relais (NIP-11), quand
   * ils l'annoncent. C'est la version proactive de `raiseFloorFromRejection` :
   * miner juste ce qu'il faut du premier coup plutôt que de se faire refuser,
   * apprendre, et reminer. Le refus reste le filet pour les relais muets.
   */
  const relayStore = useRelayStore()
  watch(
    () => relayStore.declaredMinPow,
    (declared) => {
      if (declared > powFloor.value) {
        powFloor.value = declared
        difficulty.value = Math.max(difficulty.value, declared)
      }
    },
    { immediate: true },
  )

  return {
    difficulty,
    powFloor,
    hashRate,
    mining,
    lastMs,
    available,
    ensureWorker,
    speculate,
    mineFor,
    mineFixed,
    reset,
    raiseFloorFromRejection,
  }
}
