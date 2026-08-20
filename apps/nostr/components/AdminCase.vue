<template>
  <article class="case">
    <!-- ------------------------------------------------------------- tête -->
    <header class="case__head">
      <span class="case__voices" :class="{ 'case__voices--strong': group.voices > 1 }">
        {{ group.voices }} voix
      </span>
      <span class="case__reports">
        {{ group.reporters.size }} signalement{{ group.reporters.size > 1 ? 's' : '' }}
      </span>
      <span v-for="[type, n] in group.types" :key="type" class="tag">
        {{ labelOf(type) }}<template v-if="n > 1"> ×{{ n }}</template>
      </span>
      <span class="case__spacer" />
      <time class="case__time mono">{{ relativeTime(group.lastAt) }}</time>
    </header>

    <!-- ------------------------------------------------- le contenu visé -->
    <section class="case__block">
      <h3 class="case__label">
        {{ group.targetKind === 'event' ? 'Le message signalé' : 'Le compte signalé' }}
      </h3>

      <div v-if="group.targetKind === 'event'" class="case__msg">
        <template v-if="target">
          <div class="case__msg-bar">
            <UserAvatar :pubkey="target.pubkey" :size="24" />
            <NuxtLink :to="`/profil/${npubFor(target.pubkey)}`" class="case__msg-who">
              {{ profiles.displayName(target.pubkey) }}
            </NuxtLink>
            <span class="case__disc mono">·{{ profiles.discriminator(target.pubkey) }}</span>
            <span class="case__spacer" />
            <NuxtLink v-if="topicPath" :to="topicPath" class="case__msg-topic">
              {{ topicTitleOf }}
            </NuxtLink>
            <time class="case__time mono">{{ forumTime(target.created_at) }}</time>
          </div>
          <!-- Texte brut, sans rendu enrichi : on modère ce qui a été écrit, pas
               ce que le rendu en fait. Un lien déguisé ou un balisage abusif doit
               se voir ici, pas se faire jolier. -->
          <p v-if="edited" class="case__version">texte signalé</p>
          <p class="case__msg-text">{{ target.content }}</p>

          <!--
            L'auteur a corrigé depuis (§2.5), et le modérateur doit voir les DEUX.

            Une seule version suffirait à se tromper dans les deux sens : sur le
            seul texte signalé, on masque pour une phrase déjà retirée ; sur le
            seul texte actuel, il suffit de corriger après coup pour que le
            dossier n'ait plus d'objet. La décision porte sur l'id d'origine, donc
            sur les deux à la fois — c'est ce que montre cet écart.
          -->
          <template v-if="edited && current">
            <p class="case__version case__version--now">
              version actuelle — corrigée le {{ forumTime(current.created_at) }}
            </p>
            <p v-if="current.content.trim()" class="case__msg-text">{{ current.content }}</p>
            <p v-else class="case__msg-text case__msg-text--empty">
              (retiré par son auteur — le texte signalé reste sur les relais)
            </p>
          </template>
        </template>
        <p v-else class="case__missing">
          Introuvable sur les relais interrogés. Le signalement reste traitable — il vise l'auteur.
        </p>
      </div>
    </section>

    <!-- ------------------------------------------------------- l'auteur -->
    <section v-if="authorKey" class="case__block">
      <h3 class="case__label">L'auteur</h3>
      <div class="case__author">
        <UserAvatar :pubkey="authorKey" :size="34" />
        <div class="case__author-main">
          <NuxtLink :to="`/profil/${npubFor(authorKey)}`" class="case__author-name">
            {{ profiles.displayName(authorKey) }}
          </NuxtLink>
          <span class="case__disc mono">·{{ profiles.discriminator(authorKey) }}</span>
          <div class="case__facts">
            <!-- Ces trois faits décident : une clé neuve isolée qui poste vite
                 pendant un raid n'est pas le même dossier qu'un habitué qui
                 dérape. Aucun d'eux n'est un compteur décoratif. -->
            <span class="case__fact" :class="trustClass">{{ trustLabel }}</span>
            <span v-if="banned" class="tag tag--warn">déjà banni</span>
            <span v-if="isStaff" class="tag tag--staff">membre de l'équipe</span>
            <span class="case__fact">
              {{ history.length ? `${history.length} autres messages vus` : 'aucun autre message vu' }}
            </span>
            <span v-if="otherReports > 0" class="case__fact case__fact--hot">
              {{ otherReports }} autre(s) signalement(s) en attente
            </span>
          </div>
        </div>
      </div>

      <details v-if="history.length" class="case__history">
        <summary class="case__history-sum">
          Ses derniers messages ({{ history.length }})
        </summary>
        <ul class="case__history-list">
          <li v-for="ev in history" :key="ev.id" class="case__history-row">
            <time class="case__time mono">{{ forumTime(ev.created_at) }}</time>
            <span class="case__history-text">{{ preview(ev.content) }}</span>
          </li>
        </ul>
      </details>
    </section>

    <!-- --------------------------------------------------- les signalants -->
    <section class="case__block">
      <h3 class="case__label">Qui a signalé</h3>
      <div class="case__reporters">
        <span v-for="pk in [...group.reporters]" :key="pk" class="case__reporter">
          <UserAvatar :pubkey="pk" :size="18" />
          {{ profiles.displayName(pk) }}
        </span>
      </div>
      <p v-if="group.reporters.size > group.voices" class="case__hint">
        {{ group.reporters.size }} comptes, mais <strong>{{ group.voices }} voix</strong> : certains
        se suivent entre eux, donc ils comptent pour un. C'est ce qui empêche un groupe organisé de
        décider seul.
      </p>
      <p v-if="group.notes.length" class="case__notes">
        <span v-for="(n, i) in group.notes.slice(0, 4)" :key="i" class="case__note">« {{ n }} »</span>
      </p>
    </section>

    <!-- ------------------------------------------------------- décision -->
    <form class="case__decide" @submit.prevent="apply('hide')">
      <input
        ref="reasonEl"
        v-model="reason"
        type="text"
        class="case__input"
        maxlength="140"
        placeholder="motif — obligatoire, lu par tout le monde sur /moderation"
        required
      />

      <div class="case__buttons">
        <button
          v-if="group.targetKind === 'event'"
          type="submit"
          class="btn btn--sm btn--primary"
          :disabled="mod.publishing"
        >
          Masquer <kbd>M</kbd>
        </button>
        <button type="button" class="btn btn--sm btn--danger" :disabled="mod.publishing" @click="apply('ban')">
          Bannir l'auteur <kbd>B</kbd>
        </button>
        <button type="button" class="btn btn--sm" :disabled="mod.publishing" @click="apply('ignore')">
          Classer sans suite <kbd>I</kbd>
        </button>
        <span class="case__spacer" />
        <label v-if="mod.amAdmin && group.targetKind === 'event'" class="case__illegal">
          <input v-model="illegal" type="checkbox" />
          illégal — retiré sans recours, et le relais cesse de le servir
        </label>
      </div>

      <p v-if="mod.lastError" class="case__error">{{ mod.lastError }}</p>
    </form>
  </article>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { relativeTime, forumTime } from '~/utils/format'
