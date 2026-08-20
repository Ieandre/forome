<template>
  <div class="topic-list" @mouseenter="hovered = true" @mouseleave="onMouseLeave">
    <!-- En-tête de la colonne. Les deux libellés de colonnes (« Sujet », « Msg »)
         sont tombés avec le tableau qu'ils coiffaient : il n'y a plus de grille à
         annoncer, et le seul nombre de la rangée est déjà nommé par sa bulle.
         Reste ce qui agit — l'action d'ouvrir un topic, en primaire.

         Pas d'indicateur « figé » ici. Le gel se déclenche parce que le curseur
         est dans la liste, et son intérêt est justement que rien ne bouge : une
         étiquette qui apparaît et disparaît au passage de la souris décrit un
         mécanisme sur lequel on ne peut pas agir. Le seul cas actionnable, celui
         où l'ordre a réellement changé pendant le gel, est déjà porté par la
         pilule en dessous. -->
    <div class="topic-list__head" :class="{ 'topic-list__head--searching': searching }">
      <span v-if="!searching" class="topic-list__label">Topics</span>

      <!-- La loupe reste le même bouton dans les deux états : elle ouvre le
           champ, puis elle y ramène le curseur. La bulle se coupe une fois le
           champ ouvert — elle nommerait une commande dont le résultat est déjà
           à l'écran, par-dessus le champ qu'on vient d'ouvrir. -->
      <Hint text="filtrer les topics affichés" placement="bottom" :disabled="searching">
        <button ref="openBtn" type="button" class="tool topic-list__filter" @click="openSearch">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.4" />
            <path d="M15.3 15.3 20.4 20.4" />
          </svg>
        </button>
      </Hint>

      <!-- Le champ prend TOUTE la ligne de tête, il ne se glisse pas à côté du
           primaire : à 300 px de colonne il resterait 146 px pour taper. On ne
           peut de toute façon pas ouvrir un topic et filtrer en même temps, et
           le repli « Nouveau topic » de la barre de site couvre l'intervalle. -->
      <input
        v-if="searching"
        ref="searchEl"
        v-model="query"
        type="search"
        class="topic-list__search"
        placeholder="filtrer les topics affichés…"
        aria-label="filtrer les topics affichés"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        @keydown.esc.prevent="onEscape"
      />

      <NuxtLink v-if="!searching" to="/new" class="topic-list__new">Nouveau topic</NuxtLink>
      <!-- Fermer VIDE. Un filtre actif sous un champ replié donne une liste
           mystérieusement courte sans cause visible à l'écran : c'est le bug
           classique de la recherche repliable, et la seule parade est
           l'invariant. Échap fait les deux temps (vider, puis fermer). -->
      <Hint v-else text="fermer le filtre" placement="bottom">
        <button type="button" class="tool" @click="closeSearch">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
          </svg>
        </button>
      </Hint>
    </div>

    <!-- L'équivalent lecteur d'écran de voir la colonne rétrécir. -->
    <p class="visually-hidden" aria-live="polite">{{ resultsNote }}</p>

    <!-- Masquée pendant le filtrage : orange et pulsante par-dessus des
         résultats, elle entre en concurrence avec la seule chose qu'on regarde
         à ce moment-là. Elle revient au vidage du champ, avec son retard. -->
    <Transition name="pill-pop">
      <button v-if="showPill" type="button" class="pill pill--pulse topic-list__pill" @click="applyPending">
        {{
          pendingNewCount > 0
            ? `+${pendingNewCount} nouveau${pendingNewCount > 1 ? 'x' : ''} topic${pendingNewCount > 1 ? 's' : ''}`
            : 'ordre mis à jour'
        }}
      </button>
    </Transition>

    <div class="topic-list__scroll">
      <NuxtLink
        v-for="t in rows"
        :key="t.id"
        :to="topicPath(t.id, t.title)"
        class="topic-row"
        :class="{
          'topic-row--active': t.id === openTopicId,
          'topic-row--fresh': reading.hasFresh(t.id, t.lastAt),
          'topic-row--read': reading.isCaughtUp(t.id, t.lastAt),
        }"
        :aria-current="t.id === openTopicId ? 'page' : undefined"
      >
        <!-- LE RAIL DE CHAUFFE (voir main.css). Il reprend la chaleur que le
             compteur portait en puce colorée : même donnée, forme qui se lit en
             périphérie. Décoratif pour le lecteur d'écran — la bulle du
             compteur dit déjà « et ça parle maintenant » en toutes lettres. -->
        <span
          class="heat topic-row__heat"
          :class="heatClass(t)"
          :style="{ '--fill': heatFill(t) }"
          aria-hidden="true"
        />

        <!-- L'identicon remplace la pastille d'état : il est dérivé de la clé,
             donc il colore la liste avec de l'information plutôt qu'avec de la
             décoration, et il rend l'usurpation de pseudo visible à l'œil. -->
        <UserAvatar
          :pubkey="t.pubkey"
          :size="26"
          class="topic-row__av"
          :alt="`avatar de ${profiles.displayName(t.pubkey)}`"
        />

        <span class="topic-row__head">
          <!-- Largeur réservée sur TOUTES les rangées, encrée sur les seules qui
               ont du neuf. Un marqueur qui n'existe que parfois décalerait le
               bord gauche des titres d'une rangée à l'autre, et c'est ce bord
               qu'on suit en parcourant la liste. -->
          <span class="topic-row__dot" aria-hidden="true" />
          <Hint v-if="mod.isPinned(t.id)" text="épinglé par la modération">
            <span class="tag tag--staff topic-row__flag">épinglé</span>
          </Hint>
          <!-- La bulle du compteur le dit aussi, mais elle est `aria-hidden` et
               le nombre porte déjà son propre nom accessible : sans ça le point
               n'existerait pas au lecteur d'écran. -->
          <span v-if="reading.hasFresh(t.id, t.lastAt)" class="visually-hidden">du nouveau —</span>
          <span class="topic-row__title">
            <template v-for="(part, i) in titleParts(t)" :key="i">
              <mark v-if="part.hit" class="topic-row__hit">{{ part.text }}</mark>
              <span v-else>{{ part.text }}</span>
            </template>
          </span>
          <Hint
            v-if="mod.isLocked(t.id)"
            :text="`verrouillé par la modération — ${mod.lockNotice(t.id)?.reason ?? 'sans motif'}`"
          >
            <span class="tag topic-row__flag">verrouillé</span>
          </Hint>
          <!-- `Hint` et non `Explain` : la rangée est un lien, et un bouton
               dans un lien est invalide autant qu'impraticable au clavier. -->
          <Hint
            v-if="topicStore.flaggedTopics.has(t.id)"
            text="arrivée corrélée de clés inconnues, d'après l'indexeur"
          >
            <span class="tag tag--warn topic-row__flag">raid</span>
          </Hint>
        </span>

        <!-- Le chevron a disparu avec la puce colorée : il marquait le même
             seuil que le rail, en moins lisible. Le compteur redevient un
             nombre, gradué en encre. -->
        <Hint :text="countTitle(t)">
          <span class="count" :class="countClass(t)">{{ t.replies }}</span>
        </Hint>

        <!-- Plus d'extrait du dernier message. Sur un fil de forum il rend « up »,
             « mdr », ou rien du tout : `lastText` reste vide tant qu'aucune
             réponse n'est arrivée, ce qui est le cas de la plupart des topics. Il
             coûtait la ligne que le titre réclame. C'est le code du MP (voir
             `DmThreadRow`), où un fil à deux se décide vraiment sur son dernier
             message ; un topic à deux cents messages, jamais. -->
        <span class="topic-row__by">{{ profiles.displayName(t.pubkey) }}</span>
        <span class="topic-row__when mono">{{ relativeTime(t.lastAt) }}</span>
      </NuxtLink>

      <!-- Squelettes à la forme des rangées finales, jamais un rond qui tourne.
           Le critère est `settled` et non `loading` : `loading` retombe aussi sur
           le garde-fou de dernier recours, et une liste encore vide basculait
           alors sur « personne n'a lancé de topic » — un mensonge qui se lisait
           comme une panne, et qu'on ne corrigeait qu'en rechargeant. -->
      <div v-if="rows.length === 0 && !topicStore.settled" class="topic-list__skel">
        <div v-for="i in 9" :key="i" class="topic-list__skel-row">
          <div class="skeleton topic-list__skel-title" />
          <div class="skeleton topic-list__skel-meta" />
        </div>
      </div>

      <!-- Le filtre ne porte que sur ce qui est arrivé dans cet onglet, et le
           dire est le seul moyen d'éviter qu'un vide se lise comme « ce topic
           n'existe pas ». Sans compteur : ce qui manque au lecteur ici est le
           périmètre, pas un nombre de rangées chargées. -->
      <div v-else-if="filtering && rows.length === 0" class="topic-list__empty">
        <p class="topic-list__empty-title">Rien ne correspond</p>
        <p class="topic-list__empty-sub">
          Le filtre ne porte que sur les topics affichés ici. La recherche dans les messages
          viendra avec l'indexeur.
        </p>
        <button type="button" class="btn btn--sm" @click="closeSearch">Effacer le filtre</button>
      </div>

      <!-- Un forum vide et des relais injoignables donnent le même écran vide et
           demandent l'inverse au lecteur : écrire le premier topic, ou attendre.
           Les confondre était le pire des deux — on invitait à publier vers des
           relais muets. La distinction ne coûte qu'un test. -->
      <div v-else-if="rows.length === 0 && !relays.connected" class="topic-list__empty">
        <p class="topic-list__empty-title">Aucun relais joignable</p>
        <p class="topic-list__empty-sub">
          {{
            relays.relays.length > 1
              ? `Les ${relays.relays.length} relais configurés n'ont pas répondu.`
              : "Le relais configuré n'a pas répondu."
          }}
          Rien à voir avec le forum : sans relais, il n'y a rien à lire ni où publier.
        </p>
        <button type="button" class="btn btn--sm" @click="retry">Réessayer</button>
      </div>

      <!-- État vide composé, pas un simple message : il dit pourquoi c'est vide
           (c'est le modèle, pas une panne) et propose la sortie. La sortie est
           d'écrire : elle proposait le débit brut, qui ne répondait au besoin de
           personne — un lecteur devant un forum vide veut le remplir, pas
           inspecter le flux kind 1. -->
      <div v-else-if="rows.length === 0" class="topic-list__empty">
        <p class="topic-list__empty-title">Aucun topic sur ces relais</p>
        <p class="topic-list__empty-sub">Personne n'a encore lancé de topic ici.</p>
        <NuxtLink to="/new" class="btn btn--sm">Lancer le premier topic</NuxtLink>
      </div>
    </div>

    <p class="topic-list__note">
      <Explain
        term="définitif"
        placement="top"
        :body="[
          'Un message part sur plusieurs relais indépendants, qui en gardent chacun leur copie. Personne ne peut les effacer toutes.',
          'Tu peux demander la suppression : les relais qui l\'acceptent cessent de servir le message, les autres continuent.',
        ]"
        >Tout ce qui est posté ici est définitif.</Explain
      >
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * Tri figé (spec v2 §7.1). Deux déclencheurs, et **les deux se voient à l'écran** :
 * la souris sur la liste, ou le filtre ouvert. Pendant ce temps l'ordre affiché ne
 * bouge plus, les changements s'accumulent, et la pilule les applique d'un coup.
 *
 * Il ne protège qu'une chose : viser une rangée sans qu'elle se dérobe. C'est peu,
 * et c'est voulu — l'ordre suit le dernier message posté (`compareTopicRows`), donc
 * il ne bouge que quand quelqu'un poste. Il n'y a plus de remue-ménage à cacher.
 *
 * ⚠️ Ne pas y rajouter le focus clavier. Il y était, et il gelait la liste tant que
 * la rangée qu'on venait de cliquer gardait le focus — donc pendant toute la
 * lecture du topic, et seulement sur les navigateurs qui focalisent un lien cliqué.
 * Un gel qu'on ne peut relier à aucun geste visible ne s'explique pas.
 *
 * La rangée ne répond qu'à deux questions — « j'ouvre ? » et « y a du neuf pour
 * moi ? ». Le titre porte la première et a droit à deux lignes ; l'état de
 * lecture (`stores/reading.ts`) porte la seconde. L'extrait du dernier message
 * occupait cette place et ne répondait ni à l'une ni à l'autre.
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { relativeTime } from '~/utils/format'
import { topicPath } from '~/utils/permalink'
import type { TopicRow } from '~/types/nostr'

