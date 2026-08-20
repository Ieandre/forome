<template>
  <div ref="root" class="bell">
    <Hint :text="triggerTitle" placement="bottom" :disabled="open">
      <button
        type="button"
        class="bell__btn"
        :class="{ 'bell__btn--on': open }"
        :aria-expanded="open"
        :aria-label="triggerTitle"
        @click="open = !open"
      >
        <svg
          class="bell__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8.6a6 6 0 1 0-12 0c0 5-2.1 6.4-2.1 6.4h16.2S18 13.6 18 8.6" />
          <path d="M13.7 19a2 2 0 0 1-3.4 0" />
        </svg>
        <span v-if="notifs.unreadCount" class="bell__badge mono">{{ badge }}</span>
      </button>
    </Hint>

    <div v-if="open" class="bell__pop">
      <div class="bell__head">
        <span class="bell__title">Notifications</span>
      </div>

      <div class="bell__scroll">
        <NotifRow v-for="n in visible" :key="n.id" :notif="n" @click="open = false" />

        <!-- Vide composé, et il dit POURQUOI c'est vide : ici l'absence est le
             cas normal d'un compte neuf, pas une panne. -->
        <div v-if="notifs.items.length === 0" class="bell__empty">
          <p class="bell__empty-title">Rien pour l'instant</p>
          <p class="bell__empty-sub">
            Les réponses, les citations, les nouveaux suivis et les MP non lus arrivent ici.
          </p>
        </div>
      </div>

      <!-- Le nombre coupé est DIT, jamais tronqué en silence : une liste qui
           s'arrête sans le dire se lit comme une liste complète, et on croit
           avoir tout vu. -->
      <p v-if="hidden > 0" class="bell__more">
        {{ hidden }} plus ancienne{{ hidden > 1 ? 's' : '' }} non affichée{{ hidden > 1 ? 's' : '' }}.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Le panneau de notifications, ancré dans la barre.
 *
 * ## Pourquoi un panneau et pas une page
 *
 * Une notification n'est pas une destination : on ne la lit pas, on la
 * dispatche — coup d'œil, clic, on est parti. Une page imposait deux
 * changements de contexte complets pour ce qui doit être un regard, et la mettre
 * au même rang que les MP dans la nav affirmait une symétrie fausse : les MP
 * sont un LIEU (on y lit, on y écrit, les conversations y vivent), les
 * notifications sont un aiguillage.
 *
 * ## Le plafond d'affichage
 *
 * Le store retient au plus 300 events ; ce panneau en rend 40. Ce qui dépasse
 * n'est pas coupé en silence — le compte manquant est écrit en pied. Une liste
 * qui s'arrête sans le dire se lit comme une liste complète.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'

/**
 * 40 lignes : de quoi ne jamais y toucher en usage normal, et de quoi éviter
 * qu'un topic où l'on est l'auteur ne fasse un panneau de 200 rangées presque
 * identiques. Le vrai remède à ce cas-là est le regroupement par topic — il
 * n'est pas fait, et c'est la limite connue de cet écran.
 */
const MAX_ROWS = 40

const notifs = useNotificationStore()
const topics = useTopicStore()

const root = ref<HTMLElement | null>(null)
const open = ref(false)

const visible = computed(() => notifs.items.slice(0, MAX_ROWS))
const hidden = computed(() => Math.max(0, notifs.items.length - MAX_ROWS))

/** Au-delà de 99 le nombre exact n'aide plus et casse la pastille. */
const badge = computed(() => (notifs.unreadCount > 99 ? '99+' : String(notifs.unreadCount)))

const triggerTitle = computed(() => {
  const n = notifs.unreadCount
  if (n === 0) return 'notifications — rien de nouveau'
  return `notifications — ${n} non lue${n > 1 ? 's' : ''}`
})

/**
 * Tout devient lu à la FERMETURE, jamais à l'ouverture : tant que le panneau est
 * ouvert, les liserés orange montrent ce qui était neuf — c'est ce qu'on est
 * venu voir, et le faire disparaître au moment où on regarde serait absurde.
 *
 * Une pastille qui survit au fait d'avoir été regardée apprend à être ignorée ;
 * elle imposait en plus un clic sur « tout marquer lu » à chaque passage, sur le
 * chemin le plus fréquent de l'app. Ce bouton n'existe donc plus.
 *
 * Les MP ne sont pas concernés (voir `markSeen`) : la pastille garde leur compte
 * après fermeture, parce qu'ils attendent toujours.
 */
watch(open, (isOpen, was) => {
  if (was && !isOpen) notifs.markSeen()
})

/**
 * Le titre des topics cités, chargé seulement quand le panneau est ouvert : une
 * notification ne transporte que l'id de sa racine, et sans titre chaque ligne
 * dirait « t'a répondu » sans dire où. Fermé, le panneau n'a aucune raison
 * d'interroger les relais.
 */
watch([open, visible], ([isOpen, list]) => {
  if (!isOpen) return
  const wanted = new Set<string>()
  for (const n of list) if (n.topicId && !topics.rootById(n.topicId)) wanted.add(n.topicId)
  for (const id of wanted) void topics.fetchRoot(id)
})

function onPointerDown(e: PointerEvent): void {
  if (!open.value) return
  const t = e.target
  if (t instanceof Node && root.value?.contains(t)) return
  open.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

if (import.meta.client) {
  document.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKey)
}
onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('keydown', onKey)
  }
})
</script>

<style scoped>
.bell {
  position: relative;
}

/* Même gabarit que la bascule de thème, à côté de laquelle il vit. */
.bell__btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--ink-3);
  transition: background 0.14s ease, color 0.14s ease;
}
.bell__btn:hover,
.bell__btn--on {
  background: var(--surface-3);
  color: var(--ink);
}
.bell__btn:active {
  transform: translateY(1px);
}
.bell__icon {
  width: 19px;
  height: 19px;
}

/* Orange : quelque chose est arrivé et attend. Voir « LA THÈSE » en tête de
   main.css — c'est le métier de l'orange, et le seul. */
.bell__badge {
  position: absolute;
  top: -1px;
  right: -2px;
  min-width: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--brand);
  color: var(--brand-on);
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
  /* L'anneau à la couleur du canevas détache la pastille de l'icône sous elle,
     sans avoir à creuser un trou dans le tracé. */
  box-shadow: 0 0 0 2px var(--page);
}

/* Même anatomie que `UserMenu` : panneau flottant, ombre longue, bordure pâle. */
.bell__pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: 360px;
  max-height: min(70vh, 520px);
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

.bell__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line-soft);
}
.bell__title {
  font-size: var(--fs-sm);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.bell__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}

.bell__empty {
  padding: 32px 16px 36px;
  text-align: center;
}
.bell__empty-title {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.bell__empty-sub {
  margin: 0 auto;
  max-width: 32ch;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--ink-3);
}

.bell__more {
  flex-shrink: 0;
  margin: 0;
  padding: 9px 14px;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

/* Sous 420 px, un panneau de 360 px déborderait du canevas : il se cale sur la
   largeur disponible en gardant sa gouttière. */
@media (max-width: 420px) {
  .bell__pop {
    width: calc(100vw - 24px);
    right: -8px;
  }
}
</style>
