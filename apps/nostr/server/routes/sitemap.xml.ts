/**
 * Sitemap servi depuis les relais : les pages fixes, puis les topics du forum
 * (voir `server/utils/seoContent.ts` — cache 10 min, périmètre `t=forome`).
 *
 * Un sitemap est fait d'URLs absolues : sans `NUXT_PUBLIC_SITE_URL`, la route
 * répond 404 plutôt que d'inventer un hôte.
 */
import { topicPath } from '../../utils/permalink'

export default defineEventHandler(async (event) => {
  const siteUrl = String(useRuntimeConfig().public.siteUrl ?? '').replace(/\/$/, '')
  if (!siteUrl) {
    throw createError({ statusCode: 404, statusMessage: 'sitemap indisponible : NUXT_PUBLIC_SITE_URL absente' })
  }

  const topics = await seoRecentTopics()

  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${siteUrl}/` },
    { loc: `${siteUrl}/comment-ca-marche` },
    ...topics.map((ev) => ({
      loc: siteUrl + topicPath(ev.id, seoTopicTitle(ev)),
      // La date du premier post : dire « ce topic a bougé » exigerait de
      // rapatrier toutes les réponses, pour un signal que Google pondère à peine.
      lastmod: new Date(ev.created_at * 1000).toISOString(),
    })),
  ]

  const body = urls
    .map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
    .join('\n')

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
})