const props = defineProps<{ openTopicId: string | null }>()

const topicStore = useTopicStore()
const profiles = useProfileStore()
const mod = useModerationStore()
const reading = useReadingStore()
const relays = useRelayStore()

const hovered = ref(false)
/** Champ de filtre ouvert — déclaré ici, et pas dans sa section, parce que le gel
 *  en dépend. */
const searching = ref(false)
const frozen = computed(() => hovered.value || searching.value)

const displayOrder = ref<TopicRow[]>([])
const pendingOrder = ref<TopicRow[] | null>(null)

function applyPending(): void {
  if (pendingOrder.value) {
    displayOrder.value = pendingOrder.value
    pendingOrder.value = null
  }
}

function onMouseLeave(): void {
  hovered.value = false
  if (!frozen.value) applyPending()
}

/* ------------------------------------------------------------------ filtre
   Un FILTRE de la colonne, pas une recherche du forum — et c'est le périmètre
   qui dicte l'UI, pas l'inverse. Ce qui est interrogeable ici est ce que cet
   onglet a reçu : les titres et les auteurs des rangées chargées. Le plein
   texte sur les messages demande NIP-50, que strfry n'implémente pas ; c'est
   une fonction d'indexeur (spec §5.4). Une loupe dans la barre de site ou une
   palette `Cmd+K` promettraient le forum entier et rendraient douze titres.

   Pas de `?q=` dans l'URL, malgré la règle « le state est dans l'URL » : elle
   existe parce que tout repose sur le partage de liens, et un lien vers un
   filtre ne reproduirait pas cet écran chez le destinataire — sa liste chargée
   n'est pas la nôtre.

   Le champ ouvert gèle la liste (`frozen`, en haut) : on y lit une liste courte
   qu'on vient de demander, la voir se réordonner en tapant n'aurait pas de sens. */