import { npubFor, topicTitle, rootIdOf } from '~/utils/nostr'
import { topicPath as buildTopicPath } from '~/utils/permalink'
import { REPORT_LABELS, type ReportType, type ReportGroup } from '~/types/moderation'
import {
  KIND_COMMENT,
  KIND_THREAD,
  editTargetOf,
  isRevision,
  latestRevision,
  type NostrEvent,
} from '~/types/nostr'

const props = defineProps<{
  group: ReportGroup
  /** L'event visé, déjà résolu par la page — évite de le redemander par dossier. */
  target: NostrEvent | null
  /** Nombre d'autres dossiers en attente visant le même auteur. */
  otherReports: number
}>()
const emit = defineEmits<{ resolved: [] }>()

const mod = useModerationStore()
const social = useSocialStore()
const profiles = useProfileStore()
const topics = useTopicStore()
const relayStore = useRelayStore()

const reason = ref('')
const illegal = ref(false)
const reasonEl = ref<HTMLInputElement | null>(null)
const history = ref<NostrEvent[]>([])
/** Corrections du message visé, trouvées dans l'historique de son auteur. */
const revisions = ref<NostrEvent[]>([])

const current = computed(() =>
  props.target ? latestRevision(props.target, revisions.value) : null,
)
const edited = computed(() => !!props.target && current.value !== props.target)

const authorKey = computed(() =>
  props.group.targetKind === 'pubkey' ? props.group.target : (props.target?.pubkey ?? null),
)

const banned = computed(() => !!authorKey.value && mod.isBanned(authorKey.value))
const isStaff = computed(() => !!authorKey.value && mod.isStaff(authorKey.value))

