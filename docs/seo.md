# SEO — ce qu'un moteur de recherche voit de Forome

Le client est une SPA (`ssr: false`) et le contenu arrive des relais en
WebSocket après montage : sans rien d'autre, toutes les URLs servent le même
document vide, et le forum n'existe pas pour un crawler ni pour l'aperçu de
lien d'une messagerie. Le dispositif ci-dessous répare ça **sans basculer en
SSR** — le rendu reste client, seul le `<head>` (et un bloc `<noscript>`)
devient propre à chaque URL.

## Le mécanisme

Tout passe par le serveur Nitro, qui tourne déjà pour `/api/media` :

- **`server/plugins/seoHead.ts`** — hook `render:html`, exécuté à chaque
  requête HTML. Pour `/`, `/comment-ca-marche` et `/t/<slug>-<id>`, il pose
  `<title>`, `meta description`, `og:*`, le `canonical` et un `<noscript>`
  avec le titre et l'amorce. Pour un topic, ces valeurs sont **lues des
  relais côté serveur** (l'event kind 11, par id), et un JSON-LD
  `DiscussionForumPosting` est ajouté — le balisage que Google demande pour
  les résultats enrichis de forums.
- **`server/utils/seoContent.ts`** — la lecture relais : mêmes cibles que le
  client (`utils/relayTargets.ts` : relais local en dev, le nôtre en prod,
  les publics en repli), lecture seule, cache TTL (5 min par topic, y compris
  les ids inconnus ; 10 min pour la liste).
- **`server/routes/sitemap.xml.ts`** — pages fixes + topics du périmètre
  `t=forome`, triés du plus récent au plus ancien.
- **`server/routes/robots.txt.ts`** — exclut les pages personnelles et
  d'outillage ; la ligne `Sitemap:` n'apparaît que si l'origine est connue.
- **`routeRules`** (`nuxt.config.ts`) — `X-Robots-Tag: noindex` sur `/admin`,
  `/moderation`, `/dm`, `/appareils`, `/profil/**` et `/new` (même écran que
  `/`, l'indexer serait un doublon).
- **`utils/seoText.ts`** — les textes par défaut, partagés entre le `<head>`
  de repli de `nuxt.config.ts` et le plugin serveur.

Le `<head>` de repli reste servi tel quel pour toute route hors aiguillage :
le plugin ne touche à rien qu'il ne connaît pas.

## À faire au déploiement

- **Poser `NUXT_PUBLIC_SITE_URL`** (`https://<domaine>`, sans slash final).
  Sans elle : pas de `canonical`, pas d'`og:url`, et `/sitemap.xml` répond
  404 plutôt que d'inventer un hôte.
- Déployer en **serveur Node** (`node .output/server/index.mjs`), pas en
  statique — déjà requis par `/api/media`. Node ≥ 22 : la lecture relais
  utilise le WebSocket natif.
- Déclarer le sitemap dans Google Search Console / Bing Webmaster Tools.

## Limites connues (assumées)

- **Le corps des topics reste rendu client.** Un crawler voit le titre,
  l'amorce et le `<noscript>`, pas le fil complet. Le cran au-dessus serait le
  SSR depuis l'indexeur (conception §15.1) — décision séparée.
- **Pas d'`og:image`** : il faudrait une image 1200×630 dédiée dans
  `public/` ; les aperçus retombent sur le titre + description (`twitter:card
  summary`).
- **La modération n'est pas appliquée ici** : un topic masqué par le staff
  mais présent sur le relais garde ses meta. Le vrai mur reste la policy du
  relais.
- Un topic tout neuf demandé avant que le relais ne le serve garde le
  squelette nu pendant le TTL du cache (5 min).

## Vérifier

```sh
curl -s http://localhost:3002/t/<slug>-<id> | grep -o '<title>[^<]*</title>'
curl -s http://localhost:3002/robots.txt
NUXT_PUBLIC_SITE_URL=http://localhost:3002 … curl -s http://localhost:3002/sitemap.xml
```

À vérifier sur le build de production (`nuxt build` +
`node .output/server/index.mjs`) autant qu'en dev : le hook `render:html`
s'exécute à chaque requête malgré `ssr: false`, et c'est là-dessus que tout le
dispositif repose.
