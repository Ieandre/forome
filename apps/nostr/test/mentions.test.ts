/**
 * Mentions : ce qui devient un tag `p`, et qui est proposé à la frappe.
 *
 * L'enjeu du premier bloc n'est pas le parsing, c'est la notification. Un tag
 * `p` réveille quelqu'un, et l'event est parti : une mention extraite là où le
 * rendu n'en montre aucune est un dérangement qu'on ne peut plus retirer.
 */
import { describe, it, expect } from 'vitest'
import { mentionsIn, mentionTags, mentionUri, rankMentions, MAX_MENTIONS } from '~/utils/mentions'

const A = 'a'.repeat(63) + '1'
const B = 'b'.repeat(63) + '2'
const C = 'c'.repeat(63) + '3'
const NPUB_A = 'npub142424242424242424242424242424242424242424242424242ssjg3fxl'
const NPUB_B = 'npub1hwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhweqxqj78h'
const NPROFILE_A =
  'nprofile1qyg8wumn8ghj7etcv4khqmr99en8yqpq42424242424242424242424242424242424242424242424242ssztpx7z'

describe('mentionUri', () => {
  it('écrit la forme NIP-27 attendue par les autres clients', () => {
    expect(mentionUri(A)).toBe(`nostr:${NPUB_A}`)
  })
})

describe('mentionsIn', () => {
  it('lit une mention posée dans une phrase', () => {
    expect(mentionsIn(`salut nostr:${NPUB_A} ça va ?`)).toEqual([A])
  })

  it('accepte nprofile et n’en garde que la clé', () => {
    // Les relais suggérés par l'auteur ne sont pas suivis : voir le décodage.
    expect(mentionsIn(`hé nostr:${NPROFILE_A}`)).toEqual([A])
  })

  it('dédoublonne et garde l’ordre d’apparition', () => {
    expect(mentionsIn(`nostr:${NPUB_B} et nostr:${NPUB_A} puis nostr:${NPUB_B}`)).toEqual([B, A])
  })

  it('ignore une npub dans un bloc de code', () => {
    // Le rendu l'affiche littéralement : personne ne voit de mention, donc
    // personne ne doit être notifié.
    expect(mentionsIn(`voici\n\`\`\`\nnostr:${NPUB_A}\n\`\`\``)).toEqual([])
    expect(mentionsIn(`en ligne \`nostr:${NPUB_A}\``)).toEqual([])
  })

  it('lit les mentions à l’intérieur du balisage et des citations', () => {
    expect(mentionsIn(`**nostr:${NPUB_A}**`)).toEqual([A])
    expect(mentionsIn(`> nostr:${NPUB_A}`)).toEqual([A])
    expect(mentionsIn(`- nostr:${NPUB_A}`)).toEqual([A])
  })

  it('ignore une somme de contrôle invalide', () => {
    expect(mentionsIn(`nostr:${NPUB_A.slice(0, -1)}q`)).toEqual([])
  })

  it('plafonne', () => {
    const many = Array.from({ length: MAX_MENTIONS + 4 }, (_, i) => {
      // des clés distinctes, donc des npub distinctes
      const hex = i.toString(16).padStart(2, '0').repeat(32)
      return mentionUri(hex)
    }).join(' ')
    expect(mentionsIn(many)).toHaveLength(MAX_MENTIONS)
  })
})

describe('mentionTags', () => {
  it('produit un tag p par mention', () => {
    expect(mentionTags(`nostr:${NPUB_A} nostr:${NPUB_B}`)).toEqual([
      ['p', A],
      ['p', B],
    ])
  })

  it('ne re-tague pas une clé déjà taguée par le fil', () => {
    // Sinon l'auteur du parent aurait deux tags `p`, et le PREMIER est le
    // créneau NIP-22 sur lequel `notifKindOf` se replie.
    expect(mentionTags(`nostr:${NPUB_A}`, [A])).toEqual([])
  })
})

describe('rankMentions', () => {
  const pool = [
    { pubkey: A, name: 'Théo', disc: 'aaaaaa' },
    { pubkey: B, name: 'khey_bbbbbbbb', disc: null },
    { pubkey: C, name: 'Theodore', disc: 'cccccc' },
  ]

  it('sans requête, garde l’ordre du vivier — la pertinence est déjà là', () => {
    expect(rankMentions('', pool).map((c) => c.pubkey)).toEqual([A, B, C])
  })

  it('cherche sans tenir compte des accents, dans les deux sens', () => {
    expect(rankMentions('theo', pool).map((c) => c.pubkey)).toEqual([A, C])
    expect(rankMentions('théod', pool).map((c) => c.pubkey)).toEqual([C])
  })

  it('fait passer un préfixe de pseudo devant une correspondance interne', () => {
    const p = [
      { pubkey: C, name: 'petit theo', disc: null },
      { pubkey: A, name: 'theo', disc: null },
    ]
    expect(rankMentions('theo', p).map((c) => c.pubkey)).toEqual([A, C])
  })

  it('trouve par le début de la clé publique', () => {
    // Le seul recours quand deux personnes portent le même pseudo (§3.5).
    expect(rankMentions('bbbb', pool).map((c) => c.pubkey)).toEqual([B])
  })

  it('dédoublonne par clé et respecte la limite', () => {
    expect(rankMentions('', [...pool, ...pool])).toHaveLength(3)
    expect(rankMentions('', pool, 2)).toHaveLength(2)
  })

  it('ne rend rien quand la requête ne correspond à personne', () => {
    expect(rankMentions('zzz', pool)).toEqual([])
  })
})
