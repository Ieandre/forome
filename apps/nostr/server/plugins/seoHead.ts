/**
 * Le <head> par URL que `ssr: false` ne peut pas produire.
 *
 * Le squelette servi est identique pour toutes les routes ; ce hook est le
 * seul endroit où le serveur peut encore différencier `/t/<slug>-<id>` de
 * l'accueil avant que le HTML ne parte. On y répare la seule partie qui compte
 * pour un moteur de recherche ou un aperçu de lien — <title>, description,
 * canonical, Open Graph — lue des relais avec cache (`server/utils/seoContent`).
 *
 * Les routes absentes de l'aiguillage (admin, dm, profils…) gardent le
 * squelette nu : elles sont `noindex` (routeRules) et exclues par robots.txt.
 */
import { topicIdFromParam, topicPath } from '../../utils/permalink'
import { SEO_DEFAULT_DESCRIPTION, SEO_DOC_DESCRIPTION, SEO_DOC_TITLE, SEO_SITE_NAME } from '../../utils/seoText'

const HEX64 = /^[0-9a-f]{64}$/

/** Remplace le tag qui matche `re`, ou l'ajoute s'il n'existe pas. */
function setHeadTag(head: string[], re: RegExp, tag: string): void {
  for (let i = 0; i < head.length; i++) {
    if (re.test(head[i]!)) {
      head[i] = head[i]!.replace(re, tag)
      return
    }
  }
  head.push(tag)
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:html', async (html, { event }) => {
    const path = event.path.split(/[?#]/)[0] ?? '/'

    let title = SEO_SITE_NAME
    let heading = SEO_SITE_NAME
    let description = SEO_DEFAULT_DESCRIPTION
    let canonicalPath: string | null = null
    let jsonLd: Record<string, unknown> | null = null

    if (path === '/') {
      canonicalPath = '/'
    } else if (path === '/comment-ca-marche') {
      title = `${SEO_DOC_TITLE} — ${SEO_SITE_NAME}`
      heading = SEO_DOC_TITLE
      description = SEO_DOC_DESCRIPTION
      canonicalPath = '/comment-ca-marche'
    } else if (path.startsWith('/t/')) {
      let param = path.slice('/t/'.length)
      try {
        param = decodeURIComponent(param)
      } catch {}
      const id = topicIdFromParam(param)
      if (!HEX64.test(id)) return
      const ev = await seoFetchTopic(id)
      if (!ev) return
      const topic = seoTopicTitle(ev)
      title = `${topic} — ${SEO_SITE_NAME}`
      heading = topic
      description = seoExcerpt(ev.content) || SEO_DEFAULT_DESCRIPTION
      canonicalPath = topicPath(ev.id, topic)
      // Le balisage que Google demande pour les résultats enrichis de forums.
      // L'auteur est sa clé : le nom (kind 0) coûterait une requête relais de
      // plus pour un champ que rien n'oblige à être un nom civil.
      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'DiscussionForumPosting',
        headline: topic,
        text: description,
        datePublished: new Date(ev.created_at * 1000).toISOString(),
        author: { '@type': 'Person', identifier: ev.pubkey },
      }
    } else {
      return
    }

    const safeTitle = escapeHtml(title)
    const safeDescription = escapeHtml(description)

    setHeadTag(html.head, /<title>[^<]*<\/title>/, `<title>${safeTitle}</title>`)
    setHeadTag(
      html.head,
      /<meta name="description" content="[^"]*">/,
      `<meta name="description" content="${safeDescription}">`,
    )
    html.head.push(
      `<meta property="og:title" content="${safeTitle}">`,
      `<meta property="og:description" content="${safeDescription}">`,
    )

    const siteUrl = String(useRuntimeConfig().public.siteUrl ?? '').replace(/\/$/, '')
    if (siteUrl && canonicalPath) {
      const url = escapeHtml(siteUrl + canonicalPath)
      html.head.push(`<link rel="canonical" href="${url}">`, `<meta property="og:url" content="${url}">`)
      if (jsonLd) jsonLd.url = siteUrl + canonicalPath
    }

    if (jsonLd) {
      // `<` échappé : un contenu de topic contenant `</script>` sortirait du tag.
      html.head.push(
        `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
      )
    }

    // La seule matière lisible sans JavaScript : sans elle, la page est un
    // document vide et se classe comme tel.
    html.bodyPrepend.push(
      `<noscript><h1>${escapeHtml(heading)}</h1><p>${safeDescription}</p></noscript>`,
    )
  })
})