/**
 * Le niveau de confiance dit l'essentiel d'un dossier de raid : une clé jamais
 * vue dans le graphe est le profil type du compte jetable (§9.5), un compte suivi
 * par le réseau ne l'est pas. Ça ne décide pas à la place du modérateur, ça lui
 * évite d'aller chercher l'information ailleurs.
 */
const trust = computed(() => (authorKey.value ? social.trustOf(authorKey.value) : 'unknown'))
const trustLabel = computed(() => {
  switch (trust.value) {
    case 'followed':
      return 'tu la suis'
    case 'network':
      return `suivie par ${social.networkCount(authorKey.value ?? '')} de tes suivis`
    case 'muted':
      return 'bloquée par toi'
    case 'self':
      return 'ta propre clé'
    default:
      return 'clé inconnue du graphe'
  }
})
const trustClass = computed(() =>
  trust.value === 'unknown' ? 'case__fact--hot' : trust.value === 'network' || trust.value === 'followed' ? 'case__fact--calm' : '',
)

const rootId = computed(() => (props.target ? rootIdOf(props.target) : null))
const topicTitleOf = computed(() => {
  const id = rootId.value
  if (!id) return ''
  const root = topics.rootById(id)
  return root ? topicTitle(root) : 'le topic'
})
const topicPath = computed(() => {
  const id = rootId.value
  return id ? buildTopicPath(id, topicTitleOf.value) : null
})

function labelOf(type: string): string {
  return REPORT_LABELS[type as ReportType] ?? type
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat
}

/**
 * L'historique récent de l'auteur — la pièce qui manquait le plus.
 *
 * Un message isolé ne dit pas si on a affaire à un dérapage ou à une série. La
 * différence entre « masquer ce message » et « bannir la clé » se joue là, et
 * aller la chercher à la main dans le forum pendant un raid n'est pas tenable.
 */
async function loadHistory(): Promise<void> {
  const pk = authorKey.value
  history.value = []
  revisions.value = []
  if (!pk) return
  try {
    const events = await relayStore.query({ authors: [pk], kinds: [KIND_THREAD, KIND_COMMENT], limit: 20 })
    // Les corrections du message visé sortent de la même requête : elles sont de
    // son auteur, donc elles sont déjà là. Rien à demander en plus.
    revisions.value = props.target ? events.filter((e) => editTargetOf(e) === props.target!.id) : []
    history.value = events
      // Une correction n'est pas « un autre message » : la compter donnerait à
      // un khey qui se relit le dossier d'un khey qui poste en rafale.
      .filter((e) => e.id !== props.target?.id && !isRevision(e))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 12)
  } catch {
    // pas d'historique : le dossier reste traitable, avec moins de contexte
  }
}

async function apply(verb: 'hide' | 'ban' | 'ignore'): Promise<void> {
  let ok = false
  if (verb === 'hide') {
    ok = await mod.hide(props.group.target, reason.value, illegal.value ? 'illegal' : 'editorial')
  } else if (verb === 'ban') {
    const pk = authorKey.value
    if (!pk) {
      return
    }
    ok = await mod.ban(pk, reason.value)
  } else {
    ok = await mod.ignoreReport(props.group.target, reason.value)
  }
  if (ok) {
    reason.value = ''
    illegal.value = false
    emit('resolved')
  }
}

defineExpose({
  focusReason: () => reasonEl.value?.focus(),
  apply,
})

watch(() => props.group.target, () => {
  reason.value = ''
  illegal.value = false
})

/**
 * On suit `authorKey` et non le dossier : au montage, l'event visé n'est pas
 * encore résolu, donc l'auteur est inconnu et l'historique repartait vide — puis
 * plus rien ne le relançait, le dossier n'ayant pas changé. Le contexte le plus
 * utile du panneau ne s'affichait jamais.
 */
watch(authorKey, () => void loadHistory(), { immediate: true })

onMounted(() => {
  // Le titre du topic n'est connu que si sa racine est chargée ; sur cette page
  // la liste de topics n'est pas montée, donc on va la chercher.
  const id = rootId.value
  if (id) void topics.fetchRoot(id)
})
watch(rootId, (id) => {
  if (id) void topics.fetchRoot(id)
})
</script>

<style scoped>
.case {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.case__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line-soft);
}
.case__spacer {
  flex: 1;
  min-width: 4px;
}

