/**
 * Les dimensions lues ici finissent dans le tag `imeta` d'events **signés** : une
 * erreur n'est pas un défaut d'affichage rattrapable, elle est publiée pour de
 * bon. Et le type déduit devient l'en-tête `content-type` que notre origine
 * annonce, donc se tromper sur lui, c'est étiqueter des octets inconnus.
 *
 * Les en-têtes sont fabriqués ici plutôt que chargés depuis des fichiers : ça
 * couvre des cas qu'aucun échantillon réel ne donne (JPEG avec plusieurs
 * segments avant le SOF, remplissage `0xff`, troncatures) et ça garde la suite
 * de tests sans binaire.
 */
import { describe, it, expect } from 'vitest'
import { readImageHeader } from '../server/utils/imageHeader'

function bytes(...parts: (number | number[] | string)[]): Uint8Array {
  const flat: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') flat.push(...[...part].map((c) => c.charCodeAt(0)))
    else if (Array.isArray(part)) flat.push(...part)
    else flat.push(part)
  }
  return new Uint8Array(flat)
}

const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff]
const le16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff]
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const le24 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const png = (w: number, h: number): Uint8Array =>
  bytes(PNG_SIG, be32(13), 'IHDR', be32(w), be32(h), [8, 6, 0, 0, 0])

const gif = (w: number, h: number, version = 'GIF89a'): Uint8Array =>
  bytes(version, le16(w), le16(h), [0xf7, 0x00, 0x00])

/** SOF0 précédé, en option, de segments qu'il faut savoir sauter. */
const jpeg = (w: number, h: number, before: number[] = []): Uint8Array =>
  bytes([0xff, 0xd8], before, [0xff, 0xc0], be16(17), 8, be16(h), be16(w), [3])

const app1 = (payload = 64): number[] => [0xff, 0xe1, ...be16(payload + 2), ...Array<number>(payload).fill(0x2a)]

describe('PNG', () => {
  it('lit les dimensions dans IHDR', () => {
    expect(readImageHeader(png(136, 102))).toEqual({ mime: 'image/png', width: 136, height: 102 })
  })

  it('accepte une image très grande sans repasser en négatif', () => {
    expect(readImageHeader(png(20000, 30000))).toEqual({ mime: 'image/png', width: 20000, height: 30000 })
  })

  it('refuse une signature abîmée', () => {
    const broken = png(10, 10)
    broken[3] = 0x00
    expect(readImageHeader(broken)).toBeNull()
  })

  it("refuse un PNG dont le premier chunk n'est pas IHDR", () => {
    expect(readImageHeader(bytes(PNG_SIG, be32(13), 'IDAT', be32(4), be32(4), [0]))).toBeNull()
  })

  it('refuse une largeur nulle', () => {
    expect(readImageHeader(png(0, 10))).toBeNull()
  })

  it('refuse un en-tête tronqué', () => {
    expect(readImageHeader(bytes(PNG_SIG, be32(13), 'IHDR', [0, 0]))).toBeNull()
  })
})

describe('GIF', () => {
  it('lit un GIF89a', () => {
    expect(readImageHeader(gif(136, 102))).toEqual({ mime: 'image/gif', width: 136, height: 102 })
  })

  it('lit aussi un GIF87a', () => {
    expect(readImageHeader(gif(64, 48, 'GIF87a'))).toEqual({ mime: 'image/gif', width: 64, height: 48 })
  })

  it('refuse une autre version', () => {
    expect(readImageHeader(gif(64, 48, 'GIF88a'))).toBeNull()
  })
})

