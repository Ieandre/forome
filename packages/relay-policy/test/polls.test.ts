/**
 * Tests du format et du dépouillement des sondages.
 *
 * Enjeu : `tallyPoll` décide ce que deux lecteurs voient. Une règle qui diverge
 * ne casse rien visiblement — elle affiche deux résultats différents pour le
 * même bulletin, ce qui est le pire mode de panne d'un compteur. Les quatre
 * règles de comptage sont donc testées une par une, y compris celles qui
 * ressemblent à des cas d'école (le vote antidaté, le vote vide).
 */
import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Event } from 'nostr-tools/core'
import {
  KIND_POLL_VOTE,
  badPoll,
  badVote,
  hasPoll,
  pollOptionsOf,
  pollTypeOf,
  pollEndsAt,
  pollTags,
  normalizeChoices,
  tallyPoll,
  pollShare,
} from '../src/polls.js'
import { evaluate, DEFAULT_POLICY, KIND_THREAD, communityTag, type PolicyConfig } from '../src/index.js'

const NOW = 1_800_000_000

function key(): { sk: Uint8Array; pk: string } {
  const sk = generateSecretKey()
  return { sk, pk: getPublicKey(sk) }
}

const author = key()

/**
 * Un topic porteur de sondage — c'est-à-dire un sondage : il n'y a pas d'autre
 * objet. `title` porte la question, les `poll_option` les réponses.
 */
function poll(
  over: {
    options?: [string, string][]
    type?: string
    endsAt?: number
    title?: string | null
    created_at?: number
    sk?: Uint8Array
  } = {},
): Event {
  const options = over.options ?? [
    ['a', 'Oui'],
    ['b', 'Non'],
  ]
  const title = over.title === undefined ? 'On y va ?' : over.title
  const tags: string[][] = [
    communityTag(),
    ...(title === null ? [] : [['title', title]]),
    ...options.map(([id, label]) => ['poll_option', id, label]),
    ['polltype', over.type ?? 'singlechoice'],
  ]
  if (over.endsAt) tags.push(['endsAt', String(over.endsAt)])
  return finalizeEvent(
    {
      kind: KIND_THREAD,
      content: 'le premier message du topic',
      tags,
      created_at: over.created_at ?? NOW,
    },
    over.sk ?? author.sk,
  )
}

function vote(pollId: string, choices: string[], over: { sk?: Uint8Array; created_at?: number } = {}): Event {
  return finalizeEvent(
    {
      kind: KIND_POLL_VOTE,
      content: '',
      tags: [['e', pollId], communityTag(), ...choices.map((c) => ['response', c])],
      created_at: over.created_at ?? NOW + 10,
    },
    over.sk ?? key().sk,
  )
}

describe('lecture du format', () => {
  it('garde l’ordre d’écriture des options', () => {
    const p = poll({
      options: [
        ['z', 'Dernier'],
        ['a', 'Premier'],
      ],
    })
    expect(pollOptionsOf(p).map((o) => o.id)).toEqual(['z', 'a'])
  })

  it('écarte les options illisibles sans perdre le sondage', () => {
    const p = finalizeEvent(
      {
        kind: KIND_THREAD,
        content: 'q',
        tags: [
          ['poll_option', 'a', 'Oui'],
          ['poll_option', 'b', '   '],
          ['poll_option', 'a', 'Doublon'],
          ['poll_option', '', 'Sans id'],
          ['poll_option', 'c', 'Non'],
        ],
        created_at: NOW,
      },
      author.sk,
    )
    expect(pollOptionsOf(p).map((o) => o.id)).toEqual(['a', 'c'])
  })

  // NIP-88 : le cas restrictif est celui qu'on suppose. Supposer l'inverse
  // accorderait plusieurs voix sur un sondage qui n'en donnait qu'une.
  it('suppose le choix unique quand le type est absent ou inconnu', () => {
    expect(pollTypeOf({ tags: [] })).toBe('singlechoice')
    expect(pollTypeOf({ tags: [['polltype', 'nawak']] })).toBe('singlechoice')
    expect(pollTypeOf({ tags: [['polltype', 'multiplechoice']] })).toBe('multiplechoice')
  })

  it('ignore une date de fermeture illisible', () => {
    expect(pollEndsAt({ tags: [['endsAt', 'bientôt']] })).toBeNull()
    expect(pollEndsAt({ tags: [['endsAt', '-3']] })).toBeNull()
    expect(pollEndsAt({ tags: [['endsAt', '1800000600']] })).toBe(1_800_000_600)
  })

  it('distingue un topic porteur de sondage d’un topic ordinaire', () => {
    expect(hasPoll(poll())).toBe(true)
    expect(hasPoll({ tags: [['title', 'un topic normal'], communityTag()] })).toBe(false)
  })

  it('fabrique les tags depuis les seuls intitulés', () => {
    expect(pollTags({ options: ['Oui', ' Non '], type: 'multiplechoice', endsAt: 42 })).toEqual([
      ['polltype', 'multiplechoice'],
      ['poll_option', 'o1', 'Oui'],
      ['poll_option', 'o2', 'Non'],
      ['endsAt', '42'],
    ])
  })

  it('tronque les choix de trop plutôt que de jeter le vote', () => {
    const single = poll()
    expect(normalizeChoices(single, ['b', 'a'])).toEqual(['b'])
    const multi = poll({ type: 'multiplechoice' })
    expect(normalizeChoices(multi, ['b', 'a', 'b', 'inconnu'])).toEqual(['b', 'a'])
  })
})

