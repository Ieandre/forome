/**
 * Le catalogue d'apparence : ce qu'un niveau ouvre (spec §16.9).
 *
 * ## Pourquoi c'est ici et pas dans le client
 *
 * Deux endroits ont besoin de la même vérité : l'éditeur, qui propose, et le
 * fil, qui rend. S'ils divergeaient, quelqu'un choisirait une couleur que
 * personne ne verrait — ou pire, en verrait une qu'il n'a pas. Et la
 * **vérification est côté rendu, pas côté écriture** : la revendication vit dans
 * le kind 0, que la personne signe elle-même, donc n'importe qui peut déclarer
 * `forome_gradient: "arc-en-ciel"`. Ce module est le portier, et il n'a de sens
 * qu'appelé chez le lecteur.
 *
 * ## La palette est fermée, et c'est LA décision
 *
 * Un `#RRGGBB` libre produit, garanti : du gris illisible sur fond sombre, du
 * jaune fluo sur fond clair, et un pseudo qui disparaît quand le lecteur change
 * de thème — parce que la personne a choisi sa couleur dans un thème et pas dans
 * l'autre. Chaque entrée est donc un **couple** (clair, sombre), et le plancher
 * de contraste est vérifié par les tests, pas à l'oeil.
 *
 * Bénéfice qu'un sélecteur libre ne peut pas donner : **du vocabulaire.** « Le
 * mec au pseudo cramoisi » est une phrase que les gens diront ; « le mec en
 * #B21E3C » n'en est pas une. C'est la couche culturelle du §15.3, et elle
 * arrive gratuitement.
 *
 * ## L'orange est réservé
 *
 * La charte n'a qu'un signal qui doit percer : l'orange dit « ça chauffe ». Un
 * pseudo orange fabriquerait une fausse alerte dans chaque fil où il passe, et
 * le rail de chauffe cesserait de vouloir dire quelque chose. La bande de
 * teintes `RESERVED_HUE` est donc interdite à la palette — une couleur retirée
 * sur douze, pas une interdiction de couleur.
 */

/** Teintes interdites : celles de l'orange du forum (#FF5C00 -> 22, #FF6B21 -> 20). */
export const RESERVED_HUE = { from: 8, to: 45 } as const

export interface PseudoColor {
  id: string
  /** Le mot que les gens diront. C'est lui qui compte, pas la valeur. */
  label: string
  /** Niveau qui l'ouvre. */
  level: number
  light: string
  dark: string
}

export interface PseudoGradient {
  id: string
  label: string
  level: number
  /** Arrêts, du premier au dernier. Deux jeux : le contraste n'est pas le même. */
  light: string[]
  dark: string[]
}

/**
 * Six sobres puis six vives. L'ordre est celui du palier, pas celui de la
 * teinte : dans l'interface la bande se lit de gauche à droite comme une
 * progression, ce qui est vrai, plutôt que comme un nuancier, ce qui ne l'est pas.
 */
export const COLORS: readonly PseudoColor[] = [
  { id: 'ardoise', label: 'ardoise', level: 2, light: '#4a5a70', dark: '#93a7c4' },
  { id: 'mousse', label: 'mousse', level: 2, light: '#3f6b45', dark: '#79b481' },
  { id: 'prune', label: 'prune', level: 2, light: '#7a3f6b', dark: '#c98ab8' },
  { id: 'ocean', label: 'océan', level: 2, light: '#0f6a86', dark: '#54b8d8' },
  { id: 'cendre', label: 'cendre', level: 2, light: '#5c6570', dark: '#a3adb9' },
  { id: 'bruyere', label: 'bruyère', level: 2, light: '#8a4a72', dark: '#d391bb' },
  { id: 'cramoisi', label: 'cramoisi', level: 4, light: '#b21e3c', dark: '#ff7a92' },
  { id: 'turquoise', label: 'turquoise', level: 4, light: '#00706b', dark: '#3fd0c6' },
  { id: 'magenta', label: 'magenta', level: 4, light: '#a5219a', dark: '#f472e0' },
  { id: 'acide', label: 'acide', level: 4, light: '#4f7a00', dark: '#a8dd3a' },
  { id: 'indigo', label: 'indigo', level: 4, light: '#3f3fc4', dark: '#9a9aff' },
  { id: 'violet', label: 'violet', level: 4, light: '#7038c8', dark: '#c4a2ff' },
]

/**
 * Les dégradés. Pas de « coucher de soleil » : il serait à dominante orange, et
 * la règle vaut aussi pour un dégradé. `arc-en-ciel` en contient une part, mais
 * en un arrêt sur six — un dégradé multi-teintes se lit comme une décoration,
 * pas comme le remplissage uni d'un signal.
 */
