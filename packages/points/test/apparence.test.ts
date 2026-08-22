import { describe, expect, it } from 'vitest'
import {
  ANIMATION_LEVEL,
  COLORS,
  GRADIENTS,
  GIF_AVATAR_LEVEL,
  RESERVED_HUE,
  RING_GRADIENT_LEVEL,
  RING_LEVEL,
  STYLE_FIELDS,
  TITLE_LEVEL,
  TITLE_MAX_LEN,
  cleanTitle,
  grantStyle,
  isReservedTitle,
  readStyle,
  unlocks,
  type StyleClaim,
} from '../src/apparence.js'

/* -------------------------------------------------------------- couleur */

/** Les deux surfaces sur lesquelles un pseudo se lit (assets/css/main.css). */
const SURFACE_LIGHT = '#ffffff'
const SURFACE_DARK = '#141922'
/** Plancher AA pour du texte normal. Un pseudo est en gras 14 px : pas « large ». */
const FLOOR = 4.5

function channel(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  )
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

function hue(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return -1 // gris : pas de teinte, donc jamais dans une bande
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return ((h * 60) % 360 + 360) % 360
}

/**
 * Le test qui rend la palette extensible sans danger.
 *
 * Une couleur ajoutée à l'oeil finit toujours par être celle qui disparaît chez
 * quelqu'un — et le « quelqu'un » est un lecteur dans l'autre thème, donc
 * quelqu'un qu'on ne voit pas en développant. Ici c'est mesuré, dans les deux
 * thèmes, pour chaque entrée.
 */
describe('plancher de contraste', () => {
  for (const c of COLORS) {
    it(`${c.label} se lit dans les deux thèmes`, () => {
      expect(contrast(c.light, SURFACE_LIGHT)).toBeGreaterThanOrEqual(FLOOR)
      expect(contrast(c.dark, SURFACE_DARK)).toBeGreaterThanOrEqual(FLOOR)
    })
  }

  /** Pour un dégradé, c'est l'arrêt le PIRE qui décide : le texte le traverse. */
  for (const g of GRADIENTS) {
    it(`${g.label} se lit sur chacun de ses arrêts`, () => {
      for (const stop of g.light) expect(contrast(stop, SURFACE_LIGHT)).toBeGreaterThanOrEqual(3)
      for (const stop of g.dark) expect(contrast(stop, SURFACE_DARK)).toBeGreaterThanOrEqual(3)
    })
  }
})

/**
 * L'orange du forum est le seul signal qui doit percer. Une couleur de pseudo
 * dans sa bande fabriquerait une fausse alerte dans chaque fil où elle passe.
 * C'est une règle de la charte, donc elle est testée et pas seulement écrite.
 */
describe('bande réservée à l’orange', () => {
  for (const c of COLORS) {
    it(`${c.label} n’empiète pas sur l’orange`, () => {
      for (const v of [c.light, c.dark]) {
        const h = hue(v)
        if (h < 0) continue
        expect(h < RESERVED_HUE.from || h > RESERVED_HUE.to).toBe(true)
      }
    })
  }
})

