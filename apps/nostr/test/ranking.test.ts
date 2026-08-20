import { describe, it, expect } from 'vitest'
import { compareTopicRows } from '../utils/nostr'
import type { TopicRow } from '../types/nostr'

/**
 * Le classement est testé ici et pas à l'écran parce que ses cas décisifs
 * demandent de contrôler l'heure des messages à la seconde, ce qui n'est pas
 * reproductible à la main sur un relais peuplé.
 *
 * ⚠️ Ce fichier tenait auparavant l'ordre par date pour un bug : un topic à une
 * réponse passait devant deux topics à vingt-quatre, et le premier écran du forum
 * annonçait son coin le plus mort. C'est maintenant le comportement voulu — voir
 * le pourquoi dans `utils/nostr.ts`. Ce qui a fait changer d'avis n'est pas ce cas
 * mais son opposé : la vélocité bougeait sans qu'un message arrive, donc la liste
 * se réordonnait continuellement sous les yeux du lecteur.
 */
function row(over: Partial<TopicRow> & { id: string }): TopicRow {
  return {
    title: `topic ${over.id}`,
    pubkey: 'f'.repeat(64),
    createdAt: 1_700_000_000,
    lastAt: 1_700_000_000,
    lastPubkey: 'f'.repeat(64),
    lastText: '',
    replies: 0,
    people: 0,
    vel: 0,
    ...over,
  }
}

function order(rows: TopicRow[]): string[] {
  return [...rows].sort(compareTopicRows).map((r) => r.id)
}

describe('compareTopicRows', () => {
  it('le dernier message remonte le topic', () => {
    const rows = [
      row({ id: 'vieux', replies: 40, lastAt: 1_700_000_100 }),
      row({ id: 'recent', replies: 2, lastAt: 1_700_000_500 }),
      row({ id: 'entre-deux', replies: 12, lastAt: 1_700_000_300 }),
    ]
    expect(order(rows)).toEqual(['recent', 'entre-deux', 'vieux'])
  })

  it('la vélocité ne décide plus rien — elle ne sert que le rail de chauffe', () => {
    // Un brasier dont le dernier message a une seconde de retard passe derrière.
    // C'est le renoncement assumé : l'ordre est prévisible, pas optimal.
    const rows = [
      row({ id: 'brasier', replies: 40, people: 12, vel: 30, lastAt: 1_700_000_400 }),
      row({ id: 'calme', replies: 1, people: 1, vel: 0, lastAt: 1_700_000_401 }),
    ]
    expect(order(rows)).toEqual(['calme', 'brasier'])
  })

  it('un « up » sur un topic mort le remet en tête — accepté, pas un bug', () => {
    const mort = row({ id: 'mort', replies: 1, people: 1, lastAt: 1_700_000_900 })
    const vit = row({ id: 'vit', replies: 24, people: 10, vel: 8, lastAt: 1_700_000_800 })
    expect(order([vit, mort])).toEqual(['mort', 'vit'])
  })

  it('départage sur le volume à la seconde égale', () => {
    // Deux topics touchés dans la même seconde : sans ce départage l'ordre
    // dépendrait de l'ordre d'arrivée des events, donc de rien de lisible.
    const rows = [
      row({ id: 'court', replies: 5, lastAt: 1_700_000_500 }),
      row({ id: 'long', replies: 60, lastAt: 1_700_000_500 }),
    ]
    expect(order(rows)).toEqual(['long', 'court'])
  })

  it('ignore l’heure courante : deux appels donnent le même ordre', () => {
    // La propriété qui a motivé le changement. Elle tient par construction — la
    // comparaison ne lit aucune horloge — et c'est ce qui garantit qu'une rangée
    // ne bouge que si un message est arrivé.
    const rows = [
      row({ id: 'a', replies: 3, vel: 4, lastAt: 1_700_000_200 }),
      row({ id: 'b', replies: 3, vel: 9, lastAt: 1_700_000_100 }),
    ]
    expect(order(rows)).toEqual(order(rows))
    expect(order(rows)).toEqual(['a', 'b'])
  })

  it('ne renvoie 0 que pour deux rangées réellement équivalentes', () => {
    const a = row({ id: 'a', replies: 3, lastAt: 42 })
    const b = row({ id: 'b', replies: 3, lastAt: 42 })
    expect(compareTopicRows(a, b)).toBe(0)
    expect(compareTopicRows(a, row({ id: 'c', replies: 4, lastAt: 42 }))).toBeGreaterThan(0)
  })
})
