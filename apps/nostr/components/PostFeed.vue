<template>
  <div class="feed">
    <div ref="containerEl" class="feed__scroll" @scroll="onScroll">
      <div class="feed__inner">
        <div v-if="loadingOlder" class="feed__loading-older">chargement…</div>
        <button v-else-if="hasOlder && !loadingInitial" type="button" class="feed__load-older" @click="loadOlder">
          charger plus ancien
        </button>

        <div v-if="loadingInitial" class="feed__initial-skel">
          <div v-for="i in 8" :key="i" class="feed__skel-row">
            <div class="skeleton feed__skel-avatar" />
            <div class="feed__skel-lines">
              <div class="skeleton feed__skel-head" />
              <div class="skeleton feed__skel-text" />
            </div>
          </div>
        </div>
        <template v-else>
          <div v-if="displayPosts.length" class="feed__posts" :class="{ 'feed__posts--dense': ambiance }">
            <PostItem
              v-for="p in displayPosts"
              :key="p.id"
              :post="p"
              :quoted="quotedById.get(p.id) ?? null"
              :nevent="neventOf(p.id)"
              :compact="ambiance"
              :fresh="liveIds.has(p.id)"
              :targeted="targetId === p.id"
              :own="p.pubkey === identity.pubkey"
              :state="ownState.get(p.id)"
              :editing="editingId === p.id"
              @reply="onReplyRequest"
              @jump="jumpToPost"
              @edit="editingId = $event"
              @edit-cancel="editingId = null"
              @edit-save="saveEdit"
            />
          </div>
          <!-- État vide : il explique pourquoi c'est vide, parce qu'ici « vide »
               est une propriété du modèle et non une panne. -->
          <div v-else class="feed__empty">
            <p class="feed__empty-title">Aucune réponse pour l'instant</p>
            <p class="feed__empty-sub">Sois le premier à répondre.</p>
          </div>
        </template>
      </div>
    </div>

    <Transition name="fade">
      <!-- « flux brut » ne voulait rien dire pour qui lit le fil, alors que le
           passage en dense se voit (les avatars disparaissent). L'étiquette dit
           donc ce qui arrive à l'affichage, pas le nom interne du mode. -->
      <Explain
        v-if="ambiance"
        term="affichage condensé"
        placement="bottom"
        :body="BODY_AMBIANCE"
      >
        <span class="feed__ambiance">affichage condensé</span>
      </Explain>
    </Transition>

    <Transition name="pill-pop">
      <button v-if="!hooked && pendingCount > 0" type="button" class="pill pill--pulse feed__new-pill" @click="jumpToLive">
        +{{ pendingCount }} nouveau{{ pendingCount > 1 ? 'x' : '' }}
      </button>
    </Transition>
    <Transition name="pill-pop">
      <button v-if="!hooked && pendingCount === 0" type="button" class="feed__back-to-live" @click="jumpToLive">
        ↓ revenir en direct
      </button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * Le composant à posséder (spec v2 §6, §7.5) — porté depuis la v1 avec sa
 * machine à états intacte :
 *   - `hooked` (accroché) : true à moins de ~80 px du bas
 *   - tampon de lissage à cadence variable, actif seulement si accroché
 *   - cap DOM dur (~150, ~80 en ambiance)
 *   - correction de scrollTop au chargement d'anciens (piège n°1, §6.2)
 *   - ordre d'arrivée = loi, jamais de réordonnancement de l'affiché
 *
 * Ce qui change par rapport à la v1 :
 *   - la source est un relais, pas notre serveur ; les events arrivent **en
 *     désordre** au chargement initial → on trie une fois, à la réconciliation
 *     initiale seulement (§6.4)
 *   - la pagination se fait sur `created_at` (`until`), plus sur `seq`
 *   - la numérotation est locale (§6.4) : `baseOffset` la garde cohérente
 *     malgré le cap DOM, et elle se décale quand on découvre du plus ancien —
 *     ce décalage EST la propriété documentée, pas un défaut
 *   - les **corrections** (§2.5) arrivent par la même souscription que les
 *     réponses et n'ajoutent jamais de rangée : elles remplacent le texte d'une
 *     rangée existante, sans toucher à son identité ni à sa place (`toPost`)
 */
