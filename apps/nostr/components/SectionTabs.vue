<template>
  <nav class="tabs" aria-label="sections">
    <button type="button" class="tabs__tab" :class="{ 'tabs__tab--on': !onDm }" @click="goTopics">
      Topics
    </button>
    <NuxtLink to="/dm" class="tabs__tab" :class="{ 'tabs__tab--on': onDm }">
      MP<span v-if="dms.unreadCount" class="tabs__badge mono">{{ dms.unreadCount }}</span>
    </NuxtLink>
  </nav>
</template>

<script setup lang="ts">
/**
 * Le sélecteur Topics / MP, en tête de la colonne de gauche.
 *
 * Il vivait dans la barre de site, où il se faisait passer pour de la
 * navigation entre pages. Ce n'en est pas : les deux sections sont deux
 * CONTENUS du même objet à deux volets — même grille `minmax(…, 31%) 1fr`, même
 * bascule mobile — et un sélecteur entre deux contenus d'un panneau se pose sur
 * ce panneau. Dans la barre, il répétait en plus le mot « Topics » écrit
 * soixante pixels plus bas.
 *
 * ⚠️ L'onglet allumé nomme ce que la COLONNE affiche, pas la page ouverte à
 * droite : sur un profil ou sur `/appareils`, la colonne montre les topics, donc
 * « Topics » est allumé. C'est exact, et c'est justement ce qui justifie de
 * l'avoir descendu ici.
 */
const dms = useDmStore()
const topics = useTopicStore()
const route = useRoute()
const router = useRouter()

const onDm = computed(() => route.path === '/dm')

/**
 * `?relays=` et `?indexer=` sont reportés — les perdre a déjà coûté un bug (voir
 * `stores/relays.ts`). `peer` ne l'est pas : il désigne une conversation, il n'a
 * aucun sens sur le forum.
 */
function goTopics(): void {
  topics.setMode('threads')
  const { peer: _peer, ...query } = route.query
  if (route.path !== '/' || route.query.peer) void router.push({ path: '/', query })
}
</script>

<style scoped>
/* Le segmenté de la barre de site, repris tel quel : c'est le même objet, il a
   seulement changé de place. */
.tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  flex-shrink: 0;
  background: var(--surface-sunken);
  border: 1px solid var(--line-soft);
  border-radius: 999px;
}
.tabs__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 13px;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--ink-3);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  text-decoration: none !important;
  transition: color 0.14s ease, background 0.14s ease;
}
.tabs__tab:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.tabs__tab--on,
.tabs__tab--on:hover {
  background: var(--link);
  color: #fff;
}
.tabs__badge {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--brand);
  color: var(--brand-on);
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.tabs__tab--on .tabs__badge {
  background: rgba(255, 255, 255, 0.92);
  color: var(--link);
}
</style>