/* Les voix sont le chiffre qui ordonne la file : seul élément de la tête à
   porter du poids. Le nombre de signalements est à côté, en gris, parce qu'il
   se lit mais ne décide pas. */
.case__voices {
  padding: 3px 10px;
  border-radius: var(--r-pastille);
  background: var(--surface-3);
  font-size: var(--fs-md);
  font-weight: 700;
  color: var(--ink-2);
}
.case__voices--strong {
  background: var(--brand-soft);
  color: var(--brand-ink);
}
.case__reports,
.case__time {
  font-size: var(--fs-sm);
  color: var(--ink-4);
}
.case__time {
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.case__block {
  padding: 14px 0;
  border-bottom: 1px solid var(--line-soft);
}
.case__label {
  margin: 0 0 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-4);
}

/* ------------------------------------------------------------- message */
.case__msg {
  padding: 10px 12px;
  background: var(--surface-sunken);
  border-left: 2px solid var(--line-strong);
  border-radius: 0 var(--r-control) var(--r-control) 0;
}
.case__msg-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 7px;
  font-size: var(--fs-sm);
}
.case__msg-who {
  font-weight: 700;
  color: var(--link);
  text-decoration: none;
}
.case__msg-topic {
  font-size: var(--fs-sm);
  color: var(--ink-4);
  max-width: 24ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.case__disc {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
}
.case__msg-text {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: 1.55;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.case__msg-text--empty {
  font-style: italic;
  color: var(--ink-4);
}

/* Étiquette des deux versions. N'apparaît QUE s'il y en a deux : sur un dossier
   ordinaire, coiffer le texte signalé d'un « texte signalé » serait du bruit. */
.case__version {
  margin: 0 0 4px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-4);
}
.case__version--now {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  color: var(--ink-3);
}
.case__missing {
  margin: 0;
  font-size: var(--fs-md);
  font-style: italic;
  color: var(--ink-4);
}

/* -------------------------------------------------------------- auteur */
.case__author {
  display: flex;
  gap: 11px;
  align-items: flex-start;
}
.case__author-main {
  min-width: 0;
}
.case__author-name {
  font-weight: 700;
  font-size: var(--fs-lg);
  color: var(--link);
  text-decoration: none;
}
.case__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 5px;
}
.case__fact {
  padding: 2px 7px;
  border-radius: var(--r-pastille);
  background: var(--surface-3);
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
/* Ambre pour ce qui appelle un examen, vert pour ce qui rassure. Ni l'un ni
   l'autre ne conclut : ils orientent la lecture du dossier. */
.case__fact--hot {
  background: var(--warn-soft);
  color: var(--warn);
}
.case__fact--calm {
  background: var(--ok-soft);
  color: var(--ok);
}

.case__history {
  margin-top: 11px;
}
.case__history-sum {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--ink-3);
  cursor: pointer;
}
.case__history-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
}
.case__history-row {
  display: flex;
  gap: 9px;
  padding: 5px 0;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-md);
}
.case__history-text {
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

/* --------------------------------------------------------- signalants */
.case__reporters {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.case__reporter {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 3px;
  border-radius: 999px;
  background: var(--surface-3);
  font-size: var(--fs-sm);
  color: var(--ink-2);
}
.case__hint {
  margin: 9px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--ink-4);
}
.case__notes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 9px 0 0;
}
.case__note {
  font-size: var(--fs-md);
  font-style: italic;
  color: var(--ink-3);
}

/* ---------------------------------------------------------- décision */
/* Collée en bas du panneau : le geste doit être au même endroit quel que soit
   la longueur du dossier, sinon on le cherche à chaque cas. */
.case__decide {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  padding: 14px 0 0;
  background: var(--surface);
}
.case__input {
  width: 100%;
  padding: 9px 11px;
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-family: inherit;
  font-size: var(--fs-md);
  color: var(--ink);
}
.case__input:focus {
  outline: none;
  border-color: var(--link);
  box-shadow: var(--ring);
}
.case__buttons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}
.case__illegal {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--ink-4);
}
.case__error {
  margin: 9px 0 0;
  font-size: var(--fs-sm);
  color: var(--warn);
}

kbd {
  margin-left: 5px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.22);
  font-family: var(--font-mono);
  font-size: 9.5px;
}
.btn:not(.btn--primary):not(.btn--danger) kbd {
  background: var(--surface-3);
  color: var(--ink-4);
}
</style>
