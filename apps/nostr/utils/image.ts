/**
 * Préparation d'un avatar : lecture du fichier, puis rendu carré d'un cadrage
 * choisi par l'utilisateur.
 *
 * Le cadrage est choisi et non déduit : un centrage automatique coupe la tête
 * d'un portrait pris en pied, et l'avatar est précisément ce sur quoi les gens
 * ne pardonnent pas.
 */

/** 400 px : plus du quadruple du plus grand usage (88 px) et net sur écran dense. */
const EDGE = 400

const QUALITY = 0.85

/** Zoom maximal. Au-delà, on agrandit du flou. */
export const MAX_ZOOM = 4

export interface LoadedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  /** Pour l'aperçu dans le cadreur. À révoquer par l'appelant. */
  url: string
}

/**
 * Le cadrage, exprimé en pixels de l'image source : le carré à découper.
 * Même repère que `drawImage`, donc aucune conversion au rendu.
 */
export interface Crop {
  x: number
  y: number
  size: number
}

/** L'état du cadreur : ce que la fenêtre montre de l'image affichée. */
export interface ViewState {
  /** Côté de la fenêtre carrée, en px CSS. */
  view: number
  imageW: number
  imageH: number
  /** Échelle d'affichage de l'image (couverture × zoom). */
  scale: number
  /** Coin haut-gauche de l'image affichée, relatif à la fenêtre. Négatif ou nul. */
  offsetX: number
  offsetY: number
}

/** Échelle à laquelle l'image couvre juste la fenêtre. Plancher du zoom. */
export function coverScale(view: number, imageW: number, imageH: number): number {
  return view / Math.min(imageW, imageH)
}

/**
 * Borne l'offset pour que l'image couvre **toujours** la fenêtre.
 *
 * C'est cette borne qui garantit qu'aucun cadrage ne peut produire une bande vide
 * sur un bord — la vérifier ici plutôt qu'à l'affichage évite d'avoir à y penser
 * dans les gestes, le zoom et le clavier séparément.
 */
export function clampOffset(v: ViewState): { x: number; y: number } {
  const minX = v.view - v.imageW * v.scale
  const minY = v.view - v.imageH * v.scale
  return {
    x: Math.min(0, Math.max(minX, v.offsetX)),
    y: Math.min(0, Math.max(minY, v.offsetY)),
  }
}

/**
 * Du repère de l'affichage vers celui de l'image source : le carré à découper.
 *
 * La fenêtre montre `view / scale` pixels sources, à partir de `-offset / scale`.
 * Même repère que `drawImage`, donc `renderAvatar` n'a plus rien à convertir.
 */
export function cropFromView(v: ViewState): Crop {
  return {
    x: -v.offsetX / v.scale,
    y: -v.offsetY / v.scale,
    size: v.view / v.scale,
  }
}

/**
 * ⚠️ `imageOrientation: 'from-image'` est obligatoire. Sans lui, `createImageBitmap`
 * ignore l'orientation EXIF alors que `<img>` l'applique : l'aperçu et le fichier
 * produit ne montreraient pas la même chose, et une photo de téléphone prise à la
 * verticale serait découpée sur son raster couché.
 */
export async function loadImage(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) throw new Error("ce fichier n'est pas une image")

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('image illisible')
  })

  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    url: URL.createObjectURL(file),
  }
}

/**
 * `image/webp` de préférence — à qualité égale il pèse la moitié d'un JPEG. Le
 * repli JPEG couvre les navigateurs dont le canvas ne sait pas l'encoder : sans
 * ce test, `toBlob` renvoie silencieusement du PNG, bien plus lourd.
 */
function pickType(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
}

export interface RenderedImage {
  blob: Blob
  type: string
}

/* ------------------------------------------------- images jointes aux messages */

/**
 * Côté maximal d'une image de message. 1600 px couvre l'affichage plein cadre sur
 * un écran dense ; au-delà on ferait payer à tout le monde le transfert de pixels
 * que personne ne voit.
 */
const POST_MAX_EDGE = 1600

/** Plafond du dépôt, aligné sur `server/api/media/index.post.ts`. */
export const POST_MAX_BYTES = 4 * 1024 * 1024

/**
 * Plafond d'un avatar animé (§16.9). Bien plus bas que celui d'une image de
 * message, et pour une raison qui n'a rien à voir avec le stockage : **un avatar
 * est rendu trente fois par écran.** Un GIF de 4 Mo dans une liste dense, c'est
 * 120 Mo décodés en boucle sur le téléphone du lecteur — nommément un bug selon
 * la spec, pas un compromis.
 */
export const AVATAR_GIF_MAX_BYTES = 1024 * 1024

/**
 * Laisse passer un GIF tel quel pour un avatar.
 *
 * Il ne peut pas être recadré : `renderAvatar` passe par un canevas, et un
 * canevas ne garde que la première image — un GIF fixe n'est plus un GIF. Donc
 * pas de carré garanti ici, et c'est `object-fit: cover` qui s'en charge à
 * l'affichage (voir `UserAvatar.vue`).
 */
export async function prepareAvatarGif(file: File): Promise<PreparedImage> {
  if (file.type !== 'image/gif') throw new Error("ce fichier n'est pas un GIF")
  if (file.size > AVATAR_GIF_MAX_BYTES) throw new Error('ce GIF dépasse 1 Mo')
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('GIF illisible')
  })
  try {
    return { blob: file, type: 'image/gif', width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

export interface PreparedImage {
  blob: Blob
  type: string
  width: number
  height: number
}

/**
 * Prépare une image choisie par l'utilisateur : redimensionnement et
 * ré-encodage.
 *
 * ⚠️ Effet de bord **voulu** : ré-encoder efface les métadonnées EXIF, donc les
 * coordonnées GPS qu'un téléphone pose dans ses photos. Sur un forum où on poste
 * sous pseudonyme, publier sa position à son insu serait le pire défaut possible
 * de cette fonctionnalité.
 *
 * Les GIF passent tels quels : les ré-encoder par un canvas ne garderait que la
 * première image, et un GIF fixe n'est plus un GIF.
 */
export async function prepareForPost(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error("ce fichier n'est pas une image")

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('image illisible')
  })

  try {
    if (file.type === 'image/gif') {
      if (file.size > POST_MAX_BYTES) throw new Error('ce GIF dépasse 4 Mo')
      return { blob: file, type: 'image/gif', width: bitmap.width, height: bitmap.height }
    }

    const scale = Math.min(1, POST_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('préparation impossible sur ce navigateur')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)

    const type = pickType()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY))
    if (!blob) throw new Error("l'image n'a pas pu être encodée")
    if (blob.size > POST_MAX_BYTES) throw new Error('image trop lourde même après réduction')

    return { blob, type, width, height }
  } finally {
    bitmap.close()
  }
}

/** Découpe `crop` dans l'image et rend un carré de 400 px. */
export async function renderAvatar(bitmap: ImageBitmap, crop: Crop): Promise<RenderedImage> {
  const canvas = document.createElement('canvas')
  canvas.width = EDGE
  canvas.height = EDGE

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('recadrage indisponible sur ce navigateur')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, EDGE, EDGE)

  const type = pickType()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY))
  if (!blob) throw new Error("l'image n'a pas pu être encodée")

  return { blob, type }
}
