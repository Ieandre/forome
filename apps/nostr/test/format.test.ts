/**
 * Tests des formateurs d'affichage.
 *
 * `quotePreview` alimente la citation en tête de chaque réponse. Elle reçoit du
 * contenu venu de relais tiers, et surtout elle **remonte dans un autre post**
 * du texte écrit par quelqu'un d'autre : ce qui était masqué dans l'original doit
 * le rester dans la citation, sinon citer devient un moyen de dévoiler.
 */
import { describe, it, expect } from 'vitest'
import { quotePreview } from '../utils/format.js'

describe('quotePreview', () => {
  it('retire les marqueurs de gras, italique et barré', () => {
    expect(quotePreview('un **gras**, un *italique*, un ~~barré~~')).toBe(
      'un gras, un italique, un barré',
    )
  })

  it('écrase les sauts de ligne en une seule ligne', () => {
    expect(quotePreview('première ligne\n\n\nseconde ligne')).toBe('première ligne seconde ligne')
  })

  it('ne dévoile jamais un spoiler', () => {
    const out = quotePreview("le tueur est ||le majordome|| voilà")
    expect(out).not.toContain('majordome')
    expect(out).toContain('[spoil]')
  })

  it('ne dévoile pas un spoiler multiligne', () => {
    const out = quotePreview('||première\nseconde||')
    expect(out).not.toContain('première')
    expect(out).not.toContain('seconde')
  })

  it('ne laisse pas d’espace avant le point ou la virgule', () => {
    expect(quotePreview('un spoiler : ||caché||. Puis ||autre||, et la suite')).toBe(
      'un spoiler : [spoil]. Puis [spoil], et la suite',
    )
  })

  it('garde l’espace avant les deux-points, comme en français', () => {
    expect(quotePreview('le **verdict** : coupable')).toBe('le verdict : coupable')
  })

  it("remplace un bloc de code au lieu de l'aplatir", () => {
    const out = quotePreview('avant\n```\nconst a = 1\n```\naprès')
    expect(out).not.toContain('const a = 1')
    expect(out).toBe('avant [code] après')
  })

  it('garde le libellé des liens et jette l’URL', () => {
    expect(quotePreview('voir [la doc](https://example.com/tres/longue/url)')).toBe('voir la doc')
  })

  it('retire les marqueurs de citation et de liste', () => {
    expect(quotePreview('> cité\n- item un\n2. item deux')).toBe('cité item un item deux')
  })

  it('préserve les underscores internes des mots', () => {
    expect(quotePreview('la variable snake_case reste entière')).toBe(
      'la variable snake_case reste entière',
    )
  })

  it('tronque avec une ellipse au-delà de la longueur demandée', () => {
    const out = quotePreview('a'.repeat(400), 40)
    expect(out).toHaveLength(40)
    expect(out.endsWith('…')).toBe(true)
  })

  it('ne tronque pas un texte plus court que la limite', () => {
    expect(quotePreview('court', 40)).toBe('court')
  })

  it('rend une chaîne vide pour un contenu vide de sens', () => {
    expect(quotePreview('   \n\n  ')).toBe('')
  })
})
