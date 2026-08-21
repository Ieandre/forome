<template>
  <section class="shell__topic">
    <NewTopicPanel v-if="newTopic" />

    <template v-else-if="openTopicId">
      <header class="topic-head">
        <div class="topic-head__col">
          <BackButton label="retour à la liste" @click="closeTopic" />

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
        </div>
      </header>

      <TopicModeration v-if="modPanel && openTopicId" :topic-id="openTopicId" @close="modPanel = false" />

      <PostFeed ref="feedEl" :topic-id="openTopicId" :unread-since="unreadSince" @reply="onReplyRequest" />

      <!-- Le flux global est un mode de test de débit, pas un topic : on n'y
           publie pas (il n'a pas de racine à laquelle rattacher une réponse). -->
      <!-- Topic verrouillé : le composeur disparaît, mais le fil reste lisible
           et le motif est affiché. Fermer sans dire pourquoi serait la censure
           silencieuse que le §9.2 refuse. -->
      <footer v-if="lockNotice" class="topic-foot">
        <!-- Le cadenas seul se permet ici ce qu'il ne peut pas ailleurs : la
             phrase qui suit porte déjà le motif et l'auteur de la décision. -->
        <span class="tag">
          <Glyph name="lock" />
          <span class="visually-hidden">verrouillé</span>
        </span>
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
        :reply-to-index="replyToIndex"
        :participants="feedEl?.participants ?? []"
        @posted="onPosted"
        @unsent="onPostUnsent"
        @settled="onPostSettled"
        @cancel-reply="clearReply"
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
             dépend d'aucune donnée, donc il s'affiche dès le premier rendu.

             Il ne décrit PAS l'écran. La version précédente expliquait la mise
             en page — la liste est à gauche, le topic s'ouvre ici, sans
             recharger — c'est-à-dire la plomberie d'une SPA, que deux secondes
             d'usage apprennent mieux qu'un paragraphe. C'est la seule surface
             où le forum peut dire ce qu'il EST avant qu'on ait cliqué : elle
             porte donc les trois propriétés, chacune avec le mécanisme qui la
             rend vraie, parce qu'une propriété sans son mécanisme est un
             slogan. Rien de l'ancien texte n'est repris : l'ordre de la liste
             se voit dans la liste. -->
        <div class="wel__body">
          <h2 class="wel__title display">Ce que tu écris ici, personne ne peut le retirer.</h2>
          <p class="wel__lead">
            Il n'y a pas de serveur qui nous appartienne. Ton message est signé par ta clé, puis
            recopié sur des relais indépendants qui en gardent chacun leur copie : nous pouvons
            cesser d'en servir un, le faire disparaître du réseau, non.
          </p>
          <p class="wel__lead">
            Il n'y a pas de compte non plus. Ton navigateur t'a fabriqué une clé en arrivant — elle
            est ton identité, ici comme dans n'importe quel autre client Nostr. Ni mot de passe, ni
            adresse à donner : tu peux répondre tout de suite.
          </p>
          <!-- Conditionnée comme dans `UserMenu` : sans clé racine épinglée, ce
               client n'applique la décision de personne, et il n'y a donc aucune
               modération dont annoncer la transparence. -->
          <p v-if="mod.configured" class="wel__lead">
            Et ce qu'on masque, on le dit : chaque décision de modération est un message signé,
            avec son motif, que tout le monde peut relire.
          </p>
          <div class="wel__actions">
            <NuxtLink to="/new" class="btn btn--primary">Nouveau topic</NuxtLink>
            <NuxtLink to="/comment-ca-marche" class="wel__more">Comment ça marche</NuxtLink>
            <NuxtLink v-if="mod.configured" to="/moderation" class="wel__more">Qui modère ici</NuxtLink>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * Vue 30/70 (spec §7.1) : liste à gauche, topic ouvert à droite, tout en
 * direct, jamais de rechargement. Le state du panneau droit est dans l'URL —
 * la culture repose entièrement sur le partage de liens.
 *
 * Mobile : bascule pleine largeur. La feuille glissante à trois ancrages de
 * §7.4 n'est pas implémentée — elle demande une bibliothèque de gestes pour un
 * gain que la bascule donne déjà.
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
const { copied, copy } = useCopy()
const modPanel = ref(false)
const replyTo = ref<NostrEvent | null>(null)
/** Le nº du message visé dans ce fil, tel qu'il s'affichait au clic sur « Citer ». */
const replyToIndex = ref<number | null>(null)

function onReplyRequest(ev: NostrEvent, index: number | null): void {
  replyTo.value = ev
  replyToIndex.value = index
}

function clearReply(): void {
  replyTo.value = null
  replyToIndex.value = null
}
const feedEl = ref<{
  pushOwnPost: (ev: NostrEvent, replacedId?: string) => void
  dropPost: (id: string) => void
  markOwnState: (id: string, state: 'pending' | 'failed' | null) => void
  /** Les gens du fil, pour la complétion `@…` du composeur. */
  participants: string[]
} | null>(null)

/**
 * Publication optimiste : le fil affiche le message dès le clic, avant même
 * qu'il soit miné et signé (§6.3), marqué « envoi… » jusqu'à ce qu'un relais
 * l'accepte. Le second appel apporte l'event réel et l'id provisoire qu'il
 * remplace.
 */
function onPosted(ev: NostrEvent, replacedId?: string): void {
  feedEl.value?.pushOwnPost(ev, replacedId)
  feedEl.value?.markOwnState(ev.id, 'pending')
  clearReply()
}

/**
 * L'envoi n'a jamais produit d'event. Contrairement au refus des relais, il n'y
 * a rien à marquer « non publié » : le message n'a pas d'id, donc pas
 * d'existence — la rangée s'en va, et le composeur a déjà repris le texte.
 */
function onPostUnsent(id: string): void {
  feedEl.value?.dropPost(id)
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

/**
 * `readAt` tel qu'il était AVANT d'ouvrir ce topic : c'est lui qui dit où le
 * fil pose le filet « depuis ta dernière visite ». Capturé ici et pas lu par le
 * fil directement, parce que `markRead` (plus bas) écrase la valeur dès
 * l'ouverture — ce watcher est enregistré avant lui, l'ordre compte.
 */
const unreadSince = ref<number | null>(null)

watch(
  () => props.openTopicId,
  (id) => {
    clearReply()
    unreadSince.value = id ? reading.readAt[id] ?? null : null
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

function copyPermalink(): void {
  void copy(window.location.href)
}
</script>

<style scoped>
/* Le panneau de droite, seul : la grille 30/70 et la colonne de gauche vivent
   dans `layouts/default.vue` depuis qu'elles servent TOUTES les routes. */
.shell__topic {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-2);
  overflow: hidden;
  /*
   * Mesure de lecture, partagée par l'en-tête, le fil et le pied.
   *
   * 880 px donnaient 111 caractères par ligne (mesuré dans Instrument Sans, pas
   * estimé) là où l'œil retrouve le début de la ligne suivante jusqu'à ~75. Au
   * delà il la rate, et il la rate à CHAQUE retour : c'était le premier défaut
   * de lisibilité du fil, avant toute question de hauteur. 700 px avec le corps
   * à 15 px donnent 80 caractères — au-dessus de l'idéal, mais un forum se lit
   * plus dense qu'un livre, et resserrer davantage ferait une bande étroite au
   * milieu d'un panneau de 970.
   */
  --topic-col: 700px;
}

/* ------------------------------------------------------------ tête de topic
   Le titre est la seule ligne de l'écran qui a droit à Bricolage : c'est ce
   qu'on est venu lire, et il doit se distinguer du fil qu'il coiffe. Il n'a
   plus besoin de bordure basse — le fil défile en dessous sur un fond
   légèrement enfoncé, et le décrochement de surface suffit. */
.topic-head {
  flex-shrink: 0;
  padding: 14px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--line-soft);
}
/* Le bandeau reste pleine largeur — c'est lui qui porte le filet et le
   décrochement de surface — mais son CONTENU tient dans la colonne de lecture.
   Sans ça le titre commençait 16 px à gauche du bord des messages et 26 px à
   gauche du composeur : trois bords à quelques pixels d'écart, assez proches
   pour se lire comme un défaut plutôt que comme trois alignements. */
.topic-head__col {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: var(--topic-col, 880px);
  margin: 0 auto;
}
.topic-head__av {
  flex-shrink: 0;
}
.topic-head__main {
  min-width: 0;
  flex: 1;
}
/* Deux lignes plutôt qu'une troncature : le titre est ce qu'on est venu lire, et
   la colonne s'est resserrée à la mesure de lecture — l'ellipse y mangerait des
   titres entiers. La tête ne grandit que quand elle en a besoin. */
.topic-head__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
  flex-wrap: wrap;
  gap: 2px 10px;
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
  /* Sans ça, « 4 msg » se coupait entre le chiffre et l'unité sur un téléphone :
     la rangée repliait à l'intérieur du compteur au lieu d'entre les compteurs. */
  white-space: nowrap;
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
/* Bloc calé à gauche du panneau et non centré : il se lit comme la tête d'un
   fil, et un fil commence au bord de sa gouttière — un pavé centré au milieu
   d'une colonne de 70 % ne s'accroche à rien.

   Colonne qui défile, et pas un centrage en ligne : centrer sur l'axe transverse
   rogne les deux bouts dès que le contenu dépasse, et le défilement ne les
   rattrape pas. Le texte d'accueil dépasse sur un écran court et large (petit
   portable, fenêtre partagée), là où le panneau est encore rendu — sous 820 px
   c'est la liste qui prend la place. La marge auto de `.wel` centre quand ça
   tient et tombe à 0 quand ça ne tient pas. */
.shell__welcome {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 24px 32px 24px 22px;
}

/* Le liseré de racine et la gouttière de `.msg` : c'est ce qui fait lire
   l'accueil comme la tête d'un fil plutôt que comme une page à part. */
.wel {
  margin-block: auto;
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
/* Les délais suivent l'ordre de lecture. Le troisième paragraphe est
   conditionnel : quand il manque, la rangée d'actions se lève simplement 60 ms
   plus tôt que son voisin — il n'y a pas de trou à combler. */
.wel__lead:nth-of-type(1) {
  animation-delay: 0.06s;
}
.wel__lead:nth-of-type(2) {
  animation-delay: 0.12s;
}
.wel__lead:nth-of-type(3) {
  animation-delay: 0.18s;
}
.wel__actions {
  animation-delay: 0.24s;
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
  .topic-head,
  .topic-foot {
    padding-left: 14px;
    padding-right: 14px;
  }
  .topic-head__av {
    display: none;
  }
}

/* ------------------------------------------------------- tête sur TÉLÉPHONE
 * La ligne méta répond à « est-ce que j'ouvre ce topic ? », et on est dedans :
 * l'auteur est répété par le message #1 quarante pixels plus bas (avec son
 * badge), le nombre de messages se lit sur leur numérotation, le nombre de
 * kheys sert à choisir dans la liste, et « ça parle maintenant » se voit aux
 * réponses qui arrivent. Elle coûtait 40 des 93 px de la tête — dont deux
 * lignes au lieu d'une, parce que « retour » et « permalien » écrasent la
 * colonne du titre à 217 px.
 */
@media (max-width: 700px), (max-height: 560px) {
  .topic-head {
    gap: 10px;
    padding-top: 10px;
    padding-bottom: 10px;
  }
  .topic-head__meta {
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

/* ------------------------------------------------------------ écran COURT
   Le téléphone en paysage. La tête rend ce qu'elle peut — 30 px — pour que le
   fil garde une hauteur de lecture entre elle et le composeur. Le titre reste
   au display : c'est ce qu'on est venu lire, il perd trois points, pas son
   dessin. Voir la même règle dans `Composer.vue`. */
@media (max-height: 560px) {
  .topic-head {
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .topic-head__title {
    font-size: 17px;
  }
  .topic-foot {
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .shell__welcome {
    padding-block: 14px;
  }
}
</style>
