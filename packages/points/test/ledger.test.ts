import { beforeEach, describe, expect, it } from 'vitest'
import { PointsLedger } from '../src/ledger.js'
import { DAILY_CAP, MIN_POINTS_TO_CREDIT, WEIGHTS } from '../src/index.js'

const JOUR = 86400
const J0 = 20_000 * JOUR
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

let n = 0
const id = (): string => `${(n++).toString(16).padStart(4, '0')}${'e'.repeat(60)}`

/**
 * Amène une clé au-dessus du seuil de crédit sans que personne ne l'ait
 * créditée — c'est l'amorçage que le seuil doit permettre : un topic et trois
 * réponses chez soi (aucun auto-crédit possible) valent pile 10 points.
 */
function amorcer(led: PointsLedger, pk: string, at: number): string {
  const topic = id()
  led.onTopic({ eventId: topic, pubkey: pk, createdAt: at })
  for (let i = 0; i < 3; i++) {
    led.onReply({ eventId: id(), pubkey: pk, createdAt: at, rootId: topic })
  }
  return topic
}

describe('PointsLedger', () => {
  let led: PointsLedger
  beforeEach(() => {
    led = new PointsLedger()
  })

  it('paie le topic et le bonus du jour, une seule fois par jour', () => {
    led.onTopic({ eventId: id(), pubkey: A, createdAt: J0 })
    expect(led.points(A)).toBe(WEIGHTS.topic + WEIGHTS.activeDay)
    led.onTopic({ eventId: id(), pubkey: A, createdAt: J0 + 60 })
    expect(led.points(A)).toBe(WEIGHTS.topic * 2 + WEIGHTS.activeDay)
  })

  it('ne compte pas deux fois le même event — les relais le renvoient', () => {
    const e = id()
    led.onTopic({ eventId: e, pubkey: A, createdAt: J0 })
    led.onTopic({ eventId: e, pubkey: A, createdAt: J0 })
    expect(led.points(A)).toBe(WEIGHTS.topic + WEIGHTS.activeDay)
  })

  it("amorce le forum : poster suffit à franchir le seuil de crédit", () => {
    amorcer(led, A, J0)
    expect(led.points(A)).toBe(MIN_POINTS_TO_CREDIT)
  })

  it('ne crédite rien depuis une clé neuve — sinon une ferme fabrique du score', () => {
    const topic = amorcer(led, A, J0)
    const avant = led.points(A)
    led.onReply({ eventId: id(), pubkey: B, createdAt: J0, rootId: topic })
    expect(led.points(A)).toBe(avant)
    expect(led.points(B)).toBe(WEIGHTS.reply + WEIGHTS.activeDay)
  })

  it('crédite un participant distinct une fois, pas cinquante', () => {
    const topic = amorcer(led, A, J0)
    amorcer(led, B, J0)
    const avant = led.points(A)
    for (let i = 0; i < 50; i++) {
      led.onReply({ eventId: id(), pubkey: B, createdAt: J0, rootId: topic })
    }
    expect(led.points(A)).toBe(avant + WEIGHTS.topicParticipant)
  })

  it('paie la réponse reçue au message visé, en plus du topic', () => {
    const topic = amorcer(led, A, J0)
    const mien = id()
    led.onReply({ eventId: mien, pubkey: A, createdAt: J0, rootId: topic })
    amorcer(led, B, J0)
    const avant = led.points(A)
    led.onReply({ eventId: id(), pubkey: B, createdAt: J0, rootId: topic, parentId: mien })
    expect(led.points(A)).toBe(avant + WEIGHTS.topicParticipant + WEIGHTS.replyReceived)
  })

  it('ne paie pas deux fois le même geste quand le parent EST la racine', () => {
    const topic = amorcer(led, A, J0)
    amorcer(led, B, J0)
    const avant = led.points(A)
    led.onReply({ eventId: id(), pubkey: B, createdAt: J0, rootId: topic, parentId: topic })
    expect(led.points(A)).toBe(avant + WEIGHTS.topicParticipant)
  })

  it("ne crédite jamais soi-même : se répondre est le meilleur placement possible", () => {
    const topic = amorcer(led, A, J0)
    const mien = id()
    led.onReply({ eventId: mien, pubkey: A, createdAt: J0, rootId: topic })
    const avant = led.points(A)
    led.onReply({ eventId: id(), pubkey: A, createdAt: J0, rootId: topic, parentId: mien })
    expect(led.points(A)).toBe(avant + WEIGHTS.reply)
  })

  it('plafonne la journée', () => {
    for (let i = 0; i < 200; i++) {
      led.onTopic({ eventId: id(), pubkey: A, createdAt: J0 + i })
    }
    expect(led.points(A)).toBe(DAILY_CAP)
  })

  it('rouvre le plafond le lendemain', () => {
    for (let i = 0; i < 200; i++) led.onTopic({ eventId: id(), pubkey: A, createdAt: J0 + i })
    led.onTopic({ eventId: id(), pubkey: A, createdAt: J0 + JOUR })
    expect(led.points(A)).toBe(DAILY_CAP + WEIGHTS.topic + WEIGHTS.activeDay)
  })

  /**
   * Le couple est consommé même quand le plafond absorbe le gain. Sans ça, le
   * plafond ne serait qu'un étalement : il suffirait d'attendre demain pour
   * rejouer le même crédit.
   */
  it('consomme le crédit même si le plafond du jour a tout absorbé', () => {
    const topic = amorcer(led, A, J0)
    amorcer(led, B, J0)
    for (let i = 0; i < 200; i++) led.onTopic({ eventId: id(), pubkey: A, createdAt: J0 + i })
    expect(led.points(A)).toBe(DAILY_CAP)
    led.onReply({ eventId: id(), pubkey: B, createdAt: J0, rootId: topic })
    expect(led.points(A)).toBe(DAILY_CAP)
    // Demain, le même couple ne paie pas : il a été dépensé.
    led.onReply({ eventId: id(), pubkey: B, createdAt: J0 + JOUR, rootId: topic })
    expect(led.points(A)).toBe(DAILY_CAP)
  })

  it('paie le passage en topics chauds une fois par topic', () => {
    const topic = id()
    led.onTopic({ eventId: topic, pubkey: A, createdAt: J0 })
    const avant = led.points(A)
    led.onHotTopic(topic, J0)
    led.onHotTopic(topic, J0)
    expect(led.points(A)).toBe(avant + WEIGHTS.hotTopic)
  })

  it('ignore un topic chaud dont l’auteur est inconnu', () => {
    led.onHotTopic(id(), J0)
    expect(led.rows()).toEqual([])
  })

  it('paie un vote de sondage une fois par votant', () => {
    const topic = amorcer(led, A, J0)
    amorcer(led, B, J0)
    const avant = led.points(A)
    led.onPollVote({ eventId: id(), pubkey: B, createdAt: J0, topicId: topic })
    led.onPollVote({ eventId: id(), pubkey: B, createdAt: J0, topicId: topic })
    expect(led.points(A)).toBe(avant + WEIGHTS.pollVote)
  })

  it('rend les clés qui ont des points, avec les faits qui les expliquent', () => {
    amorcer(led, A, J0)
    expect(led.rows()).toEqual([
      { pubkey: A, points: MIN_POINTS_TO_CREDIT, topics: 1, replies: 3, activeDays: 1, lastDay: 20_000 },
    ])
    expect(led.points(C)).toBe(0)
  })

  /** Les faits décrivent, ils ne récompensent pas : le plafond ne les touche pas. */
  it('compte les faits au-delà du plafond de points', () => {
    for (let i = 0; i < 60; i++) led.onTopic({ eventId: id(), pubkey: A, createdAt: J0 + i })
    led.onReply({ eventId: id(), pubkey: A, createdAt: J0 + 2 * JOUR, rootId: id() })
    const row = led.rows()[0]
    expect(row?.points).toBe(DAILY_CAP + WEIGHTS.reply + WEIGHTS.activeDay)
    expect(row?.topics).toBe(60)
    expect(row?.replies).toBe(1)
    expect(row?.activeDays).toBe(2)
    expect(row?.lastDay).toBe(20_002)
  })

  it('se relit après un tour sur le disque, garde-fous compris', () => {
    const topic = amorcer(led, A, J0)
    amorcer(led, B, J0)
    led.onReply({ eventId: id(), pubkey: B, createdAt: J0, rootId: topic })
    const attendu = led.points(A)

    const relu = PointsLedger.fromJSON(JSON.parse(JSON.stringify(led.toJSON())))
    expect(relu.points(A)).toBe(attendu)
    expect(relu.points(B)).toBe(led.points(B))
    // Le crédit dépensé l'est resté : la persistance porte les garde-fous, pas
    // seulement les totaux — sinon un redémarrage rouvrirait toutes les fermes.
    relu.onReply({ eventId: id(), pubkey: B, createdAt: J0 + JOUR, rootId: topic })
    expect(relu.points(A)).toBe(attendu)
  })

  it('ne casse pas sur un état illisible : le tick ne tombe pas avec les points', () => {
    expect(PointsLedger.fromJSON(null).size).toBe(0)
    expect(PointsLedger.fromJSON({ v: 99 }).size).toBe(0)
    expect(PointsLedger.fromJSON({ v: 1, keys: [['x', 'pas un nombre']] }).size).toBe(0)
  })
})
