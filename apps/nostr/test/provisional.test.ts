/**
 * Tests de l'id provisoire.
 *
 * Le fil affiche une réponse avant qu'elle soit minée et signée, donc avant
 * qu'elle ait un id. Deux propriétés tiennent tout le reste : cet id ne doit
 * jamais pouvoir se confondre avec un id d'event, et deux envois ne doivent
 * jamais en partager un — sinon l'arrivée du vrai event remplacerait la mauvaise
 * rangée, ou pire, un tag `e` partirait vers un event qui n'existera jamais, sur
 * un réseau qui ne sait pas effacer.
 */
import { describe, it, expect } from 'vitest'
import { provisionalId, isProvisional } from '../types/nostr.js'

const REAL_ID = '8bdbc7490dc20264108411a5e3ba8a6b83d6ef3360fe152f2973b7386b4ce356'

describe('provisionalId', () => {
  it('ne peut pas être un id d’event', () => {
    expect(provisionalId()).not.toMatch(/^[0-9a-f]{64}$/)
  })

  it('ne se répète jamais', () => {
    const ids = Array.from({ length: 500 }, () => provisionalId())
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('isProvisional', () => {
  it('reconnaît ce qu’il produit', () => {
    expect(isProvisional(provisionalId())).toBe(true)
  })

  it('laisse passer un vrai id', () => {
    expect(isProvisional(REAL_ID)).toBe(false)
  })

  it('ne se laisse pas piéger par un id qui contient le préfixe ailleurs', () => {
    expect(isProvisional(`${REAL_ID}echo:1`)).toBe(false)
  })
})
