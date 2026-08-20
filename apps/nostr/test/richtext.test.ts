/**
 * Tests du texte enrichi.
 *
 * La moitié de ces tests ne vérifie pas le formatage mais **l'absence
 * d'exécution** : ce parseur traite du contenu venu de relais tiers, donc
 * d'inconnus, sur le chemin parcouru par chaque message affiché. Une faille ici
 * touche tous les lecteurs, pas seulement l'auteur du message.
 */
import { describe, it, expect } from 'vitest'
import { parseInline, parseRichText, hasMarkup, type InlineToken, type Block } from '../utils/richtext.js'

/** Aplatit l'arbre en texte, pour vérifier ce qui serait affiché. */
function flatten(tokens: InlineToken[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'text':
          return t.value
        case 'code':
          return t.value
        case 'link':
          return t.label
        case 'image':
          return t.alt
        default:
          return flatten(t.children)
      }
    })
    .join('')
}

function types(tokens: InlineToken[]): string[] {
  return tokens.map((t) => t.type)
}

describe('aucune exécution possible', () => {
  it('ne transforme jamais du HTML en HTML — il reste du texte', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    const tokens = parseInline(evil)
    expect(types(tokens)).toEqual(['text'])
    // le texte est rendu tel quel : c'est le renderer qui l'insère comme texte,
    // donc le navigateur ne l'interprétera jamais
    expect(flatten(tokens)).toBe(evil)
  })

  it('refuse un lien javascript: et le rend comme du texte', () => {
    const tokens = parseInline('[clique ici](javascript:alert(1))')
    expect(types(tokens)).not.toContain('link')
    expect(flatten(tokens)).toContain('javascript')
  })

  it('refuse data: et vbscript:', () => {
    for (const scheme of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)', 'VBScript:x', 'JavaScript:x']) {
      const tokens = parseInline(`[x](${scheme})`)
      expect(types(tokens), scheme).not.toContain('link')
    }
  })

  it('accepte http, https, nostr et mailto', () => {
    for (const href of ['https://a.fr', 'http://a.fr', 'nostr:npub1abc', 'mailto:a@b.fr']) {
      const tokens = parseInline(`[x](${href})`)
      expect(types(tokens), href).toEqual(['link'])
    }
  })

  it("ne se fait pas piéger par un schéma déguisé", () => {
    // espaces, retours, casse : autant de tentatives classiques de contournement
    for (const href of [' javascript:alert(1)', 'java\tscript:alert(1)', '/\\/evil.fr', '//evil.fr']) {
      const tokens = parseInline(`[x](${href})`)
      expect(types(tokens), href).not.toContain('link')
    }
  })
})

