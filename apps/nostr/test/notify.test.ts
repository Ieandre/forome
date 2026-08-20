import { describe, it, expect } from 'vitest'
import { parentRef, notifKindOf } from '../utils/notify'
import type { NostrEvent } from '../types/nostr'

const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const THIRD = 'c'.repeat(64)
const ROOT_ID = '1'.repeat(64)
const PARENT_ID = '2'.repeat(64)

function ev(tags: string[][]): NostrEvent {
  return {
    id: '9'.repeat(64),
    pubkey: OTHER,
    created_at: 1_700_000_000,
    kind: 1111,
    tags,
    content: 'peu importe',
    sig: '0'.repeat(128),
  }
}

describe('parentRef', () => {
  it('lit le parent et son auteur depuis le tag e (NIP-22)', () => {
    const r = parentRef(ev([['E', ROOT_ID, '', THIRD], ['e', PARENT_ID, '', ME]]))
    expect(r).toEqual({ id: PARENT_ID, author: ME })
  })

  it("ne rend pas de parent quand la réponse vise la racine", () => {
    // Le tag `e` répète la racine : il n'y a pas de parent distinct.
    expect(parentRef(ev([['E', ROOT_ID, '', ME], ['e', ROOT_ID, '', ME]]))).toBeNull()
  })

  it("refuse un marqueur NIP-10 en guise de clé d'auteur", () => {
    // En vieux style, le 4e élément est "reply", pas une clé publique.
    const r = parentRef(ev([['e', PARENT_ID, '', 'reply']]))
    expect(r).toEqual({ id: PARENT_ID, author: null })
  })

  it('saute le tag e marqué root du vieux style', () => {
    const r = parentRef(ev([['e', ROOT_ID, '', 'root'], ['e', PARENT_ID, '', ME]]))
    expect(r?.id).toBe(PARENT_ID)
  })
})

describe('notifKindOf', () => {
  it('réponse : je suis l’auteur du message parent', () => {
    expect(notifKindOf(ev([['E', ROOT_ID, '', THIRD], ['e', PARENT_ID, '', ME], ['p', ME]]), ME)).toBe(
      'reply',
    )
  })

  it("citation : le parent est de quelqu'un d'autre, je suis seulement tagué", () => {
    expect(
      notifKindOf(ev([['E', ROOT_ID, '', THIRD], ['e', PARENT_ID, '', THIRD], ['p', THIRD], ['p', ME]]), ME),
    ).toBe('mention')
  })

  it('réponse : quelqu’un répond directement à mon topic', () => {
    // Pas de parent distinct — l'auteur de la racine, c'est moi.
    expect(notifKindOf(ev([['E', ROOT_ID, '', ME], ['e', ROOT_ID, '', ME], ['p', ME]]), ME)).toBe('reply')
  })

  it("citation : réponse à la racine d'un topic qui n'est pas le mien", () => {
    expect(
      notifKindOf(ev([['E', ROOT_ID, '', THIRD], ['e', ROOT_ID, '', THIRD], ['p', THIRD], ['p', ME]]), ME),
    ).toBe('mention')
  })

  it('repli sur le premier tag p quand aucune clé n’est dans les tags e', () => {
    // Client qui n'écrit pas l'auteur en 4e position : le créneau NIP-22 de
    // l'auteur du parent reste le PREMIER tag `p`.
    expect(notifKindOf(ev([['e', PARENT_ID], ['p', ME]]), ME)).toBe('reply')
    expect(notifKindOf(ev([['e', PARENT_ID], ['p', THIRD], ['p', ME]]), ME)).toBe('mention')
  })

  it('citation par défaut quand rien ne permet de trancher', () => {
    // Dire « t'a répondu » d'une simple mention serait un mensonge ; l'inverse
    // n'est qu'une imprécision.
    expect(notifKindOf(ev([['t', 'forome']]), ME)).toBe('mention')
  })
})
