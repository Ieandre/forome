import { SEO_DEFAULT_DESCRIPTION, SEO_SITE_NAME } from './utils/seoText'

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',

  modules: ['@pinia/nuxt'],

  // SPA assumé (spec §15.1) : un rendu serveur ne pourrait s'appuyer que sur
  // l'indexeur, jamais sur les relais directement. Rester sur Nuxt garde
  // l'option SSR ouverte sans réécriture.
  ssr: false,

  devServer: { port: 3002 },

  hooks: {
    /**
     * `/`, `/new` et `/t/<slug>-<id>` rendent LE MÊME composant de page : trois
     * fichiers feraient démonter/remonter tout le forum (souscriptions relais
     * comprises) à chaque clic liste↔topic. Voir `pages/index.vue`.
     *
     * ⚠️ Trois **routes distinctes**, et surtout pas trois alias d'une seule.
     * Un alias partage l'enregistrement de son original, et `isSameRouteRecord`
     * de vue-router compare justement les enregistrements — donc aller de `/` à
     * `/new`, qui n'ont ni paramètre ni requête pour les distinguer, était
     * refusé comme navigation **dupliquée** (`NavigationFailureType.duplicated`)
     * et « Nouveau topic » ne faisait rien du tout. `/t/:id` échappait au piège
     * par accident : son paramètre suffit à distinguer la destination.
     *
     * Ce qui préserve la performance n'est donc pas l'alias mais le couple
     * « même composant + même `key` » (`definePageMeta({ key: 'forum' })`) :
     * `<NuxtPage>` produit le même vnode, Vue le met à jour au lieu de le
     * remplacer. Le vérifier après toute modification d'ici — c'est invisible à
     * l'œil nu et ça ne coûte qu'un remontage silencieux de tout le forum.
     */
    'pages:extend'(pages) {
      const index = pages.find((p) => p.path === '/')
      if (!index) return
      pages.push(
        { ...index, path: '/new', name: 'forum-new' },
        { ...index, path: '/t/:id()', name: 'forum-topic' },
      )
    },
  },

  /**
   * Ce qui est peint AVANT que le bundle ait démarré.
   *
   * Conséquence directe de `ssr: false` juste au-dessus : `#__nuxt` part vide,
   * donc sans ceci le premier écran est **blanc** jusqu'au montage de Vue — et un
   * écran blanc se lit comme un site cassé, pas comme un site qui charge. C'est
   * la moitié « ça ne s'affiche pas » du symptôme qui a motivé cette passe ;
   * l'autre moitié était l'état vide mensonger de `stores/topics.ts`.
   *
   * Trois contraintes tiennent le contenu du fichier :
   *
   *   1. **Pas de flash de thème.** Le script inline ci-dessous a déjà posé
   *      `data-theme` quand ce fragment se peint ; il lit donc le même signal, et
   *      couvre « aucun choix enregistré » par `prefers-color-scheme`.
   *   2. **Les valeurs de `main.css` recopiées en dur** — la feuille de styles
   *      n'est pas forcément arrivée, c'est tout l'intérêt. En changer une ici ne
   *      casse rien : ça fait juste sauter la couleur au montage.
   *   3. **La forme de l'app, pas un rond qui tourne** — même règle que les
   *      squelettes de `TopicList`, pour que rien ne se déplace au montage.
   */
  spaLoadingTemplate: 'spa-loading-template.html',

  css: ['~/assets/css/main.css'],

  /**
   * Hors index : pages personnelles ou d'outillage, servies vides de toute
   * façon (`ssr: false`) — les indexer ne produirait que des coquilles en
   * doublon. `/new` rend le même écran que `/`. Le pendant « politesse » est
   * `server/routes/robots.txt.ts` ; l'en-tête, lui, fait foi.
   */
  routeRules: {
    '/admin': { headers: { 'x-robots-tag': 'noindex' } },
    '/moderation': { headers: { 'x-robots-tag': 'noindex' } },
    '/dm': { headers: { 'x-robots-tag': 'noindex' } },
    '/appareils': { headers: { 'x-robots-tag': 'noindex' } },
    '/new': { headers: { 'x-robots-tag': 'noindex' } },
    '/profil/**': { headers: { 'x-robots-tag': 'noindex' } },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'Forome',
      link: [
        // Le SVG sert les deux thèmes à lui seul ; l'ICO n'est là que pour les
        // navigateurs qui l'ignorent, et évite le /favicon.ico en 404.
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '16x16 32x32' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        // Les deux thèmes existent : le chrome du navigateur doit suivre.
        { name: 'color-scheme', content: 'light dark' },
        // Le canevas, pas la barre : la barre de site sombre n'existe plus.
        { name: 'theme-color', content: '#e9ecf2', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#0b0e13', media: '(prefers-color-scheme: dark)' },
        /**
         * Le repli, identique pour toutes les routes puisque `ssr: false`.
         * `server/plugins/seoHead.ts` remplace titre et description par ceux de
         * l'URL demandée (topic, doc) avant l'envoi du HTML — c'est lui, le SEO.
         */
        { name: 'description', content: SEO_DEFAULT_DESCRIPTION },
        { property: 'og:site_name', content: SEO_SITE_NAME },
        { property: 'og:type', content: 'website' },
        { property: 'og:locale', content: 'fr_FR' },
        { name: 'twitter:card', content: 'summary' },
      ],
      script: [
        {
          // En SPA (`ssr: false`), appliquer le thème au montage fait clignoter
          // la page en blanc à chaque chargement. On le pose donc avant le
          // premier paint, en synchrone. Voir `composables/useTheme.ts`.
          innerHTML:
            "try{var t=localStorage.getItem('forome.theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
          tagPosition: 'head',
        },
        {
          /**
           * Clé de reprise arrivée par QR (`/appareils#k=nsec1…`) : on la sort
           * de l'URL **avant que quoi que ce soit d'autre ne tourne**.
           *
           * Ici et pas dans le composant, pour deux raisons. La barre d'adresse
           * cesse de montrer une clé privée au premier paint, plutôt qu'après
           * l'hydratation. Et le routeur ne voit jamais ce fragment : il essaie
           * sinon de s'en servir comme sélecteur CSS, ce qui **écrit la clé dans
           * la console** du navigateur. Voir `components/DevicePairing.vue`.
           */
          innerHTML:
            "try{var h=location.hash;if(h.slice(0,3)==='#k='){window.__foromeKey=decodeURIComponent(h.slice(3));history.replaceState(null,'',location.pathname+location.search)}}catch(e){}",
          tagPosition: 'head',
        },
      ],
    },
  },

  runtimeConfig: {
    /**
     * Hôte Blossom où atterrissent les avatars, et d'où le proxy les relit.
     *
     * Pas dans `public` : le navigateur n'a jamais besoin de le connaître. Il
     * dépose par `/api/media` et relit par `/api/media/<sha256>` — l'adresse du
     * tiers ne sort pas du serveur, donc changer d'hôte ne casse aucun profil
     * déjà signé (l'adresse contient le sha256, pas l'hôte : spec §599).
     *
     * Hôtes vérifiés le 2026-08-13 avec une clé neuve, sans compte :
     *   - blossom.primal.net  dépôt accepté (200)   ← retenu
     *   - nostr.download      dépôt accepté (201)
     *   - cdn.hzrd149.com     dépôt accepté (201)
     *   - blossom.band        contrôle préalable OK, puis 500 au dépôt
     *   - blossom.nostr.hu    401, clé hors liste blanche
     *
     * ⚠️ Le contrôle préalable BUD-06 ne prouve rien : blossom.band répond 200 puis
     * échoue. Retester le vrai dépôt avant de changer d'hôte.
     */
    blossomServer: 'https://blossom.primal.net',

    public: {
      /**
       * Origine publique du site (`https://forome.example`, sans slash final).
       *
       * Vide tant que le domaine n'existe pas : les URLs absolues (canonical,
       * `og:url`, sitemap) n'apparaissent que quand elle est posée — inventer un
       * hôte ferait indexer des liens morts. Surchargeable par
       * `NUXT_PUBLIC_SITE_URL`.
       */
      siteUrl: '',

      /**
       * Clé publique (hex) de l'indexeur dont on accepte le tick (spec §5.2).
       *
       * Vide par défaut, délibérément : sans clé épinglée, le client calcule son
       * classement localement plutôt que d'accepter celui du premier venu.
       * Accepter un tick non attribué donnerait à un inconnu le pouvoir de
       * décider l'ordre de l'écran principal.
       *
       * Surchargeable par `NUXT_PUBLIC_INDEXER_PUBKEY`, ou par `?indexer=<hex>`.
       */
      indexerPubkey: '',

      /**
       * Clé publique (hex) **racine** du forum : celle dont on accepte le roster
       * de modération (`docs/moderation-staff.md` §3.1).
       *
       * Vide par défaut, pour la même raison que `indexerPubkey` juste au-dessus :
       * sans clé épinglée, aucun staff, aucune action appliquée, panneau
       * inaccessible. Accepter le roster du premier venu donnerait à un inconnu
       * le pouvoir de masquer l'écran principal.
       *
       * ⚠️ Ce n'est pas une identité de tous les jours. Elle ne signe que le
       * roster — quelques events par an — et doit vivre hors du navigateur, dans
       * un signeur NIP-46 : Nostr n'a pas de révocation, donc une clé racine
       * compromise l'est définitivement.
       *
       * Surchargeable par `NUXT_PUBLIC_ADMIN_PUBKEY`, ou par `?admin=<hex>`.
       */
      adminPubkey: '',

      /**
       * **Notre** relais (strfry, `docs/strfry.md`) : le seul où la policy
       * s'applique, donc le seul dont on répond de ce qu'il sert (spec §9.2).
       * C'est lui qu'on **lit** en production.
       *
       * Vide tant qu'il n'est pas déployé — le client retombe alors sur les
       * relais publics ci-dessous, parce qu'un forum qui n'afficherait rien
       * serait pire qu'un forum qui affiche ce qui existe.
       *
       * Surchargeable par `NUXT_PUBLIC_HOME_RELAY`.
       */
      homeRelay: '',

      /**
       * Relais local de développement, cible **exclusive** de `npm run dev`.
       *
       * Ce n'est pas du confort, c'est le garde-fou principal : sur Nostr écrire
       * est définitif, et un essai de développement n'a rien à faire sur le
       * réseau. Viser les relais publics par défaut suffit à envoyer un
       * « test » sur des relais tiers sans que personne le remarque.
       */
      devRelay: 'ws://localhost:7778',

      /**
       * Relais publics : la réplication et la portabilité de ce qu'on écrit.
       *
       * Liste **mesurée**, pas choisie de mémoire : `npm run check:relays`
       * teste la connexion, la lecture et le document NIP-11 de chacun. Deux
       * critères d'exclusion, tous les deux vérifiés le 2026-08-11 :
       *
       *   - injoignable. `relay.nostr.band` expirait systématiquement, et un
       *     relais mort dans la liste par défaut coûte une tentative à chaque
       *     démarrage (le client l'exclut après échec, mais il l'a payée).
       *   - **paiement requis.** `nostr.wine` déclare `payment_required: true`
       *     en NIP-11 : il refuse donc toute écriture d'un non-abonné. Dans une
       *     liste par défaut, il ferait échouer une publication sur cinq en
       *     permanence et plomberait le rapport « accepté par N/M » sans qu'il y
       *     ait le moindre problème réel.
       *
       * ⚠️ En production ils sont une cible d'**écriture**, pas de lecture : y
       * diffuser est ce qui rend vraie la promesse de §9.3 (« rien ne peut être
       * retiré du réseau »), mais les lire donnerait à n'importe qui l'entrée
       * dans la liste, sans passer par notre policy. Voir `utils/relayTargets.ts`.
       *
       * Les cinq ci-dessous répondent, laissent lire, et n'exigent ni paiement,
       * ni AUTH, ni PoW minimale. À revérifier de temps en temps : un relais
       * public peut fermer ou devenir payant sans préavis.
       *
       * ⚠️ La mesure vient de Node ; un navigateur peut différer (origine,
       * limitation par IP, CORS). `relay.damus.io` a été vu joignable depuis
       * Node et simultanément mort dans le navigateur. Le client s'en sort seul —
       * il exclut les relais en échec des requêtes et des écritures — mais ne pas
       * conclure d'un `check:relays` vert que tout va bien côté utilisateur.
       */
      relays: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.primal.net',
        'wss://relay.snort.social',
        'wss://offchain.pub',
      ],
    },
  },

  vite: { build: { target: 'es2022' } },

  typescript: { strict: true, typeCheck: false },
})