import { ref, shallowRef, triggerRef, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import {
  KIND_COMMENT,
  KIND_NOTE,
  KIND_THREAD,
  FIREHOSE_TOPIC_ID,
  editTargetOf,
  resolveRevisions,
  latestRevision,
  type NostrEvent,
  type OwnState,
  type Post,
  type QuotedPost,
} from '~/types/nostr'
import { rootIdOf, parentIdOf, neventFor } from '~/utils/nostr'
import { parseImeta } from '~/utils/media'
import type { SubHandle } from '~/stores/relays'

const props = defineProps<{ topicId: string }>()
const emit = defineEmits<{ reply: [event: NostrEvent] }>()

// Constante et non littéral dans le template : voir `PostItem` (mêmes bulles).
const BODY_AMBIANCE = [
  "Ça poste plus vite que l'affichage normal ne suit.",
  'Les avatars disparaissent et les messages se resserrent, le temps que ça se calme.',
]

const relayStore = useRelayStore()
const profiles = useProfileStore()
const identity = useIdentityStore()
const publisher = usePublisher()
const route = useRoute()

const HISTORY_LIMIT = 300

type LoadedPost = Omit<Post, 'index'>

/**
 * `shallowRef`, pas `ref` : les sources ne sont jamais mutées (voir `toPost`),
 * donc proxifier en profondeur 150 posts — leurs `versions`, leurs `tags`,
 * leurs `imeta` — ne servait qu'à ralentir chaque lecture. Les mutations en
 * place (`push`/`splice`) signalent par `triggerRef(posts)` ; les
 * réaffectations de `posts.value` suffisent d'elles-mêmes.
 */
const posts = shallowRef<LoadedPost[]>([])
const baseOffset = ref(0)
const hooked = ref(true)
const pendingCount = ref(0)
const ambiance = ref(false)
const loadingOlder = ref(false)
const loadingInitial = ref(true)
const hasOlder = ref(false)
const liveIds = ref(new Set<string>())
/**
 * État de publication de ses propres posts. Vide = rien à signaler (reçu d'un
 * relais, donc publié par définition). Voir `PostItem` pour le pourquoi.
 */
const ownState = ref(new Map<string, OwnState>())

/**
 * Message dont l'éditeur est ouvert. Un seul à la fois, et c'est délibéré : deux
 * corrections en cours dans le même fil, c'est deux textes qu'on croit avoir
 * enregistrés.
 */
const editingId = ref<string | null>(null)

const containerEl = ref<HTMLElement | null>(null)
const eventById = new Map<string, NostrEvent>()

/** Post visé par un saut depuis une citation, surligné le temps d'être repéré. */
const targetId = ref<string | null>(null)
let targetTimer: ReturnType<typeof setTimeout> | null = null

let buffer: LoadedPost[] = []
let backlog: LoadedPost[] = []
let releaseTimer: ReturnType<typeof setTimeout> | null = null
let releaseStamps: number[] = []
let subs: SubHandle[] = []

const isFirehose = computed(() => props.topicId === FIREHOSE_TOPIC_ID)

/**
 * Objets `Post` réutilisés d'un recalcul à l'autre, à numéro inchangé.
 *
 * ⚠️ C'est ce qui rend le fil tenable en direct, et son absence était le
 * principal coût de rendu de l'app. `map()` fabriquait un objet neuf pour CHAQUE
 * message à chaque arrivée : la prop `post` de chacun des ~150 `PostItem`
 * changeait d'identité, donc Vue les re-rendait tous — quinze fois par seconde
 * dans un topic actif, pour un seul message réellement nouveau. Les sources ne
 * sont jamais mutées (voir `toPost`), donc la même entrée + le même numéro
 * donnent le même objet, et le patch se limite au message ajouté.
 */
const indexed = new WeakMap<LoadedPost, Post>()

/** Numérotation locale, stable malgré le cap DOM (voir en-tête). */
const displayPosts = computed<Post[]>(() => {
  const offset = baseOffset.value
  const out: Post[] = []
  for (let i = 0; i < posts.value.length; i++) {
    const source = posts.value[i]!
    const index = offset + i + 1
    const cached = indexed.get(source)
    if (cached && cached.index === index) {
      out.push(cached)
      continue
    }
    const next: Post = { ...source, index }
    indexed.set(source, next)
    out.push(next)
  }
  return out
})

/**
 * Le message cité par chaque réponse, résolu en auteur + texte + numéro local.
 *
 * Dérivé de `displayPosts` et **pas** du seul `eventById` : cette Map n'est pas
 * réactive, donc une citation calculée à l'écart ne se remplirait jamais pour une
 * réponse affichée avant son parent (possible : le tampon de lissage libère à
 * cadence variable, et la réconciliation initiale reçoit les events en
 * désordre). En dépendant de `displayPosts`, la citation se résout d'elle-même
 * dès que le parent entre dans le DOM.
 */
/** Résultat du recalcul précédent, réutilisé entrée par entrée (voir plus bas). */
let quoteCache = new Map<string, QuotedPost>()

const quotedById = computed<Map<string, QuotedPost>>(() => {
  const indexOf = new Map<string, number>()
  for (const p of displayPosts.value) indexOf.set(p.id, p.index)

  const out = new Map<string, QuotedPost>()
  for (const p of displayPosts.value) {
    if (!p.replyTo) continue
    const ev = eventById.get(p.replyTo)
    // La citation suit les corrections du message cité (voir `QuotedPost.edited`) :
    // sinon une réponse afficherait indéfiniment un texte que son auteur a
    // remplacé, sans que rien ne l'indique.
    const known = ev ? revisionsByAnchor.get(ev.id) : null
    const shown = ev && known ? latestRevision(ev, known.values()) : ev
    const next: QuotedPost = {
      id: p.replyTo,
      pubkey: ev?.pubkey ?? null,
      content: shown?.content ?? null,
      index: indexOf.get(p.replyTo) ?? null,
      edited: !!ev && !!shown && shown !== ev,
    }
    // Même raison que `indexed` plus haut : rendre un objet neuf à chaque
    // recalcul faisait changer la prop `quoted` de toutes les réponses affichées,
    // donc les re-rendait toutes. La citation ne bouge que quand son parent
    // entre dans le fil ou change de numéro.
    const cached = quoteCache.get(p.id)
    if (
      cached &&
      cached.id === next.id &&
      cached.pubkey === next.pubkey &&
      cached.content === next.content &&
      cached.index === next.index &&
      cached.edited === next.edited
    ) {
      out.set(p.id, cached)
      continue
    }
    out.set(p.id, next)
  }
  // `out` devient le cache : il ne contient que les messages affichés, donc rien
  // ne s'accumule quand le cap DOM fait défiler le fil.
  quoteCache = out
  return out
})

/**
 * Saut vers le message cité. Le surlignage compte autant que le défilement : sur
 * un fil dense, arriver au bon endroit sans savoir quelle rangée on cherchait
 * revient à ne pas être arrivé.
 */
function jumpToPost(id: string): void {
  // Sélecteur d'attribut et non `#msg-<id>` : un id d'event est du hexa fourni
  // par un tiers, et il n'a rien à faire concaténé dans un sélecteur.
  const el = containerEl.value?.querySelector<HTMLElement>(`[id="msg-${id}"]`)
  if (!el) return
  // `scrollIntoView` est du JS : la règle globale de `main.css` ne l'atteint pas,
  // donc `prefers-reduced-motion` se lit ici à la main.
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })
  targetId.value = id
  if (targetTimer) clearTimeout(targetTimer)
  targetTimer = setTimeout(() => (targetId.value = null), 1600)
}