const query = ref('')
const searchEl = ref<HTMLInputElement | null>(null)
const openBtn = ref<HTMLButtonElement | null>(null)

const needle = computed(() => fold(query.value.trim()).text)
const filtering = computed(() => needle.value.length > 0)

async function openSearch(): Promise<void> {
  searching.value = true
  await nextTick()
  searchEl.value?.focus()
}

async function closeSearch(): Promise<void> {
  query.value = ''
  searching.value = false
  // Fermer le filtre relâche le gel : ce qui s'est accumulé pendant la recherche
  // s'applique ici, sinon la colonne resterait sur un ordre périmé sans le dire.
  if (!frozen.value) applyPending()
  // Sans ça le focus retombe sur <body> et la liste perd le fil du clavier au
  // moment précis où on vient de choisir ce qu'on regarde.
  await nextTick()
  openBtn.value?.focus()
}

function onEscape(): void {
  if (query.value) {
    query.value = ''
    return
  }
  void closeSearch()
}

/** `/` ouvre le filtre, sauf en train d'écrire — le composeur en contient. */
function onSlash(e: KeyboardEvent): void {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target
  if (t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return
  e.preventDefault()
  void openSearch()
}

/**
 * Repli de comparaison : minuscules, accents retirés — forum français, `evenement`
 * doit trouver « Évènement ».
 *
 * Le tableau d'index est ce qui permet de surligner dans la chaîne D'ORIGINE.
 * La décomposition NFD change la longueur (`é` devient deux caractères), donc
 * une position trouvée dans le repli ne désigne pas le même caractère du titre
 * affiché ; on replie caractère par caractère en notant d'où vient chacun.
 */
/**
 * Mémoïsé par chaîne : `matches` + `titleParts` replient chaque titre deux fois
 * par frappe et par rangée, et le repli passe par `normalize()` caractère par
 * caractère. Les titres sont immuables, le résultat aussi.
 */
const foldCache = new Map<string, { text: string; map: number[] }>()
function fold(s: string): { text: string; map: number[] } {
  const cached = foldCache.get(s)
  if (cached) return cached
  let text = ''
  const map: number[] = []
  for (let i = 0; i < s.length; i++) {
    const folded = s[i]!.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    for (let k = 0; k < folded.length; k++) map.push(i)
    text += folded
  }
  const out = { text, map }
  if (foldCache.size > 1000) foldCache.clear()
  foldCache.set(s, out)
  return out
}

/** Titre ET pseudo de l'auteur : « les topics de X » est un geste de forum. */
function matches(t: TopicRow): boolean {
  return (
    fold(t.title).text.includes(needle.value) ||
    fold(profiles.displayName(t.pubkey)).text.includes(needle.value)
  )
}

interface TitlePart {
  text: string
  hit: boolean
}

/** Découpe du titre pour le surlignage — c'est ce qui explique pourquoi une
 *  rangée est là quand la correspondance porte sur le pseudo, pas sur le titre. */
function titleParts(t: TopicRow): TitlePart[] {
  const whole = [{ text: t.title, hit: false }]
  if (!filtering.value) return whole

  const { text, map } = fold(t.title)
  const parts: TitlePart[] = []
  let cursor = 0
  for (let at = text.indexOf(needle.value); at >= 0; at = text.indexOf(needle.value, at + needle.value.length)) {
    const from = map[at]!
    const to = map[at + needle.value.length - 1]! + 1
    if (from > cursor) parts.push({ text: t.title.slice(cursor, from), hit: false })
    parts.push({ text: t.title.slice(from, to), hit: true })
    cursor = to
  }
  if (parts.length === 0) return whole
  if (cursor < t.title.length) parts.push({ text: t.title.slice(cursor), hit: false })
  return parts
}

const resultsNote = computed(() => {
  if (!filtering.value) return ''
  const n = rows.value.length
  return n === 0 ? 'aucun topic ne correspond' : `${n} topic${n > 1 ? 's' : ''} affiché${n > 1 ? 's' : ''}`
})

watch(
  () => topicStore.rows,
  (next) => {
    if (!frozen.value) {
      displayOrder.value = next
      pendingOrder.value = null
    } else {
      pendingOrder.value = next
    }
  },
  { immediate: true },
)

const pendingNewCount = computed(() => {
  if (!pendingOrder.value) return 0
  const currentIds = new Set(displayOrder.value.map((t) => t.id))
  return pendingOrder.value.filter((t) => !currentIds.has(t.id)).length
})
const orderShifted = computed(() => {
  const pending = pendingOrder.value
  if (!pending) return false
  const current = displayOrder.value
  if (current.length !== pending.length) return true
  for (let i = 0; i < current.length; i++) {
    if (current[i]!.id !== pending[i]!.id) return true
  }
  return false
})
const showPill = computed(
  () => frozen.value && pendingOrder.value !== null && orderShifted.value && !filtering.value,
)

/**
 * Le topic ouvert reste visible quoi qu'il arrive à son rang (spec v2 §7.1).
 * S'il sort du classement, on le garde en fin de liste.
 */
const ranked = computed<TopicRow[]>(() => {
  const base = displayOrder.value
  // Le maintien du topic ouvert ne vaut pas sous filtre : le §7.1 protège des
  // mouvements de RANG, il ne donne pas de passe-droit contre un filtre demandé
  // explicitement — une rangée qui ne correspond pas casse la lecture du résultat.
  const withOpen =
    filtering.value || !props.openTopicId || base.some((t) => t.id === props.openTopicId)
      ? base
      : ((): TopicRow[] => {
          const fromLive = topicStore.rowById(props.openTopicId!)
          return fromLive ? [...base, fromLive] : base
        })()

  // Les épinglés remontent en tête sans être retirés du classement : ils gardent
  // leur rail de chauffe et leur compteur, ils changent juste de rang. Un topic
  // épinglé qui n'aurait plus l'air vivant serait une annonce morte en haut de
  // page, ce que tous les forums finissent par produire.
  if (mod.state.pinned.size === 0) return withOpen
  const pinned = withOpen.filter((t) => mod.isPinned(t.id))
  return pinned.length === 0 ? withOpen : [...pinned, ...withOpen.filter((t) => !mod.isPinned(t.id))]
})

const rows = computed<TopicRow[]>(() =>
  filtering.value ? ranked.value.filter(matches) : ranked.value,
)

/**
 * Seuil de tendance, en vélocité et non en nombre de réponses : un topic à 800
 * réponses mort depuis trois jours n'est pas chaud, et c'est exactement la
 * confusion qu'un classement par volume produit.
 *
 * Valeur absolue, jamais un rang. La liste étant déjà triée par vélocité,
 * marquer « les N premiers » ne dirait rien de plus que leur position ; avec un
 * seuil, un forum calme n'affiche aucun chevron — et c'est la bonne réponse.
 */
const TRENDING_VEL = 6

function isTrending(t: TopicRow): boolean {
  return t.vel > TRENDING_VEL
}

/**
 * Remplissage du rail de chauffe, entre 0 et 1. Plein à deux fois le seuil de
 * tendance : au-delà, un topic n'est pas « plus chaud », il est saturé, et
 * étirer l'échelle écraserait toute la plage utile en bas.
 *
 * Plancher à 0.14 dès qu'il y a de la vie : sans lui, un topic qui bouge un
 * peu rend un rail visuellement identique à un topic mort, et le rail ne dirait
 * plus la seule chose qu'on lui demande.
 */
function heatFill(t: TopicRow): string {
  if (t.vel <= 0) return '0'
  return String(Math.max(0.14, Math.min(1, t.vel / (TRENDING_VEL * 2))))
}

function heatClass(t: TopicRow): string {
  if (isTrending(t)) return 'heat--hot'
  return t.vel > 0 ? '' : 'heat--cold'
}

/**
 * Graduation d'encre du compteur. Elle ne porte plus l'alarme — le rail s'en
 * charge — mais elle garde la hiérarchie : dans une colonne de nombres, tous du
 * même gris, on ne voit plus lequel compte.
 *
 * Le palier `hot` et le rail sortent du même test : ce sont deux expressions
 * d'un seul fait, elles ne peuvent pas se contredire sur une rangée.
 */
function countClass(t: TopicRow): string {
  if (isTrending(t)) return 'count--hot'
  if (t.replies >= 25) return 'count--warm'
  if (t.replies > 0) return 'count--some'
  return 'count--none'
}
function countTitle(t: TopicRow): string {
  const parts = [t.replies === 0 ? 'aucune réponse' : `${t.replies} réponse${t.replies > 1 ? 's' : ''}`]
  if (isTrending(t)) parts.push('et ça parle maintenant')
  else if (t.replies >= 25) parts.push('topic fourni')
  if (reading.hasFresh(t.id, t.lastAt)) parts.push('du nouveau depuis ta dernière visite')
  return parts.join(', ')
}

/** Relance les souscriptions du forum sans recharger la page. */
function retry(): void {
  topicStore.stop()
  topicStore.start()
  void relays.loadRelayInfo()
}

onMounted(() => {
  window.addEventListener('keydown', onSlash)
  topicStore.start()
  // Document NIP-11 des relais : dit lesquels refusent l'écriture (payants) et
  // quelle PoW ils exigent. Lu une fois, tôt, pour que la première publication
  // parte déjà avec la bonne difficulté.
  void relays.loadRelayInfo()
})
// Le forum s'arrête avec sa colonne. Sans ça, les souscriptions kind 11 / 1111 et
// la cadence de reclassement (toutes les 2 s, sur jusqu'à 500 topics) continuaient
// de tourner pendant la lecture des MP ou du panneau d'admin — du trafic et du
// calcul pour un écran qui n'affiche pas la liste.
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onSlash)
  topicStore.stop()
})
// Le canal personnel (suivis, MP, notifications) démarrait ici. Il est remonté
// dans `layouts/default.vue` : ses pastilles vivent dans la barre, donc sur tous
// les écrans, et les démarrer au montage de cette colonne rendait l'app muette
// quand on arrivait directement sur `/dm`.
</script>

