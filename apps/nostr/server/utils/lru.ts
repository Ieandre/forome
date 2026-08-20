/**
 * Cache borné à capacité fixe, éviction du plus anciennement utilisé.
 *
 * Le point n'est pas la vitesse mais la **borne** : tous les caches de ce
 * serveur sont alimentés par des identifiants venus de l'extérieur (un id de
 * sticker dans une URL). Un `Map` nu grandirait alors aussi vite qu'on lui
 * envoie d'ids différents, ce qui fait d'un cache une fuite de mémoire à
 * déclenchement distant.
 *
 * `Map` conserve l'ordre d'insertion : re-poser une clé lue suffit à la faire
 * passer en queue, donc l'éviction se lit en une ligne.
 */
export class Lru<K, V> {
  readonly #max: number
  readonly #entries = new Map<K, V>()

  constructor(max: number) {
    if (max < 1) throw new Error('capacité invalide')
    this.#max = max
  }

  get size(): number {
    return this.#entries.size
  }

  get(key: K): V | null {
    if (!this.#entries.has(key)) return null
    const value = this.#entries.get(key) as V
    this.#entries.delete(key)
    this.#entries.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    // Supprimer d'abord : sans ça, réécrire une clé existante la laisserait à sa
    // place d'origine et elle serait évincée avant des entrées plus vieilles.
    this.#entries.delete(key)
    this.#entries.set(key, value)
    if (this.#entries.size > this.#max) {
      const oldest = this.#entries.keys().next()
      if (!oldest.done) this.#entries.delete(oldest.value)
    }
  }

  has(key: K): boolean {
    return this.#entries.has(key)
  }
}

/**
 * Cache d'octets borné par un **budget en octets**, pas par un nombre d'entrées.
 *
 * Compter les entrées ne marche pas ici : un sticker PNG pèse ~17 ko et un GIF
 * animé jusqu'à 1 Mo (mesuré le 2026-08-13). À nombre d'entrées fixe, une page
 * de GIF occuperait soixante fois une page de PNG, et le plafond ne voudrait
 * plus rien dire.
 */
export class ByteCache<K> {
  readonly #max: number
  readonly #entries = new Map<K, Uint8Array>()
  #used = 0

  constructor(maxBytes: number) {
    this.#max = maxBytes
  }

  get used(): number {
    return this.#used
  }

  get(key: K): Uint8Array | null {
    const hit = this.#entries.get(key)
    if (!hit) return null
    this.#entries.delete(key)
    this.#entries.set(key, hit)
    return hit
  }

  set(key: K, bytes: Uint8Array): void {
    // Plus gros que le budget entier : le garder viderait tout le cache pour une
    // seule entrée, ce qui est pire que ne pas la garder.
    if (bytes.byteLength > this.#max) return

    const previous = this.#entries.get(key)
    if (previous) this.#used -= previous.byteLength
    this.#entries.delete(key)

    this.#entries.set(key, bytes)
    this.#used += bytes.byteLength

    for (const [k, v] of this.#entries) {
      if (this.#used <= this.#max) break
      if (k === key) continue
      this.#entries.delete(k)
      this.#used -= v.byteLength
    }
  }
}

/** Entrée de cache qui se périme. */
interface Expiring<V> {
  value: V
  /** Époque en ms au-delà de laquelle l'entrée n'est plus servie. */
  until: number
}

/**
 * Cache borné **et** périssable, pour les réponses d'une API tierce.
 *
 * La péremption est indispensable ici : « les populaires du moment » sont censés
 * bouger. Un cache sans TTL figerait la page d'accueil du tiroir jusqu'au
 * prochain redémarrage.
 */
export class TtlCache<V> {
  readonly #lru: Lru<string, Expiring<V>>
  readonly #ttlMs: number

  constructor(max: number, ttlMs: number) {
    this.#lru = new Lru(max)
    this.#ttlMs = ttlMs
  }

  get(key: string): V | null {
    const hit = this.#lru.get(key)
    if (!hit) return null
    if (hit.until <= Date.now()) return null
    return hit.value
  }

  set(key: string, value: V): void {
    this.#lru.set(key, { value, until: Date.now() + this.#ttlMs })
  }
}
