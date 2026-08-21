/**
 * Découverte de stickers : le client de l'API RisiBank.
 *
 * ## Répartition des rôles (spec §8)
 *
 * **RisiBank = découverte** — recherche, tags, collections, popularité. Ils le
 * font mieux, et refaire un moteur de recherche de stickers n'apporterait rien.
 * **Nous = durabilité** — la copie des octets et le hash dans l'event signé,
 * traités par `stickerMirror.ts`. Ce fichier ne s'occupe que du premier volet.
 *
 * ## Pourquoi tout passe par le serveur
 *
 * Trois raisons, dans cet ordre d'importance :
 *
 *   1. **L'IP du lecteur.** Un `fetch` depuis le navigateur livrerait à RisiBank
 *      l'IP de chaque utilisateur *et* ses recherches — donc ce qu'il s'apprête à
 *      poster. La spec §8 (l. 607) l'exclut explicitement.
 *   2. **Le rate limit.** Il est documenté côté RisiBank, et leur doc invite à
 *      demander une IP en liste blanche. Une seule IP sortante rend cette
 *      demande possible ; 10 000 navigateurs ne sont pas une IP.
 *   3. **Le cache.** Mutualisé pour tout le monde, il transforme un tiroir ouvert
 *      mille fois en une requête amont.
 *
 * ⚠️ **API, pas widget.** `RisiBank.activate()` injecte
 * son propre sélecteur dans la page, ce qui contredit à la fois le proxy (le
 * widget parle directement à RisiBank depuis le navigateur) et les gestes conçus
 * pour le composeur.
 */
import { readImageHeader, type ImageHeader } from './imageHeader'
import { ByteCache, Lru, TtlCache } from './lru'

const BASE = 'https://risibank.fr/api/v1'

/**
 * Le seul hôte dont on accepte de charger des octets.
 *
 * `cache_url` vient d'une réponse d'API : c'est une URL fournie par un tiers qui
 * atterrit dans un `fetch` **serveur**. Sans cette liste, un jour où leur API
 * renverrait autre chose (compromission, bug, champ contrôlé par l'uploadeur),
 * on irait chercher les octets où on nous le dit. Mesuré le 2026-08-13 : tous
 * les `cache_url` sont sur `risibank.fr/cache/medias/…`.
 */
const IMAGE_HOST = 'risibank.fr'

/** Formats qu'on sait afficher et mesurer (`imageHeader.ts`). Pas de SVG. */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i

const TIMEOUT_MS = 8000

/**
 * 5 minutes. « Les populaires du moment » doivent bouger dans la journée, mais
 * pas à chaque ouverture du tiroir.
 */
const LIST_TTL_MS = 5 * 60 * 1000

/** Les listes sont grosses (80 entrées) : on en garde peu. */
const LIST_CACHE_MAX = 64

/**
 * Table id → `cache_url`, alimentée par toute réponse qui passe ici.
 *
 * Elle existe pour que `/api/risibank/bytes?id=…` n'ait pas à rappeler l'API
 * amont pour retrouver l'adresse d'un sticker que l'utilisateur vient de voir.
 * Le chemin est pourtant dérivable de l'id (`/cache/medias/{id/1e6}/{id/1e4}/{id/100}/{id}/full.…`)
 * mais **pas l'extension**, et ce découpage est un détail d'implémentation chez
 * eux : le déduire nous casserait le jour où ils le changent.
 */
const urlById = new Lru<number, string>(20_000)

const lists = new TtlCache<unknown>(LIST_CACHE_MAX, LIST_TTL_MS)

/** Ce que l'API renvoie, réduit aux champs qu'on utilise. */
interface RawMedia {
  id: number
  cache_url: string
  slug: string
  category: string
  nsfw_category: string | null
  is_deleted: boolean
  is_locked: boolean
}

/** Un sticker tel qu'on l'expose au navigateur. */
export interface Sticker {
  id: number
  /** Texte de remplacement lisible, dérivé du slug. */
  alt: string
}

export interface StickerSearch {
  /** Tags reconnus dans la requête — RisiBank les renvoie, ils servent de suggestions. */
  tags: string[]
  stickers: Sticker[]
  hasMore: boolean
  nextPage: number | null
}

