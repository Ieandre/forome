// @vitest-environment happy-dom
/**
 * Aller-retour balisage → DOM → balisage.
 *
 * C'est le seul endroit du projet où une perte de données est **silencieuse et
 * définitive** : corriger une faute rouvre le message dans l'éditeur, et ce qui
 * n'aurait pas survécu au voyage serait republié amputé, sur un réseau où rien
 * ne se répare. Un spoiler qui redevient du texte nu ou une image qui disparaît
 * ne lèverait aucune erreur — d'où ces tests plutôt qu'une relecture.
 *
 * La propriété visée : `serializeToMarkup(markupToDom(m)) === m`.
 */
import { describe, it, expect } from 'vitest'
import { markupToDom, serializeToMarkup } from '~/utils/serialize'
import { parseRichText } from '~/utils/richtext'

const NPUB_URI = 'nostr:npub142424242424242424242424242424242424242424242424242ssjg3fxl'
const NPUB_B_URI = 'nostr:npub1hwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhweqxqj78h'

/** Rejoue le trajet complet d'une correction : on rouvre, on referme. */
function roundTrip(markup: string): string {
  const host = document.createElement('div')
  host.appendChild(markupToDom(markup, document))
  return serializeToMarkup(host)
}

/** Le texte republié est celui d'origine, à l'octet près. */
function stable(markup: string): void {
  expect(roundTrip(markup)).toBe(markup)
}

/**
 * Aller-retour d'un balisage écrit autrement que ce que l'app produit — par un
 * autre client, ou par une version antérieure du composeur.
 *
 * Deux exigences, et elles suffisent : le texte peut être **normalisé**, mais il
 * doit vouloir exactement la même chose (mêmes blocs), et un second passage ne
 * doit plus rien changer. C'est ce qui interdit la dérive — un message qui
 * gagnerait ou perdrait une ligne à chaque correction finirait ailleurs que là
 * où son auteur l'a laissé.
 */
function normalizes(markup: string, expected: string): void {
  const once = roundTrip(markup)
  expect(once).toBe(expected)
  expect(parseRichText(once)).toEqual(parseRichText(markup))
  expect(roundTrip(once)).toBe(once)
}