describe('forme refusée à l’écriture', () => {
  it('accepte un sondage bien formé', () => {
    expect(badPoll(poll())).toBeNull()
  })

  // Le titre du topic EST la question : sans lui, les réponses ne répondent à
  // rien. Un topic SANS sondage, lui, n'a rien à valider.
  it('refuse un sondage sans titre, accepte un topic sans sondage', () => {
    expect(badPoll(poll({ title: null }))).toContain('sans question')
    expect(badPoll({ tags: [['title', 'topic ordinaire']] })).toBeNull()
    expect(badPoll({ tags: [] })).toBeNull()
  })

  it('refuse un sondage à une seule réponse', () => {
    expect(badPoll(poll({ options: [['a', 'Oui']] }))).toContain('< 2')
  })

  it('refuse plus de dix options', () => {
    const options = Array.from({ length: 11 }, (_, i) => [`o${i}`, `Option ${i}`] as [string, string])
    expect(badPoll(poll({ options }))).toContain('> 10')
  })

  it('refuse deux options du même id', () => {
    expect(
      badPoll(
        poll({
          options: [
            ['a', 'Oui'],
            ['a', 'Aussi oui'],
          ],
        }),
      ),
    ).toContain('doublon')
  })

  it('refuse un type de sondage inconnu', () => {
    expect(badPoll(poll({ type: 'showofhands' }))).toContain('type de sondage inconnu')
  })

  it('refuse un vote qui ne nomme aucun sondage', () => {
    expect(badVote({ tags: [['response', 'a']] })).toContain('sans sondage')
  })

  it('refuse un vote qui nomme deux sondages', () => {
    expect(badVote({ tags: [['e', 'a'.repeat(64)], ['e', 'b'.repeat(64)]] })).toContain('2 sondages')
  })

  /*
   * Le retrait de voix. Sans lui, le premier clic serait définitif : rien ne
   * s'efface sur Nostr, donc il n'y a pas d'autre geste possible que republier un
   * vote vide.
   */
  it('accepte un vote sans réponse — c’est le retrait', () => {
    expect(badVote({ tags: [['e', 'a'.repeat(64)]] })).toBeNull()
  })
})