<style scoped>
/* La colonne est un panneau qui flotte sur le canevas : plus de filet de
   séparation avec le fil, c'est la gouttière qui sépare. */
.topic-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-2);
  overflow: hidden;
  position: relative;
}

/* Une seule tête au lieu de deux bandes empilées (l'aplat orange pleine largeur
   + l'en-tête de colonnes gris). Le libellé nomme la colonne, le bouton agit. */
.topic-list__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line-soft);
}
.topic-list__label {
  font-size: var(--fs-sm);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
}

/* Le filet du bas se met au bleu pendant la saisie : la ligne de tête EST le
   champ, donc c'est elle qui porte le « où tu es » plutôt qu'un cadre dessiné
   autour de l'input. Aucune géométrie ajoutée — le filet existe déjà. */
.topic-list__head--searching {
  border-bottom-color: var(--link);
}

/* Plus grands que le `.tool` par défaut (26 px, calibré pour la rangée dense du
   composeur) : ici ils sont seuls sur une ligne de tête et voisinent un bouton
   plein — à 26 px la loupe se lisait comme une poussière. */
.topic-list__head .tool {
  min-width: 30px;
  height: 30px;
  padding: 0;
}
.topic-list__head .tool svg {
  width: 18px;
  height: 18px;
}

.topic-list__filter {
  margin-left: auto;
}
/* Une fois le champ ouvert, la loupe n'est plus une commande poussée à droite
   mais le repère du champ, collé à gauche. */
