/**
 * Tests de la reconnaissance d'adresse d'avatar.
 *
 * Ce n'est pas du formatage : `pictureSha` est ce qui garantit que le proxy ne
 * reçoit jamais autre chose qu'un sha256. Si une URL arbitraire arrivait à en
 * sortir un, le point d'entrée deviendrait un relais ouvert utilisable pour
 * frapper n'importe quel hôte — y compris interne — depuis notre IP.
 */
import { describe, it, expect } from 'vitest'
import {
  pictureSha,
  avatarSrc,
  isImageUrl,
  postImageSrc,
  parseImeta,
  imetaTags,
  resizedDims,
  IMG_DISPLAY_MIN,
  IMG_DISPLAY_MAX,
} from '../utils/media.js'

const SHA = 'a'.repeat(64)

describe('pictureSha', () => {
  it('reconnaît une adresse Blossom nue', () => {
    expect(pictureSha(`https://blossom.band/${SHA}`)).toBe(SHA)
  })

  it('reconnaît une adresse avec extension', () => {
    expect(pictureSha(`https://blossom.band/${SHA}.webp`)).toBe(SHA)
  })

  it('ignore la query et le fragment', () => {
    expect(pictureSha(`https://blossom.band/${SHA}?x=1#y`)).toBe(SHA)
  })

  it('normalise en minuscules', () => {
    expect(pictureSha(`https://h/${'A'.repeat(64)}`)).toBe('a'.repeat(64))
  })

  it('refuse une URL sans hash', () => {
    expect(pictureSha('https://exemple.test/avatar.png')).toBeNull()
  })

  it('refuse un hash trop court', () => {
    expect(pictureSha(`https://h/${'a'.repeat(63)}`)).toBeNull()
  })

  it('refuse un hash non hexadécimal', () => {
    expect(pictureSha(`https://h/${'z'.repeat(64)}`)).toBeNull()
  })

  it("refuse un hash qui n'est pas en fin de chemin", () => {
    expect(pictureSha(`https://h/${SHA}/../../etc/passwd`)).toBeNull()
  })

  it('refuse le vide et le nul', () => {
    expect(pictureSha('')).toBeNull()
    expect(pictureSha(null)).toBeNull()
    expect(pictureSha(undefined)).toBeNull()
  })
})

describe('avatarSrc', () => {
  it('renvoie toujours notre origine, jamais celle du tiers', () => {
    const src = avatarSrc(`https://blossom.band/${SHA}.webp`)
    expect(src).toBe(`/api/media/${SHA}`)
    expect(src).not.toContain('blossom.band')
  })

  it("ne renvoie rien pour une image qu'on ne peut pas relayer", () => {
    expect(avatarSrc('https://exemple.test/moi.jpg')).toBeNull()
  })
})

describe('isImageUrl', () => {
  it('reconnaît les formats affichables', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']) {
      expect(isImageUrl(`https://h.io/a.${ext}`), ext).toBe(true)
    }
    expect(isImageUrl('https://h.io/a.PNG?v=2#x')).toBe(true)
  })

  it('refuse le SVG — c’est un document, il peut porter du script', () => {
    expect(isImageUrl('https://h.io/a.svg')).toBe(false)
  })

  it('refuse ce qui n’est pas une image sur le web', () => {
    expect(isImageUrl('https://h.io/page')).toBe(false)
    expect(isImageUrl('nostr:npub1x')).toBe(false)
    expect(isImageUrl('javascript:alert(1)//a.png')).toBe(false)
  })
})

describe('postImageSrc', () => {
  it('passe toujours par notre origine, l’adresse encodée', () => {
    const src = postImageSrc('https://media.chilio.io/a b.png?x=1&y=2')
    expect(src.startsWith('/api/img?u=')).toBe(true)
    expect(src).not.toContain('&y=2')
    expect(decodeURIComponent(src.slice('/api/img?u='.length))).toBe('https://media.chilio.io/a b.png?x=1&y=2')
  })
})

describe('parseImeta', () => {
  it('lit url, type, dimensions et texte de remplacement', () => {
    const meta = parseImeta([
      ['e', 'abc'],
      ['imeta', 'url https://h.io/a.png', 'm image/png', 'dim 800x600', 'alt un chat qui dort'],
    ])
    expect(meta['https://h.io/a.png']).toEqual({
      url: 'https://h.io/a.png',
      mime: 'image/png',
      width: 800,
      height: 600,
      alt: 'un chat qui dort',
    })
  })

  /** Sans la provenance, le rendu afficherait le sticker à l'échelle d'une photo. */
  it('relit la provenance risibank posée par imetaTags', () => {
    const img = { url: 'https://h.io/s.webp', mime: 'image/webp', width: 300, height: 300, alt: '', risibank: 4242 }
    const meta = parseImeta(imetaTags(img.url, [img]))
    expect(meta[img.url]?.risibank).toBe(4242)
  })

  it('ignore une provenance risibank mal formée', () => {
    const meta = parseImeta([['imeta', 'url https://h.io/c.png', 'risibank nawak']])
    expect(meta['https://h.io/c.png']?.risibank).toBeUndefined()
  })

  it('survit à un imeta incomplet ou mal formé', () => {
    const meta = parseImeta([['imeta', 'm image/png'], ['imeta', 'url https://h.io/b.png', 'dim nawak']])
    expect(meta['https://h.io/b.png']?.width).toBeNull()
    expect(Object.keys(meta)).toEqual(['https://h.io/b.png'])
  })
})

describe('resizedDims', () => {
  const natural = { width: 1600, height: 1200 }

  it('garde le ratio à la largeur demandée', () => {
    expect(resizedDims(natural, 400)).toEqual({ width: 400, height: 300 })
  })

  it('borne en dessous du minimum', () => {
    expect(resizedDims(natural, 3)).toEqual({ width: IMG_DISPLAY_MIN, height: 60 })
  })

  it('borne au-dessus du maximum', () => {
    expect(resizedDims(natural, 5000).width).toBe(IMG_DISPLAY_MAX)
  })

  it('ne produit jamais une hauteur nulle', () => {
    expect(resizedDims({ width: 4000, height: 1 }, 100).height).toBe(1)
  })
})

describe('imetaTags', () => {
  const img = { url: `https://blossom.band/${SHA}.webp`, mime: 'image/webp', width: 800, height: 600, alt: '' }

  it('décrit l’image et porte son empreinte', () => {
    expect(imetaTags(`voilà ${img.url} !`, [img])).toEqual([
      ['imeta', `url ${img.url}`, 'm image/webp', 'dim 800x600', `x ${SHA}`],
    ])
  })

  /** Une image retirée de l'éditeur ne doit pas laisser sa métadonnée derrière elle. */
  it('ignore une image absente du texte publié', () => {
    expect(imetaTags('finalement non', [img])).toEqual([])
  })

  it('ne décrit pas deux fois la même image', () => {
    expect(imetaTags(`${img.url} ${img.url}`, [img, img])).toHaveLength(1)
  })
})
