<template>
  <div class="shell" :class="{ 'shell--topic-open': !!openTopicId || newTopic }">
    <aside class="shell__list">
      <TopicList :open-topic-id="openTopicId" />
    </aside>

    <section class="shell__topic">
      <NewTopicPanel v-if="newTopic" />

      <template v-else-if="openTopicId">
        <header class="topic-head">
          <Hint text="retour à la liste" placement="bottom">
            <button type="button" class="topic-head__back" @click="closeTopic">
              <span aria-hidden="true">←</span>
              <span class="visually-hidden">retour à la liste</span>
            </button>
          </Hint>

          <UserAvatar v-if="rootAuthor" :pubkey="rootAuthor" :size="26" class="topic-head__av" />

          <div class="topic-head__main">
            <h1 class="topic-head__title">{{ title }}</h1>
            <div class="topic-head__meta">
              <span v-if="rootAuthor" class="topic-head__by">
                par <strong>{{ profiles.displayName(rootAuthor) }}</strong>
              </span>
              <span v-if="row" class="topic-head__stat mono">{{ row.replies }} msg</span>
              <span v-if="row && row.people > 0" class="topic-head__stat mono">{{ row.people }} kheys</span>
              <span v-if="row && row.vel > 6" class="tag tag--brand topic-head__hot">ça parle maintenant</span>
            </div>
          </div>

          <button
            v-if="mod.amStaff"
            type="button"
            class="btn btn--sm topic-head__mod"
            :class="{ 'topic-head__mod--on': modPanel }"
            @click="modPanel = !modPanel"
          >
            modérer
          </button>

          <button type="button" class="btn btn--sm topic-head__perma" @click="copyPermalink">
            {{ copied ? 'copié' : 'permalien' }}
          </button>
        </header>

        <TopicModeration v-if="modPanel && openTopicId" :topic-id="openTopicId" @close="modPanel = false" />

        <PostFeed ref="feedEl" :topic-id="openTopicId" @reply="replyTo = $event" />

        <!-- Le flux global est un mode de test de débit, pas un topic : on n'y
             publie pas (il n'a pas de racine à laquelle rattacher une réponse). -->
        <!-- Topic verrouillé : le composeur disparaît, mais le fil reste lisible
             et le motif est affiché. Fermer sans dire pourquoi serait la censure
             silencieuse que le §9.2 refuse. -->
        <footer v-if="lockNotice" class="topic-foot">
          <span class="tag">verrouillé</span>
          <span class="topic-foot__note">
            {{ lockNotice.reason }} — décision de {{ profiles.displayName(lockNotice.by) }}. Le fil
            reste lisible ; nos relais n'acceptent plus de réponse.
          </span>
        </footer>

        <Composer
          v-else-if="openTopicId !== FIREHOSE_TOPIC_ID"
          :root-id="openTopicId"
          :root="root"
          :reply-to="replyTo"
          @posted="onPosted"
          @settled="onPostSettled"
          @cancel-reply="replyTo = null"
        />
        <footer v-else class="topic-foot">
          <span class="tag tag--warn">démo débit</span>
          <span class="topic-foot__note">
            Flux global <code>kind 1</code> : sert à stresser le fil, pas à publier.
          </span>
        </footer>
      </template>

      <!-- Le forum se présente dans l'anatomie d'un message, mais sans carte ni
           ombre : ça doit se lire comme la tête du fil, jamais comme un vrai
           message reçu des relais. -->
      <div v-else class="shell__welcome">
        <article class="wel">
          <span class="wel__rail" aria-hidden="true" />

          <p class="wel__brand">Forome<span class="wel__brand-dot">.</span></p>

          <!-- Aucun état d'attente ici : la colonne de gauche porte déjà le
               squelette, les relais injoignables et le forum vide. Ce texte ne
               dépend d'aucune donnée, donc il s'affiche dès le premier rendu. -->
          <div class="wel__body">
            <h2 class="wel__title display">Tout se passe à gauche.</h2>
            <p class="wel__lead">
              La liste est classée par ce qui bouge maintenant, pas par ce qui vient d'arriver.
              Choisis un topic : il s'ouvre ici même, en direct, sans jamais recharger la page.
            </p>
            <p class="wel__lead">
              Tu peux répondre dans la foulée. Ton navigateur t'a fabriqué un pseudo en arrivant —
              il n'y a ni compte, ni mot de passe, ni adresse à donner.
            </p>
            <div class="wel__actions">
              <NuxtLink to="/new" class="btn btn--primary">Nouveau topic</NuxtLink>
              <NuxtLink to="/comment-ca-marche" class="wel__more">Comment ça marche</NuxtLink>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * Vue 30/70 (spec v2 §7.1) : liste à gauche, topic ouvert à droite, tout en
 * direct, jamais de rechargement. Le state du panneau droit est dans l'URL —
 * la culture repose entièrement sur le partage de liens.
 *
 * Mobile : bascule pleine largeur (la feuille glissante à trois ancrages de
 * §7.4 n'est pas portée à l'étape 1 — elle demande une lib de gestes et ne
 * teste pas le protocole).
 */
import { ref, computed, watch } from 'vue'
import { FIREHOSE_TOPIC_ID, type NostrEvent } from '~/types/nostr'
import { topicTitle } from '~/utils/nostr'

const props = defineProps<{ openTopicId: string | null; newTopic?: boolean }>()

const topicStore = useTopicStore()
const profiles = useProfileStore()
const mod = useModerationStore()
const reading = useReadingStore()
const router = useRouter()
const copied = ref(false)
const modPanel = ref(false)
const replyTo = ref<NostrEvent | null>(null)
const feedEl = ref<{
  pushOwnPost: (ev: NostrEvent, replacedId?: string) => void
  markOwnState: (id: string, state: 'pending' | 'failed' | null) => void
} | null>(null)

/**
 * Publication optimiste : le fil affiche le message avant la diffusion (§6.3),
 * marqué « envoi… » jusqu'à ce qu'un relais l'accepte.
 */
function onPosted(ev: NostrEvent, replacedId?: string): void {
  feedEl.value?.pushOwnPost(ev, replacedId)
  feedEl.value?.markOwnState(ev.id, 'pending')
  replyTo.value = null
}

/** Verdict de publication, connu après coup puisqu'on ne l'attend plus. */
function onPostSettled(id: string, accepted: boolean): void {
  feedEl.value?.markOwnState(id, accepted ? null : 'failed')
}

const row = computed(() => (props.openTopicId ? topicStore.rowById(props.openTopicId) : null))
const root = computed(() => (props.openTopicId ? topicStore.rootById(props.openTopicId) : null))

const title = computed(() => {
  if (props.openTopicId === FIREHOSE_TOPIC_ID) return 'Flux global (démo débit)'
  if (root.value) return topicTitle(root.value)
  if (row.value) return row.value.title
  return 'topic'
})

const rootAuthor = computed(() => root.value?.pubkey ?? row.value?.pubkey ?? null)
const lockNotice = computed(() => (props.openTopicId ? mod.lockNotice(props.openTopicId) : null))

watch(
  () => props.openTopicId,
  (id) => {
    replyTo.value = null
    if (id && id !== FIREHOSE_TOPIC_ID) void topicStore.fetchRoot(id)
  },
  { immediate: true },
)

/**
 * Marque le topic ouvert comme lu (§ `stores/reading.ts`). Le déclencheur est la
 * date du dernier message et non un minuteur : elle ne bouge qu'à l'arrivée
 * d'une vraie réponse, donc on n'écrit dans le stockage que quand il y a
 * quelque chose de neuf à acter — et un message reçu pendant qu'on lit compte
 * comme lu, puisque le fil l'affiche en direct.
 *
 * Le repli sur l'heure courante couvre le topic atteint par permalien, qui n'est
 * pas forcément dans le classement : sans lui, l'ouvrir ne marquerait rien.
 */
watch(
  () => [props.openTopicId, row.value?.lastAt ?? 0] as const,
  ([id, lastAt]) => {
    if (!id || id === FIREHOSE_TOPIC_ID) return
    reading.markRead(id, Math.max(lastAt, Math.floor(Date.now() / 1000)))
  },
  { immediate: true },
)

function closeTopic(): void {
  void router.push('/')
}

async function copyPermalink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* presse-papier indisponible — pas bloquant */
  }
}
</script>

