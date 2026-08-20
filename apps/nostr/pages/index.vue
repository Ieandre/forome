<template>
  <ForumShell :open-topic-id="topicId" :new-topic="newTopic" />
</template>

<script setup lang="ts">
/**
 * L'unique page du forum : `/`, `/new` et `/t/<slug>-<id>` sont trois routes qui
 * rendent **ce composant-ci** (voir `pages:extend` dans `nuxt.config.ts`), pas
 * trois pages.
 *
 * Ce n'est pas un raccourci d'écriture, c'est le cœur de la fluidité : trois
 * fichiers de page = trois composants = `<NuxtPage>` démonte et remonte tout
 * l'arbre (`ForumShell`, `TopicList`, `PostFeed`) à CHAQUE clic liste↔topic —
 * et `TopicList` coupe les souscriptions relais à son démontage, donc chaque
 * navigation refaisait payer l'EOSE des relais et reconstruisait le DOM de la
 * liste. Un seul composant, une seule `key` : ouvrir un topic ne re-rend que le
 * panneau droit, et quitter le forum (`/dm`, `/admin`…) démonte toujours tout.
 *
 * ⚠️ Ce sont bien trois routes **distinctes**. Les avoir écrites comme des alias
 * d'une seule route rendait « Nouveau topic » inerte : vue-router voyait la même
 * destination et refusait la navigation (voir `nuxt.config.ts` pour le détail).
 *
 * Permalien (spec v2 §7.1) : le state du panneau droit est dans l'URL, donc un
 * lien partagé ouvre les deux panneaux au bon endroit. L'URL porte le titre en
 * slug devant l'id hex (`utils/permalink.ts`), mais seul l'id compte à la
 * lecture — un lien nu `/t/<id>`, émis quand le titre n'est pas encore connu,
 * reste donc valide et se réécrit dès qu'il l'est.
 *
 * Note : le permalien *canonique* pour l'extérieur reste l'`nevent` (§6.4) — il
 * porte en plus l'auteur et des hints de relais, donc il fonctionne dans un
 * autre client.
 */
import { computed, watch } from 'vue'
import { topicIdFromParam, topicPath } from '~/utils/permalink'
import { topicTitle } from '~/utils/nostr'
import { FIREHOSE_TOPIC_ID } from '~/types/nostr'

/**
 * Sans clé fixe, l'alias ne suffit pas : la clé de page par défaut de Nuxt est
 * le chemin de la route **matchée**, et un alias est un record à part — passer
 * de `/` à `/t/<id>` changeait la clé et remontait quand même tout le shell.
 */
definePageMeta({ key: 'forum' })

const route = useRoute()
const router = useRouter()
const topicStore = useTopicStore()

const newTopic = computed(() => route.path === '/new')

const topicId = computed(() => {
  const raw = String(route.params.id ?? '')
  if (!raw) return null
  return topicIdFromParam(raw)
})

const title = computed(() => {
  if (!topicId.value) return null
  const root = topicStore.rootById(topicId.value)
  if (root) return topicTitle(root)
  return topicStore.rowById(topicId.value)?.title ?? null
})

// Le flux global n'a pas de racine à interroger : son nom est en dur, comme
// dans `ForumShell`. Sans le « (démo débit) », qui situe un écran mais n'a rien
// à faire dans une liste d'onglets.
usePageTitle(() => {
  if (newTopic.value) return 'Nouveau topic'
  if (!topicId.value) return null
  return topicId.value === FIREHOSE_TOPIC_ID ? 'Flux global' : title.value
})

/**
 * `query` et `hash` sont reportés : sans eux la réécriture perdrait `?relays=` /
 * `?indexer=` (bug déjà payé, cf. `stores/relays.ts`) et l'ancre `#msg-` d'un
 * lien vers un message précis.
 */
watch(
  [topicId, title],
  ([id, known]) => {
    if (!import.meta.client || !id || !known) return
    const want = topicPath(id, known)
    if (want === route.path) return
    void router.replace({ path: want, query: route.query, hash: route.hash })
  },
  { immediate: true },
)
</script>
