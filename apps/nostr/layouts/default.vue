<template>
  <div class="app">
    <SiteHeader />
    <div class="app__shell" :class="{ 'app__shell--panel': panelOpen }">
      <aside class="app__col">
        <SideColumn />
      </aside>
      <main class="app__panel">
        <slot />
      </main>
    </div>

    <!-- ⚠️ Ici et pas dans la colonne : sous 820 px, `.app__col` passe en
         `display: none` dès qu'un panneau est ouvert, et TOUTES les pastilles
         partent avec elle. Montée au niveau du layout, la bulle est le seul
         canal qui survit — c'est ce qui la justifie. -->
    <DmToast />
  </div>
</template>

<script setup lang="ts">
/**
 * Le squelette à deux volets vit ICI, et non plus dans `ForumShell`.
 *
 * La colonne de gauche est donc rendue sur TOUTES les routes : les MP, un
 * profil, `/appareils` s'ouvrent dans le panneau de droite au lieu de remplacer
 * l'écran. Trois conséquences, dans l'ordre d'importance :
 *
 *   1. le chrome du site (marque, cloche, thème, avatar, relais) redescend dans
 *      la colonne, et la barre pleine largeur de 56 px disparaît — c'est autant
 *      rendu au panneau de lecture, sur tous les écrans ;
 *   2. rien ne saute d'une route à l'autre, puisque la colonne ne bouge jamais.
 *      C'est ce qui rendait l'ancien en-tête-dans-`TopicList` intenable : il
 *      disparaissait sur `/dm`. Le motif tombe ;
 *   3. `TopicList` n'est plus démontée en quittant le forum, donc ses
 *      souscriptions relais survivent à un aller-retour vers un profil.
 *
 * `app__panel` est `flex: 1; min-height: 0` pour que les pages puissent rester
 * en `height: 100%` avec leurs propres zones de défilement internes.
 *
 * ## Le canal personnel démarre ICI, et pas dans `TopicList`
 *
 * Suivis, MP et notifications (spec §5.1) alimentent des pastilles qui vivent
 * dans la barre, donc sur TOUS les écrans. Ils étaient démarrés au montage de la
 * colonne de topics : la pastille de MP ne se mettait à jour qu'après un passage
 * par le forum, et arriver directement sur `/dm` laissait l'app muette. Le web
 * of trust doit en plus être chargé tôt — `dms.inbox` s'en sert pour trier la
 * boîte principale de la file séparée (§10.2).
 *
 * ## Ce qui attend se dit sur trois canaux, un par situation du lecteur
 *
 *   - **onglet en arrière-plan** → le compte en tête du titre (`usePageTitle`) ;
 *   - **écran occupé par autre chose** → `DmToast`, monté ici ;
 *   - **colonne visible** → les pastilles de `SectionTabs` et `NotifBell`, les
 *     seules qui persistent, donc les seules qui font foi.
 *
 * Un seul nombre circule entre eux (`notifs.unreadCount`) : deux comptes
 * différents pour la même chose à 200 px d'écart et on n'en croirait aucun.
 */
import { computed, watch, onMounted } from 'vue'

const identity = useIdentityStore()
const social = useSocialStore()
const dms = useDmStore()
const notifs = useNotificationStore()
const mod = useModerationStore()
const points = useUserPointsStore()
const route = useRoute()

/**
 * Sous 700 px les deux volets ne tiennent pas côte à côte : l'un OU l'autre.
 * La règle est celle de l'URL — la colonne est l'accueil, tout le reste est un
 * panneau ouvert par-dessus. `/dm` sans conversation choisie reste donc la
 * colonne, comme `/` : c'est une liste, pas une destination.
 */
const panelOpen = computed(
  () => route.path !== '/' && !(route.path === '/dm' && !route.query.peer),
)

function startPersonal(): void {
  void social.load()
  social.watch()
  dms.watch()
  notifs.watch()
}

onMounted(() => {
  // La modération n'est pas un canal personnel : elle vaut pour tout le monde,
  // et un message masqué doit l'être dès le premier écran — y compris pour un
  // visiteur qui n'a pas encore de clé.
  mod.start()
  // Les points non plus ne sont pas un canal personnel : le niveau s'affiche
  // dans la bande d'auteur de tout le monde, y compris pour un visiteur sans clé.
  points.start()
  if (identity.pubkey) startPersonal()
})

watch(
  () => identity.pubkey,
  (pk) => {
    // Changement d'identité (import, new khey) : les listes, les MP et les
    // notifications de l'ancienne clé n'ont aucun sens pour la nouvelle.
    social.reset()
    dms.reset()
    notifs.reset()
    if (pk) startPersonal()
  },
)
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--page);
}

/* La gouttière est ici et pas dans les pages : c'est elle qui fait flotter les
   panneaux sur le canevas, et c'est le geste structurant de la charte. Une page
   qui la reprendrait à son compte finirait par la doubler. */
.app__shell {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(300px, 31%) 1fr;
  gap: var(--gutter);
  padding: 0 calc(var(--gutter) + env(safe-area-inset-right, 0px)) calc(var(--gutter) + env(safe-area-inset-bottom, 0px))
    calc(var(--gutter) + env(safe-area-inset-left, 0px));
}
.app__col,
.app__panel {
  min-width: 0;
  min-height: 0;
}

/* Sous 700 px l'écran est trop étroit pour se payer une marge : les panneaux
   reprennent le plein cadre.
   Les `env()` restent, eux : ils ne valent 0 que sur un écran rectangulaire, et
   sans eux le pied du composeur passe sous la barre d'accueil de l'iPhone (le
   bouton « Poster » y devient intouchable) et le fil sous l'encoche en paysage.
   C'est `viewport-fit=cover` de `nuxt.config.ts` qui met ces bords à notre
   charge — il donne le plein écran, il ne donne pas les marges avec. */
/* Une seule colonne dès 820 px : à deux, la liste tombe sous 300 px et le
   panneau sous la mesure de lecture. C'est l'URL qui dit lequel on montre. */
@media (max-width: 820px) {
  .app__shell {
    grid-template-columns: 1fr;
  }
  .app__panel {
    display: none;
  }
  .app__shell--panel .app__col {
    display: none;
  }
  .app__shell--panel .app__panel {
    display: block;
  }
}

@media (max-width: 700px) {
  .app__shell {
    padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  }
}
</style>
