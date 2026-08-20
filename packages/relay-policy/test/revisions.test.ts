/**
 * Tests du format des révisions.
 *
 * Enjeu : la résolution décide **quel texte tout le monde lit** pour un message
 * donné. Deux clients qui n'en tireraient pas la même version afficheraient deux
 * forums différents — et la règle d'auteur est la seule chose qui empêche de
 * réécrire le message d'autrui, puisque le relais ne peut pas la vérifier.
 */
import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Event } from 'nostr-tools/core'
import { EDIT_TAG, editTargetOf, isRevision, resolveRevisions, latestRevision } from '../src/revisions.js'
import { evaluate, DEFAULT_POLICY, KIND_COMMENT, communityTag, type PolicyConfig } from '../src/index.js'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const otherSk = generateSecretKey()
const NOW = 1_800_000_000

const ID_A = 'a'.repeat(64)

/**
 * La marque de périmètre est ajoutée d'office : ces tests portent sur les
 * révisions, pas sur le périmètre, et sans elle la policy les refuserait tous
 * pour une raison qui n'est pas celle qu'ils vérifient.
 */
function make(over: Partial<{ content: string; tags: string[][]; created_at: number }> = {}, key = sk): Event {
  return finalizeEvent(
    {
      kind: KIND_COMMENT,
      content: over.content ?? 'texte',
      tags: [...(over.tags ?? []), communityTag()],
      created_at: over.created_at ?? NOW,
    },
    key,
  )
}

describe('editTargetOf', () => {
  it('lit la cible d’un tag edit bien formé', () => {
    expect(editTargetOf(make({ tags: [[EDIT_TAG, ID_A]] }))).toBe(ID_A)
  })

  it('ignore un event sans tag edit', () => {
    expect(editTargetOf(make())).toBeNull()
    expect(isRevision(make())).toBe(false)
  })

  it('refuse deux tags edit plutôt que d’en choisir un', () => {
    const ev = make({ tags: [[EDIT_TAG, ID_A], [EDIT_TAG, 'b'.repeat(64)]] })
    expect(editTargetOf(ev)).toBeNull()
  })

  it('refuse une cible qui n’est pas un id', () => {
    expect(editTargetOf(make({ tags: [[EDIT_TAG, 'pas-un-id']] }))).toBeNull()
    expect(editTargetOf(make({ tags: [[EDIT_TAG, '']] }))).toBeNull()
    expect(editTargetOf(make({ tags: [[EDIT_TAG]] }))).toBeNull()
    // majuscules : un id Nostr est en hexa minuscule
    expect(editTargetOf(make({ tags: [[EDIT_TAG, 'A'.repeat(64)]] }))).toBeNull()
  })

  it('refuse un event qui se désigne lui-même', () => {
    const ev = make({ tags: [[EDIT_TAG, ID_A]] })
    const self = { ...ev, tags: [[EDIT_TAG, ev.id]] }
    expect(editTargetOf(self)).toBeNull()
  })
})

describe('resolveRevisions', () => {
  it('rend l’original seul quand rien ne le révise', () => {
    const anchor = make({ content: 'v1' })
    expect(resolveRevisions(anchor, [])).toEqual([anchor])
    expect(latestRevision(anchor, []).content).toBe('v1')
  })

  it('la dernière version l’emporte, l’historique reste complet', () => {
    const anchor = make({ content: 'v1' })
    const r1 = make({ content: 'v2', created_at: NOW + 10, tags: [[EDIT_TAG, anchor.id]] })
    const r2 = make({ content: 'v3', created_at: NOW + 20, tags: [[EDIT_TAG, anchor.id]] })

    // désordre d'arrivée délibéré : les relais ne rendent pas l'historique trié
    const chain = resolveRevisions(anchor, [r2, r1])
    expect(chain.map((e) => e.content)).toEqual(['v1', 'v2', 'v3'])
    expect(latestRevision(anchor, [r2, r1]).content).toBe('v3')
  })

  /**
   * Le test qui compte. Sans la règle d'auteur, publier un event taguant
   * `edit: <id d'autrui>` réécrirait son message chez tous les lecteurs.
   */
  it('ignore une révision signée par quelqu’un d’autre', () => {
    const anchor = make({ content: 'ce que j’ai écrit' })
    const forged = make(
      { content: 'ce qu’on me fait dire', created_at: NOW + 10, tags: [[EDIT_TAG, anchor.id]] },
      otherSk,
    )
    expect(resolveRevisions(anchor, [forged])).toEqual([anchor])
    expect(latestRevision(anchor, [forged]).content).toBe('ce que j’ai écrit')
  })

  it('ignore une révision qui vise un autre message', () => {
    const anchor = make({ content: 'v1' })
    const elsewhere = make({ content: 'ailleurs', created_at: NOW + 10, tags: [[EDIT_TAG, ID_A]] })
    expect(resolveRevisions(anchor, [elsewhere])).toEqual([anchor])
  })

  it('une révision antidatée ne prend pas la place de l’original', () => {
    const anchor = make({ content: 'v1' })
    const backdated = make({ content: 'antidaté', created_at: NOW - 3600, tags: [[EDIT_TAG, anchor.id]] })
    const chain = resolveRevisions(anchor, [backdated])
    expect(chain.map((e) => e.content)).toEqual(['antidaté', 'v1'])
    expect(latestRevision(anchor, [backdated]).content).toBe('v1')
  })

  it('départage deux révisions de la même seconde de façon déterministe', () => {
    const anchor = make({ content: 'v1' })
    const a = make({ content: 'A', created_at: NOW + 10, tags: [[EDIT_TAG, anchor.id]] })
    const b = make({ content: 'B', created_at: NOW + 10, tags: [[EDIT_TAG, anchor.id]] })
    const expected = a.id < b.id ? 'B' : 'A'
    expect(latestRevision(anchor, [a, b]).content).toBe(expected)
    // même verdict quel que soit l'ordre d'arrivée — c'est tout l'objet du départage
    expect(latestRevision(anchor, [b, a]).content).toBe(expected)
  })

  it('ne compte pas deux fois la même révision reçue de deux relais', () => {
    const anchor = make({ content: 'v1' })
    const r = make({ content: 'v2', created_at: NOW + 10, tags: [[EDIT_TAG, anchor.id]] })
    expect(resolveRevisions(anchor, [r, { ...r }])).toHaveLength(2)
  })
})

describe('policy : forme du tag edit', () => {
  const cfg: PolicyConfig = { ...DEFAULT_POLICY, minPow: { ...DEFAULT_POLICY.minPow, [KIND_COMMENT]: 0 } }
  const opts = { config: cfg, nowS: NOW }

  it('accepte une révision bien formée', () => {
    expect(evaluate(make({ tags: [[EDIT_TAG, ID_A]] }), opts)).toEqual({ accept: true })
  })

  it('refuse deux tags edit', () => {
    const v = evaluate(make({ tags: [[EDIT_TAG, ID_A], [EDIT_TAG, 'b'.repeat(64)]] }), opts)
    expect(v.accept).toBe(false)
  })

  it('refuse une cible qui n’est pas un id', () => {
    expect(evaluate(make({ tags: [[EDIT_TAG, 'nope']] }), opts).accept).toBe(false)
  })
})