/**
 * `nevent` mémorisé : il est appelé depuis le template pour chaque message, donc
 * à chaque rendu du fil, et `neventFor` fait un encodage bech32 complet. Cent
 * cinquante encodages par rendu pour un résultat qui ne change jamais — l'id et
 * l'auteur d'un event sont immuables.
 */
const neventCache = new Map<string, string>()

function neventOf(id: string): string {
  const hit = neventCache.get(id)
  if (hit !== undefined) return hit
  const ev = eventById.get(id)
  const out = ev ? neventFor(ev, relayStore.relays) : id
  // On ne mémorise que ce qui est résolu : un event pas encore reçu rend son id
  // brut, et il ne faut pas figer ce repli.
  if (ev) neventCache.set(id, out)
  return out
}

/**
 * Révisions connues, par ancre puis par id (spec v2 §2.5).
 *
 * Indexées par id à l'intérieur parce qu'un même event arrive de plusieurs
 * relais : une liste finirait par contenir dix copies de la même correction.
 *
 * Elles sont gardées même quand l'ancre n'est pas (encore) chargée — une
 * révision peut arriver avant son message d'origine à la réconciliation
 * initiale, ou viser un message plus ancien que le cap DOM. `toPost` les relit
 * à chaque construction, donc elles s'appliquent d'elles-mêmes quand
 * « charger plus ancien » ramène l'ancre.
 */
const revisionsByAnchor = new Map<string, Map<string, NostrEvent>>()

/**
 * Enregistre une révision. `false` si on la connaissait déjà.
 *
 * Le doublon est le cas NORMAL, pas l'exception : le même event revient d'autant
 * de relais qu'on en interroge, plus une fois en écho de notre propre
 * publication. Sans ce verdict, chaque correction reconstruirait sa rangée cinq
 * ou six fois — donc autant de re-rendus et de compensations de défilement pour
 * un texte qui ne change qu'une fois.
 */
function noteRevision(ev: NostrEvent, anchorId: string): boolean {
  let bucket = revisionsByAnchor.get(anchorId)
  if (!bucket) {
    bucket = new Map()
    revisionsByAnchor.set(anchorId, bucket)
  }
  if (bucket.has(ev.id)) return false
  bucket.set(ev.id, ev)
  return true
}

