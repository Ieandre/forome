/**
 * Avatars : du champ `picture` d'un kind 0 vers une adresse qu'on accepte de
 * charger.
 *
 * ⚠️ Le proxy ne prend **qu'un sha256**, jamais une URL. Un proxy qui accepterait
 * une URL arbitraire serait un relais ouvert : n'importe qui s'en servirait pour
 * frapper des hôtes tiers, y compris des adresses internes, depuis notre IP.
 * L'adressage par contenu de Blossom ferme la porte par construction.
 *
 * Conséquence assumée : un `picture` qui n'est pas adressé par sha256 (une URL
 * posée depuis un autre client Nostr) n'est **pas affiché** — on retombe sur
 * l'identicon. Le charger en direct rendrait à son hébergeur l'IP de chaque
 * lecteur, ce que la spec §8 refuse (l. 612).
 */

const SHA256_RE = /(^|\/)([0-9a-f]{64})(\.[a-z0-9]{1,5})?$/i

/** Le sha256 d'une URL Blossom, ou null si l'adresse n'est pas adressée par contenu. */
export function pictureSha(url: string | null | undefined): string | null {
  if (!url) return null
  // Le chemin suffit : la query et le fragment ne portent pas le hash, et les
  // inclure ferait rater les URL qui en ont un.
  const path = url.split(/[?#]/)[0] ?? ''
  return SHA256_RE.exec(path)?.[2]?.toLowerCase() ?? null
}

/**
 * L'adresse à mettre dans un `src`, ou null s'il n'y a rien d'affichable.
 * Toujours notre origine : le lecteur ne contacte jamais l'hôte d'images.
 */
export function avatarSrc(url: string | null | undefined): string | null {
  const sha = pictureSha(url)
  return sha ? `/api/media/${sha}` : null
}

/* ------------------------------------------------------- images des messages
 *
 * Les images d'un post ne peuvent pas passer par `avatarSrc` : elles viennent
 * d'hôtes quelconques (un autre client Nostr a publié l'URL qu'il voulait), et
 * la plupart ne sont pas adressées par contenu. D'où un second proxy,
 * `/api/img`, qui accepte une URL — mais seulement vers une adresse publique,
 * et seulement pour en ramener une image (voir `server/utils/imgGuard.ts`).
 *
 * Le principe ne change pas : c'est NOTRE serveur qui va chercher l'image, donc
 * le lecteur d'un fil ne livre son IP à aucun hébergeur tiers (spec §8).
 */

/** Extensions rendues. Pas de SVG : c'est un document, il peut porter du script. */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif)$/i

/**
 * true si l'URL désigne une image.
 *
 * Sur l'extension et non sur le `content-type` : la décision se prend au rendu,
 * donc avant toute requête. Une image servie sans extension reste un lien —
 * mieux vaut ça qu'un cadre vide sur chaque URL d'un fil.
 */
export function isImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  const path = url.split(/[?#]/)[0] ?? ''
  return IMAGE_EXT_RE.test(path)
}

/** L'adresse d'affichage d'une image de message. Toujours notre origine. */
export function postImageSrc(url: string): string {
  return `/api/img?u=${encodeURIComponent(url)}`
}

/**
 * Métadonnée d'image portée par l'event (`imeta`, NIP-92) ou produite par le
 * composeur avant publication.
 */
export interface ImageMeta {
  url: string
  mime: string | null
  width: number | null
  height: number | null
  alt: string
  /**
   * Id RisiBank, pour un sticker. Provenance seulement : le contenu est servi par
   * `url`, qui pointe sur notre copie (spec §592).
   *
   * Absent pour une image déposée par l'utilisateur — d'où la propriété
   * optionnelle plutôt qu'un `| null` : ça évite d'imposer un champ vide à tous
   * les appelants qui n'ont rien à en dire.
   */
  risibank?: number
}

/**
 * Bornes de la largeur d'affichage qu'un auteur peut donner à une image dans
 * l'éditeur. En dessous de 80 px, l'image n'est plus qu'une vignette illisible ;
 * au-dessus de 720 px, elle déborde la colonne du fil (880 px moins ses marges)
 * et le plafond de hauteur du rendu (`.rt-media`) la rognerait de toute façon.
 */
export const IMG_DISPLAY_MIN = 80
export const IMG_DISPLAY_MAX = 720

/**
 * Dimensions à publier pour une image redimensionnée par son auteur : la
 * largeur choisie, bornée, et la hauteur au même ratio.
 *
 * Elles partent dans le champ `dim` de l'`imeta` — qui publie donc la taille
 * que l'auteur a donnée à l'image, pas celle du fichier. C'est assumé : `dim`
 * sert partout à dimensionner et réserver la place de l'image (voir
 * `frameStyle` de `RichInline`), et c'est la taille d'affichage qui est la
 * bonne réponse à cette question. Le fichier, lui, reste entier derrière
 * l'URL, et son empreinte `x` reste celle des octets déposés.
 */
export function resizedDims(
  natural: { width: number; height: number },
  targetWidth: number,
): { width: number; height: number } {
  const width = Math.round(Math.min(Math.max(targetWidth, IMG_DISPLAY_MIN), IMG_DISPLAY_MAX))
  const height = Math.max(1, Math.round((natural.height * width) / natural.width))
  return { width, height }
}

/**
 * Lit les tags `imeta` d'un event (NIP-92) : `["imeta", "url …", "m …", "dim WxH", …]`.
 *
 * Les dimensions comptent plus qu'elles n'en ont l'air : sans elles, une image
 * qui arrive décale tout le fil au moment où elle se charge — dans un fil qui
 * défile en direct, c'est le lecteur qui perd sa ligne. Avec `dim`, la place est
 * réservée avant le chargement.
 */
export function parseImeta(tags: string[][]): Record<string, ImageMeta> {
  const out: Record<string, ImageMeta> = {}
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue
    const fields = new Map<string, string>()
    for (const part of tag.slice(1)) {
      const sp = part.indexOf(' ')
      if (sp > 0) fields.set(part.slice(0, sp), part.slice(sp + 1).trim())
    }
    const url = fields.get('url')
    if (!url) continue
    const dim = /^(\d{1,5})x(\d{1,5})$/.exec(fields.get('dim') ?? '')
    // Sans relire la provenance ici, le rendu ne peut pas distinguer un sticker
    // d'une photo — et l'afficherait à l'échelle d'une photo.
    const risibank = /^\d{1,10}$/.exec(fields.get('risibank') ?? '')
    out[url] = {
      url,
      mime: fields.get('m') ?? null,
      width: dim ? Number(dim[1]) : null,
      height: dim ? Number(dim[2]) : null,
      alt: fields.get('alt') ?? '',
      ...(risibank ? { risibank: Number(risibank[0]) } : {}),
    }
  }
  return out
}

/**
 * Tags `imeta` à publier pour les images réellement présentes dans le message.
 *
 * Le filtre sur le contenu n'est pas une précaution de style : une image retirée
 * de l'éditeur après son dépôt laisserait sinon un `imeta` qui décrit une image
 * absente du texte — et le hash `x` d'un fichier qui n'est plus montré.
 */
export function imetaTags(content: string, images: ImageMeta[]): string[][] {
  const seen = new Set<string>()
  const tags: string[][] = []
  for (const img of images) {
    if (seen.has(img.url) || !content.includes(img.url)) continue
    seen.add(img.url)
    const parts = [`url ${img.url}`]
    if (img.mime) parts.push(`m ${img.mime}`)
    if (img.width && img.height) parts.push(`dim ${img.width}x${img.height}`)
    // `x` est le hash des octets déposés : c'est lui qui rend l'image vérifiable
    // si l'hôte la ré-encode ou disparaît (spec §8).
    const sha = pictureSha(img.url)
    if (sha) parts.push(`x ${sha}`)
    if (img.alt) parts.push(`alt ${img.alt}`)
    // Champ hors NIP-92, posé dans le même tag que l'image qu'il décrit plutôt
    // que dans un tag séparé : un client qui l'ignore lit `imeta` normalement,
    // et la provenance ne peut pas se désolidariser de son image.
    if (img.risibank) parts.push(`risibank ${img.risibank}`)
    tags.push(['imeta', ...parts])
  }
  return tags
}