<style scoped>
/* Deux panneaux qui flottent sur le canevas, séparés par la gouttière. La
   scission 30/70 de la spec est intacte ; ce qui change, c'est qu'elle n'est
   plus tenue par un filet de 1 px mais par du vide. */
.shell {
  display: grid;
  grid-template-columns: minmax(300px, 31%) 1fr;
  gap: var(--gutter);
  height: 100%;
  min-height: 0;
}
.shell__list {
  min-width: 0;
  min-height: 0;
}
.shell__topic {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-2);
  overflow: hidden;
  /* mesure de lecture partagée par l'en-tête, le fil et le pied */
  --topic-col: 880px;
}

/* ------------------------------------------------------------ tête de topic
   Le titre est la seule ligne de l'écran qui a droit à Bricolage : c'est ce
   qu'on est venu lire, et il doit se distinguer du fil qu'il coiffe. Il n'a
   plus besoin de bordure basse — le fil défile en dessous sur un fond
   légèrement enfoncé, et le décrochement de surface suffit. */
.topic-head {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  padding: 14px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--line-soft);
}
.topic-head__back {
  display: none;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  color: var(--ink-2);
  padding: 5px 11px;
  font-size: var(--fs-lg);
  line-height: 1.2;
  flex-shrink: 0;
}
.topic-head__back:hover {
  background: var(--surface-3);
}
.topic-head__av {
  flex-shrink: 0;
}
.topic-head__main {
  min-width: 0;
  flex: 1;
}
.topic-head__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topic-head__hot {
  animation: hot-breathe 2.6s ease-in-out infinite;
}
/* Le seul mouvement en boucle de cet en-tête, et il porte un état vraiment
   vivant : « ça parle maintenant » est faux dès que le débit retombe, donc
   l'étiquette disparaît d'elle-même. Coupé sous `prefers-reduced-motion`. */
