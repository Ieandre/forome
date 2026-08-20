<template>
  <div class="app">
    <SiteHeader />
    <main class="app__main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * Le chrome du site est global : il est là sur la liste comme dans un topic
 * comme dans les MP. Avant, l'en-tête vivait dans `TopicList` — donc il
 * disparaissait sur `/dm` et n'occupait que la colonne de gauche.
 *
 * `app__main` est `flex: 1; min-height: 0` pour que les pages puissent rester
 * en `height: 100%` avec leurs propres zones de défilement internes.
 *
 * ## Le canal personnel démarre ICI, et pas dans `TopicList`
 *
 * Suivis, MP et notifications (spec v2 §5.1) alimentent des pastilles qui vivent
 * dans la barre, donc sur TOUS les écrans. Ils étaient démarrés au montage de la
 * colonne de topics : la pastille de MP ne se mettait à jour qu'après un passage
 * par le forum, et arriver directement sur `/dm` laissait l'app muette. Le web
 * of trust doit en plus être chargé tôt — `dms.inbox` s'en sert pour trier la
 * boîte principale de la file séparée (§10.2).
 */
import { watch, onMounted } from 'vue'

const identity = useIdentityStore()
const social = useSocialStore()
const dms = useDmStore()
const notifs = useNotificationStore()
const mod = useModerationStore()

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
.app__main {
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 0 calc(var(--gutter) + env(safe-area-inset-right, 0px)) calc(var(--gutter) + env(safe-area-inset-bottom, 0px))
    calc(var(--gutter) + env(safe-area-inset-left, 0px));
}

/* Sous 700 px l'écran est trop étroit pour se payer une marge : les panneaux
   reprennent le plein cadre.
   Les `env()` restent, eux : ils ne valent 0 que sur un écran rectangulaire, et
   sans eux le pied du composeur passe sous la barre d'accueil de l'iPhone (le
   bouton « Poster » y devient intouchable) et le fil sous l'encoche en paysage.
   C'est `viewport-fit=cover` de `nuxt.config.ts` qui met ces bords à notre
   charge — il donne le plein écran, il ne donne pas les marges avec. */
@media (max-width: 700px) {
  .app__main {
    padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  }
}
</style>
