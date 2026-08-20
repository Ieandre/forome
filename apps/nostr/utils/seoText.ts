/**
 * Les textes que les moteurs de recherche et les aperçus de lien lisent.
 *
 * Partagés entre `nuxt.config.ts` (le <head> de repli, identique pour toutes
 * les routes puisque `ssr: false`) et `server/plugins/seoHead.ts` (la version
 * par URL, injectée avant l'envoi du HTML) : une seule source, pour que le
 * repli et l'injecté ne racontent jamais deux choses différentes.
 */

export const SEO_SITE_NAME = 'Forome'

export const SEO_DEFAULT_DESCRIPTION =
  'Le forum généraliste de la culture 18-25, sur Nostr : tu lis en deux secondes, ' +
  'tu postes sans compte, et rien ne peut être retiré du réseau.'

export const SEO_DOC_TITLE = 'Comment ça marche'

export const SEO_DOC_DESCRIPTION =
  'Ce qu’est ce forum, ce qu’est un message signé, où il va — et ce que le ' +
  'système ne saura jamais faire.'