@keyframes hot-breathe {
  50% {
    opacity: 0.5;
  }
}
.topic-head__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 3px;
}
.topic-head__by {
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.topic-head__by strong {
  color: var(--ink-2);
  font-weight: 600;
}
/* Les compteurs sont séparés par une puce dessinée en CSS et non par un
   caractère : un « · » entre deux nombres en mono s'aligne mal et se copie
   avec le texte. */
.topic-head__stat {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.topic-head__stat::before {
  content: '';
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--ink-4);
}
.topic-head__perma {
  flex-shrink: 0;
}

/* Bouton de modération du topic. Bleu comme les autres marqueurs d'équipe, et
   pas orange : l'orange est la couleur de l'action offerte à tout le monde. */
.topic-head__mod {
  flex-shrink: 0;
  color: var(--link);
}
.topic-head__mod--on {
  background: var(--link-soft);
  border-color: var(--link);
}

/* ------------------------------------------------------------------- pied */
.topic-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 12px 20px;
  border-top: 1px solid var(--line-soft);
  background: var(--surface);
}
.topic-foot__note {
  font-size: var(--fs-md);
  color: var(--ink-3);
}

/* ------------------------------------------------------------ écran d'accueil
   L'écran le plus regardé de l'app à froid : c'est lui qui dit ce qu'est
   l'endroit avant qu'on ait cliqué. Il a donc droit au display et à de l'air. */
/* Bloc calé à gauche du panneau et non centré : « tout se passe à gauche » se
   dit aussi par la position, et un pavé centré au milieu d'une colonne de 70 %
   ne pointe vers rien. */
.shell__welcome {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 24px 32px 24px 22px;
}

/* Le liseré de racine et la gouttière de `.msg` : c'est ce qui fait lire
   l'accueil comme la tête d'un fil plutôt que comme une page à part. */
.wel {
  display: grid;
  grid-template-columns: 3px 1fr;
  grid-template-areas:
    'rail brand'
    'rail body';
  column-gap: 13px;
  row-gap: 7px;
  max-width: 60ch;
}

.wel__rail {
  grid-area: rail;
  align-self: stretch;
  border-radius: 999px;
  background: var(--brand);
}

/* Le wordmark de l'en-tête, à la même graisse et au même dessin — c'est le
   forum qui parle, pas un auteur. */
.wel__brand {
  grid-area: brand;
  margin: 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.045em;
  color: var(--ink);
}
.wel__brand-dot {
  color: var(--brand);
}

.wel__body {
  grid-area: body;
  min-width: 0;
}
.wel__title {
  margin: 2px 0 12px;
  font-size: clamp(27px, 3.1vw, 39px);
  letter-spacing: -0.035em;
  line-height: 1.06;
  color: var(--ink);
}
.wel__lead {
  margin: 0 0 11px;
  max-width: 54ch;
  font-size: var(--fs-lg);
  line-height: 1.62;
  color: var(--ink-2);
}
.wel__actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 19px;
}
.wel__more {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--link);
  text-decoration: none;
}
.wel__more:hover {
  text-decoration: underline;
}

/* Une seule apparition orchestrée, au moment où les relais ont répondu : le
   texte se lève dans l'ordre de lecture. */
.wel__title,
.wel__lead,
.wel__actions {
  animation: wel-rise 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
.wel__lead:nth-of-type(1) {
  animation-delay: 0.06s;
}
.wel__lead:nth-of-type(2) {
  animation-delay: 0.12s;
}
.wel__actions {
  animation-delay: 0.18s;
}
@keyframes wel-rise {
  from {
    opacity: 0;
    transform: translateY(7px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .wel__title,
  .wel__lead,
  .wel__actions {
    animation: none;
  }
}

@media (max-width: 820px) {
  .shell {
    grid-template-columns: 1fr;
  }
  .shell__topic {
    display: none;
  }
  .shell--topic-open .shell__list {
    display: none;
  }
  .shell--topic-open .shell__topic {
    display: flex;
  }
  .topic-head,
  .topic-foot {
    padding-left: 14px;
    padding-right: 14px;
  }
  .topic-head__back {
    display: block;
  }
  .topic-head__av {
    display: none;
  }
}

@media (max-width: 700px) {
  .shell__topic {
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
}
</style>
