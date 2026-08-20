<template>
  <component :is="tag" :to="to" class="notif" :class="{ 'notif--unread': notif.unread }">
    <!-- Liseré de non-lu. Orange : quelque chose est arrivé et attend, comme la
         pastille de MP et le rail de chauffe. Le bleu dirait « où tu es », ce
         qui n'a aucun sens pour une ligne qu'on n'a pas encore ouverte. -->
    <span class="notif__rail" aria-hidden="true" />

    <!-- Pile d'avatars : trois au plus. Au-delà, les visages ne se distinguent
         plus et c'est le nombre écrit dans la phrase qui porte l'information. -->
    <span class="notif__avs" :style="{ width: `${30 + (faces.length - 1) * 15}px` }">
      <UserAvatar
        v-for="(pk, i) in faces"
        :key="pk"
        :pubkey="pk"
        :size="30"
        class="notif__av"
        :style="{ left: `${i * 15}px`, zIndex: faces.length - i }"
        :alt="`avatar de ${profiles.displayName(pk)}`"
      />
    </span>

    <span class="notif__head">
      <!-- Le pseudo et le verbe forment une phrase, pas deux étiquettes :
           « khey_a et 18 autres t'ont répondu » se lit d'un trait.

           L'espace est écrit à la main : `.notif__head` est en `-webkit-box`
           pour le clamp à deux lignes, et ce mode d'affichage avale le blanc
           entre deux éléments du template — la phrase sortait collée
           (« et 3 autrest'ont répondu »). -->
      <strong class="notif__who">{{ who }}</strong>{{ ' ' }}<span class="notif__verb">{{ verb }}</span>
    </span>

    <time class="notif__when mono">{{ relativeTime(notif.createdAt) }}</time>

    <span v-if="context" class="notif__context">{{ context }}</span>
    <span v-if="notif.preview" class="notif__preview">{{ notif.preview }}</span>
  </component>
</template>

<script setup lang="ts">
/**
 * Une ligne du panneau de notifications. Même anatomie que la rangée de topic et
 * que le fil de MP — avatar en colonne, titre et heure sur la première ligne,
 * contexte en dessous — pour que les trois listes de l'app se lisent pareil.
 *
 * Une ligne réunit souvent plusieurs events (voir `items` dans le store), d'où
 * la pile d'avatars et l'accord du verbe.
 */
import { computed } from 'vue'
import { relativeTime } from '~/utils/format'
import { topicPath } from '~/utils/permalink'
import { topicTitle, npubFor } from '~/utils/nostr'
import type { Notif } from '~/stores/notifications'

const props = defineProps<{ notif: Notif }>()

const profiles = useProfileStore()
const topics = useTopicStore()

const faces = computed(() => props.notif.actors.slice(0, 3))
const many = computed(() => props.notif.actors.length > 1)

/**
 * UN seul pseudo nommé, puis le compte. Deux pseudos ne tiennent pas : le nom de
 * repli d'une clé sans profil fait treize caractères (`khey_9ccf1091`), donc
 * « khey_a, khey_b et 2 autres » dépasse largement les ~200 px de la colonne et
 * finissait tronqué en « khey_9ccf1091,… » — soit un nom, un compte perdu, et
 * une phrase illisible.
 */
const who = computed(() => {
  const first = profiles.displayName(props.notif.actors[0]!)
  const rest = props.notif.actors.length - 1
  if (rest === 0) return first
  return `${first} et ${rest} autre${rest > 1 ? 's' : ''}`
})

const verb = computed(() => {
  switch (props.notif.kind) {
    case 'reply':
      return many.value ? "t'ont répondu" : "t'a répondu"
    case 'mention':
      return many.value ? "t'ont cité" : "t'a cité"
    case 'follow':
      return many.value ? 'te suivent' : 'te suit'
    default:
      return "t'a écrit en MP"
  }
})

/**
 * La deuxième ligne situe. Pour une réponse c'est le topic — sans lui, « khey_x
 * t'a répondu » ne dit pas de quoi on parle et il faut cliquer pour le savoir.
 *
 * Le titre vient du cache de topics, alimenté par le panneau ; tant qu'il n'est
 * pas arrivé on ne met rien plutôt qu'un identifiant hexadécimal, qui
 * n'apprendrait rien — un id affiché à la place du contenu qu'il désigne est un
 * code de chat déguisé.
 */
const context = computed(() => {
  const n = props.notif
  if (n.kind === 'dm') return `${n.count} message${n.count > 1 ? 's' : ''} non lu${n.count > 1 ? 's' : ''}`
  if (n.kind === 'follow') return ''
  if (!n.topicId) return ''
  const root = topics.rootById(n.topicId)
  const where = root ? `sur « ${topicTitle(root)} »` : ''
  if (n.count <= 1) return where
  const tally = `${n.count} messages`
  return where ? `${where} · ${tally}` : tally
})

/**
 * Un groupe de suivis n'a pas de destination : il n'y a pas UN profil à ouvrir.
 * La ligne cesse alors d'être un lien plutôt que d'en inventer un arbitraire —
 * un lien qui mène ailleurs que là où il annonce est pire que pas de lien.
 */
const navigable = computed(() => !(props.notif.kind === 'follow' && many.value))
const tag = computed(() => (navigable.value ? resolveComponent('NuxtLink') : 'div'))

/**
 * L'ancre `#msg-<id>` est celle que `PostItem` pose sur chaque message et que le
 * bouton « permalien » copie déjà ; `PostFeed` la consomme au chargement pour
 * sauter au bon endroit. Sans elle, une notification déposerait le lecteur en
 * bas d'un fil de 150 messages, ce qui revient à ne pas l'avoir amené.
 */
const to = computed(() => {
  if (!navigable.value) return undefined
  const n = props.notif
  if (n.kind === 'dm') return { path: '/dm', query: { peer: n.actors[0] } }
  if (n.kind === 'follow') return `/profil/${npubFor(n.actors[0]!)}`
  if (!n.topicId) return '/'
  const root = topics.rootById(n.topicId)
  const path = topicPath(n.topicId, root ? topicTitle(root) : null)
  return n.eventId ? `${path}#msg-${n.eventId}` : path
})
</script>

<style scoped>
/* Grille à deux lignes, comme `.topic-row` : liseré et avatars tiennent leur
   colonne sur toute la hauteur pour que la phrase et le contexte partagent le
   même bord gauche. */
.notif {
  display: grid;
  grid-template-columns: 3px auto 1fr auto;
  grid-template-areas:
    'rail avs head    when'
    'rail avs context context'
    'rail avs preview preview';
  align-items: start;
  column-gap: 11px;
  row-gap: 2px;
  padding: 10px;
  border-radius: var(--r-control);
  text-decoration: none !important;
  transition: background 0.14s ease;
}
.notif:hover {
  background: var(--surface-3);
}
/* Un groupe de suivis n'est pas cliquable : il ne doit pas non plus s'allumer
   au survol comme s'il l'était. */
div.notif:hover {
  background: transparent;
}

.notif__rail {
  grid-area: rail;
  align-self: stretch;
  min-height: 30px;
  border-radius: 999px;
  background: transparent;
}
.notif--unread .notif__rail {
  background: var(--brand);
}

.notif__avs {
  grid-area: avs;
  position: relative;
  align-self: start;
  height: 30px;
  flex-shrink: 0;
}
/* L'anneau à la couleur de la surface détache chaque visage de celui d'en
   dessous : sans lui, la pile fait une bouillie de pixels. */
.notif__av {
  position: absolute;
  top: 0;
  box-shadow: 0 0 0 2px var(--surface);
}

/* La phrase passe à la ligne au lieu de s'élider : c'est le contenu principal de
   la rangée, il passe avant la compacité. Deux lignes au plus — au-delà, c'est
   qu'un pseudo est absurde, et il s'élide alors lui-même. */
.notif__head {
  grid-area: head;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  min-width: 0;
  font-size: var(--fs-base);
  line-height: 1.35;
}
.notif__who {
  font-weight: 600;
  letter-spacing: -0.012em;
  color: var(--ink-2);
}
.notif__verb {
  color: var(--ink-3);
}
/* Non lu : le pseudo reprend de l'encre et du poids. Deux canaux pour un seul
   fait — un liseré de 3 px seul se rate en survolant la liste. */
.notif--unread .notif__who {
  font-weight: 700;
  color: var(--ink);
}
.notif--unread .notif__verb {
  color: var(--ink-2);
}

.notif__when {
  grid-area: when;
  justify-self: end;
  align-self: start;
  padding-top: 2px;
  font-size: 10.5px;
  color: var(--ink-4);
  white-space: nowrap;
}

.notif__context {
  grid-area: context;
  min-width: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Deux lignes maximum : une amorce, pas le message. Au-delà, la liste
   deviendrait un fil et on ne compterait plus les notifications. */
.notif__preview {
  grid-area: preview;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--ink-4);
  overflow-wrap: anywhere;
}
</style>