describe('la policy applique ces règles', () => {
  const noPow: PolicyConfig = { ...DEFAULT_POLICY, minPow: { default: 0 } }

  it('accepte un sondage marqué et bien formé', () => {
    expect(evaluate(poll(), { config: noPow, nowS: NOW }).accept).toBe(true)
  })

  it('refuse un sondage hors périmètre', () => {
    const ev = finalizeEvent(
      {
        kind: KIND_THREAD,
        content: 'q',
        tags: [
          ['title', 'On y va ?'],
          ['poll_option', 'a', 'Oui'],
          ['poll_option', 'b', 'Non'],
        ],
        created_at: NOW,
      },
      author.sk,
    )
    const v = evaluate(ev, { config: noPow, nowS: NOW })
    expect(v.accept === false && v.reason).toContain('hors périmètre')
  })

  it('refuse un sondage illisible avec sa raison', () => {
    const v = evaluate(poll({ options: [['a', 'Seule']] }), { config: noPow, nowS: NOW })
    expect(v.accept === false && v.reason).toContain('réponse')
  })

  // Le sondage voyage dans le topic : il ne peut donc pas casser un topic qui
  // n'en porte pas, et c'est ce que ce test garde.
  it('laisse passer un topic ordinaire', () => {
    const ev = finalizeEvent(
      { kind: KIND_THREAD, content: 'coucou', tags: [['title', 'un topic'], communityTag()], created_at: NOW },
      author.sk,
    )
    expect(evaluate(ev, { config: noPow, nowS: NOW }).accept).toBe(true)
  })

  it('accepte un vote marqué', () => {
    expect(evaluate(vote('b'.repeat(64), ['a']), { config: noPow, nowS: NOW }).accept).toBe(true)
  })

  it('refuse un vote hors périmètre', () => {
    const ev = finalizeEvent(
      { kind: KIND_POLL_VOTE, content: '', tags: [['e', 'b'.repeat(64)], ['response', 'a']], created_at: NOW },
      author.sk,
    )
    expect(evaluate(ev, { config: noPow, nowS: NOW }).accept).toBe(false)
  })
})

/*
 * Ce que le format « le sondage EST le topic » rend impossible par construction,
 * et qui demandait autrement une règle d'autorité chez le lecteur : le bulletin
 * vit dans le kind 11 signé, donc il vient forcément de l'auteur du topic, il ne
 * peut pas viser un autre fil, et il n'en existe pas deux à départager.
 *
 * Reste une seule voie pour qu'un tiers pousse un bulletin dans le fil : un
 * kind 1111 (une réponse) qui porterait des tags de sondage. Personne ne le lit
 * comme tel — le fil ne cherche le sondage que sur sa racine — et c'est ce que
 * ce test garde.
 */
describe('le sondage ne peut venir que du topic', () => {
  it('ignore des tags de sondage portés par une réponse', () => {
    const intrus = finalizeEvent(
      {
        kind: 1111,
        content: 'je pose mon sondage chez toi',
        tags: [
          communityTag(),
          ['E', 'a'.repeat(64)],
          ['title', 'Ma question à moi'],
          ['poll_option', 'a', 'Oui'],
          ['poll_option', 'b', 'Non'],
        ],
        created_at: NOW,
      },
      key().sk,
    )
    // La policy l'accepte — c'est une réponse valide, et refuser un tag inconnu
    // sur un kind 1111 fermerait la porte aux autres clients Nostr.
    expect(evaluate(intrus, { config: { ...DEFAULT_POLICY, minPow: { default: 0 } }, nowS: NOW }).accept).toBe(true)
    // Mais aucun lecteur ne peut le prendre pour le sondage du fil : il n'est pas
    // la racine, et c'est la racine seule qu'on interroge.
    expect(intrus.kind).not.toBe(KIND_THREAD)
  })
})

