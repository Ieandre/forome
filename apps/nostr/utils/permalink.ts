/**
 * Chemin d'un topic : le titre en slug, puis l'id hex de l'event.
 *
 * ⚠️ L'id reste **entier**, et c'est le seul point non négociable ici. Il est la
 * seule clé de récupération : le topic est demandé aux relais par filtre `ids`
 * exact (`stores/topics.ts`, `fetchRoot`), et le préfixe d'id a été retiré de
 * NIP-01. Un id tronqué ne serait résolvable que pour les topics déjà en
 * mémoire — donc jamais pour un lien reçu de l'extérieur, qui est précisément ce
 * que ces URLs servent à faire.
 *
 * Le slug, lui, ne sert qu'à se lire : rien ne le vérifie au retour.
 */

const HEX64 = /^[0-9a-f]{64}$/
const SLUG_MAX = 60

/** Slug ASCII minuscule, coupé au mot. Vide si le titre n'a rien de latin. */
export function slugifyTitle(title: string): string {
  const flat = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (flat.length <= SLUG_MAX) return flat
  const cut = flat.slice(0, SLUG_MAX)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '')
}

/**
 * Sans titre connu — un lien depuis un profil ne connaît pas la racine qu'il
 * cite — on émet l'URL nue : `pages/t/[id].vue` la réécrit quand le titre
 * arrive.
 */
export function topicPath(id: string, title?: string | null): string {
  if (!HEX64.test(id)) return `/t/${id}` // pseudo-topics (flux global)
  const slug = title ? slugifyTitle(title) : ''
  return slug ? `/t/${slug}-${id}` : `/t/${id}`
}

/**
 * Id lu en **fin** de segment : c'est ce qui garde valides les liens `/t/<id>`
 * nus déjà partagés, et ce qui rend l'id insensible au slug qui le précède.
 */
export function topicIdFromParam(param: string): string {
  if (HEX64.test(param)) return param
  const tail = param.slice(-64)
  return HEX64.test(tail) ? tail : param
}
