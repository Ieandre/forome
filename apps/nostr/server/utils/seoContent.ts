/**
 * Ce que le serveur sait raconter d'un forum en SPA.
 *
 * `ssr: false` (voir `nuxt.config.ts`) : le HTML servi est le même squelette
 * pour toutes les URLs, et le contenu n'arrive qu'en WebSocket après montage —
 * un crawler ou un aperçu de messagerie ne voit donc rien. Ce module lit des
 * relais, côté serveur et avec cache, le strict nécessaire pour décrire chaque
 * URL : un topic par id (title + amorce), la liste des topics (sitemap).
 *
 * Lecture seule, mêmes cibles que le client (`utils/relayTargets.ts`) : le
 * relais local en dev, le nôtre en production, les publics tant qu'il n'est pas
 * déployé. Rien n'est écrit, jamais.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { KIND_THREAD, communityFilter, inCommunity } from '@forome/relay-policy'
import { readTargets } from '../../utils/relayTargets'
import { quotePreview } from '../../utils/format'
import { TtlCache } from './lru'

const pool = new SimplePool()

function relays(): string[] {
  const pub = useRuntimeConfig().public
  return readTargets({
    dev: import.meta.dev === true,
    homeRelay: String(pub.homeRelay ?? ''),
    devRelay: String(pub.devRelay ?? ''),
    publicRelays: Array.isArray(pub.relays) ? pub.relays.map(String) : [],
  })
}

/**
 * Même règle que `topicTitle` (`utils/nostr.ts`), recopiée : ce fichier-là
 * importe par alias `~/` et tirerait le reste du client dans le bundle Nitro.
 */
export function seoTopicTitle(ev: NostrEvent): string {
  const tag = ev.tags.find((t) => (t[0] === 'title' || t[0] === 'subject') && t[1])
  if (tag?.[1]) return tag[1].trim()
  const first = ev.content.trim().split('\n')[0] ?? ''
  return first.length > 90 ? `${first.slice(0, 90)}…` : first || '(sans titre)'
}

/** L'amorce d'un topic au format « meta description » : du texte plat, court. */
export function seoExcerpt(content: string): string {
  return quotePreview(content, 160)
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/**
 * Le `null` aussi est mis en cache : un id inconnu (lien mort, relais muet) ne
 * doit pas coûter `maxWait` à chaque hit d'un crawler. Revers assumé : un topic
 * demandé avant que le relais ne l'ait sert le squelette nu pendant un TTL.
 */
const topicCache = new TtlCache<{ ev: NostrEvent | null }>(500, 5 * 60_000)

export async function seoFetchTopic(id: string): Promise<NostrEvent | null> {
  const hit = topicCache.get(id)
  if (hit) return hit.ev
  let ev: NostrEvent | null = null
  try {
    ev = await pool.get(relays(), { ids: [id], kinds: [KIND_THREAD] }, { maxWait: 2500 })
  } catch {
    ev = null
  }
  // Hors périmètre = hors forum : pas de meta pour un fil qui n'est pas à nous.
  if (ev && !inCommunity(ev)) ev = null
  topicCache.set(id, { ev })
  return ev
}

const listCache = new TtlCache<NostrEvent[]>(1, 10 * 60_000)

export async function seoRecentTopics(limit = 500): Promise<NostrEvent[]> {
  const hit = listCache.get('topics')
  if (hit) return hit
  let events: NostrEvent[] = []
  try {
    events = await pool.querySync(
      relays(),
      { kinds: [KIND_THREAD], ...communityFilter(), limit },
      { maxWait: 5000 },
    )
  } catch {
    events = []
  }
  const seen = new Set<string>()
  const topics = events
    .filter((ev) => inCommunity(ev) && !seen.has(ev.id) && seen.add(ev.id))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
  // Une liste vide n'est pas mise en cache : relais injoignable ≠ forum vide.
  if (topics.length > 0) listCache.set('topics', topics)
  return topics
}
