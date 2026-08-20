/**
 * Tests des URLs de topic.
 *
 * L'enjeu tient en une propriété : `topicIdFromParam` doit rendre l'id **quoi
 * qu'il y ait devant**, parce qu'un id mal lu, c'est un lien partagé qui tombe
 * sur « topic introuvable ». Les liens `/t/<id>` nus, déjà en circulation, en
 * font partie.
 */
import { describe, it, expect } from 'vitest'
import { slugifyTitle, topicPath, topicIdFromParam } from '../utils/permalink.js'

const ID = '8bdbc7490dc20264108411a5e3ba8a6b83d6ef3360fe152f2973b7386b4ce356'

describe('slugifyTitle', () => {
  it('aplatit accents, majuscules et ponctuation', () => {
    expect(slugifyTitle('Où est passé le café ?!')).toBe('ou-est-passe-le-cafe')
  })

  it('ne laisse pas de tiret en tête ni en queue', () => {
    expect(slugifyTitle('  ...Bonjour !  ')).toBe('bonjour')
  })

  it('coupe au mot, pas au milieu', () => {
    const slug = slugifyTitle(
      'les chats sont vraiment les meilleurs animaux de compagnie du monde entier',
    )
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug).toBe('les-chats-sont-vraiment-les-meilleurs-animaux-de-compagnie')
  })

  it('rend vide un titre sans caractère latin', () => {
    expect(slugifyTitle('日本語 🎉')).toBe('')
  })
})

describe('topicPath', () => {
  it('met le slug devant et l’id complet en queue', () => {
    expect(topicPath(ID, 'Les chats, c’est la vie')).toBe(`/t/les-chats-c-est-la-vie-${ID}`)
  })

  it('garde l’id entier — jamais tronqué', () => {
    expect(topicPath(ID, 'un titre')).toContain(ID)
  })

  it('tombe sur l’URL nue sans titre exploitable', () => {
    expect(topicPath(ID)).toBe(`/t/${ID}`)
    expect(topicPath(ID, '')).toBe(`/t/${ID}`)
    expect(topicPath(ID, '🎉')).toBe(`/t/${ID}`)
  })

  it('laisse les pseudo-topics intacts', () => {
    expect(topicPath('firehose')).toBe('/t/firehose')
  })
})

describe('topicIdFromParam', () => {
  it('lit l’id derrière un slug', () => {
    expect(topicIdFromParam(`les-chats-c-est-la-vie-${ID}`)).toBe(ID)
  })

  it('accepte un id nu (liens déjà partagés)', () => {
    expect(topicIdFromParam(ID)).toBe(ID)
  })

  it('ne se fait pas déborder par un slug qui finit en hexa', () => {
    expect(topicIdFromParam(`deadbeefcafe-${ID}`)).toBe(ID)
  })

  it('rend le segment tel quel pour un pseudo-topic', () => {
    expect(topicIdFromParam('firehose')).toBe('firehose')
  })

  it('fait l’aller-retour pour n’importe quel titre', () => {
    for (const title of ['Où ça ?', 'a', 'AAAA'.repeat(40), '日本語', '---']) {
      expect(topicIdFromParam(topicPath(ID, title).slice('/t/'.length))).toBe(ID)
    }
  })
})