.topic-list__head--searching .topic-list__filter {
  margin-left: 0;
  color: var(--ink-3);
}

/* Sans bordure : le champ ne dessine pas une boîte dans un panneau dont toute
   la charte dit que la séparation se fait à l'espace et à la teinte. */
.topic-list__search {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
  font-size: var(--fs-base);
  color: var(--ink);
}
.topic-list__search::placeholder {
  color: var(--ink-4);
}
/* La croix native ferait doublon avec le bouton de fermeture, qui lui vide
   aussi le filtre. */
.topic-list__search::-webkit-search-cancel-button {
  display: none;
}

/* Le primaire de l'écran, et le seul. En bleu : l'orange est réservé à ce qui
   se passe dans le forum, et ce bouton ne se passe jamais — il est là en
   permanence (voir « LA THÈSE » en tête de main.css). */
/* ⚠️ Pas de `margin-left: auto` ici : c'est la loupe qui le porte, et deux
   `auto` dans la même ligne flex se PARTAGENT l'espace libre — la loupe
   atterrissait au milieu de la tête. Les deux forment un groupe collé à droite. */
.topic-list__new {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--link);
  color: #fff;
  font-size: var(--fs-md);
  font-weight: 700;
  text-decoration: none !important;
  box-shadow: 0 1px 2px rgba(20, 40, 130, 0.24), 0 6px 16px -8px rgba(43, 79, 232, 0.55);
  transition: background 0.14s ease, transform 0.1s ease;
}
.topic-list__new:hover {
  background: var(--link-hover);
  color: #fff;
}
.topic-list__new:active {
  transform: translateY(1px);
}