describe('robustesse', () => {
  it("ne déborde pas la pile sur une imbrication absurde", () => {
    const bomb = '**'.repeat(5000) + 'x' + '**'.repeat(5000)
    expect(() => parseInline(bomb)).not.toThrow()
  })

  it('termine sur un marqueur jamais fermé', () => {
    const tokens = parseInline('**gras jamais fermé')
    expect(types(tokens)).toEqual(['text'])
    expect(flatten(tokens)).toBe('**gras jamais fermé')
  })

  it('borne le nombre de blocs', () => {
    const many = Array.from({ length: 2000 }, (_, i) => `paragraphe ${i}\n\n`).join('')
    const blocks = parseRichText(many)
    expect(blocks.length).toBeLessThanOrEqual(400)
  })

  it('accepte un bloc de code non fermé sans avaler le reste en boucle', () => {
    const blocks = parseRichText('```js\nconst a = 1\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('codeblock')
  })
})

describe('formatage en ligne', () => {
  it('gras, italique, barré, souligné, spoiler', () => {
    expect(types(parseInline('**g**'))).toEqual(['bold'])
    expect(types(parseInline('*i*'))).toEqual(['italic'])
    expect(types(parseInline('~~b~~'))).toEqual(['strike'])
    expect(types(parseInline('++s++'))).toEqual(['underline'])
    expect(types(parseInline('||spoil||'))).toEqual(['spoiler'])
  })

  it('lit le gras avant l’italique — sinon ** deviendrait deux *', () => {
    const tokens = parseInline('**gras**')
    expect(types(tokens)).toEqual(['bold'])
    expect(flatten(tokens)).toBe('gras')
  })

  it('imbrique', () => {
    const tokens = parseInline('**gras et *italique* dedans**')
    expect(tokens[0]!.type).toBe('bold')
    const inner = tokens[0]!.type === 'bold' ? tokens[0]!.children : []
    expect(types(inner)).toContain('italic')
  })

  it('ne réanalyse pas le contenu du code', () => {
    const tokens = parseInline('`**pas du gras**`')
    expect(types(tokens)).toEqual(['code'])
    expect(flatten(tokens)).toBe('**pas du gras**')
  })

  it("respecte l'échappement — un antislash échappe UN caractère", () => {
    // `\**` échappe la première étoile seulement ; la seconde reste un marqueur.
    // Pour un `**` littéral il faut donc échapper les deux, comme en Markdown.
    const tokens = parseInline('\\*\\*pas du gras\\*\\*')
    expect(types(tokens)).toEqual(['text'])
    expect(flatten(tokens)).toBe('**pas du gras**')
  })

  it("échappe un marqueur simple", () => {
    const tokens = parseInline('\\*pas d\\*italique\\*')
    expect(types(tokens)).toEqual(['text'])
    expect(flatten(tokens)).toBe('*pas d*italique*')
  })
})

describe('URLs nues', () => {
  it('détecte une URL sans balisage', () => {
    const tokens = parseInline('regarde https://exemple.fr/page voilà')
    expect(types(tokens)).toEqual(['text', 'link', 'text'])
  })

  it("n'avale pas la ponctuation finale", () => {
    const tokens = parseInline('vu sur https://exemple.fr.')
    const link = tokens.find((t) => t.type === 'link')
    expect(link && link.type === 'link' && link.href).toBe('https://exemple.fr')
    expect(flatten(tokens)).toContain('.')
  })

  it('en détecte plusieurs', () => {
    const tokens = parseInline('https://a.fr et https://b.fr')
    expect(tokens.filter((t) => t.type === 'link')).toHaveLength(2)
  })
})

describe('blocs', () => {
  it('citation, y compris imbriquée', () => {
    const blocks = parseRichText('> dit ceci\n> et cela')
    expect(blocks[0]!.type).toBe('quote')
    const inner = blocks[0]!.type === 'quote' ? blocks[0]!.children : []
    expect(inner[0]!.type).toBe('paragraph')
  })

  it('liste à puces et liste numérotée', () => {
    const bullets = parseRichText('- un\n- deux')
    expect(bullets[0]).toMatchObject({ type: 'list', ordered: false })
    expect((bullets[0] as Extract<Block, { type: 'list' }>).items).toHaveLength(2)

    const numbered = parseRichText('1. un\n2. deux')
    expect(numbered[0]).toMatchObject({ type: 'list', ordered: true })
  })

  it('bloc de code avec langage, contenu intact', () => {
    const blocks = parseRichText('```ts\nconst a = **1**\n```')
    expect(blocks[0]).toMatchObject({ type: 'codeblock', lang: 'ts' })
    expect((blocks[0] as Extract<Block, { type: 'codeblock' }>).value).toBe('const a = **1**')
  })

  it('sépare les paragraphes sur la ligne vide', () => {
    const blocks = parseRichText('un\n\ndeux')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('un paragraphe s’arrête au début d’une liste, sans ligne vide', () => {
    const blocks = parseRichText('avant\n- item')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list'])
  })
})

describe('hasMarkup', () => {
  it('faux sur du texte nu — le cas courant, qui doit rester bon marché', () => {
    expect(hasMarkup('juste une phrase normale')).toBe(false)
  })

  it('vrai dès qu’un balisage apparaît', () => {
    for (const s of ['**g**', '*i*', '~~b~~', '++u++', '`c`', '- liste', '> cite', '||spoil||', '[x](https://a.fr)']) {
      expect(hasMarkup(s), s).toBe(true)
    }
  })

  /**
   * Une URL nue devient un lien, donc elle doit ouvrir le chemin enrichi. Sans
   * ça, un message qui n'est QUE du texte et une URL affichait l'URL en encre
   * morte, alors que la même URL avec du gras à côté était cliquable.
   */
  it('vrai sur une URL nue, qui devient un lien', () => {
    expect(hasMarkup('this looks fun\nhttps://media.exemple.io/a.png')).toBe(true)
    expect(hasMarkup('http://a.fr')).toBe(true)
  })
})

describe('images', () => {
  const png = 'https://media.chilio.io/d1b15c7ed2a92318645ceea505e55dca2d1ed75f3071e99546dae28c6a200b05.png'

  /** Le cas de la capture : un message qui n'est que du texte et une URL d'image. */
  it('une URL nue d’image devient une image, pas un lien', () => {
    const tokens = parseInline(`this looks fun\n${png}`)
    expect(types(tokens)).toEqual(['text', 'image'])
    expect(tokens[1]).toEqual({ type: 'image', href: png, alt: '' })
  })

  it('une URL qui n’est pas une image reste un lien', () => {
    expect(types(parseInline('https://exemple.fr/page'))).toEqual(['link'])
  })

  it('lit ![alt](url), y compris sans texte de remplacement', () => {
    expect(parseInline(`![un chat](${png})`)[0]).toEqual({ type: 'image', href: png, alt: 'un chat' })
    expect(parseInline(`![](${png})`)[0]).toEqual({ type: 'image', href: png, alt: '' })
  })

  /** Même liste blanche que les liens : un `href` exécutable ne devient rien. */
  it('refuse un schéma dangereux', () => {
    expect(types(parseInline('![x](javascript:alert(1))'))).toEqual(['text'])
  })

  it('garde le texte autour de l’image', () => {
    const tokens = parseInline(`avant ${png} après`)
    expect(types(tokens)).toEqual(['text', 'image', 'text'])
  })

  /*
   * Le cas des stickers : « texte sticker texte sticker » sur une seule ligne est
   * la forme normale d'un message sur ce genre de forum. Le composeur sérialise
   * donc l'URL entourée d'espaces et non de sauts de ligne (voir
   * `serialize.ts`) — ces deux tests sont ce qui attraperait un retour en arrière.
   */
  it('enchaîne plusieurs images dans la même ligne', () => {
    const gif = 'https://h.tld/b.gif'
    expect(types(parseInline(`deux ${png} et ${gif} suite`))).toEqual([
      'text',
      'image',
      'text',
      'image',
      'text',
    ])
  })

  it('laisse une image au milieu du texte dans UN seul paragraphe', () => {
    const blocks = parseRichText(`avant ${png} après`)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('paragraph')
  })
})