describe('catalogue', () => {
  it('n’a aucun identifiant en double', () => {
    const ids = [...COLORS.map((c) => c.id), ...GRADIENTS.map((g) => g.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ouvre les paliers dans l’ordre annoncé', () => {
    expect(unlocks(1).colors).toHaveLength(0)
    expect(unlocks(2).colors).toHaveLength(6)
    expect(unlocks(4).colors).toHaveLength(12)
    expect(unlocks(4).title).toBe(true)
    expect(unlocks(3).title).toBe(false)
    expect(unlocks(RING_LEVEL).ring).toBe(true)
    expect(unlocks(RING_GRADIENT_LEVEL).gradients).toHaveLength(4)
    expect(unlocks(ANIMATION_LEVEL).animation).toBe(true)
    expect(unlocks(GIF_AVATAR_LEVEL).gifAvatar).toBe(true)
    expect(unlocks(GIF_AVATAR_LEVEL - 1).gifAvatar).toBe(false)
  })
})

/* --------------------------------------------------------------- portier */

const claim = (over: Partial<StyleClaim> = {}): StyleClaim => ({
  color: null,
  gradient: null,
  animated: false,
  ring: 'none',
  title: null,
  avatarAnim: false,
  ...over,
})

describe('le portier', () => {
  it('accorde ce que le niveau permet', () => {
    expect(grantStyle(claim({ color: 'ardoise' }), 2).color).toBe('ardoise')
    expect(grantStyle(claim({ color: 'cramoisi' }), 4).color).toBe('cramoisi')
  })

  /** Le coeur du système : la revendication est signée par la personne elle-même. */
  it('refuse ce qui est revendiqué trop tôt', () => {
    expect(grantStyle(claim({ color: 'cramoisi' }), 2).color).toBeNull()
    expect(grantStyle(claim({ gradient: 'arc-en-ciel' }), 8).gradient).toBeNull()
    expect(grantStyle(claim({ title: 'gardien du seuil' }), 3).title).toBeNull()
  })

  it('refuse une couleur qui n’existe pas', () => {
    expect(grantStyle(claim({ color: 'or-legendaire' }), 99).color).toBeNull()
  })

  /** Dégrader informe ; jeter laisse croire à un bug. Même règle que `illegal`. */
  it('rétrograde un cadre en dégradé plutôt que de le supprimer', () => {
    const s = grantStyle(claim({ color: 'ardoise', ring: 'gradient' }), RING_LEVEL)
    expect(s.ring).toBe('color')
  })

  it('n’accorde aucun cadre sous son palier', () => {
    expect(grantStyle(claim({ color: 'ardoise', ring: 'color' }), RING_LEVEL - 1).ring).toBe('none')
  })

  it('n’anime rien sans dégradé à animer', () => {
    const s = grantStyle(claim({ color: 'ardoise', animated: true }), 99)
    expect(s.animated).toBe(false)
    const avec = grantStyle(claim({ gradient: 'neon', animated: true }), 99)
    expect(avec.animated).toBe(true)
  })

  it('n’anime pas sous le palier de l’animation', () => {
    const s = grantStyle(claim({ gradient: 'neon', animated: true }), ANIMATION_LEVEL - 1)
    expect(s.gradient).toBe('neon')
    expect(s.animated).toBe(false)
  })

  it('ne laisse pas un cadre « ta couleur » sans couleur', () => {
    expect(grantStyle(claim({ ring: 'color' }), 99).ring).toBe('none')
  })
})

/* ----------------------------------------------------------------- titre */

describe('titre libre', () => {
  it('borne la longueur', () => {
    expect(cleanTitle('x'.repeat(200))).toHaveLength(TITLE_MAX_LEN)
  })

  it('aplatit ce qui casserait la rangée', () => {
    expect(cleanTitle('deux\nlignes')).toBe('deux lignes')
    expect(cleanTitle('  trop   d espaces  ')).toBe('trop d espaces')
  })

  /**
   * Sans ce filtre, une marque de direction suffit à inverser l'affichage de la
   * bande d'auteur, et une espace de largeur nulle à fabriquer deux titres
   * visuellement identiques.
   */
  it('écrase les invisibles', () => {
    expect(cleanTitle('a​b')).toBe('a b')
    expect(cleanTitle('‮khey')).toBe('khey')
    expect(cleanTitle('‏')).toBeNull()
  })

  it('refuse d’usurper une autorité du forum', () => {
    expect(isReservedTitle('modo')).toBe(true)
    expect(isReservedTitle('Modérateur')).toBe(true)
    expect(isReservedTitle('  ADMIN ')).toBe(true)
    expect(cleanTitle('staff')).toBeNull()
    expect(isReservedTitle('gardien du seuil')).toBe(false)
  })

  it('laisse passer un titre ordinaire', () => {
    expect(cleanTitle('gardien du seuil')).toBe('gardien du seuil')
  })
})

/* ------------------------------------------------------------- lecture kind 0 */

describe('avatar animé', () => {
  it("n'est accordé qu'au dernier palier", () => {
    const c = claim({ avatarAnim: true })
    expect(grantStyle(c, GIF_AVATAR_LEVEL - 1).avatarAnim).toBe(false)
    expect(grantStyle(c, GIF_AVATAR_LEVEL).avatarAnim).toBe(true)
  })
})

describe('lecture depuis le kind 0', () => {
  it('lit les champs namespacés', () => {
    const s = readStyle({
      [STYLE_FIELDS.color]: 'prune',
      [STYLE_FIELDS.gradient]: 'neon',
      [STYLE_FIELDS.animated]: '1',
      [STYLE_FIELDS.ring]: 'gradient',
      [STYLE_FIELDS.title]: 'gardien du seuil',
    })
    expect(s).toEqual({
      color: 'prune',
      gradient: 'neon',
      animated: true,
      ring: 'gradient',
      title: 'gardien du seuil',
      avatarAnim: false,
    })
  })

  it('ne rend rien d’un profil sans apparence', () => {
    expect(readStyle({ name: 'khey' })).toEqual({
      color: null,
      gradient: null,
      animated: false,
      ring: 'none',
      title: null,
      avatarAnim: false,
    })
    expect(readStyle(null).color).toBeNull()
  })

  it('ignore un cadre inconnu plutôt que de le deviner', () => {
    expect(readStyle({ [STYLE_FIELDS.ring]: 'or-massif' }).ring).toBe('none')
  })

  it("n'accorde rien à un profil qui revendique tout au niveau 1", () => {
    const tout = readStyle({
      [STYLE_FIELDS.color]: 'cramoisi',
      [STYLE_FIELDS.gradient]: 'arc-en-ciel',
      [STYLE_FIELDS.animated]: '1',
      [STYLE_FIELDS.ring]: 'gradient',
      [STYLE_FIELDS.title]: 'le boss',
      [STYLE_FIELDS.avatarAnim]: '1',
    })
    const accorde = grantStyle(tout, 1)
    expect(accorde).toEqual({
      color: null,
      gradient: null,
      animated: false,
      ring: 'none',
      title: null,
      avatarAnim: false,
    })
    expect(TITLE_LEVEL).toBeGreaterThan(1)
  })
})
