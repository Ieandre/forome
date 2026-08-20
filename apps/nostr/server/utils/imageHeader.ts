/**
 * Type et dimensions d'une image, lus dans son en-tête.
 *
 * ## Pourquoi ce fichier existe
 *
 * L'API RisiBank ne renvoie **aucune dimension** (voir `risibank.ts`), alors que
 * le tag `imeta` en exige une : sans `dim`, un sticker qui finit de charger
 * décale le fil au moment où il arrive, et le lecteur perd sa ligne (spec §450).
 * Il faut donc les déduire des octets.
 *
 * Le type est déduit des mêmes octets, et **pas** du `content-type` de l'hôte :
 * on ressert ces octets depuis notre origine, donc la seule source d'autorité
 * acceptable est le contenu lui-même. Un hôte qui annonce `image/png` sur autre
 * chose ne doit pas pouvoir nous faire poser cette étiquette.
 *
 * Aucune dépendance, et aucun décodage : on ne lit que l'en-tête. Décoder une
 * image pour connaître sa taille ferait passer des octets hostiles dans un
 * décodeur, ce qui est exactement la classe de bug qu'on ne veut pas côté
 * serveur.
 */

export interface ImageHeader {
  mime: string
  width: number
  height: number
}

function u16be(b: Uint8Array, at: number): number | null {
  const hi = b[at]
  const lo = b[at + 1]
  return hi === undefined || lo === undefined ? null : (hi << 8) | lo
}

function u16le(b: Uint8Array, at: number): number | null {
  const lo = b[at]
  const hi = b[at + 1]
  return hi === undefined || lo === undefined ? null : (hi << 8) | lo
}

function u24le(b: Uint8Array, at: number): number | null {
  const a = b[at]
  const c = b[at + 1]
  const d = b[at + 2]
  return a === undefined || c === undefined || d === undefined ? null : a | (c << 8) | (d << 16)
}

function u32be(b: Uint8Array, at: number): number | null {
  const a = b[at]
  const c = b[at + 1]
  const d = b[at + 2]
  const e = b[at + 3]
  if (a === undefined || c === undefined || d === undefined || e === undefined) return null
  // `>>> 0` : un PNG déclarant une largeur ≥ 2³¹ donnerait un négatif en `<<`.
  return ((a << 24) | (c << 16) | (d << 8) | e) >>> 0
}

function matches(b: Uint8Array, at: number, ascii: string): boolean {
  for (let i = 0; i < ascii.length; i++) {
    if (b[at + i] !== ascii.charCodeAt(i)) return false
  }
  return true
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function png(b: Uint8Array): ImageHeader | null {
  if (PNG_SIGNATURE.some((byte, i) => b[i] !== byte)) return null
  // IHDR est normativement le premier chunk : largeur et hauteur sont donc
  // toujours à 16 et 20, sans avoir à parcourir les chunks.
  if (!matches(b, 12, 'IHDR')) return null
  const width = u32be(b, 16)
  const height = u32be(b, 20)
  return width && height ? { mime: 'image/png', width, height } : null
}

function gif(b: Uint8Array): ImageHeader | null {
  if (!matches(b, 0, 'GIF87a') && !matches(b, 0, 'GIF89a')) return null
  const width = u16le(b, 6)
  const height = u16le(b, 8)
  return width && height ? { mime: 'image/gif', width, height } : null
}

/**
 * Marqueurs « début de trame » qui portent les dimensions. Les trous (C4, C8,
 * CC) sont des tables de Huffman et d'arithmétique : même forme de segment,
 * mais pas de dimensions dedans.
 */
function isStartOfFrame(marker: number): boolean {
  if (marker === 0xc4 || marker === 0xc8 || marker === 0xcc) return false
  return marker >= 0xc0 && marker <= 0xcf
}

/**
 * JPEG : contrairement à PNG et GIF, les dimensions ne sont pas à une position
 * fixe — il faut sauter de segment en segment jusqu'au SOF. Un JPEG d'appareil
 * photo place plusieurs kilo-octets d'EXIF avant (les échantillons RisiBank en
 * ont), donc la boucle est la seule option.
 */
function jpeg(b: Uint8Array): ImageHeader | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null

  let at = 2
  while (at < b.length) {
    // Un remplissage de `0xff` est licite entre deux segments.
    if (b[at] !== 0xff) {
      at++
      continue
    }
    const marker = b[at + 1]
    if (marker === undefined) return null
    if (marker === 0xff) {
      at++
      continue
    }
    // Marqueurs sans charge utile : RSTn, SOI, EOI, TEM.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      at += 2
      continue
    }
    const length = u16be(b, at + 2)
    if (length === null || length < 2) return null

    if (isStartOfFrame(marker)) {
      const height = u16be(b, at + 5)
      const width = u16be(b, at + 7)
      return width && height ? { mime: 'image/jpeg', width, height } : null
    }
    // SOS : après lui vient le flux compressé, où chercher un marqueur n'a plus
    // de sens. Un JPEG sans SOF avant son SOS est illisible pour nous.
    if (marker === 0xda) return null
    at += 2 + length
  }
  return null
}

/**
 * WebP a trois formes de chunk, et aucune n'est un simple couple d'entiers :
 *   - VP8X (étendu, le cas de l'animation) porte canvas-1 sur 24 bits ;
 *   - VP8 (avec perte) cache les dimensions sur 14 bits après la trame clé ;
 *   - VP8L (sans perte) les empaquette sur 14 bits chacune, décalées de 1.
 *
 * Aucun sticker RisiBank n'était en WebP au moment d'écrire ceci (72 PNG, 4 GIF,
 * 4 JPEG sur 80), mais le format est le seul qui puisse arriver sans préavis :
 * il gère l'animation comme le GIF pour un tiers du poids.
 */
function webp(b: Uint8Array): ImageHeader | null {
  if (!matches(b, 0, 'RIFF') || !matches(b, 8, 'WEBP')) return null

  if (matches(b, 12, 'VP8X')) {
    const width = u24le(b, 24)
    const height = u24le(b, 27)
    return width !== null && height !== null ? { mime: 'image/webp', width: width + 1, height: height + 1 } : null
  }

  if (matches(b, 12, 'VP8L')) {
    const bits = u32be(b, 21)
    if (bits === null) return null
    // 14 bits de largeur puis 14 de hauteur, en petit-boutien de bits : on relit
    // l'entier à l'envers pour les extraire.
    const le = ((bits & 0xff) << 24) | (((bits >>> 8) & 0xff) << 16) | (((bits >>> 16) & 0xff) << 8) | ((bits >>> 24) & 0xff)
    const packed = le >>> 0
    return { mime: 'image/webp', width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
  }

  if (matches(b, 12, 'VP8 ')) {
    // 0x9d 0x01 0x2a est la signature de trame clé ; les dimensions suivent.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    const width = u16le(b, 26)
    const height = u16le(b, 28)
    if (width === null || height === null) return null
    // Les deux bits hauts sont l'échelle, pas la dimension.
    return { mime: 'image/webp', width: width & 0x3fff, height: height & 0x3fff }
  }

  return null
}

/**
 * Le type et les dimensions, ou null si les octets ne sont pas une image d'un
 * format qu'on affiche.
 *
 * Pas de SVG, volontairement : c'est un document qui peut porter du script, et
 * il n'a pas de dimensions en pixels de toute façon.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  return png(bytes) ?? gif(bytes) ?? jpeg(bytes) ?? webp(bytes)
}