.topic-list__scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 6px;
}

.topic-list__pill {
  position: absolute;
  top: 52px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
}

/* ---------------------------------------------------------------- la rangée
   Grille à deux lignes : la première porte le sujet et son compteur, la seconde
   l'auteur et l'heure. Le rail et l'identicon occupent chacun leur
   colonne sur les deux lignes, pour que le titre et la ligne de méta partagent
   le même bord gauche — sinon la largeur du pseudo décalait tous les titres.

   Plus de zébrage ni de filet entre les rangées : elles sont détachées les unes
   des autres par leur propre espace, et c'est le survol qui les matérialise.
   Le zébrage était le trait le plus daté de la liste. */
.topic-row {
  display: grid;
  grid-template-columns: 3px auto 1fr auto;
  grid-template-areas:
    'rail av title count'
    'rail av meta  when';
  align-items: center;
  column-gap: 11px;
  row-gap: 2px;
  padding: 9px 10px;
  border-radius: var(--r-control);
  text-decoration: none !important;
  transition: background 0.14s ease;
}
.topic-row:hover {
  background: var(--surface-3);
}

/* « Où tu es » : aplat bleu très pâle et anneau bleu. Pas d'orange — le rail de
   la rangée peut être allumé en même temps, et deux signaux de la même teinte
   à 10 px l'un de l'autre ne se distinguent plus. */