describe('markupToDom → serializeToMarkup', () => {
  it('texte nu', () => {
    stable('juste une phrase')
  })

  it('lignes d’un même paragraphe', () => {
    stable('première ligne\nseconde ligne')
  })

  it('paragraphes séparés par une ligne vide', () => {
    stable('un paragraphe\n\nun autre')
  })

  it('mises en forme en ligne', () => {
    stable('du **gras**, de l’*italique*, du ~~barré~~ et du ++souligné++')
  })

  it('imbrication', () => {
    stable('**du gras avec de l’*italique* dedans**')
  })

  /** Le spoiler et le code n'ont pas de balise dédiée — ils passent par
   *  `data-markup`, et c'est exactement ce qu'un rendu de lecture perdrait. */
  it('spoiler', () => {
    stable('attention ||la fin du film|| voilà')
  })

  it('code en ligne', () => {
    stable('la fonction `evaluate()` refuse')
  })

  it('bloc de code, langage compris', () => {
    stable('```js\nconst a = 1\n```')
  })

  it('bloc de code sans langage', () => {
    stable('```\ntexte brut\n```')
  })

  it('citation', () => {
    stable('> ce qu’il a dit')
  })

  it('citation imbriquée', () => {
    stable('> > deux niveaux')
  })

  it('liste à puces', () => {
    stable('- un\n- deux\n- trois')
  })

  it('liste numérotée', () => {
    stable('1. un\n2. deux')
  })

  it('lien avec libellé', () => {
    stable('voir [la doc](https://example.org/page) pour la suite')
  })

  it('url nue', () => {
    stable('https://example.org/page')
  })

  /**
   * Une image se sérialise entourée d'espaces (le parseur en a besoin pour
   * isoler l'URL nue) alors que le texte voisin les porte déjà. Sans la
   * correction d'`appendInline`, le message gagnerait deux espaces à **chaque**
   * correction — une dérive lente et invisible.
   */
  it('image au milieu d’une phrase, sans accumuler d’espaces', () => {
    const src = 'regarde https://img.example.org/a.png c’est ça'
    const once = roundTrip(src)
    expect(once).toBe(src)
    expect(roundTrip(once)).toBe(src)
  })

  it('image seule', () => {
    stable('https://img.example.org/a.png')
  })

  /*
   * Mentions. Ce qui se perdrait ici serait une notification : la pastille de
   * l'éditeur porte la clé dans `data-mention`, et son texte visible n'est qu'un
   * pseudo. Si la sérialisation relisait ce texte, corriger un message
   * remplacerait la mention par un `@pseudo` qui ne désigne personne — donc plus
   * de tag `p`, donc plus personne de prévenu, sans le moindre message d'erreur.
   */
  it('mention au milieu d’une phrase', () => {
    stable(`salut ${NPUB_URI} tu confirmes ?`)
  })

  it('mention seule', () => {
    stable(NPUB_URI)
  })

  it('mention dans du balisage', () => {
    stable(`**${NPUB_URI}**`)
  })

  it('deux mentions et une image dans la même phrase', () => {
    stable(`${NPUB_URI} et ${NPUB_B_URI} regardez https://img.example.org/a.png`)
  })

  it('le pseudo affiché dans la pastille ne part jamais dans le message', () => {
    // Le résolveur de pseudos est cosmétique : deux libellés différents doivent
    // produire le même balisage, à l'octet près.
    const host = document.createElement('div')
    host.appendChild(markupToDom(NPUB_URI, document, () => 'Théo le grand'))
    expect(serializeToMarkup(host)).toBe(NPUB_URI)
  })

  it('caractères de balisage échappés', () => {
    stable('un astérisque littéral \\* et un backtick \\`')
  })

  /*
   * Blocs qui se touchent, sans ligne vide entre eux.
   *
   * C'est la forme qu'un message prend réellement quand on écrit une question
   * puis une liste dessous, et c'était le trou : chaque correction ajoutait une
   * ligne vide devant la liste. Invisible au rendu (le parseur saute les lignes
   * vides), donc invisible aux tests d'affichage — mais le texte republié
   * n'était plus celui qui avait été écrit, et ça se voyait partout où le
   * balisage est montré brut : l'historique, et le panneau de modération.
   */
  it('paragraphe puis liste, sans ligne vide', () => {
    stable('ca dit quoi ????\n1. oui\n2. ++non++')
  })

  it('paragraphe puis citation, sans ligne vide', () => {
    stable('salut\n> ce qu’il a dit')
  })

  it('paragraphe puis bloc de code, sans ligne vide', () => {
    stable('voici\n```\nx = 1\n```')
  })

  it('liste puis paragraphe, sans ligne vide', () => {
    stable('- un\n- deux\net voilà')
  })

  /* Les cas où la ligne vide est au contraire indispensable : sans elle, les
     deux blocs n'en font plus qu'un à la relecture. */
  it('deux listes de même type restent deux listes', () => {
    stable('- un\n\n- autre liste')
  })

  it('deux citations restent deux citations', () => {
    stable('> première\n\n> seconde')
  })

  it('message composite', () => {
    stable(
      [
        'Salut, **regarde** ça :',
        '> il disait que `x` valait 3',
        '- un',
        '- deux',
        'et voilà https://example.org/fin',
      ].join('\n'),
    )
  })

  /**
   * La ligne vide devant une citation ou une liste ne sert à rien : le chevron
   * et la puce marquent déjà le début du bloc. Elle est donc retirée une fois,
   * sans que le message change de sens — et pas une deuxième.
   */
  it('les lignes vides superflues sont retirées une fois, et une seule', () => {
    normalizes(
      'Salut :\n\n> il disait ça\n\n- un\n- deux\n\net voilà',
      'Salut :\n> il disait ça\n- un\n- deux\net voilà',
    )
  })

  it('la ligne vide entre deux paragraphes, elle, est indispensable et reste', () => {
    stable('premier paragraphe\n\nsecond paragraphe')
  })

  it('message vide', () => {
    stable('')
  })
})