/**
 * Les deux rails qu'on expose, servis par une seule requête amont.
 *
 * `GET /medias` en renvoie quatre (`hot`, `new`, `top`, `rand`) ; on n'en garde
 * que deux. « Les classiques » est ce qu'on cherche neuf fois sur dix dans un
 * tiroir de stickers, « du moment » couvre l'actualité du forum — `new` et `rand`
 * ne répondaient à aucune intention.
 */
export interface StickerDiscovery {
  top: Sticker[]
  hot: Sticker[]
}

export type DiscoveryRail = keyof StickerDiscovery

/**
 * Valide un `cache_url` avant tout usage. Renvoie l'URL normalisée ou null.
 *
 * Le test porte sur l'hôte **exact** : `endsWith('risibank.fr')` accepterait
 * `evil-risibank.fr`, qui est un domaine que n'importe qui peut déposer.
 */
export function safeCacheUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.hostname !== IMAGE_HOST && url.hostname !== `www.${IMAGE_HOST}`) return null
  if (url.port) return null
  if (!IMAGE_EXT_RE.test(url.pathname)) return null
  return url.href
}

/**
 * Le slug RisiBank est une liste de mots-clés collés par des tirets
 * (`risitas-sac-rire-gros-plan-espagnol`). Tel quel c'est illisible dans un
 * `alt`, et c'est pourtant tout ce qu'on a comme description.
 */
export function altFromSlug(slug: string): string {
  const words = slug.split('-').filter(Boolean)
  // Certains slugs empilent quinze mots-clés de référencement ; au-delà de six
  // le `alt` n'aide plus personne.
  return words.slice(0, 6).join(' ')
}

/**
 * Écarte ce qu'on refuse d'afficher, puis mémorise l'adresse.
 *
 * Le filtre NSFW est posé **ici**, pas dans les routes : c'est le seul endroit
 * par lequel tout passe. `nsfw=false` côté API ne suffit pas — mesuré le
 * 2026-08-13, le flux `hot` sans paramètre contenait 3 stickers flaggés `soft`
 * sur 80. Le paramètre `nsfw` de leur API bascule vers la *section* NSFW, il ne
 * garantit pas l'absence de flag dans la section normale.
 *
 * ⚠️ Limite connue : un sticker non flaggé par RisiBank passe. Le même
 * échantillon contenait 3 stickers portant « nsfw » dans leur slug avec
 * `nsfw_category: null`. Le flag est déclaratif, donc ce filtre est un plancher,
 * pas une garantie.
 */
function accept(media: RawMedia): Sticker | null {
  if (media.is_deleted || media.is_locked) return null
  if (media.nsfw_category !== null) return null
  const url = safeCacheUrl(media.cache_url)
  if (!url) return null
  urlById.set(media.id, url)
  return { id: media.id, alt: altFromSlug(media.slug) }
}

function acceptAll(medias: unknown): Sticker[] {
  if (!Array.isArray(medias)) return []
  return (medias as RawMedia[]).map(accept).filter((s): s is Sticker => s !== null)
}

async function get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))

  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Pas de cookie, pas de référent : on relaie une demande, pas une identité.
    headers: { accept: 'application/json' },
  }).catch(() => null)

  if (!res) throw new Error('RisiBank injoignable')
  if (res.status === 429) throw new Error('RisiBank limite le débit')
  if (!res.ok) throw new Error(`RisiBank a répondu ${res.status}`)
  return (await res.json()) as T
}

/** Comme `get`, mais servi depuis le cache quand c'est encore frais. */
async function getCached<T>(key: string, path: string, query: Record<string, string | number> = {}): Promise<T> {
  const hit = lists.get(key) as T | null
  if (hit) return hit
  const fresh = await get<T>(path, query)
  lists.set(key, fresh)
  return fresh
}

export async function searchStickers(args: {
  query: string
  page: number
  collectionId: number | null
}): Promise<StickerSearch> {
  const query: Record<string, string | number> = { query: args.query, page: args.page }
  if (args.collectionId !== null) query.collection_id = args.collectionId

  const key = `search:${args.query}:${args.page}:${args.collectionId ?? ''}`
  const raw = await getCached<{
    tags?: unknown
    medias?: unknown
    has_more?: boolean
    next_page?: number | null
  }>(key, '/medias/search', query)

  return {
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]).filter((t) => typeof t === 'string') : [],
    stickers: acceptAll(raw.medias),
    hasMore: raw.has_more === true,
    nextPage: typeof raw.next_page === 'number' ? raw.next_page : null,
  }
}

