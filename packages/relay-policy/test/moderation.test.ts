/**
 * Tests du modèle de modération.
 *
 * Même enjeu que la policy à côté : cette dérivation décide qui est masqué et
 * qui est banni, **des deux côtés à la fois** (client et relais). Une règle qui
 * se comporte différemment ici et là produirait un forum où « bannir » masque
 * sans bloquer.
 */
import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { npubEncode, nsecEncode } from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/core'
import {
  deriveState,
  parseStaff,
  parseActions,
  blockedKeys,
  lockedThreads,
  purgedEvents,
  KIND_APP_DATA,
  STAFF_D_TAG,
  MODERATION_D_TAG,
  MAX_REASON_LEN,
  normalizePubkey,
  type ModAction,
} from '../src/moderation.js'

const rootSk = generateSecretKey()
const ROOT = getPublicKey(rootSk)
const modSk = generateSecretKey()
const MOD = getPublicKey(modSk)
const mod2Sk = generateSecretKey()
const MOD2 = getPublicKey(mod2Sk)
const strangerSk = generateSecretKey()
const STRANGER = getPublicKey(strangerSk)

const TARGET = 'a'.repeat(64)
const TOPIC = 'b'.repeat(64)
const VICTIM = 'c'.repeat(64)
const NOW = 1_800_000_000

function roster(sk: Uint8Array, staff: { pubkey: string; role: string }[], at = NOW): Event {
  return finalizeEvent(
    {
      kind: KIND_APP_DATA,
      created_at: at,
      tags: [['d', STAFF_D_TAG]],
      content: JSON.stringify({ v: 1, at, staff: staff.map((s) => ({ ...s, since: at })) }),
    },
    sk,
  )
}

function list(sk: Uint8Array, actions: Partial<ModAction>[], at = NOW): Event {
  return finalizeEvent(
    {
      kind: KIND_APP_DATA,
      created_at: at,
      tags: [['d', MODERATION_D_TAG]],
      content: JSON.stringify({
        v: 1,
        at,
        actions: actions.map((a) => ({ reason: 'motif', at, ...a })),
      }),
    },
    sk,
  )
}

describe('roster', () => {
  it('n’accepte le roster que de la clé racine', () => {
    const usurped = roster(modSk, [{ pubkey: STRANGER, role: 'admin' }])
    expect(parseStaff(usurped, ROOT)).toBeNull()
  })

  it('la clé racine reste admin même absente de sa propre liste', () => {
    const staff = parseStaff(roster(rootSk, [{ pubkey: MOD, role: 'moderator' }]), ROOT)
    expect(staff?.get(ROOT)).toBe('admin')
    expect(staff?.get(MOD)).toBe('moderator')
  })

  it('ignore les entrées malformées sans jeter le roster', () => {
    const ev = roster(rootSk, [
      { pubkey: 'trop court', role: 'moderator' },
      { pubkey: MOD, role: 'roi' },
      { pubkey: MOD2, role: 'moderator' },
    ])
    const staff = parseStaff(ev, ROOT)
    expect([...(staff?.keys() ?? [])].sort()).toEqual([ROOT, MOD2].sort())
  })

  it('la clé racine ne peut pas se rétrograder elle-même', () => {
    const staff = parseStaff(roster(rootSk, [{ pubkey: ROOT, role: 'moderator' }]), ROOT)
    expect(staff?.get(ROOT)).toBe('admin')
  })
})

describe('actions', () => {
  it('borne le motif au lieu de rejeter l’action', () => {
    const ev = list(modSk, [{ type: 'hide', target: TARGET, reason: 'x'.repeat(500) }])
    expect(parseActions(ev)?.[0]?.reason).toHaveLength(MAX_REASON_LEN)
  })

  it('ignore une action dont la cible n’est pas un identifiant', () => {
    const ev = list(modSk, [{ type: 'hide', target: 'pas-un-id' }])
    expect(parseActions(ev)).toEqual([])
  })
})

