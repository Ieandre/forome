/**
 * Tests des ensembles de relais.
 *
 * Enjeu : une erreur ici publie sur un réseau où rien ne s'efface. C'est
 * arrivé — le premier message de Forome est parti sur quatre relais publics
 * depuis un serveur de développement, parce que le défaut de lecture servait
 * aussi de défaut d'écriture.
 */
import { describe, it, expect } from 'vitest'
import {
  isLocalRelay,
  isThirdPartyRelay,
  readTargets,
  writeTargets,
  type RelayPlan,
} from '../utils/relayTargets.js'

const PUBLICS = ['wss://relay.damus.io', 'wss://nos.lol']
const HOME = 'wss://relay.forome.example'
const DEV = 'ws://localhost:7778'

const dev: RelayPlan = { dev: true, homeRelay: HOME, devRelay: DEV, publicRelays: PUBLICS }
const prod: RelayPlan = { dev: false, homeRelay: HOME, devRelay: DEV, publicRelays: PUBLICS }
const prodSansRelais: RelayPlan = { ...prod, homeRelay: '' }

describe('isLocalRelay', () => {
  it('reconnaît la boucle locale sous ses différentes formes', () => {
    expect(isLocalRelay('ws://localhost:7778')).toBe(true)
    expect(isLocalRelay('ws://127.0.0.1:7447')).toBe(true)
    expect(isLocalRelay('ws://[::1]:7778')).toBe(true)
  })

  it('ne confond pas un hôte qui commence pareil', () => {
    expect(isLocalRelay('wss://localhost.attaquant.fr')).toBe(false)
    expect(isLocalRelay('wss://nos.lol')).toBe(false)
  })
})

describe('isThirdPartyRelay', () => {
  it('notre relais et la boucle locale ne sont pas des tiers', () => {
    expect(isThirdPartyRelay(HOME, HOME)).toBe(false)
    expect(isThirdPartyRelay(`${HOME}/`, HOME)).toBe(false)
    expect(isThirdPartyRelay(DEV, HOME)).toBe(false)
  })

  it('tout le reste en est un', () => {
    expect(isThirdPartyRelay('wss://nos.lol', HOME)).toBe(true)
    // Sans relais à nous configuré, tout ce qui n'est pas local est un tiers.
    expect(isThirdPartyRelay('wss://nos.lol')).toBe(true)
  })
})

describe('développement', () => {
  it('ne lit que le relais local', () => {
    expect(readTargets(dev)).toEqual([DEV])
  })

  // LE test de ce fichier : aucun essai ne doit pouvoir partir sur le réseau.
  it('n’écrit QUE sur le relais local, jamais sur un tiers', () => {
    const targets = writeTargets(dev)
    expect(targets).toEqual([DEV])
    expect(targets.some((url) => isThirdPartyRelay(url, HOME))).toBe(false)
  })
})

describe('production', () => {
  it('lit chez nous — le seul relais dont la policy répond', () => {
    expect(readTargets(prod)).toEqual([HOME])
  })

  it('écrit chez nous ET chez les tiers, pour que rien ne dépende de nous seuls', () => {
    expect(writeTargets(prod)).toEqual([HOME, ...PUBLICS])
  })

  it('retombe sur les relais publics tant que le nôtre n’est pas déployé', () => {
    expect(readTargets(prodSansRelais)).toEqual(PUBLICS)
    expect(writeTargets(prodSansRelais)).toEqual(PUBLICS)
  })
})

describe('hygiène des listes', () => {
  it('ignore les entrées vides ou mal formées, et dédoublonne', () => {
    const plan: RelayPlan = {
      dev: false,
      homeRelay: 'wss://nos.lol/',
      devRelay: DEV,
      publicRelays: ['wss://nos.lol', '', 'pas-une-url', 'wss://relay.damus.io'],
    }
    expect(writeTargets(plan)).toEqual(['wss://nos.lol', 'wss://relay.damus.io'])
  })
})