export const GRADIENTS: readonly PseudoGradient[] = [
  {
    id: 'arc-en-ciel',
    label: 'arc-en-ciel',
    level: 9,
    light: ['#c81e3c', '#9c5a0a', '#4f7a00', '#00706b', '#3f3fc4', '#7038c8'],
    dark: ['#ff7a92', '#ffb45c', '#a8dd3a', '#3fd0c6', '#9a9aff', '#c4a2ff'],
  },
  {
    id: 'neon',
    label: 'néon',
    level: 9,
    light: ['#a5219a', '#3f3fc4', '#00706b'],
    dark: ['#f472e0', '#9a9aff', '#3fd0c6'],
  },
  {
    id: 'metal',
    label: 'métal',
    level: 9,
    light: ['#3d4654', '#7a8494', '#3d4654'],
    dark: ['#afb9c8', '#e9edf4', '#afb9c8'],
  },
  {
    id: 'abysse',
    label: 'abysse',
    level: 9,
    light: ['#0f4a86', '#3f3fc4', '#7038c8'],
    dark: ['#54a8d8', '#9a9aff', '#c4a2ff'],
  },
]

/** Le dégradé qui bouge — le seul mouvement du site, donc le plus rare. */
export const ANIMATION_LEVEL = 12
export const TITLE_LEVEL = 4
export const TITLE_MAX_LEN = 24
export const RING_LEVEL = 6
export const RING_GRADIENT_LEVEL = 9
/** L'avatar animé. Voir §16.9 : ce palier EST la protection, pas la récompense. */
export const GIF_AVATAR_LEVEL = 15

export type RingStyle = 'none' | 'color' | 'gradient'

/** Ce que quelqu'un déclare dans son kind 0. Déclaratif : à vérifier au rendu. */
export interface StyleClaim {
  color: string | null
  gradient: string | null
  animated: boolean
  ring: RingStyle
  title: string | null
  /**
   * L'avatar est un GIF animé (§16.9).
   *
   * Déclaré dans le kind 0 plutôt que deviné : on ne peut pas savoir qu'une
   * image est animée sans la décoder, et le décoder pour trente vignettes par
   * écran serait payer une analyse pour la quasi-totalité des avatars, qui sont
   * fixes. Le déclarer à tort ne coûte qu'à celui qui le déclare.
   */
  avatarAnim: boolean
}

export const EMPTY_STYLE: StyleClaim = {
  color: null,
  gradient: null,
  animated: false,
  ring: 'none',
  title: null,
  avatarAnim: false,
}

/** Clés du kind 0, namespacées comme `forome_signature` et pour la même raison. */
export const STYLE_FIELDS = {
  color: 'forome_color',
  gradient: 'forome_gradient',
  animated: 'forome_anim',
  ring: 'forome_ring',
  title: 'forome_title',
  avatarAnim: 'forome_avatar_anim',
} as const

/**
 * Titres interdits : ceux qui usurpent une autorité.
 *
 * ⚠️ **Cette liste ne protège pas contre un adversaire**, et il faut le savoir :
 * une graphie exotique ou un zéro à la place du « o » passent. Ce qu'elle arrête
 * est le cas honnête-paresseux, qui est le cas courant. La vraie protection est
 * ailleurs : le marqueur de staff est un objet visuel distinct (bouclier, puce
 * bleue), là où un titre est du texte en mono — quelqu'un qui écrit « modo » ne
 * ressemble pas à un modérateur, il ressemble à quelqu'un qui a écrit « modo ».
 */
const RESERVED_TITLES = [
  'admin',
  'administrateur',
  'moderateur',
  'moderation',
  'modo',
  'mod',
  'staff',
  'forome',
  'officiel',
  'operateur',
  'root',
]

/**
 * Invisibles à écraser dans un titre : contrôles, tabulation, séparateurs de
 * ligne, trait conditionnel, marques ET SURCHARGES de direction, espaces de
 * largeur nulle, isolats.
 *
 * Ce n'est pas de la cosmétique. Un titre est du texte libre posé à côté d'un
 * pseudo : sans ce filtre, un `U+202E` suffit à inverser l'ordre d'affichage de
 * la bande d'auteur, et une espace de largeur nulle à fabriquer deux titres
 * visuellement identiques.
 *
 * La première version de cette classe ne couvrait que `U+200B-200F` et laissait
 * justement passer les surcharges `U+202A-202E` — c'est-à-dire le seul groupe
 * dont l'inversion d'affichage est l'usage. Trouvé par le test, pas par relecture.
 */
const INVISIBLE = /[\u0000-\u001f\u007f\u00ad\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060\u2066-\u2069\ufeff]/g

/** Réduit un titre à sa forme comparable : minuscules, sans accents ni signes. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** true si ce titre se fait passer pour une autorité du forum. */
export function isReservedTitle(title: string): boolean {
  const f = fold(title)
  return f.length > 0 && RESERVED_TITLES.includes(f)
}

