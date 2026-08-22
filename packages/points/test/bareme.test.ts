import { describe, expect, it } from 'vitest'
import {
  DAILY_CAP,
  LEVEL_STEP,
  levelOf,
  levelProgress,
  minDaysForLevel,
  pointsForLevel,
} from '../src/index.js'

describe('courbe des niveaux', () => {
  it('pose les seuils annoncés', () => {
    expect(pointsForLevel(1)).toBe(0)
    expect(pointsForLevel(2)).toBe(25)
    expect(pointsForLevel(3)).toBe(75)
    expect(pointsForLevel(5)).toBe(250)
    expect(pointsForLevel(10)).toBe(1125)
    expect(pointsForLevel(20)).toBe(4750)
    expect(pointsForLevel(50)).toBe(30625)
  })

  it('coûte exactement 25 × n pour passer du niveau n au suivant', () => {
    for (let n = 1; n < 200; n++) {
      expect(pointsForLevel(n + 1) - pointsForLevel(n)).toBe(LEVEL_STEP * n)
    }
  })

  it('ne donne que des seuils entiers', () => {
    for (let n = 1; n < 500; n++) expect(Number.isInteger(pointsForLevel(n))).toBe(true)
  })

  /**
   * Le cas qui motive la correction entière de `levelOf` : sur un seuil atteint
   * pile, `sqrt` peut rendre juste en dessous. Un lecteur coincé à 74 points
   * pendant qu'un autre passe est un bug qu'on ne reproduit jamais à la main.
   */
  it('tranche juste des deux côtés de chaque seuil, sur 500 niveaux', () => {
    for (let n = 2; n < 500; n++) {
      const seuil = pointsForLevel(n)
      expect(levelOf(seuil)).toBe(n)
      expect(levelOf(seuil - 1)).toBe(n - 1)
      expect(levelOf(seuil + 1)).toBe(n)
    }
  })

  it('reste au niveau 1 en dessous du premier seuil, et sur les valeurs absurdes', () => {
    expect(levelOf(0)).toBe(1)
    expect(levelOf(24)).toBe(1)
    expect(levelOf(-100)).toBe(1)
    expect(levelOf(Number.NaN)).toBe(1)
    expect(levelOf(25)).toBe(2)
  })

  it('décrit une progression cohérente', () => {
    const p = levelProgress(100)
    expect(p.level).toBe(3)
    expect(p.into).toBe(25)
    expect(p.span).toBe(75)
    expect(p.toNext).toBe(50)
    expect(p.nextAt).toBe(150)
    expect(p.into + p.toNext).toBe(p.span)
  })

  /** Le plafond quotidien fait du niveau une durée : c'est ce qu'on affiche. */
  it('déduit une durée minimale du plafond quotidien', () => {
    expect(minDaysForLevel(2)).toBe(Math.ceil(25 / DAILY_CAP))
    expect(minDaysForLevel(20)).toBe(119)
  })
})