/**
 * Construit la rangée d'un message, corrections appliquées.
 *
 * L'identité du message reste celle de l'**event d'origine** (`id`, `createdAt`,
 * `replyTo`) et seul ce qui s'affiche vient de la dernière version. C'est ce qui
 * fait qu'une correction ne déplace pas le message dans le fil, ne change pas
 * son numéro, et ne casse ni les permaliens ni les citations qui le visent.
 *
 * `resolveRevisions` écarte les révisions signées par quelqu'un d'autre — c'est
 * la seule barrière contre le message d'autrui réécrit, le relais ne pouvant pas
 * la poser (voir `@forome/relay-policy/revisions`).
 */
function toPost(ev: NostrEvent, topicId: string, root = false): LoadedPost {
  eventById.set(ev.id, ev)
  profiles.want(ev.pubkey)

  const known = revisionsByAnchor.get(ev.id)
  const chain = known ? resolveRevisions(ev, known.values()) : null
  const shown = chain ? chain[chain.length - 1]! : ev

  return {
    id: ev.id,
    topicId,
    pubkey: ev.pubkey,
    createdAt: ev.created_at,
    content: shown.content,
    replyTo: root ? null : parentIdOf(ev),
    root,
    imeta: parseImeta(shown.tags),
    ...(shown === ev ? {} : { editedAt: shown.created_at }),
    ...(chain && chain.length > 1 ? { versions: chain } : {}),
  }
}

/**
 * Applique une correction à un message déjà chargé.
 *
 * Remplace l'entrée au lieu de la muter : les objets sources ne sont jamais
 * mutés (voir `indexed`), donc un objet neuf à la même place fait re-rendre
 * cette rangée-là et seulement elle.
 *
 * `false` si l'ancre n'est nulle part — la révision reste en réserve.
 */
function applyRevision(anchorId: string): boolean {
  const anchor = eventById.get(anchorId)
  if (!anchor) return false

  const i = posts.value.findIndex((p) => p.id === anchorId)
  if (i !== -1) {
    const before = posts.value[i]!
    const next = toPost(anchor, before.topicId, before.root)
    // Mesuré AVANT le remplacement : après, l'ancienne hauteur n'existe plus.
    const guard = scrollGuardFor(anchorId)
    const copy = posts.value.slice()
    copy[i] = next
    posts.value = copy
    void guard()
    return true
  }

  // Pas encore à l'écran : le tampon et l'arriéré tiennent des rangées qui n'ont
  // pas encore été posées, et il faut les corriger là aussi — sinon la version
  // périmée s'afficherait au moment de la libération.
  for (const list of [buffer, backlog]) {
    const j = list.findIndex((p) => p.id === anchorId)
    if (j !== -1) {
      list[j] = toPost(anchor, list[j]!.topicId, list[j]!.root)
      return true
    }
  }
  return false
}

/**
 * Compense le déplacement du contenu quand la rangée corrigée est **au-dessus**
 * du regard — piège n°1 (§6.2), dans sa version « en direct ».
 *
 * Une correction change la hauteur d'un message : plus de texte, une image de
 * moins. Si elle a lieu hors écran vers le haut, tout ce qu'on est en train de
 * lire glisse. Même technique que « charger plus ancien », mais conditionnée :
 * corriger une rangée **visible** ne doit rien compenser — le lecteur la regarde,
 * et déplacer le fil sous prétexte qu'elle a changé serait le vrai saut.
 *
 * Rend une fonction à appeler après le remplacement, pour que la mesure d'avant
 * soit prise au bon moment.
 */
function scrollGuardFor(anchorId: string): () => Promise<void> {
  const el = containerEl.value
  if (!el) return async () => {}

  if (hooked.value) {
    // Accroché : on l'est au bas du fil. Une rangée qui grandit plus haut nous en
    // décrocherait silencieusement — on se remet au contact.
    return async () => {
      await nextTick()
      scrollToBottom()
    }
  }

  // Par rectangles et non par `offsetTop` : celui-ci se mesure depuis
  // l'`offsetParent`, qui n'est pas le conteneur de défilement ici. La
  // comparaison serait juste par accident de mise en page.
  const row = el.querySelector<HTMLElement>(`[id="msg-${anchorId}"]`)
  const above = !!row && row.getBoundingClientRect().bottom <= el.getBoundingClientRect().top
  if (!above) return async () => {}

  const prevHeight = el.scrollHeight
  return async () => {
    await nextTick()
    el.scrollTop += el.scrollHeight - prevHeight
  }
}

function domCap(): number {
  return ambiance.value ? 80 : 150
}

function trackRate(): void {
  const now = Date.now()
  releaseStamps.push(now)
  if (releaseStamps.length > 40) releaseStamps.shift()
  const recent = releaseStamps.filter((t) => now - t < 1000).length
  // passé ~4 msg/s affichés, plus personne ne lit — mode ambiance (§6.3)
  ambiance.value = recent > 4
}