describe('JPEG', () => {
  it('lit un SOF0 immédiat', () => {
    expect(readImageHeader(jpeg(300, 200))).toEqual({ mime: 'image/jpeg', width: 300, height: 200 })
  })

  /* Les JPEG de RisiBank portent de l'EXIF : sans ce saut, le SOF est hors de portée. */
  it('saute les segments qui précèdent (EXIF)', () => {
    expect(readImageHeader(jpeg(300, 200, app1(2048)))).toEqual({ mime: 'image/jpeg', width: 300, height: 200 })
  })

  it('saute plusieurs segments', () => {
    expect(readImageHeader(jpeg(12, 34, [...app1(16), ...app1(32), ...app1(8)]))).toEqual({
      mime: 'image/jpeg',
      width: 12,
      height: 34,
    })
  })

  it('tolère un remplissage 0xff entre deux segments', () => {
    expect(readImageHeader(jpeg(20, 30, [0xff, 0xff, 0xff, ...app1(4)]))).toEqual({
      mime: 'image/jpeg',
      width: 20,
      height: 30,
    })
  })

  it('lit un SOF2 (progressif)', () => {
    const progressive = bytes([0xff, 0xd8], [0xff, 0xc2], be16(17), 8, be16(70), be16(90), [3])
    expect(readImageHeader(progressive)).toEqual({ mime: 'image/jpeg', width: 90, height: 70 })
  })

  /* 0xc4 est une table de Huffman : même forme de segment, pas de dimensions. */
  it('ne prend pas une table de Huffman pour un SOF', () => {
    const withDht = bytes([0xff, 0xd8], [0xff, 0xc4], be16(6), [1, 2, 3, 4], [0xff, 0xc0], be16(17), 8, be16(5), be16(7), [3])
    expect(readImageHeader(withDht)).toEqual({ mime: 'image/jpeg', width: 7, height: 5 })
  })

  it('abandonne si le flux compressé commence avant tout SOF', () => {
    expect(readImageHeader(bytes([0xff, 0xd8], [0xff, 0xda], be16(8), [0, 0, 0, 0, 0, 0]))).toBeNull()
  })

  it('refuse une longueur de segment absurde', () => {
    expect(readImageHeader(bytes([0xff, 0xd8], [0xff, 0xe1], be16(1), [0]))).toBeNull()
  })
})

describe('WebP', () => {
  it('lit un VP8X (le cas des animations)', () => {
    const vp8x = bytes('RIFF', be32(30), 'WEBP', 'VP8X', be32(10), 0x10, [0, 0, 0], le24(135), le24(101))
    expect(readImageHeader(vp8x)).toEqual({ mime: 'image/webp', width: 136, height: 102 })
  })

  it('lit un VP8 avec perte', () => {
    const vp8 = bytes('RIFF', be32(30), 'WEBP', 'VP8 ', be32(10), [0, 0, 0], [0x9d, 0x01, 0x2a], le16(136), le16(102))
    expect(readImageHeader(vp8)).toEqual({ mime: 'image/webp', width: 136, height: 102 })
  })

  it('ignore les bits d’échelle du VP8', () => {
    const scaled = bytes(
      'RIFF', be32(30), 'WEBP', 'VP8 ', be32(10), [0, 0, 0], [0x9d, 0x01, 0x2a],
      le16(136 | 0x8000), le16(102 | 0x4000),
    )
    expect(readImageHeader(scaled)).toEqual({ mime: 'image/webp', width: 136, height: 102 })
  })

  it('lit un VP8L sans perte', () => {
    // 14 bits de largeur puis 14 de hauteur, décalés de 1, en petit-boutien.
    const packed = (136 - 1) | ((102 - 1) << 14)
    const vp8l = bytes('RIFF', be32(30), 'WEBP', 'VP8L', be32(10), 0x2f, [
      packed & 0xff,
      (packed >>> 8) & 0xff,
      (packed >>> 16) & 0xff,
      (packed >>> 24) & 0xff,
    ])
    expect(readImageHeader(vp8l)).toEqual({ mime: 'image/webp', width: 136, height: 102 })
  })

  it('refuse un RIFF qui n’est pas du WEBP', () => {
    expect(readImageHeader(bytes('RIFF', be32(30), 'WAVE', 'fmt ', be32(16)))).toBeNull()
  })

  it('refuse un VP8 sans signature de trame clé', () => {
    const bad = bytes('RIFF', be32(30), 'WEBP', 'VP8 ', be32(10), [0, 0, 0], [0x00, 0x01, 0x2a], le16(4), le16(4))
    expect(readImageHeader(bad)).toBeNull()
  })
})

describe('ce qui n’est pas une image', () => {
  /* Un SVG est un document qui peut porter du script : il ne doit jamais être
     reconnu, sinon on le resservirait depuis notre origine. */
  it('refuse un SVG', () => {
    expect(readImageHeader(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull()
  })

  it('refuse du HTML (la page d’erreur d’un hôte)', () => {
    expect(readImageHeader(bytes('<!DOCTYPE html><html><body>404</body></html>'))).toBeNull()
  })

  it('refuse des octets vides ou trop courts', () => {
    expect(readImageHeader(new Uint8Array(0))).toBeNull()
    expect(readImageHeader(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})
