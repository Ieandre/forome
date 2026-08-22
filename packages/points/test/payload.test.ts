import { describe, expect, it } from 'vitest'
import { decodeShard, encodeShard, pointsShardTags, shardOf, splitIntoShards } from '../src/payload.js'
import type { PointsEntry } from '../src/payload.js'

const key = (c: string, n: number): string => `${c}${n.toString(16).padStart(63, '0')}`
const entry = (pubkey: string, points: number): PointsEntry => ({
  pubkey,
  points,
  topics: 1,
  replies: 2,
  activeDays: 3,
  lastDay: 20_000,
})

describe('format sur le fil', () => {
  it('annonce seize morceaux, et y range chaque clé de façon stable', () => {
    expect(pointsShardTags()).toHaveLength(16)
    expect(shardOf(key('a', 1))).toBe('forome.points.a')
    expect(shardOf(key('a', 2))).toBe('forome.points.a')
    expect(shardOf('PAS UNE CLÉ')).toBeNull()
  })

  it('range les plus hauts scores en tête de leur morceau', () => {
    const shards = splitIntoShards([entry(key('a', 1), 10), entry(key('b', 1), 5), entry(key('a', 2), 99)])
    expect(shards.get('forome.points.a')?.map((e) => e.points)).toEqual([99, 10])
    expect(shards.get('forome.points.b')?.map((e) => e.points)).toEqual([5])
  })

  it('fait l’aller-retour sans rien perdre', () => {
    const rows = [entry(key('a', 1), 1247), entry(key('a', 2), 3)]
    const { json, dropped } = encodeShard(rows, 1_700_000_000)
    expect(dropped).toBe(0)
    const back = decodeShard(json)
    expect(back?.at).toBe(1_700_000_000)
    expect(back?.entries).toEqual(rows)
  })

  /** Le classement perd sa queue, jamais sa tête — et il le dit. */
  it('coupe par le bas quand le budget d’octets est atteint', () => {
    const rows = Array.from({ length: 4000 }, (_, i) => entry(key('a', i), 4000 - i))
    const { json, kept, dropped } = encodeShard(rows, 1)
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(28 * 1024)
    expect(kept + dropped).toBe(4000)
    expect(dropped).toBeGreaterThan(0)
    expect(decodeShard(json)?.entries[0]?.points).toBe(4000)
  })

  it('jette la ligne illisible sans jeter le morceau', () => {
    const json = JSON.stringify({
      v: 1,
      at: 1,
      r: [[key('a', 1), 10, 1, 2, 3, 4], ['pas-une-clé', 10, 0, 0, 0, 0], 'ni-un-tableau', [key('a', 2), -5]],
    })
    const back = decodeShard(json)
    expect(back?.entries).toHaveLength(1)
    expect(back?.entries[0]?.pubkey).toBe(key('a', 1))
  })

  it('refuse ce qui n’est pas un morceau', () => {
    expect(decodeShard('pas du json')).toBeNull()
    expect(decodeShard('{"v":2,"r":[]}')).toBeNull()
    expect(decodeShard('null')).toBeNull()
  })
})