function scrollToBottom(): void {
  const el = containerEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function appendToDom(p: LoadedPost, opts: { trackRate?: boolean } = {}): void {
  liveIds.value.add(p.id)
  posts.value.push(p)
  if (opts.trackRate !== false) trackRate()
  if (hooked.value) {
    const cap = domCap()
    if (posts.value.length > cap) {
      const dropped = posts.value.length - cap
      posts.value.splice(0, dropped)
      // le cap DOM ne doit pas renuméroter ce qui reste affiché
      baseOffset.value += dropped
      hasOlder.value = true
    }
    void nextTick(scrollToBottom)
  }
  triggerRef(posts)
}

function cadenceFor(bufferLen: number): number {
  const interval = 350 / (1 + bufferLen * 0.25)
  return Math.max(60, Math.min(350, interval))
}

function scheduleRelease(): void {
  if (releaseTimer) return
  const tick = (): void => {
    releaseTimer = null
    const p = buffer.shift()
    if (p) appendToDom(p)
    if (buffer.length > 0) releaseTimer = setTimeout(tick, cadenceFor(buffer.length))
  }
  releaseTimer = setTimeout(tick, cadenceFor(buffer.length))
}

function known(id: string): boolean {
  return (
    posts.value.some((x) => x.id === id) || buffer.some((x) => x.id === id) || backlog.some((x) => x.id === id)
  )
}

function onLiveEvent(ev: NostrEvent): void {
  if (!isFirehose.value && rootIdOf(ev) !== props.topicId) return

  // Une correction n'est pas un message : elle remplace un texte affiché, elle
  // n'ajoute pas de rangée (§2.5). Elle arrive par la même souscription que les
  // réponses — c'est le point du format : rien de plus à écouter.
  //
  // Le test porte sur `editTargetOf` et non sur le verdict de `noteRevision` :
  // une révision déjà connue reste une révision, et retomber sur le chemin
  // ordinaire en ferait une rangée à chaque écho de relais.
  const anchorId = editTargetOf(ev)
  if (anchorId) {
    if (noteRevision(ev, anchorId)) applyRevision(anchorId)
    return
  }

  if (known(ev.id)) return
  const p = toPost(ev, props.topicId)

  // le tampon ne sert que si accroché — sinon on accumule dans le compteur (§6.3)
  if (!hooked.value) {
    backlog.push(p)
    pendingCount.value++
    return
  }
  buffer.push(p)
  scheduleRelease()
}

/** Tri de réconciliation initiale : `created_at`, départagé par `id` (§6.4). */
function sortAsc(a: LoadedPost, b: LoadedPost): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)
}

interface RepliesPage {
  posts: LoadedPost[]
  /** Ancres corrigées par cette page, à réappliquer si elles sont déjà à l'écran. */
  revised: string[]
  /**
   * Events reçus, **révisions comprises**. C'est lui qui dit s'il reste de
   * l'historique : compter les seules rangées ferait disparaître « charger plus
   * ancien » d'un fil très corrigé, où une page pleine produit peu de rangées.
   */
  received: number
}

async function fetchReplies(until?: number): Promise<RepliesPage> {
  // On interroge `#E` (NIP-22) ET `#e` (vieux style NIP-10) : ignorer le second
  // reviendrait à ne pas voir les réponses des clients pas encore migrés.
  const base = { kinds: [KIND_COMMENT], limit: HISTORY_LIMIT, ...(until ? { until } : {}) }
  const [byUpper, byLower] = await Promise.all([
    relayStore.query({ ...base, '#E': [props.topicId] }),
    relayStore.query({ ...base, '#e': [props.topicId] }),
  ])
  const seen = new Map<string, NostrEvent>()
  for (const ev of [...byUpper, ...byLower]) {
    if (rootIdOf(ev) !== props.topicId) continue
    seen.set(ev.id, ev)
  }

  // Deux passes, et l'ordre compte : les relais rendent l'historique en
  // désordre, donc une correction peut arriver avant le message qu'elle corrige.
  // L'enregistrer d'abord garantit que `toPost` construit d'emblée la bonne
  // version, au lieu d'afficher l'ancienne puis de la remplacer sous les yeux.
  const revised: string[] = []
  const ordinary: NostrEvent[] = []
  for (const ev of seen.values()) {
    const anchorId = editTargetOf(ev)
    if (!anchorId) {
      ordinary.push(ev)
      continue
    }
    if (noteRevision(ev, anchorId)) revised.push(anchorId)
  }
  return {
    posts: ordinary.map((ev) => toPost(ev, props.topicId)).sort(sortAsc),
    revised,
    received: seen.size,
  }
}

