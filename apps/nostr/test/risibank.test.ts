/**
 * `cache_url` est une URL fournie par un tiers qui atterrit dans un `fetch`
 * **serveur**, puis dont les octets sont resservis depuis notre origine. Sans la
 * liste blanche d'hôte, un jour où l'API de RisiBank renverrait autre chose
 * (compromission, bug, champ contrôlé par l'uploadeur), on irait chercher les
 * octets où on nous le dit — et on les étiquetterait comme les nôtres.
 *
 * Les cas d'usurpation d'hôte testés ici sont des domaines que n'importe qui peut
 * déposer.
 */
import { describe, it, expect } from 'vitest'
import { safeCacheUrl, altFromSlug } from '../server/utils/risibank'

const REAL = 'https://risibank.fr/cache/medias/0/0/2/224/full.png'

describe('safeCacheUrl', () => {
  it('accepte une adresse de sticker telle que l’API la renvoie', () => {
    expect(safeCacheUrl(REAL)).toBe(REAL)
  })

  it('accepte les extensions qu’on sait lire', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) {
      expect(safeCacheUrl(`https://risibank.fr/cache/medias/0/0/0/1/full.${ext}`), ext).not.toBeNull()
    }
  })

  it('accepte le sous-domaine www', () => {
    expect(safeCacheUrl('https://www.risibank.fr/cache/medias/0/0/0/1/full.png')).not.toBeNull()
  })

  /* `endsWith('risibank.fr')` laisserait passer les deux premiers. */
  it('refuse un hôte qui ressemble au bon', () => {
    for (const host of [
      'evil-risibank.fr',
      'notrisibank.fr',
      'risibank.fr.attaquant.io',
      'risibank.com',
      'risibank.fr.evil',
      'attaquant.io',
    ]) {
      expect(safeCacheUrl(`https://${host}/cache/medias/0/0/0/1/full.png`), host).toBeNull()
    }
  })

  it('refuse un hôte glissé dans les identifiants', () => {
    expect(safeCacheUrl('https://risibank.fr@attaquant.io/full.png')).toBeNull()
  })

  it('refuse ce qui n’est pas du https', () => {
    for (const raw of [
      'http://risibank.fr/cache/medias/0/0/0/1/full.png',
      'file:///etc/passwd',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
    ]) {
      expect(safeCacheUrl(raw), raw).toBeNull()
    }
  })

  it('refuse un port explicite', () => {
    expect(safeCacheUrl('https://risibank.fr:8443/cache/medias/0/0/0/1/full.png')).toBeNull()
  })

  /* Un SVG est un document qui peut porter du script. */
  it('refuse une extension qu’on ne rend pas', () => {
    for (const ext of ['svg', 'html', 'json', 'mp4', '']) {
      expect(safeCacheUrl(`https://risibank.fr/cache/medias/0/0/0/1/full.${ext}`), ext).toBeNull()
    }
  })

  it('refuse une extension cachée dans la query', () => {
    expect(safeCacheUrl('https://risibank.fr/cache/medias/0/0/0/1/full.svg?x=.png')).toBeNull()
  })

  it('refuse une adresse illisible', () => {
    for (const raw of ['', 'pas une url', '//risibank.fr/a.png']) {
      expect(safeCacheUrl(raw), raw).toBeNull()
    }
  })
})

describe('altFromSlug', () => {
  it('rend le slug lisible', () => {
    expect(altFromSlug('risitas-sac-rire-gros-plan-espagnol')).toBe('risitas sac rire gros plan espagnol')
  })

  /* Certains slugs empilent quinze mots-clés de référencement : au-delà de six,
     le `alt` n'aide plus personne — il devient du bruit pour un lecteur d'écran. */
  it('tronque les slugs à rallonge', () => {
    const long = 'detective-inspecteur-crime-colombo-assassin-columbo-meurtre-risitas-lieutenant-enquete'
    expect(altFromSlug(long)).toBe('detective inspecteur crime colombo assassin columbo')
  })

  it('encaisse un slug vide ou biscornu', () => {
    expect(altFromSlug('')).toBe('')
    expect(altFromSlug('---')).toBe('')
    expect(altFromSlug('zidane')).toBe('zidane')
  })
})