describe('état effectif', () => {
  const base = roster(rootSk, [
    { pubkey: MOD, role: 'moderator' },
    { pubkey: MOD2, role: 'moderator' },
  ])

  it('applique le masquage d’un modérateur du roster', () => {
    const state = deriveState([base, list(modSk, [{ type: 'hide', target: TARGET }])], ROOT)
    expect(state.hidden.get(TARGET)?.by).toBe(MOD)
  })

  it('ignore les actions d’une clé hors du roster', () => {
    const state = deriveState([base, list(strangerSk, [{ type: 'hide', target: TARGET }])], ROOT)
    expect(state.hidden.size).toBe(0)
  })

  it('révoquer un modérateur annule toutes ses actions d’un coup', () => {
    const events = [base, list(modSk, [{ type: 'hide', target: TARGET }, { type: 'ban', target: VICTIM }])]
    expect(deriveState(events, ROOT).hidden.size).toBe(1)

    const revoked = roster(rootSk, [{ pubkey: MOD2, role: 'moderator' }], NOW + 10)
    const after = deriveState([...events, revoked], ROOT)
    expect(after.hidden.size).toBe(0)
    expect(after.banned.size).toBe(0)
  })

  it('un modérateur peut défaire la décision d’un autre — le plus récent gagne', () => {
    const state = deriveState(
      [
        base,
        list(modSk, [{ type: 'hide', target: TARGET, at: NOW }]),
        list(mod2Sk, [{ type: 'show', target: TARGET, at: NOW + 5 }], NOW + 5),
      ],
      ROOT,
    )
    expect(state.hidden.size).toBe(0)
  })

  it('et la décision la plus ancienne ne ressuscite pas', () => {
    const state = deriveState(
      [
        base,
        list(modSk, [{ type: 'hide', target: TARGET, at: NOW + 5 }], NOW + 5),
        list(mod2Sk, [{ type: 'show', target: TARGET, at: NOW }]),
      ],
      ROOT,
    )
    expect(state.hidden.get(TARGET)?.by).toBe(MOD)
  })

  it('un modérateur ne peut pas en bannir un autre', () => {
    const state = deriveState([base, list(modSk, [{ type: 'ban', target: MOD2 }])], ROOT)
    expect(state.banned.size).toBe(0)
  })

  it('seule la dernière liste d’un modérateur compte', () => {
    const state = deriveState(
      [
        base,
        list(modSk, [{ type: 'hide', target: TARGET }], NOW),
        list(modSk, [], NOW + 10),
      ],
      ROOT,
    )
    expect(state.hidden.size).toBe(0)
  })
})

describe('classement illégal', () => {
  it('un modérateur ne peut pas classer en illégal — dégradé en éditorial', () => {
    const state = deriveState(
      [
        roster(rootSk, [{ pubkey: MOD, role: 'moderator' }]),
        list(modSk, [{ type: 'hide', target: TARGET, class: 'illegal' }]),
      ],
      ROOT,
    )
    expect(state.hidden.get(TARGET)?.class).toBe('editorial')
    expect(purgedEvents(state).size).toBe(0)
  })

  it('un admin le peut, et l’event entre dans l’ensemble purgé', () => {
    const state = deriveState(
      [
        roster(rootSk, [{ pubkey: MOD, role: 'admin' }]),
        list(modSk, [{ type: 'hide', target: TARGET, class: 'illegal' }]),
      ],
      ROOT,
    )
    expect(purgedEvents(state).has(TARGET)).toBe(true)
  })
})

describe('vues pour le relais', () => {
  it('extrait les clés bannies et les topics verrouillés', () => {
    const state = deriveState(
      [
        roster(rootSk, [{ pubkey: MOD, role: 'moderator' }]),
        list(modSk, [
          { type: 'ban', target: VICTIM },
          { type: 'lock', target: TOPIC },
          { type: 'pin', target: TOPIC },
        ]),
      ],
      ROOT,
    )
    expect(blockedKeys(state)).toEqual(new Set([VICTIM]))
    expect(lockedThreads(state)).toEqual(new Set([TOPIC]))
    expect(state.pinned.has(TOPIC)).toBe(true)
  })

  it('sans clé racine configurée, rien n’est modéré', () => {
    const state = deriveState([roster(rootSk, []), list(rootSk, [{ type: 'ban', target: VICTIM }])], '')
    expect(state.staff.size).toBe(0)
    expect(blockedKeys(state).size).toBe(0)
  })
})

describe('forme de la clé', () => {
  it('accepte l’hexadécimal et la npub, qui est la seule forme que l’app montre', () => {
    const npub = npubEncode(ROOT)
    expect(normalizePubkey(ROOT)).toBe(ROOT)
    expect(normalizePubkey(npub)).toBe(ROOT)
    expect(normalizePubkey(`  ${npub}  `)).toBe(ROOT)
    expect(normalizePubkey(ROOT.toUpperCase())).toBe(ROOT)
  })

  it('refuse ce qui n’est pas une clé publique', () => {
    expect(normalizePubkey('')).toBeNull()
    expect(normalizePubkey(null)).toBeNull()
    expect(normalizePubkey('npub1cassée')).toBeNull()
    // une nsec est un SECRET : l'accepter comme clé racine serait un piège
    expect(normalizePubkey(nsecEncode(rootSk))).toBeNull()
  })

  it('une npub sert de clé racine comme l’hexadécimal', () => {
    const state = deriveState(
      [roster(rootSk, [{ pubkey: MOD, role: 'moderator' }]), list(modSk, [{ type: 'ban', target: VICTIM }])],
      normalizePubkey(npubEncode(ROOT))!,
    )
    expect(blockedKeys(state)).toEqual(new Set([VICTIM]))
  })
})