async function loadInitial(): Promise<void> {
  loadingInitial.value = true
  posts.value = []
  baseOffset.value = 0
  buffer = []
  backlog = []
  pendingCount.value = 0
  hooked.value = true
  hasOlder.value = false
  ambiance.value = false
  liveIds.value = new Set()
  eventById.clear()
  neventCache.clear()
  quoteCache.clear()
  revisionsByAnchor.clear()
  // Sinon l'éditeur se rouvrirait sur le message qui porte ce numéro dans le
  // topic suivant — un autre message, un autre auteur.
  editingId.value = null

  try {
    if (isFirehose.value) {
      // pas d'historique : le flux global n'a pas de racine à charger
      return
    }
    const [rootEvents, replies] = await Promise.all([
      relayStore.query({ ids: [props.topicId], kinds: [KIND_THREAD] }),
      fetchReplies(),
    ])
    const out: LoadedPost[] = []
    // Après `fetchReplies`, donc les corrections du message racine sont déjà
    // connues : il s'ouvre à sa dernière version, sans clignotement.
    const root = rootEvents[0]
    if (root) out.push(toPost(root, props.topicId, true))
    out.push(...replies.posts)

    // La souscription live tourne pendant ces requêtes (voir `onMounted`) : un
    // message posté entre-temps est déjà affiché, et écraser `posts` le faisait
    // disparaître définitivement — `known()` le croyait connu, donc l'écho du
    // relais ne le remettait pas. On garde donc ce qui est arrivé, à la fin,
    // puisque c'est le plus récent.
    const known = new Set(out.map((p) => p.id))
    const live = posts.value.filter((p) => !known.has(p.id))
    posts.value = live.length > 0 ? [...out, ...live] : out
    hasOlder.value = replies.received >= HISTORY_LIMIT
  } finally {
    loadingInitial.value = false
  }
  await nextTick()
  // Une ancre `#msg-<id>` dans l'URL vise un message précis : c'est ce que copie
  // le bouton « permalien » et ce que produit une notification. Sans ce
  // traitement, le lien ouvrait bien le topic mais atterrissait en bas du fil —
  // le message visé pouvant être 140 rangées plus haut, ça revient à ne pas
  // avoir amené le lecteur. L'ancrage natif du navigateur ne peut rien ici : le
  // fil est chargé après le rendu de la page.
  if (!jumpToHash()) scrollToBottom()
}

/**
 * Vise le message de l'ancre, s'il est dans la fenêtre chargée. Retourne `false`
 * quand il n'y a pas d'ancre ou que le message est plus ancien que ce que le fil
 * garde — auquel cas l'appelant reprend le comportement normal plutôt que de
 * laisser le lecteur sur un écran figé sans explication.
 */
function jumpToHash(): boolean {
  const hash = route.hash
  if (!hash.startsWith('#msg-')) return false
  const id = hash.slice(5)
  if (!posts.value.some((p) => p.id === id)) return false
  jumpToPost(id)
  return true
}

async function loadOlder(): Promise<void> {
  if (loadingOlder.value || !hasOlder.value || posts.value.length === 0) return
  const el = containerEl.value
  if (!el) return
  loadingOlder.value = true
  const oldest = posts.value.find((p) => !p.root)?.createdAt ?? posts.value[0]!.createdAt
  const prevHeight = el.scrollHeight
  try {
    const page = await fetchReplies(oldest - 1)
    const older = page.posts.filter((p) => !known(p.id))
    if (older.length === 0) {
      hasOlder.value = page.received >= HISTORY_LIMIT
      // Une page entièrement faite de corrections : rien à insérer, mais les
      // messages déjà affichés qu'elles visent doivent être mis à jour.
      for (const id of page.revised) applyRevision(id)
      return
    }
    const rootIdx = posts.value.findIndex((p) => p.root)
    if (rootIdx === 0) {
      posts.value = [posts.value[0]!, ...older, ...posts.value.slice(1)]
    } else {
      posts.value = [...older, ...posts.value]
    }
    // on a découvert du plus ancien : la numérotation locale se décale (§6.4)
    baseOffset.value = Math.max(0, baseOffset.value - older.length)
    await nextTick()
    // Piège n°1 (§6.2) : mesurer scrollHeight avant/après, corriger scrollTop.
    el.scrollTop += el.scrollHeight - prevHeight
    // Après la correction de défilement, et une par une : chaque révision qui
    // touche une rangée déjà affichée porte sa propre compensation.
    for (const id of page.revised) applyRevision(id)
  } finally {
    loadingOlder.value = false
  }
}

function onScroll(): void {
  const el = containerEl.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  const wasHooked = hooked.value
  hooked.value = distanceFromBottom < 80
  if (hooked.value && !wasHooked) flushBacklog()
}