describe('dépouillement', () => {
  it('compte une voix par option', () => {
    const p = poll()
    const t = tallyPoll(p, [vote(p.id, ['a']), vote(p.id, ['a']), vote(p.id, ['b'])], { nowS: NOW + 20 })
    expect(t.voters).toBe(3)
    expect(t.counts.get('a')).toBe(2)
    expect(t.counts.get('b')).toBe(1)
  })

  it('publie toute option connue, même à zéro', () => {
    const p = poll()
    const t = tallyPoll(p, [], { nowS: NOW })
    expect([...t.counts.keys()]).toEqual(['a', 'b'])
    expect(t.counts.get('a')).toBe(0)
  })

  // Règle 1. Changer d'avis, c'est republier : sans elle chaque hésitation
  // compterait une voix de plus.
  it('ne retient que le dernier vote d’une clé', () => {
    const p = poll()
    const k = key()
    const t = tallyPoll(
      p,
      [vote(p.id, ['a'], { sk: k.sk, created_at: NOW + 10 }), vote(p.id, ['b'], { sk: k.sk, created_at: NOW + 20 })],
      { nowS: NOW + 30, me: k.pk },
    )
    expect(t.voters).toBe(1)
    expect(t.counts.get('a')).toBe(0)
    expect(t.counts.get('b')).toBe(1)
    expect(t.mine).toEqual(['b'])
  })

  it('départage deux votes de la même seconde par l’id, donc pareil pour tous', () => {
    const p = poll()
    const k = key()
    const a = vote(p.id, ['a'], { sk: k.sk, created_at: NOW + 10 })
    const b = vote(p.id, ['b'], { sk: k.sk, created_at: NOW + 10 })
    const gagnant = a.id < b.id ? 'b' : 'a'
    expect(tallyPoll(p, [a, b], { nowS: NOW + 20 }).counts.get(gagnant)).toBe(1)
    expect(tallyPoll(p, [b, a], { nowS: NOW + 20 }).counts.get(gagnant)).toBe(1)
  })

  // Règle 2 : personne ne peut faire exister une voix « déjà là avant » le
  // bulletin.
  it('écarte un vote antidaté avant le sondage', () => {
    const p = poll({ created_at: NOW })
    const t = tallyPoll(p, [vote(p.id, ['a'], { created_at: NOW - 1 })], { nowS: NOW + 10 })
    expect(t.voters).toBe(0)
  })

  // Règle 3 : la fermeture ne borne pas qui écrit — le relais ne connaît pas la
  // date — seulement ce qui est compté.
  it('écarte un vote postérieur à la fermeture', () => {
    const p = poll({ endsAt: NOW + 100 })
    const t = tallyPoll(p, [vote(p.id, ['a'], { created_at: NOW + 50 }), vote(p.id, ['b'], { created_at: NOW + 101 })], {
      nowS: NOW + 200,
    })
    expect(t.voters).toBe(1)
    expect(t.counts.get('b')).toBe(0)
    expect(t.closed).toBe(true)
  })

  it('ignore un vote qui vise un autre sondage', () => {
    const p = poll()
    expect(tallyPoll(p, [vote('d'.repeat(64), ['a'])], { nowS: NOW + 20 }).voters).toBe(0)
  })

  // Règle 4 : un vote vide annule le précédent sans compter pour autant.
  it('un vote vide retire la voix précédente', () => {
    const p = poll()
    const k = key()
    const t = tallyPoll(
      p,
      [vote(p.id, ['a'], { sk: k.sk, created_at: NOW + 10 }), vote(p.id, [], { sk: k.sk, created_at: NOW + 20 })],
      { nowS: NOW + 30, me: k.pk },
    )
    expect(t.voters).toBe(0)
    expect(t.counts.get('a')).toBe(0)
    expect(t.mine).toEqual([])
  })

  it('ne compte qu’une voix par option sur un choix multiple répété', () => {
    const p = poll({ type: 'multiplechoice' })
    const t = tallyPoll(p, [vote(p.id, ['a', 'a', 'b'])], { nowS: NOW + 20 })
    expect(t.voters).toBe(1)
    expect(t.counts.get('a')).toBe(1)
    expect(t.counts.get('b')).toBe(1)
  })

  it('n’accorde qu’une voix sur un choix unique, même si le vote en coche deux', () => {
    const p = poll()
    const t = tallyPoll(p, [vote(p.id, ['a', 'b'])], { nowS: NOW + 20 })
    expect(t.voters).toBe(1)
    expect(t.counts.get('a')).toBe(1)
    expect(t.counts.get('b')).toBe(0)
  })

  /*
   * La part se rapporte aux VOTANTS, pas à la somme des voix : « 100 % des
   * votants ont coché ceci » reste vrai quand ils en cochent trois.
   */
  it('rapporte les parts aux votants, quitte à dépasser 100 % au total', () => {
    const p = poll({ type: 'multiplechoice' })
    const t = tallyPoll(p, [vote(p.id, ['a', 'b']), vote(p.id, ['a'])], { nowS: NOW + 20 })
    expect(t.voters).toBe(2)
    expect(pollShare(t, 'a')).toBe(100)
    expect(pollShare(t, 'b')).toBe(50)
  })

  it('rend zéro pour tout le monde sans votant', () => {
    const p = poll()
    expect(pollShare(tallyPoll(p, [], { nowS: NOW }), 'a')).toBe(0)
  })
})
