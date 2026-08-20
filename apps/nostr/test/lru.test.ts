/**
 * Ces caches sont bornés parce que leurs clés viennent de l'extérieur : un id de
 * sticker arrive dans une URL. Un cache non borné alimenté par un inconnu est une
 * fuite de mémoire à déclenchement distant — c'est cette propriété qu'on teste
 * ici, pas la vitesse.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Lru, ByteCache, TtlCache } from '../server/utils/lru'

describe('Lru', () => {
  it('rend ce qu’on lui a donné', () => {
    const lru = new Lru<string, number>(3)
    lru.set('a', 1)
    expect(lru.get('a')).toBe(1)
    expect(lru.get('absent')).toBeNull()
  })

  it('évince le plus ancien au-delà de la capacité', () => {
    const lru = new Lru<string, number>(2)
    lru.set('a', 1)
    lru.set('b', 2)
    lru.set('c', 3)
    expect(lru.get('a')).toBeNull()
    expect(lru.get('b')).toBe(2)
    expect(lru.get('c')).toBe(3)
    expect(lru.size).toBe(2)
  })

  it('une lecture protège de l’éviction', () => {
    const lru = new Lru<string, number>(2)
    lru.set('a', 1)
    lru.set('b', 2)
    lru.get('a')
    lru.set('c', 3)
    expect(lru.get('a')).toBe(1)
    expect(lru.get('b')).toBeNull()
  })

  /* Sans le `delete` avant le `set`, réécrire une clé la laisserait à sa place
     d'origine et elle partirait avant des entrées plus vieilles qu'elle. */
  it('une réécriture repousse aussi l’éviction', () => {
    const lru = new Lru<string, number>(2)
    lru.set('a', 1)
    lru.set('b', 2)
    lru.set('a', 9)
    lru.set('c', 3)
    expect(lru.get('a')).toBe(9)
    expect(lru.get('b')).toBeNull()
  })

  it('ne dépasse jamais sa capacité', () => {
    const lru = new Lru<number, number>(10)
    for (let i = 0; i < 1000; i++) lru.set(i, i)
    expect(lru.size).toBe(10)
  })

  it('refuse une capacité absurde', () => {
    expect(() => new Lru(0)).toThrow()
  })
})

describe('ByteCache', () => {
  const chunk = (n: number): Uint8Array => new Uint8Array(n)

  it('borne par le poids, pas par le nombre d’entrées', () => {
    const cache = new ByteCache<string>(100)
    cache.set('a', chunk(60))
    cache.set('b', chunk(60))
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).not.toBeNull()
    expect(cache.used).toBe(60)
  })

  it('garde beaucoup de petites entrées', () => {
    const cache = new ByteCache<number>(1000)
    for (let i = 0; i < 10; i++) cache.set(i, chunk(50))
    expect(cache.used).toBe(500)
    expect(cache.get(0)).not.toBeNull()
  })

  /* Une entrée plus grosse que le budget viderait tout le cache pour elle seule :
     ne pas la garder est moins coûteux que la garder. */
  it('ignore une entrée plus grosse que le budget', () => {
    const cache = new ByteCache<string>(100)
    cache.set('petit', chunk(40))
    cache.set('énorme', chunk(500))
    expect(cache.get('énorme')).toBeNull()
    expect(cache.get('petit')).not.toBeNull()
    expect(cache.used).toBe(40)
  })

  it('remplacer une clé ne compte pas deux fois', () => {
    const cache = new ByteCache<string>(1000)
    cache.set('a', chunk(100))
    cache.set('a', chunk(30))
    expect(cache.used).toBe(30)
  })

  it('n’évince jamais l’entrée qu’on vient d’insérer', () => {
    const cache = new ByteCache<string>(100)
    cache.set('a', chunk(90))
    cache.set('b', chunk(90))
    expect(cache.get('b')).not.toBeNull()
    expect(cache.used).toBe(90)
  })
})

describe('TtlCache', () => {
  afterEach(() => void vi.useRealTimers())

  it('sert tant que c’est frais', () => {
    const cache = new TtlCache<string>(4, 1000)
    cache.set('k', 'v')
    expect(cache.get('k')).toBe('v')
  })

  /* Sans péremption, « les populaires du moment » resteraient figés jusqu'au
     prochain redémarrage. */
  it('ne sert plus après le délai', () => {
    vi.useFakeTimers()
    const cache = new TtlCache<string>(4, 1000)
    cache.set('k', 'v')
    vi.advanceTimersByTime(1001)
    expect(cache.get('k')).toBeNull()
  })

  it('reste borné en nombre d’entrées', () => {
    const cache = new TtlCache<number>(2, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeNull()
    expect(cache.get('c')).toBe(3)
  })
})