function flushBacklog(): void {
  if (backlog.length > 0) {
    for (const p of backlog) {
      liveIds.value.add(p.id)
      posts.value.push(p)
    }
    backlog = []
  }
  pendingCount.value = 0
  const cap = domCap()
  if (posts.value.length > cap) {
    const dropped = posts.value.length - cap
    posts.value.splice(0, dropped)
    baseOffset.value += dropped
    hasOlder.value = true
  }
  triggerRef(posts)
}

function jumpToLive(): void {
  hooked.value = true
  flushBacklog()
  void nextTick(scrollToBottom)
}

function subscribeLive(): void {
  const since = Math.floor(Date.now() / 1000) - 60
  if (isFirehose.value) {
    subs.push(relayStore.subscribe({ kinds: [KIND_NOTE], since }, { onevent: onLiveEvent }, 'feed:firehose'))
    return
  }
  subs.push(
    relayStore.subscribe({ kinds: [KIND_COMMENT], '#E': [props.topicId], since }, { onevent: onLiveEvent }, 'feed:E'),
  )
  subs.push(
    relayStore.subscribe({ kinds: [KIND_COMMENT], '#e': [props.topicId], since }, { onevent: onLiveEvent }, 'feed:e'),
  )
}

function onReplyRequest(id: string): void {
  const ev = eventById.get(id)
  if (ev) emit('reply', ev)
}

/**
 * Affichage optimiste de son propre message (spec v2 §6.3) : **jamais par le
 * tampon**, sinon écrire donne l'impression que le site est cassé.
 *
 * Garde anti-doublon : l'écho du relais arrivera aussi par la souscription
 * live, éventuellement avant que `publish` ne résolve. `known()` couvre le sens
 * inverse, ceci couvre celui-ci.
 */
/**
 * Retire un post déjà affiché. Sert au renvoi après refus de PoW : la nouvelle
 * tentative porte un nonce différent, donc un id différent — garder les deux
 * afficherait un doublon, et l'écho du relais n'en dédoublonnerait qu'un.
 */
function dropPost(id: string): void {
  const i = posts.value.findIndex((p) => p.id === id)
  if (i === -1) return
  posts.value.splice(i, 1)
  triggerRef(posts)
  eventById.delete(id)
  liveIds.value.delete(id)
  markOwnState(id, null)
}

function markOwnState(id: string, state: OwnState | null): void {
  const next = new Map(ownState.value)
  if (state === null) next.delete(id)
  else next.set(id, state)
  ownState.value = next
}

function pushOwnPost(ev: NostrEvent, replacedId?: string): void {
  if (replacedId) dropPost(replacedId)
  if (known(ev.id)) return
  hooked.value = true
  appendToDom(toPost(ev, props.topicId), { trackRate: false })
}

/* ------------------------------------------------------------- corrections */

/**
 * Publie une correction et l'affiche avant la diffusion, comme un message
 * (§6.3). L'appel vit ici et non dans `PostItem` : c'est le fil qui détient les
 * events (`eventById`) et l'état d'affichage, et une rangée n'a pas à savoir
 * qu'il existe des relais.
 */
async function saveEdit(payload: { id: string; content: string; tags: string[][] }): Promise<void> {
  const anchor = eventById.get(payload.id)
  if (!anchor) return

  const outcome = await publisher.publishEdit({
    content: payload.content,
    anchor,
    tags: payload.tags,
    onOptimistic: (ev, replacedId) => {
      editingId.value = null
      showOwnEdit(ev, replacedId)
    },
  })
  if (!outcome) return

  const settle = (accepted: boolean): void => settleOwnEdit(payload.id, outcome.event.id, accepted)
  if (outcome.settled) void outcome.settled.then((r) => settle(r.accepted.length > 0))
  else settle(outcome.result.accepted.length > 0)
}

/** Affiche sa propre correction tout de suite, en la marquant « en cours ». */
function showOwnEdit(ev: NostrEvent, replacedId?: string): void {
  const anchorId = editTargetOf(ev)
  if (!anchorId) return
  // Renvoi après refus de PoW : la tentative précédente porte un autre id, et la
  // garder ferait deux corrections concurrentes dont la plus récente gagnerait
  // par hasard.
  if (replacedId) revisionsByAnchor.get(anchorId)?.delete(replacedId)
  noteRevision(ev, anchorId)
  applyRevision(anchorId)
  markOwnState(anchorId, 'edit-pending')
}

/**
 * Verdict des relais sur une correction.
 *
 * En cas de refus, le texte **revient à la version publiée**. C'est le point : le
 * message, lui, existe bien sur le réseau — laisser la correction à l'écran
 * ferait croire à son auteur qu'elle est partie, alors qu'elle n'est nulle part
 * et que tout le monde lit encore l'ancienne.
 */
