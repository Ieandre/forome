/**
 * Tests du portage de la liste chaude.
 *
 * Ce qui est testé en priorité, ce sont les **différences avec la v1** : le
 * désordre d'arrivée et les doublons, que Nostr introduit et que le serveur v1
 * ne pouvait pas produire.
 */
import { describe, it, expect } from 'vitest'
import { HotList } from '../src/hotlist.js'
import { RaidDetector } from '../src/raid.js'

const T0 = 1_800_000_000

function fresh(): HotList {
  const hot = new HotList()
  hot.addTopic({ id: 'topic-a', title: 'A', createdAt: T0 - 3600, pubkey: 'auteur-a', text: 'ouverture' })
  return hot
}

describe('liste chaude', () => {
  it('ignore une réponse dont la racine est inconnue', () => {
    const hot = new HotList()
    const added = hot.onReply({ topicId: 'inconnu', eventId: 'e1', pubkey: 'p1', createdAt: T0, text: 'x' })
    expect(added).toBe(false)
  })

  it('dédoublonne par id — les relais renvoient les mêmes events', () => {
    const hot = fresh()
    expect(hot.onReply({ topicId: 'topic-a', eventId: 'e1', pubkey: 'p1', createdAt: T0, text: 'x' })).toBe(true)
    expect(hot.onReply({ topicId: 'topic-a', eventId: 'e1', pubkey: 'p1', createdAt: T0, text: 'x' })).toBe(false)
    expect(hot.snapshot(T0).topics[0]!.replies).toBe(1)
  })

  it('ne recule pas le « dernier message » quand un event arrive en retard', () => {
    const hot = fresh()
    hot.onReply({ topicId: 'topic-a', eventId: 'e2', pubkey: 'p2', createdAt: T0, text: 'récent' })
    hot.onReply({ topicId: 'topic-a', eventId: 'e1', pubkey: 'p1', createdAt: T0 - 300, text: 'ancien' })
    const row = hot.snapshot(T0).topics[0]!
    expect(row.lastText).toBe('récent')
    expect(row.lastAt).toBe(T0)
  })

  it('compte tous les events de la fenêtre malgré un ordre d\'arrivée aléatoire', () => {
    // Régression : la v1 sortait de la boucle au premier event hors fenêtre
    // (`break`), ce qui est correct avec un ordre chronologique garanti et faux
    // ici. Un vieil event arrivé au milieu ne doit pas masquer les suivants.
    const hot = fresh()
    hot.onReply({ topicId: 'topic-a', eventId: 'e1', pubkey: 'p1', createdAt: T0 - 30, text: 'a' })
    hot.onReply({ topicId: 'topic-a', eventId: 'vieux', pubkey: 'p9', createdAt: T0 - 5000, text: 'hors fenêtre' })
    hot.onReply({ topicId: 'topic-a', eventId: 'e2', pubkey: 'p2', createdAt: T0 - 20, text: 'b' })
    hot.onReply({ topicId: 'topic-a', eventId: 'e3', pubkey: 'p3', createdAt: T0 - 10, text: 'c' })

    const row = hot.snapshot(T0).topics[0]!
    // 3 participants dans la fenêtre de 10 min ; le vieux est exclu du score
    expect(row.ppl).toBe(3)
    expect(row.vel).toBeGreaterThan(0)
  })

  it('les participants pèsent plus que le volume — 3 squatteurs ne montent pas', () => {
    const hot = new HotList()
    hot.addTopic({ id: 'squat', title: 'squat', createdAt: T0 - 600, pubkey: 'a', text: '' })
    hot.addTopic({ id: 'vivant', title: 'vivant', createdAt: T0 - 600, pubkey: 'b', text: '' })

    // 30 messages de 3 personnes
    for (let i = 0; i < 30; i++) {
      hot.onReply({
        topicId: 'squat',
        eventId: `s${i}`,
        pubkey: `squatteur-${i % 3}`,
        createdAt: T0 - 60,
        text: 'up',
      })
    }
    // 15 messages de 15 personnes
    for (let i = 0; i < 15; i++) {
      hot.onReply({ topicId: 'vivant', eventId: `v${i}`, pubkey: `khey-${i}`, createdAt: T0 - 60, text: 'salut' })
    }

    // Sur la vélocité et non sur le rang : l'ordre du tick suit le dernier message
    // (les deux topics sont ici touchés à la même seconde), et la vélocité
    // n'alimente plus que le rail de chauffe.
    const topics = hot.snapshot(T0).topics
    const squat = topics.find((t) => t.id === 'squat')!
    const vivant = topics.find((t) => t.id === 'vivant')!
    expect(vivant.vel).toBeGreaterThan(squat.vel)
  })

  it('un topic sans activité récente a une vélocité nulle', () => {
    const hot = fresh()
    hot.onReply({ topicId: 'topic-a', eventId: 'e1', pubkey: 'p1', createdAt: T0 - 4000, text: 'vieux' })
    expect(hot.snapshot(T0).topics[0]!.vel).toBe(0)
  })
})