.topic-row--active,
.topic-row--active:hover {
  background: var(--link-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--link) 26%, transparent);
}

.topic-row__heat {
  grid-area: rail;
  align-self: stretch;
  min-height: 30px;
}

.topic-row__av {
  grid-area: av;
  align-self: center;
}

/* `baseline` et non `center` : le titre peut faire deux lignes, et le point
   comme les étiquettes doivent se poser sur la PREMIÈRE — centrés, ils
   flotteraient au milieu du bloc. La ligne de base évite d'accorder à la main
   un décalage qui dépendrait de la hauteur de ligne du titre. */
.topic-row__head {
  grid-area: title;
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

/* Le point de lecture. Vide par défaut mais toujours présent : voir le
   commentaire du template sur l'alignement des titres.

   Sa boîte fait exactement une ligne de titre de haut et se cale en HAUT du
   bloc, le point étant centré dedans : il tombe donc sur la première ligne quel
   que soit le nombre de lignes du titre. La ligne de base ne suffisait pas —
   pour un titre sur deux lignes, elle dépend de la façon dont le navigateur
   calcule celle d'un `-webkit-box`, et le point pouvait descendre à la seconde. */
.topic-row__dot {
  flex-shrink: 0;
  align-self: flex-start;
  display: flex;
  align-items: center;
  width: 5px;
  height: calc(var(--fs-base) * 1.3);
}
.topic-row__dot::after {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: transparent;
}
.topic-row--fresh .topic-row__dot::after {
  background: var(--ink);
}

/* Le titre n'est plus bleu : dans une liste où CHAQUE rangée est un lien, le
   bleu ne distingue rien et c'est ce qui datait le plus l'écran. Il est en
   pleine encre, et l'état de lecture se dit par le poids d'encre plutôt que par
   le violet des liens visités — même information, sans le costume de 1998.

   Deux lignes : c'est l'élément qui porte la décision d'ouvrir, et c'était le
   seul de la rangée à être rogné. */
.topic-row__title {
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: var(--fs-base);
  font-weight: 600;
  letter-spacing: -0.012em;
  line-height: 1.3;
  color: var(--ink);
  overflow: hidden;
}

/* Bleu et non jaune : trouver est un geste d'interface, et l'orange ne dit que
   la chaleur du forum. Teinte translucide plutôt qu'un aplat opaque — la rangée
   ouverte a déjà `--link-soft` en fond, un aplat de la même couleur y
   disparaîtrait. Les marges négatives annulent le décalage du padding : le
   titre ne doit pas bouger d'un pixel quand le surlignage apparaît. */
.topic-row__hit {
  background: color-mix(in srgb, var(--link) 16%, transparent);
  color: inherit;
  border-radius: 3px;
  padding: 0 1px;
  margin: 0 -1px;
}

/* Les trois états de `stores/reading.ts`. Jamais ouvert = la règle au-dessus,
   pleine encre : à froid la liste se lit donc comme avant, et rien ne crie.
   `:visited` portait ça avant, en binaire et pour toujours. */
.topic-row--read .topic-row__title {
  color: var(--ink-3);
  font-weight: 500;
}
.topic-row--fresh .topic-row__title {
  color: var(--ink);
  font-weight: 700;
}
/* ⚠️ APRÈS les deux règles d'état : même spécificité, l'ordre du fichier
   tranche, et « où tu es » doit gagner. */
.topic-row--active .topic-row__title {
  color: var(--link);
  font-weight: 700;
}

/* C'est au titre de s'élider, pas à l'étiquette de se faire rogner. Calées en
   haut pour la même raison que le point : sur un titre à deux lignes, la ligne
   de base les ferait descendre à la seconde. */
.topic-row__flag {
  flex-shrink: 0;
  align-self: flex-start;
}

/* Compteur et heure partagent la colonne de droite : tous deux collés au bord,
   sinon « 6 » flottait au milieu d'une colonne large comme « 1 mois ».
   L'apparence du nombre vient de `.count` dans `main.css`. */
.count {
  grid-area: count;
  justify-self: end;
}

/* Le pseudo est celui de l'AUTEUR du topic, pas du dernier posteur. Le titre et
   celui qui a ouvert le fil forment une seule unité, et c'est un repère stable ;
   le dernier posteur change toutes les cinq minutes et personne ne décide
   d'ouvrir là-dessus. Il partage donc sa clé avec l'identicon de la rangée. */
.topic-row__by {
  grid-area: meta;
  min-width: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topic-row__when {
  grid-area: when;
  justify-self: end;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
  white-space: nowrap;
}

/* ------------------------------------------------------------- vide / attente */
.topic-list__empty {
  padding: 44px 18px;
  text-align: center;
}
.topic-list__empty-title {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: var(--fs-title);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.topic-list__empty-sub {
  margin: 0 auto 16px;
  max-width: 34ch;
  font-size: var(--fs-md);
  color: var(--ink-3);
  line-height: 1.6;
}

.topic-list__skel-row {
  padding: 11px 10px;
}
.topic-list__skel-title {
  height: 13px;
  width: 78%;
  margin-bottom: 7px;
}
.topic-list__skel-meta {
  height: 10px;
  width: 46%;
}
.topic-list__skel-row:nth-child(2n) .topic-list__skel-title {
  width: 58%;
}
.topic-list__skel-row:nth-child(3n) .topic-list__skel-title {
  width: 88%;
}

.topic-list__note {
  flex-shrink: 0;
  margin: 0;
  padding: 10px 14px;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

.pill-pop-enter-active,
.pill-pop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.pill-pop-enter-from,
.pill-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}

@media (max-width: 700px) {
  .topic-list {
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
}
</style>