function settleOwnEdit(anchorId: string, revisionId: string, accepted: boolean): void {
  if (accepted) {
    markOwnState(anchorId, null)
    return
  }
  revisionsByAnchor.get(anchorId)?.delete(revisionId)
  applyRevision(anchorId)
  markOwnState(anchorId, 'edit-failed')
}

defineExpose({ pushOwnPost, dropPost, markOwnState })

function teardown(): void {
  for (const s of subs) s.close()
  subs = []
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
  releaseStamps = []
  if (targetTimer) clearTimeout(targetTimer)
  targetTimer = null
  targetId.value = null
}

onMounted(() => {
  void loadInitial()
  subscribeLive()
})

onUnmounted(teardown)

watch(
  () => props.topicId,
  () => {
    teardown()
    void loadInitial()
    subscribeLive()
  },
)
</script>

<style scoped>
.feed {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  min-height: 0;
}
/* Le fond du fil est ENFONCÉ, et c'est ce qui fait exister les messages : posés
   à même le blanc du panneau et séparés par un filet de 1 px, ils se lisaient
   comme une seule nappe de texte où l'on ne voyait plus où un message finit.
   Le panneau garde son blanc en haut (titre) et en bas (composeur) : deux
   chrome blancs qui encadrent un sol gris, et le fil est dessus. */
.feed__scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px 16px;
  min-height: 0;
  background: var(--surface-2);
}

/* mesure de lecture contrainte : les lignes de 1000px sont illisibles */
.feed__inner {
  max-width: var(--topic-col, 880px);
  margin: 0 auto;
}

.feed__posts {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

/* Mode ambiance (> ~4 msg/s) : les cartes se referment en rangées jointives.
   À ce débit la séparation ne sert plus à personne — plus rien ne se lit
   message par message — et l'espace vaut mieux en lignes affichées. Le zébrage
   reprend alors son rôle, faute de carte pour délimiter. */
.feed__posts--dense {
  gap: 0;
  background: var(--surface);
  border-radius: var(--r-control);
  overflow: hidden;
}
.feed__posts--dense :deep(.msg--compact:nth-child(even)) {
  background: var(--surface-2);
}

.feed__loading-older,
.feed__load-older {
  display: block;
  margin: 8px auto 14px;
  text-align: center;
  color: var(--ink-3);
  font-size: var(--fs-sm);
  font-weight: 600;
  padding: 5px 14px;
  background: var(--surface-2);
  border: none;
  border-radius: 999px;
  transition: background 0.13s ease, color 0.13s ease;
}
.feed__load-older:hover {
  color: var(--ink);
  background: var(--surface-3);
}
.feed__load-older:active {
  transform: translateY(1px);
}
.feed__loading-older {
  background: transparent;
}

/* Le squelette a la forme de la carte finale : même rayon, même gouttière,
   même avatar de 30 px à gauche. Aucun décalage au remplacement. */
.feed__initial-skel {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.feed__skel-row {
  display: flex;
  gap: 11px;
  align-items: flex-start;
  padding: 10px 16px 11px 25px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
}
.feed__skel-avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: var(--r-control);
}
.feed__skel-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-top: 3px;
}
.feed__skel-head {
  height: 11px;
  width: 140px;
}
.feed__skel-text {
  height: 14px;
  width: 72%;
}
.feed__skel-row:nth-child(2n) .feed__skel-text {
  width: 45%;
}
.feed__skel-row:nth-child(3n) .feed__skel-text {
  width: 60%;
}

.feed__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  padding: 72px 20px;
}
.feed__empty-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-title);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.feed__empty-sub {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--fs-base);
  line-height: 1.6;
  max-width: 46ch;
}

/* indicateurs flottants : aucun décalage de layout dans un fil vivant */
/* Le condensé n'est pas une alerte, c'est un état d'affichage : il perd le
   cramoisi qu'il avait hérité de l'ambre des états techniques, et redevient
   une pastille neutre. */
.feed__ambiance {
  position: absolute;
  top: 10px;
  right: 18px;
  z-index: 5;
  color: var(--ink-2);
  border-radius: 999px;
  padding: 4px 11px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  background: var(--surface-2);
  box-shadow: var(--elev-1);
}

.feed__new-pill,
.feed__back-to-live {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  border: none;
}
.feed__back-to-live {
  background: var(--surface);
  color: var(--ink-2);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 7px 16px;
  font-size: var(--fs-md);
  font-weight: 600;
  box-shadow: var(--shadow-pop);
}
.feed__back-to-live:hover {
  background: var(--surface-3);
  color: var(--ink);
}

.pill-pop-enter-active,
.pill-pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.pill-pop-enter-from,
.pill-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .feed__scroll {
    padding: 0 0 12px;
  }
  .feed__skel-row {
    padding: 12px 14px 13px 22px;
  }
}
</style>