describe('détection de raid', () => {
  it('reste muet pendant la période de chauffe', () => {
    // Au démarrage, toutes les clés sont inconnues donc « récentes » : alerter
    // ici produirait un faux positif à chaque redémarrage.
    const raid = new RaidDetector(24 * 3600, 10 * 60, T0)
    let alerts = 0
    for (let i = 0; i < 60; i++) {
      const s = raid.onEvent({ topicId: 't', pubkey: `neuf-${i}`, at: T0 + 10, nowS: T0 + 10 })
      if (s) alerts++
    }
    expect(alerts).toBe(0)
  })

  it('alerte sur une arrivée massive de clés inconnues après la chauffe', () => {
    const raid = new RaidDetector(24 * 3600, 0, T0)
    let signal = null
    for (let i = 0; i < 60 && !signal; i++) {
      signal = raid.onEvent({ topicId: 't', pubkey: `raideur-${i}`, at: T0, nowS: T0 })
    }
    expect(signal).not.toBeNull()
    expect(signal!.score).toBeGreaterThanOrEqual(3)
    expect(raid.isFlagged('t', T0)).toBe(true)
  })

  it("n'alerte pas sur des clés suivies, même jamais vues avant", () => {
    // Renforcement de l'étape 4 : le graphe kind 3 remplace le proxy faible
    // « clé jamais vue ». Une clé suivie par quelqu'un n'est pas une clé de
    // ferme, même si l'indexeur la découvre à l'instant.
    const raid = new RaidDetector(24 * 3600, 0, T0)
    const keys = Array.from({ length: 60 }, (_, i) => `habitue-${i}`)
    raid.noteFollowGraph(keys)
    expect(raid.followGraphSize).toBe(60)

    let alerts = 0
    for (const pk of keys) {
      if (raid.onEvent({ topicId: 't', pubkey: pk, at: T0, nowS: T0 })) alerts++
    }
    expect(alerts).toBe(0)
    expect(raid.isFlagged('t', T0)).toBe(false)
  })

  it('alerte toujours si les clés ne sont dans aucun graphe', () => {
    // Contrôle négatif du test précédent : sans follows, le même trafic alerte.
    const raid = new RaidDetector(24 * 3600, 0, T0)
    let signal = null
    for (let i = 0; i < 60 && !signal; i++) {
      signal = raid.onEvent({ topicId: 't', pubkey: `ferme-${i}`, at: T0, nowS: T0 })
    }
    expect(signal).not.toBeNull()
  })

  it("n'alerte pas quand des habitués s'emballent", () => {
    // Le cœur de l'heuristique : l'accélération est pondérée par la part de
    // clés récentes. Un bon topic n'est pas un raid.
    const raid = new RaidDetector(60, 0, T0)
    // les 10 clés deviennent « connues » longtemps avant
    for (let i = 0; i < 10; i++) raid.onEvent({ topicId: 'autre', pubkey: `habitue-${i}`, at: T0, nowS: T0 })

    const later = T0 + 600
    let alerts = 0
    for (let i = 0; i < 100; i++) {
      const s = raid.onEvent({ topicId: 't', pubkey: `habitue-${i % 10}`, at: later, nowS: later })
      if (s) alerts++
    }
    expect(alerts).toBe(0)
    expect(raid.isFlagged('t', later)).toBe(false)
  })
})
