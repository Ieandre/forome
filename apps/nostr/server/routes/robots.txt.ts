/**
 * Une route et pas un fichier `public/` : la ligne `Sitemap:` exige une URL
 * absolue, donc elle n'existe que si `NUXT_PUBLIC_SITE_URL` est posée.
 *
 * Les chemins exclus sont les pages personnelles ou d'outillage — elles portent
 * aussi `X-Robots-Tag: noindex` (routeRules), robots.txt n'étant qu'une
 * politesse que certains crawlers ignorent. `/new` est exclu parce qu'il rend
 * le même écran que `/` : l'indexer serait du contenu dupliqué.
 */
export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')

  const lines = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /moderation',
    'Disallow: /dm',
    'Disallow: /appareils',
    'Disallow: /new',
    'Disallow: /profil/',
    'Disallow: /api/',
  ]

  const siteUrl = String(useRuntimeConfig().public.siteUrl ?? '').replace(/\/$/, '')
  if (siteUrl) lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`)

  return lines.join('\n') + '\n'
})