/**
 * Nettoie un titre. Rend `null` s'il n'en reste rien — un titre n'a pas de forme
 * dégradée acceptable, contrairement à un cadre.
 */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // Le titre vit sur UNE ligne, à côté d'un pseudo, dans une rangée dont la
  // hauteur est réservée à l'avance (§6.3).
  const flat = raw.replace(INVISIBLE, ' ')
  const trimmed = flat.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LEN)
  if (!trimmed || isReservedTitle(trimmed)) return null
  return trimmed
}

/** Ce qu'un niveau ouvre. Sert à l'éditeur pour proposer, et à rien d'autre. */
export function unlocks(level: number) {
  return {
    colors: COLORS.filter((c) => level >= c.level),
    gradients: GRADIENTS.filter((g) => level >= g.level),
    title: level >= TITLE_LEVEL,
    ring: level >= RING_LEVEL,
    ringGradient: level >= RING_GRADIENT_LEVEL,
    animation: level >= ANIMATION_LEVEL,
    gifAvatar: level >= GIF_AVATAR_LEVEL,
  }
}

export function colorById(id: string | null): PseudoColor | null {
  if (!id) return null
  return COLORS.find((c) => c.id === id) ?? null
}

export function gradientById(id: string | null): PseudoGradient | null {
  if (!id) return null
  return GRADIENTS.find((g) => g.id === id) ?? null
}

/** Lit une revendication depuis les champs d'un kind 0. Ne vérifie aucun droit. */
export function readStyle(fields: Record<string, unknown> | null | undefined): StyleClaim {
  if (!fields) return { ...EMPTY_STYLE }
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const ring = str(fields[STYLE_FIELDS.ring])
  return {
    color: str(fields[STYLE_FIELDS.color]),
    gradient: str(fields[STYLE_FIELDS.gradient]),
    animated: fields[STYLE_FIELDS.animated] === '1' || fields[STYLE_FIELDS.animated] === true,
    ring: ring === 'color' || ring === 'gradient' ? ring : 'none',
    title: cleanTitle(fields[STYLE_FIELDS.title]),
    avatarAnim: fields[STYLE_FIELDS.avatarAnim] === '1' || fields[STYLE_FIELDS.avatarAnim] === true,
  }
}

/**
 * **Le portier.** Ne garde d'une revendication que ce que le niveau autorise.
 *
 * Deux régimes, et la différence est délibérée :
 *   - ce qui n'a pas de forme dégradée est **jeté** (une couleur inconnue, un
 *     titre réservé) ;
 *   - ce qui en a une est **rétrogradé** — un cadre en dégradé revendiqué trop
 *     tôt devient un cadre uni si le niveau le permet. C'est la règle déjà
 *     appliquée aux masquages `illegal` d'un non-admin, qui deviennent
 *     `editorial` au lieu de disparaître : dégrader informe, jeter laisse croire
 *     à un bug.
 */
export function grantStyle(claim: StyleClaim, level: number): StyleClaim {
  const out: StyleClaim = { ...EMPTY_STYLE }

  const color = colorById(claim.color)
  if (color && level >= color.level) out.color = color.id

  const gradient = gradientById(claim.gradient)
  if (gradient && level >= gradient.level) out.gradient = gradient.id

  // L'animation n'existe pas seule : elle anime un dégradé. Revendiquée sans
  // dégradé accordé, elle n'a rien à animer.
  out.animated = Boolean(out.gradient) && claim.animated && level >= ANIMATION_LEVEL

  if (claim.ring === 'gradient') {
    out.ring = level >= RING_GRADIENT_LEVEL ? 'gradient' : level >= RING_LEVEL ? 'color' : 'none'
  } else if (claim.ring === 'color') {
    out.ring = level >= RING_LEVEL ? 'color' : 'none'
  }
  // Un cadre « dans ta couleur » sans couleur accordée n'a pas de couleur : il
  // retombe sur rien plutôt que sur une teinte par défaut, qui ferait croire à
  // un choix qu'on n'a pas fait.
  if (out.ring === 'gradient' && !out.gradient) out.ring = out.color ? 'color' : 'none'
  if (out.ring === 'color' && !out.color && !out.gradient) out.ring = 'none'

  if (claim.title && level >= TITLE_LEVEL) out.title = cleanTitle(claim.title)

  out.avatarAnim = claim.avatarAnim && level >= GIF_AVATAR_LEVEL

  return out
}

/** true si cette revendication n'affiche rien du tout. */
export function isPlainStyle(s: StyleClaim): boolean {
  return !s.color && !s.gradient && !s.title && s.ring === 'none' && !s.avatarAnim
}
