/**
 * Tests du traitement des signalements.
 *
 * Le cas qui compte est le brigading : trois comptes qui se suivent ne doivent
 * pas peser plus que trois inconnus. C'est la seule protection de la file
 * (spec §9.6), donc c'est ce qui est testé le plus près.
 */
import { describe, it, expect } from 'vitest'
import { reportTargetOf, distinctVoices, groupReports } from '../utils/moderation'
import type { NostrEvent } from '../types/nostr'

const EVENT_ID = '1'.repeat(64)
const OTHER_ID = '2'.repeat(64)
const AUTHOR = 'a'.repeat(64)
const NOW = 1_800_000_000

function key(n: number): string {
  return n.toString(16).padStart(2, '0').repeat(32)
}

function report(pubkey: string, tags: string[][], content = '', at = NOW): NostrEvent {
  return {
    id: '9'.repeat(64),
    pubkey,
    created_at: at,
    kind: 1984,
    tags,
    content,
    sig: '0'.repeat(128),
  }
}

/** Graphe de follows explicite : `follows[k]` = ce que k suit. */
function graph(follows: Record<string, string[]>): (pk: string) => string[] {
  return (pk) => follows[pk] ?? []
}

describe('cible d’un signalement', () => {
  it('lit le motif en 3e position du tag, pas dans le contenu (NIP-56)', () => {
    const ref = reportTargetOf(report(key(1), [['e', EVENT_ID, 'spam']], 'du texte libre'))
    expect(ref).toEqual({ target: EVENT_ID, targetKind: 'event', type: 'spam' })
  })

  it('vise le message quand les deux tags sont présents', () => {
    const ref = reportTargetOf(report(key(1), [['p', AUTHOR, 'spam'], ['e', EVENT_ID, 'spam']]))
    expect(ref?.targetKind).toBe('event')
    expect(ref?.target).toBe(EVENT_ID)
  })

  it('vise le compte quand il n’y a pas de tag e', () => {
    const ref = reportTargetOf(report(key(1), [['p', AUTHOR, 'impersonation']]))
    expect(ref).toEqual({ target: AUTHOR, targetKind: 'pubkey', type: 'impersonation' })
  })

  it('retombe sur « other » quand le motif manque', () => {
    expect(reportTargetOf(report(key(1), [['e', EVENT_ID]]))?.type).toBe('other')
  })

  it('ignore un signalement sans cible exploitable', () => {
    expect(reportTargetOf(report(key(1), [['e', 'pas-un-id', 'spam']]))).toBeNull()
  })
})

describe('voix distinctes', () => {
  const [a, b, c] = [key(1), key(2), key(3)]

  it('trois inconnus font trois voix', () => {
    expect(distinctVoices([a, b, c], graph({}))).toBe(3)
  })

  it('trois comptes qui se suivent ne font qu’une voix', () => {
    const g = graph({ [a]: [b, c], [b]: [a, c], [c]: [a, b] })
    expect(distinctVoices([a, b, c], g)).toBe(1)
  })

  it('un lien à sens unique suffit à ne pas compter deux fois', () => {
    // Suivre quelqu'un sans réciprocité reste un lien : c'est exactement ainsi
    // qu'on recrute une brigade.
    expect(distinctVoices([a, b], graph({ [a]: [b] }))).toBe(1)
    expect(distinctVoices([a, b], graph({ [b]: [a] }))).toBe(1)
  })

  it('un groupe lié plus un étranger font deux voix', () => {
    const g = graph({ [a]: [b], [b]: [a] })
    expect(distinctVoices([a, b, c], g)).toBe(2)
  })

  it('ne compte pas les follows hors du groupe de signalants', () => {
    const g = graph({ [a]: [key(9)], [b]: [key(9)] })
    expect(distinctVoices([a, b], g)).toBe(2)
  })

  it('est stable quel que soit l’ordre d’arrivée', () => {
    const g = graph({ [a]: [b], [b]: [a] })
    expect(distinctVoices([a, b, c], g)).toBe(distinctVoices([c, b, a], g))
  })

  it('cas dégénérés', () => {
    expect(distinctVoices([], graph({}))).toBe(0)
    expect(distinctVoices([a, a, a], graph({}))).toBe(1)
  })
})

describe('file du panneau', () => {
  const [a, b, c] = [key(1), key(2), key(3)]

  it('trie par voix, pas par nombre de signalements', () => {
    const brigade = graph({ [a]: [b, c], [b]: [a, c], [c]: [a, b] })
    const groups = groupReports(
      [
        report(a, [['e', EVENT_ID, 'spam']]),
        report(b, [['e', EVENT_ID, 'spam']]),
        report(c, [['e', EVENT_ID, 'spam']]),
        report(key(7), [['e', OTHER_ID, 'illegal']], '', NOW + 1),
      ],
      { followsOf: brigade },
    )
    expect(groups[0]?.target).toBe(OTHER_ID) // 1 voix isolée
    expect(groups[0]?.voices).toBe(1)
    expect(groups[1]?.target).toBe(EVENT_ID) // 3 signalements, 1 voix
    expect(groups[1]?.voices).toBe(1)
    expect(groups[1]?.reporters.size).toBe(3)
  })

  it('un compte qui signale trois fois reste une voix', () => {
    const groups = groupReports(
      [
        report(a, [['e', EVENT_ID, 'spam']], 'un'),
        report(a, [['e', EVENT_ID, 'spam']], 'deux'),
        report(a, [['e', EVENT_ID, 'spam']], 'trois'),
      ],
      { followsOf: graph({}) },
    )
    expect(groups[0]?.voices).toBe(1)
    expect(groups[0]?.notes).toEqual(['un'])
  })

  it('sort les cibles déjà classées sans suite ou déjà traitées', () => {
    const events = [report(a, [['e', EVENT_ID, 'spam']]), report(b, [['e', OTHER_ID, 'spam']])]
    const ignored = groupReports(events, { followsOf: graph({}), ignored: new Set([EVENT_ID]) })
    expect(ignored.map((g) => g.target)).toEqual([OTHER_ID])

    const resolved = groupReports(events, { followsOf: graph({}), resolved: new Set([OTHER_ID]) })
    expect(resolved.map((g) => g.target)).toEqual([EVENT_ID])
  })

  it('à voix égales, le plus récent passe devant', () => {
    const groups = groupReports(
      [
        report(a, [['e', EVENT_ID, 'spam']], '', NOW),
        report(b, [['e', OTHER_ID, 'spam']], '', NOW + 100),
      ],
      { followsOf: graph({}) },
    )
    expect(groups[0]?.target).toBe(OTHER_ID)
  })

  it('retient le motif et l’heure du plus récent', () => {
    const groups = groupReports(
      [
        report(a, [['e', EVENT_ID, 'spam']], '', NOW),
        report(b, [['e', EVENT_ID, 'illegal']], '', NOW + 50),
      ],
      { followsOf: graph({}) },
    )
    expect(groups[0]?.lastAt).toBe(NOW + 50)
    expect([...(groups[0]?.types.keys() ?? [])].sort()).toEqual(['illegal', 'spam'])
  })
})
