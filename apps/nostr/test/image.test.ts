/**
 * Tests du cadrage d'avatar.
 *
 * La traduction « ce que la fenêtre montre » → « quel carré découper » est le seul
 * endroit du parcours où une erreur ne se voit pas : rien ne plante, l'avatar est
 * simplement mal cadré ou porte une bande vide. D'où l'invariant vérifié partout
 * ici — le carré découpé reste **toujours** à l'intérieur de l'image.
 */
import { describe, it, expect } from 'vitest'
import { coverScale, clampOffset, cropFromView, type ViewState } from '../utils/image.js'

const VIEW = 232

function stateOf(imageW: number, imageH: number, zoom = 1, at = { x: 0, y: 0 }): ViewState {
  const scale = coverScale(VIEW, imageW, imageH) * zoom
  const raw = { view: VIEW, imageW, imageH, scale, offsetX: at.x, offsetY: at.y }
  const clamped = clampOffset(raw)
  return { ...raw, offsetX: clamped.x, offsetY: clamped.y }
}

/** Le carré découpé tient-il dans l'image ? À une tolérance de flottant près. */
function inside(v: ViewState): boolean {
  const c = cropFromView(v)
  const e = 0.001
  return c.x >= -e && c.y >= -e && c.x + c.size <= v.imageW + e && c.y + c.size <= v.imageH + e
}

describe('coverScale', () => {
  it("s'accroche au plus petit côté, en paysage", () => {
    expect(coverScale(200, 800, 400)).toBe(0.5)
  })

  it("s'accroche au plus petit côté, en portrait", () => {
    expect(coverScale(200, 400, 800)).toBe(0.5)
  })
})

describe('clampOffset', () => {
  it('interdit un offset positif, qui laisserait du vide à gauche', () => {
    const v = stateOf(1000, 1000, 1, { x: 50, y: 50 })
    expect(v.offsetX).toBe(0)
    expect(v.offsetY).toBe(0)
  })

  it('interdit de dépasser le bord opposé', () => {
    const v = stateOf(1000, 500, 1, { x: -99999, y: 0 })
    // Au zoom 1 sur une image en paysage, la hauteur couvre pile la fenêtre.
    expect(v.offsetX).toBeCloseTo(VIEW - 1000 * v.scale, 5)
    expect(inside(v)).toBe(true)
  })

  it('immobilise un carré au zoom 1 : il couvre exactement la fenêtre', () => {
    const v = stateOf(600, 600, 1, { x: -40, y: -40 })
    expect(v.offsetX).toBe(0)
    expect(v.offsetY).toBe(0)
  })
})

describe('cropFromView', () => {
  // `toBeCloseTo` et non `toEqual` : un offset nul produit `-0`, que `drawImage`
  // traite comme `0`. Normaliser le signe dans le code ne servirait que le test.
  it('découpe toute une image carrée au zoom 1', () => {
    const c = cropFromView(stateOf(600, 600))
    expect(c.x).toBeCloseTo(0, 5)
    expect(c.y).toBeCloseTo(0, 5)
    expect(c.size).toBeCloseTo(600, 5)
  })

  it('ne prend que le carré central visible d’un paysage', () => {
    const v = stateOf(1000, 500)
    const c = cropFromView(v)
    expect(c.size).toBeCloseTo(500, 5)
    expect(c.y).toBeCloseTo(0, 5)
  })

  it('un zoom de 2 découpe deux fois moins de pixels source', () => {
    const un = cropFromView(stateOf(800, 800, 1))
    const deux = cropFromView(stateOf(800, 800, 2))
    expect(deux.size).toBeCloseTo(un.size / 2, 5)
  })

  it('un déplacement vers la gauche avance dans l’image', () => {
    const v = stateOf(800, 800, 2, { x: -100, y: 0 })
    expect(cropFromView(v).x).toBeCloseTo(100 / v.scale, 5)
  })

  it('reste dans l’image pour toute combinaison de zoom et de poussée', () => {
    const formats: [number, number][] = [
      [1000, 500],
      [500, 1000],
      [600, 600],
      [4032, 3024],
      [17, 4000],
    ]
    for (const [w, h] of formats) {
      for (const zoom of [1, 1.37, 2, 3, 4]) {
        for (const push of [-99999, -137, 0, 137, 99999]) {
          expect(inside(stateOf(w, h, zoom, { x: push, y: push }))).toBe(true)
        }
      }
    }
  })
})
