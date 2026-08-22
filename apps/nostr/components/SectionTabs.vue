<template>
  <nav class="tabs" aria-label="sections">
    <button type="button" class="tabs__tab" :class="{ 'tabs__tab--on': !onDm }" @click="goTopics">
      Topics
    </button>
    <NuxtLink to="/dm" class="tabs__tab" :class="{ 'tabs__tab--on': onDm }" :aria-label="dmLabel">
      <span aria-hidden="true">MP</span>
      <span v-if="dms.unreadCount" class="tabs__badge mono" aria-hidden="true">{{ dms.unreadCount }}</span>
      <!-- Les inconnus se signalent, ils ne se comptent pas : un point creux, et
           pas un nombre en aplat orange. Voir `requestsUnread` dans le store —
           promettre « il y a quelque chose » est tout ce qu'on doit à du
           non-sollicité, et le compte de la boîte ne doit pas s'en trouver
           gonflé. -->
      <span v-if="dms.requestsUnread" class="tabs__dot" aria-hidden="true" />
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
 * Le nom accessible porte ce que les deux marques disent séparément : « MP » nu
 * suivi d'un « 3 » se lit « MP 3 », qui ne dit pas de quoi, et le point creux ne
 * se lit pas du tout.
 */
const dmLabel = computed(() => {
  const parts: string[] = []
  const n = dms.unreadCount
  if (n > 0) parts.push(`${n} message${n > 1 ? 's' : ''} non lu${n > 1 ? 's' : ''}`)
  const r = dms.requestsUnread
  if (r > 0) parts.push(`${r} fil${r > 1 ? 's' : ''} d'inconnus en attente`)
  return parts.length > 0 ? `MP — ${parts.join(', ')}` : 'MP'
})

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

/* Creux et à l'encre pâle : il doit se voir en balayant l'écran sans jamais
   attirer le regard comme la pastille pleine. La hiérarchie des deux marques EST
   la différence entre la boîte et la file séparée. */
.tabs__dot {
  width: 6px;
  height: 6px;
  border: 1.5px solid var(--ink-4);
  border-radius: 50%;
  flex-shrink: 0;
}
.tabs__tab--on .tabs__dot {
  border-color: rgba(255, 255, 255, 0.75);
}
</style>