/**
 * Ce qui ouvre le tiroir. Une seule requête amont sert les deux rails, donc
 * basculer d'un onglet à l'autre ne coûte rien.
 */
export async function discoverStickers(): Promise<StickerDiscovery> {
  const raw = await getCached<Record<string, unknown>>('home', '/medias')
  return { top: acceptAll(raw.top), hot: acceptAll(raw.hot) }
}

/** Page suivante d'un rail, pour le « en voir plus » du tiroir. */
export async function railPage(rail: DiscoveryRail, page: number): Promise<Sticker[]> {
  const raw = await getCached<unknown>(`rail:${rail}:${page}`, `/medias/${rail}`, { page })
  return acceptAll(raw)
}

/**
 * L'adresse des octets d'un sticker chez RisiBank.
 *
 * Passe par la table quand l'id a déjà été vu, sinon interroge l'API. Le second
 * cas existe parce qu'un id peut arriver d'un onglet resté ouvert pendant un
 * redémarrage du serveur, ou d'une URL fabriquée à la main.
 */
export async function cacheUrlOf(id: number): Promise<string | null> {
  const known = urlById.get(id)
  if (known) return known

  const raw = await get<RawMedia>(`/medias/${id}`).catch(() => null)
  if (!raw) return null
  // On repasse par `accept` : un sticker devenu NSFW, supprimé ou verrouillé
  // depuis qu'il a été vu ne doit pas être servi par la porte de derrière.
  return accept(raw) ? (urlById.get(id) ?? null) : null
}

export interface StickerBytes {
  bytes: Uint8Array
  header: ImageHeader
}

/**
 * 4 Mo, aligné sur le plafond de dépôt (`server/api/media/index.post.ts`) :
 * au-delà, le sticker ne pourrait de toute façon pas être copié chez nous.
 * Mesuré : un sticker PNG pèse ~17 ko, un GIF animé peut atteindre 1 Mo.
 */
const MAX_BYTES = 4 * 1024 * 1024

/**
 * Va chercher les octets d'un sticker et les mesure.
 *
 * Le type vient des **octets**, jamais de l'en-tête `content-type` de l'hôte :
 * on les ressert depuis notre origine, donc la seule autorité acceptable est le
 * contenu. Un fichier dont on ne sait pas lire l'en-tête est refusé plutôt que
 * relayé à l'aveugle.
 */
export async function fetchStickerBytes(url: string): Promise<StickerBytes | null> {
  const safe = safeCacheUrl(url)
  if (!safe) return null

  const res = await fetch(safe, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'image/*' },
  }).catch(() => null)
  if (!res?.ok) return null

  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MAX_BYTES) return null

  const bytes = new Uint8Array(await res.arrayBuffer())
  // `content-length` est déclaratif : on revérifie sur les octets reçus.
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null

  const header = readImageHeader(bytes)
  return header ? { bytes, header } : null
}

/**
 * 64 Mo d'octets de stickers en cache.
 *
 * Ce cache est ce qui protège le rate limit de RisiBank : sans lui, chaque
 * première ouverture du tiroir par chaque utilisateur déclenche 80 requêtes chez
 * eux. Avec lui, la page « populaires du moment » est servie depuis notre
 * mémoire pour tout le monde après le premier passage.
 */
const BYTE_BUDGET = 64 * 1024 * 1024

const byteCache = new ByteCache<number>(BYTE_BUDGET)

/** Les octets sont évincés par budget, l'en-tête est minuscule : deux caches. */
const headerById = new Lru<number, ImageHeader>(20_000)

/**
 * Les octets d'un sticker par son id, servis depuis le cache quand ils y sont.
 *
 * Partagé par `/api/risibank/bytes` (l'affichage) et `/api/risibank/mirror`
 * (la mesure avant dépôt) : les deux veulent exactement les mêmes octets, et le
 * second suit le premier de quelques secondes quand on clique sur un sticker.
 */
export async function stickerBytes(id: number): Promise<StickerBytes | null> {
  const bytes = byteCache.get(id)
  const header = headerById.get(id)
  if (bytes && header) return { bytes, header }

  const url = await cacheUrlOf(id)
  if (!url) return null

  const fresh = await fetchStickerBytes(url)
  if (!fresh) return null

  byteCache.set(id, fresh.bytes)
  headerById.set(id, fresh.header)
  return fresh
}
