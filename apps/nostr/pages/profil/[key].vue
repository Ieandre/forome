<template>
  <div class="profil">
    <!-- Clé illisible : ce n'est pas « profil introuvable ». On ne sait même pas
         de qui on parle, donc on le dit autrement. -->
    <div v-if="!pubkey" class="panel profil__bad">
      <p class="profil__bad-title">Cette adresse ne contient pas de clé lisible</p>
      <p class="profil__bad-sub">
        Un profil s'ouvre avec une <code>npub1…</code> ou 64 caractères hexadécimaux.
      </p>
      <NuxtLink to="/" class="btn btn--sm">Retour au forum</NuxtLink>
    </div>

    <template v-else>
      <section class="panel profil__card">
        <div class="profil__split">
          <ProfileKeyRail :pubkey="pubkey" :declared-name="profile?.name ?? null">
            <!-- La confiance est une propriété du graphe, donc de la clé : elle
                 vit du côté prouvé, pas du côté déclaré. -->
            <p v-if="trustLine" class="profil__trust">{{ trustLine }}</p>
          </ProfileKeyRail>

          <div class="profil__declared">
            <div v-if="state === 'loading'" class="profil__skel">
              <div class="skeleton profil__skel-name" />
              <div class="skeleton profil__skel-line" />
              <div class="skeleton profil__skel-line profil__skel-line--short" />
            </div>

            <template v-else>
              <div class="profil__identity">
                <!-- Plus d'`<img>` de la photo ici : elle est l'avatar du rail, et
                     elle y passe par notre proxy. La charger en direct depuis son
                     hébergeur livrait l'IP de chaque visiteur (spec §8, l. 612). -->
                <div class="profil__names">
                  <p class="profil__name">
                    <template v-if="profile?.name">
                      {{ profile.name }}
                      <!-- Le pseudo n'est pas unique sur Nostr (§3.5) : dès
                           qu'il est déclaré, le discriminant l'accompagne. -->
                      <!-- La clé en entier n'est listée qu'ICI, pas sous le
                           discriminant du fil ni des MP : c'est la page où l'on
                           vient vérifier une identité, et un bloc de 64 caractères
                           sous chaque pseudo d'un topic ne servirait personne. -->
                      <Explain
                        term="discriminant"
                        :body="[
                          'Les six premiers caractères de la clé publique, ci-dessous en entier.',
                          'La npub à gauche est cette même clé dans un autre alphabet : ses derniers caractères sont une somme de contrôle, pas la fin de la clé.',
                          'Sur Nostr, n\'importe qui peut prendre n\'importe quel pseudo — seule la clé est unique.',
                        ]"
                        :items="keyItems"
                      >
                        <span class="profil__disc mono">·{{ discriminator }}</span>
                      </Explain>
                    </template>
                    <span v-else class="profil__noname">Aucun pseudo déclaré</span>
                  </p>

                  <div class="profil__tags">
                    <span v-if="isSelf" class="tag tag--ok">toi</span>
                    <Explain v-if="profile?.nip05" term="nip-05" variant="chip" :body="nip05Body">
                      <span class="tag" :class="nip05TagClass">{{ nip05Label }}</span>
                    </Explain>
                    <Explain v-if="trustTag" :term="trustTag.label" variant="chip" :body="trustTag.body">
                      <span class="tag" :class="trustTag.cls">{{ trustTag.label }}</span>
                    </Explain>
                  </div>
                </div>
              </div>

              <p v-if="profile?.about" class="profil__about">{{ profile.about }}</p>

              <p v-if="profile?.website" class="profil__site">
                <a :href="safeWebsite ?? undefined" target="_blank" rel="noopener noreferrer nofollow">{{
                  profile.website
                }}</a>
              </p>

              <!-- Même objet que le pied de message dans le fil, même filet et
                   même registre. Pas de clamp ici, à la différence du fil : la
                   signature n'apparaît qu'une fois sur cette page, et c'est le
                   seul endroit où on la voit en entier. -->
              <p v-if="profile?.signature" class="profil__sig">{{ profile.signature }}</p>

              <!-- Rien de plus dans l'état vide : « Aucun pseudo déclaré »
                   au-dessus le dit déjà, et personne n'a à remplir un profil pour
                   exister ici (§3.1). -->
              <!-- Ce que le réseau établit sur la clé, sous ce que l'auteur a
                   déclaré. Un seul de ces trois nombres est un compte (les
                   suivis, kind 3 signé) ; les deux autres sont une borne et une
                   date d'event. Trois valeurs mises en page pareil affirmeraient
                   la même certitude pour les trois — c'est donc l'ÉTIQUETTE qui
                   porte la réserve (« retrouvé », « publié »), et elle reste une
                   phrase courte plutôt qu'un mot-clé de tableau de bord. -->
              <dl v-if="hasFacts" class="profil__facts">
                <!-- L'ancienneté que réclame la spec (§11.1), au mois près : la
                     date est un majorant tiré d'une remontée bornée, la donner au
                     jour près afficherait une précision qu'on n'a pas. -->
                <div v-if="firstSeenLabel" class="profil__fact">
                  <dt class="profil__fact-label">
                    <Explain
                      term="ancienneté"
                      :body="[
                        'Nostr n\'a pas de date d\'inscription : aucun registre de clés n\'existe, ni ici ni ailleurs.',
                        'C\'est le message le plus ancien que ces relais ont rendu. Cette clé peut être bien plus vieille.',
                      ]"
                      >plus ancien message retrouvé</Explain
                    >
                  </dt>
                  <dd class="profil__fact-value">{{ firstSeenLabel }}</dd>
                </div>

                <div v-if="followCount" class="profil__fact">
                  <dt class="profil__fact-label">
                    <Explain
                      term="suivis"
                      :body="[
                        'Sa liste de suivis est publique et signée par cette clé : ce nombre vient d\'elle, pas d\'un compteur du forum.',
                        'L\'inverse — combien de gens la suivent — ne se compte pas : il faudrait lire tous les relais du réseau.',
                      ]"
                      >{{ followCount > 1 ? 'personnes suivies' : 'personne suivie' }}</Explain
                    >
                  </dt>
                  <dd class="profil__fact-value">{{ followCount }}</dd>
                </div>

                <div v-if="state !== 'error' && updatedAt" class="profil__fact">
                  <dt class="profil__fact-label">
                    <Explain term="modifié" :body="updatedBody">profil modifié</Explain>
                  </dt>
                  <dd class="profil__fact-value">il y a {{ relativeTime(updatedAt) }}</dd>
                </div>
              </dl>

              <p v-if="state === 'error'" class="profil__facts-err">
                Aucun relais n'a répondu : ce profil peut être incomplet.
              </p>
            </template>
          </div>
        </div>

        <!-- Les actions traversent les deux colonnes : elles ne portent ni sur la
             clé ni sur ce qui est déclaré, elles portent sur la personne. -->
        <footer class="profil__actions">
          <template v-if="isSelf">
            <NuxtLink to="/profil/editer" class="btn btn--sm btn--primary">Modifier mon profil</NuxtLink>
          </template>

          <template v-else>
            <Hint :text="followTitle">
              <button
                type="button"
                class="btn btn--sm"
                :class="{ 'btn--primary': !isFollowed }"
                :disabled="!social.loaded || social.publishing"
                @click="toggleFollow"
              >
                {{ isFollowed ? 'Ne plus suivre' : 'Suivre' }}
              </button>
            </Hint>

            <!-- Bouton désactivé plutôt qu'absent : sans lui, quelqu'un qui signe
                 avec une extension chercherait un « envoyer un MP » qui n'existe
                 nulle part. Le pourquoi tient dans l'infobulle. -->
            <NuxtLink
              v-if="dms.available"
              :to="{ path: '/dm', query: { ...route.query, peer: pubkey } }"
              class="btn btn--sm"
              >Envoyer un MP</NuxtLink
            >
            <Hint
              v-else
              text="les MP demandent la clé de cet appareil ; avec une extension ou un signeur distant, l’app ne peut pas déchiffrer"
            >
              <button type="button" class="btn btn--sm" disabled>Envoyer un MP</button>
            </Hint>

            <Hint
              :text="
                isMuted
                  ? 'retirer cette clé de ta liste de blocage, qui est publique'
                  : 'bloquer — ta liste de blocages est publique, donc ce blocage est visible de tous'
              "
            >
              <button
                type="button"
                class="btn btn--sm btn--danger"
                :disabled="!social.loaded || social.publishing"
                @click="toggleMute"
              >
                {{ isMuted ? 'Débloquer' : 'Bloquer' }}
              </button>
            </Hint>
          </template>

          <span class="profil__actions-spacer" />

          <!-- Vers l'extérieur : la même clé chez quelqu'un d'autre. C'est la
               démonstration la plus courte que l'identité n'appartient pas à ce
               forum. -->
          <Hint text="ouvrir cette clé dans un client Nostr tiers — l'identité n'appartient pas à ce forum">
          <a
            :href="`https://njump.me/${npub}`"
            target="_blank"
            rel="noopener noreferrer"
            class="profil__njump"
            >voir ailleurs sur Nostr</a
          >
          </Hint>
        </footer>

        <p v-if="social.loadError" class="profil__warn">
          Tes suivis n'ont pas pu être lus : suivre et bloquer restent indisponibles tant qu'écrire
          risquerait d'écraser ta liste.
        </p>
      </section>

      <section class="panel profil__panel">
        <p class="panel__head">{{ isSelf ? 'Tes topics' : 'Ses topics' }}</p>
        <div v-if="content === 'loading'" class="profil__skel-rows">
          <div v-for="i in 3" :key="i" class="skeleton profil__skel-row" />
        </div>
        <NuxtLink v-for="t in topics" :key="t.id" :to="topicPath(t.id, t.title)" class="prow">
          <span class="prow__title">{{ t.title }}</span>
          <span class="prow__when mono">{{ relativeTime(t.createdAt) }}</span>
        </NuxtLink>
        <p v-if="content !== 'loading' && topics.length === 0" class="profil__none">Aucun topic.</p>
      </section>

      <section class="panel profil__panel">
        <p class="panel__head">{{ isSelf ? 'Tes messages' : 'Ses messages' }}</p>
        <div v-if="content === 'loading'" class="profil__skel-rows">
          <div v-for="i in 4" :key="i" class="skeleton profil__skel-row" />
        </div>
        <NuxtLink v-for="c in commentRows" :key="c.id" :to="c.to" class="prow prow--msg">
          <span class="prow__text">{{ c.snippet }}</span>
          <!-- Un message hors de son topic n'est qu'un extrait : sans le titre,
               la seule façon de savoir de quoi il parle est de cliquer. -->
          <span v-if="c.topic" class="prow__in">dans {{ c.topic }}</span>
          <span class="prow__when mono">{{ relativeTime(c.createdAt) }}</span>
        </NuxtLink>
        <p v-if="content !== 'loading' && comments.length === 0" class="profil__none">Aucun message.</p>

        <!-- Pas de compteur : ce serait le nombre de messages que CET onglet a
             réussi à récupérer, et il se lirait comme un total. Une ligne en pied
             de panneau, sur le modèle de « Tout ce qui est posté ici est
             définitif » dans la liste de topics. -->
        <p class="profil__scope">Extrait de ce que ces relais ont gardé, pas un historique complet.</p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Page de profil (spec v2 §11.1, §3.5).
 *
 * L'anatomie de la page EST l'argument : à gauche ce que la clé prouve
 * (identicon, handle, npub — dérivés, donc infalsifiables), à droite ce que la
 * personne déclare (kind 0 — remplaçable, non unique, usurpable). Sur un forum
 * classique, un profil est un enregistrement tenu par le site ; ici la moitié
 * droite n'est qu'une affirmation, et la page ne doit jamais laisser croire le
 * contraire.
 *
 * Elle partage son rail gauche avec `/profil/editer` : mêmes deux colonnes, une
 * en lecture, l'autre en écriture.
 */
import { ref, computed, watch } from 'vue'
import { decode } from 'nostr-tools/nip19'
import type { Filter } from 'nostr-tools/filter'
import { KIND_COMMENT, KIND_CONTACTS, KIND_THREAD, type NostrEvent, type Profile } from '~/types/nostr'
import { npubFor, rootIdOf, topicTitle } from '~/utils/nostr'
import { absoluteTime, relativeTime } from '~/utils/format'
import { topicPath } from '~/utils/permalink'

const route = useRoute()
const profiles = useProfileStore()
const social = useSocialStore()
const identity = useIdentityStore()
const dms = useDmStore()
const relays = useRelayStore()

/** Accepte une `npub` comme une clé hex — les gens copient l'un ou l'autre. */
function decodeKey(input: string): string | null {
  const raw = input.trim()
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase()
  if (raw.startsWith('npub')) {
    try {
      const d = decode(raw)
      if (d.type === 'npub') return d.data
    } catch {
      return null
    }
  }
  return null
}

const pubkey = computed(() => decodeKey(String(route.params.key ?? '')))
const npub = computed(() => (pubkey.value ? npubFor(pubkey.value) : ''))
const isSelf = computed(() => !!pubkey.value && pubkey.value === identity.pubkey)

const state = ref<'loading' | 'ok' | 'none' | 'error'>('loading')
const content = ref<'loading' | 'ok' | 'error'>('loading')

const profile = computed<Profile | null>(() => (pubkey.value ? (profiles.cache.get(pubkey.value) ?? null) : null))
const updatedAt = computed(() => (pubkey.value ? (profiles.rawOf(pubkey.value)?.createdAt ?? null) : null))
const discriminator = computed(() => (pubkey.value ? profiles.discriminator(pubkey.value) : ''))
const keyItems = computed(() => (pubkey.value ? [pubkey.value] : []))

/**
 * Un `website` vient d'un relais tiers : `javascript:` dans un `href` est une
 * exécution de script en un clic. Seuls http(s) sortent d'ici.
 */
const safeWebsite = computed(() => {
  const raw = profile.value?.website
  if (!raw) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
})

/* ------------------------------------------------------------- NIP-05 (§3.5) */

// Vocabulaire identique à celui de la barre d'auteur : « injoignable » n'est
// pas « invalide », et un mot en petites capitales se lit là où « ✓ » ne dit rien.
const nip05Status = computed(() => (pubkey.value ? profiles.nip05StatusOf(pubkey.value) : null))
const nip05Label = computed(() => {
  switch (nip05Status.value) {
    case 'valid':
      return 'nip-05'
    case 'invalid':
      return 'usurpation'
    default:
      return 'nip-05 ?'
  }
})
const nip05TagClass = computed(() => {
  switch (nip05Status.value) {
    case 'valid':
      return 'tag--ok'
    case 'invalid':
      return 'tag--brand'
    default:
      return ''
  }
})
const nip05Body = computed<string[]>(() => {
  const addr = profile.value?.nip05 ?? ''
  switch (nip05Status.value) {
    case 'valid':
      return [
        `Le domaine ${addr} reconnaît cette clé sous ce nom.`,
        'Vérifié par ce navigateur, pas un badge accordé par le forum.',
      ]
    case 'invalid':
      return [
        `Le domaine ${addr} ne reconnaît PAS cette clé.`,
        'Quelqu\'un affiche une adresse qui ne lui appartient pas. Usurpation probable.',
      ]
    case 'unreachable':
      return [
        `Le domaine ${addr} n'a pas répondu.`,
        'Ça ne prouve rien, ni dans un sens ni dans l\'autre : il peut être hors service ou refuser les requêtes du navigateur.',
      ]
    default:
      return [`Vérification de ${addr} en cours.`]
  }
})

/* ------------------------------------------------------- confiance et actions */

const isFollowed = computed(() => !!pubkey.value && social.isFollowed(pubkey.value))
const isMuted = computed(() => !!pubkey.value && social.isMuted(pubkey.value))

const trustTag = computed(() => {
  if (!pubkey.value || isSelf.value) return null
  switch (social.trustOf(pubkey.value)) {
    case 'followed':
      return {
        label: 'suivi',
        cls: 'tag--ok',
        body: ['Tu suis cette clé.', 'Ta liste de suivis est publique : elle est publiée sur les relais.'],
      }
    case 'network':
      return {
        label: 'réseau',
        cls: '',
        body: ['Suivie par des gens que tu suis.', 'Tu ne la suis pas toi-même.'],
      }
    case 'muted':
      return {
        label: 'bloqué',
        cls: 'tag--warn',
        body: [
          'Tu as bloqué cette clé.',
          'Ses messages restent consultables : le forum replie, il ne masque rien en silence.',
        ],
      }
    default:
      return null
  }
})

/** Le web of trust en une phrase, plutôt qu'un compteur à décoder. */
const trustLine = computed(() => {
  if (!pubkey.value || isSelf.value) return null
  const n = social.networkCount(pubkey.value)
  if (n <= 0) return null
  return `Suivie par ${n} personne${n > 1 ? 's' : ''} que tu suis.`
})

const followTitle = computed(() => {
  if (!social.loaded) return 'ta liste de suivis n’est pas encore lue — publier maintenant l’écraserait'
  return isFollowed.value
    ? 'ne plus suivre (met à jour ta liste kind 3, publique)'
    : 'suivre : alimente ton web of trust et ta boîte de MP'
})

async function toggleFollow(): Promise<void> {
  if (!pubkey.value) return
  if (isFollowed.value) await social.unfollow(pubkey.value)
  else await social.follow(pubkey.value)
}

async function toggleMute(): Promise<void> {
  if (!pubkey.value) return
  if (isMuted.value) await social.unmute(pubkey.value)
  else await social.mute(pubkey.value)
}

/* ----------------------------------------------------------------- données */

const topics = ref<{ id: string; title: string; createdAt: number }[]>([])
const comments = ref<{ id: string; to: string; root: string | null; snippet: string; createdAt: number }[]>([])

/** Titres des topics où vivent ses messages, résolus après coup. */
const rootTitles = ref(new Map<string, string>())

const commentRows = computed(() =>
  comments.value.map((c) => ({ ...c, topic: c.root ? (rootTitles.value.get(c.root) ?? null) : null })),
)

const firstSeen = ref<number | null>(null)
const followCount = ref<number | null>(null)

/**
 * Au mois, pas au jour : `firstSeen` est un majorant (voir `loadFirstSeen`), et
 * « à mars 2026 » ne promet pas la précision que « le 3 mars 2026 » promettrait.
 */
const firstSeenLabel = computed(() =>
  firstSeen.value === null
    ? null
    : new Date(firstSeen.value * 1000).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
)

const hasFacts = computed(() => Boolean(firstSeenLabel.value || followCount.value || updatedAt.value))

/** La bande donne l'écart (« il y a 15 h ») ; l'horodatage exact reste ici. */
const updatedBody = computed(() =>
  [
    'Un profil Nostr est remplaçable : cette date est celle de la dernière version publiée.',
    'Les versions précédentes ne sont pas conservées.',
    updatedAt.value ? `Dernière version : ${absoluteTime(updatedAt.value)}.` : '',
  ].filter(Boolean),
)

function snippetOf(ev: NostrEvent): string {
  const flat = ev.content.replace(/\s+/g, ' ').trim()
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat || '(message vide)'
}

/**
 * Un jeton par chargement : sans lui, revenir vite d'un profil à l'autre laisse
 * la réponse lente du premier écraser l'affichage du second.
 */
let token = 0

const FIRST_SEEN_STEPS = 4
const FIRST_SEEN_BATCH = 100

/**
 * Ancienneté (§11.1). Un relais ne sait pas répondre « le plus ancien » : il
 * rend toujours les plus récents d'abord, donc on remonte par paquets avec
 * `until` jusqu'à épuisement — ou jusqu'au budget, sur une clé prolifique.
 *
 * Ce qui en sort est un **majorant**, jamais une date d'inscription : d'où
 * « retrouvé » à l'écran, et l'affichage au mois.
 */
async function loadFirstSeen(pk: string, mine: number): Promise<void> {
  let oldest: number | null = null
  let until: number | undefined
  try {
    for (let step = 0; step < FIRST_SEEN_STEPS; step++) {
      const filter: Filter = { kinds: [KIND_THREAD, KIND_COMMENT], authors: [pk], limit: FIRST_SEEN_BATCH }
      if (until !== undefined) filter.until = until
      const events = await relays.query(filter)
      if (mine !== token) return
      if (events.length === 0) break
      for (const ev of events) if (oldest === null || ev.created_at < oldest) oldest = ev.created_at
      if (events.length < FIRST_SEEN_BATCH) break
      // `until` est inclusif : sans le -1 on redemanderait le paquet qu'on vient
      // de lire, et la boucle tournerait sur place.
      until = (oldest as number) - 1
    }
  } catch {
    // rien à dire : la ligne d'ancienneté disparaît, elle n'est pas une promesse
    return
  }
  if (mine !== token) return
  firstSeen.value = oldest
}

/**
 * Combien de clés cette personne suit. Exact, contrairement à tout ce qu'on
 * pourrait compter d'autre ici : kind 3 est remplaçable, donc l'event porte la
 * liste **entière** — ce n'est pas un échantillon de ce que les relais ont bien
 * voulu rendre.
 */
async function loadFollowCount(pk: string, mine: number): Promise<void> {
  try {
    const events = await relays.query({ kinds: [KIND_CONTACTS], authors: [pk] })
    if (mine !== token) return
    let newest: NostrEvent | null = null
    for (const ev of events) if (!newest || ev.created_at > newest.created_at) newest = ev
    if (!newest) return
    const keys = new Set<string>()
    for (const t of newest.tags) if (t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/.test(t[1])) keys.add(t[1])
    followCount.value = keys.size
  } catch {
    // pas de liste lisible : on n'affiche rien plutôt qu'un zéro qui mentirait
  }
}

/** Les titres des topics cités par ses messages, en une requête pour tous. */
async function loadRootTitles(ids: string[], mine: number): Promise<void> {
  if (ids.length === 0) return
  try {
    const roots = await relays.query({ ids, kinds: [KIND_THREAD] })
    if (mine !== token) return
    const next = new Map(rootTitles.value)
    for (const ev of roots) next.set(ev.id, topicTitle(ev))
    rootTitles.value = next
  } catch {
    // les lignes restent sans contexte, ce qui est l'état d'avant
  }
}

async function load(): Promise<void> {
  const pk = pubkey.value
  if (!pk) return
  const mine = ++token

  state.value = 'loading'
  content.value = 'loading'
  topics.value = []
  comments.value = []
  rootTitles.value = new Map()
  firstSeen.value = null
  followCount.value = null

  // Ni l'une ni l'autre ne conditionne l'affichage : elles ajoutent une ligne
  // quand elles aboutissent, et la remontée d'ancienneté est bien plus lente que
  // le reste de la page.
  void loadFirstSeen(pk, mine)
  void loadFollowCount(pk, mine)

  const status = await profiles.fetchOne(pk)
  if (mine !== token) return
  state.value = status

  try {
    const [threadEvents, commentEvents] = await Promise.all([
      relays.query({ kinds: [KIND_THREAD], authors: [pk], limit: 40 }),
      relays.query({ kinds: [KIND_COMMENT], authors: [pk], limit: 40 }),
    ])
    if (mine !== token) return

    topics.value = threadEvents
      .map((ev) => ({ id: ev.id, title: topicTitle(ev), createdAt: ev.created_at }))
      .sort((a, b) => b.createdAt - a.createdAt)

    comments.value = commentEvents
      .map((ev) => {
        const root = rootIdOf(ev)
        return {
          id: ev.id,
          // Sans racine résolue, le message existe mais on ne sait pas où il
          // vit : on pointe l'event lui-même plutôt qu'un lien mort. Dans les
          // deux cas le titre du topic nous est inconnu, donc URL nue.
          to: root ? `${topicPath(root)}#msg-${ev.id}` : topicPath(ev.id),
          root,
          snippet: snippetOf(ev),
          createdAt: ev.created_at,
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt)

    content.value = 'ok'
    void loadRootTitles([...new Set(comments.value.map((c) => c.root).filter((r): r is string => !!r))], mine)
  } catch {
    if (mine !== token) return
    content.value = 'error'
  }
}

watch(pubkey, () => void load(), { immediate: true })

// Les listes de suivis conditionnent « suivre » et « bloquer » : une arrivée
// directe sur ce lien ne passe ni par la liste de topics ni par les MP, donc
// personne ne les a chargées.
watch(
  () => identity.pubkey,
  (pk) => {
    if (!pk) return
    void social.load()
    social.watch()
  },
  { immediate: true },
)

// Une clé illisible n'a pas de nom à annoncer : l'onglet dit ce qu'est la page
// plutôt que de citer le paramètre d'URL fautif.
usePageTitle(() => (pubkey.value ? profiles.displayName(pubkey.value) : 'Profil'))
</script>

<style scoped>
/*
 * La seule idée propre à cette page est la scission en deux colonnes de
 * surfaces différentes — prouvé à gauche (dérivé de la clé), déclaré à droite
 * (ce que l'auteur a bien voulu écrire). Le reste vient de la charte.
 */
.profil {
  height: 100%;
  overflow-y: auto;
  padding: 20px 12px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 940px;
  margin: 0 auto;
}

/* Colonne de défilement : aucun enfant ne doit se comprimer. Sans ça, un enfant
   qui pose `overflow: hidden` perd son minimum automatique de contenu et absorbe
   à lui seul tout le débordement — la carte d'identité tombait à 2 px dès que la
   page dépassait la hauteur de la fenêtre. */
.profil > * {
  flex-shrink: 0;
}

.profil__card {
  overflow: hidden;
}

.profil__split {
  display: grid;
  grid-template-columns: 210px 1fr;
}

/* ------------------------------------------------------------- côté déclaré */

.profil__declared {
  padding: 20px 22px 22px;
  min-width: 0;
}

.profil__identity {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}
.profil__names {
  min-width: 0;
}
.profil__name {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-h);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.2;
  color: var(--ink);
  word-break: break-word;
}
.profil__noname {
  font-weight: 500;
  font-size: var(--fs-lg);
  color: var(--ink-3);
}
.profil__disc {
  font-size: var(--fs-md);
  font-weight: 500;
  color: var(--ink-4);
}
.profil__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 5px;
}

.profil__about {
  margin: 11px 0 0;
  font-size: var(--fs-base);
  line-height: 1.55;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.profil__site {
  margin: 8px 0 0;
  font-size: var(--fs-md);
  overflow-wrap: anywhere;
}

.profil__sig {
  margin: 11px 0 0;
  padding-top: 6px;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--ink-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Le pied du côté déclaré. Le filet n'est pas un séparateur de confort : il
   marque la frontière de la page — au-dessus ce que l'auteur écrit de lui,
   au-dessous ce que le réseau permet d'en établir. Pas de couleur ici : la
   charte réserve l'orange à la chaleur du forum et le bleu à l'interface, et
   trois faits d'identité ne sont ni l'un ni l'autre. */
.profil__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 9px 22px;
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--line-soft);
}
/* La signature porte déjà son filet : deux traits à 40 px l'un de l'autre sur
   une carte de cette taille se lisent comme une hésitation, pas comme deux
   frontières. Celui du bas cède, l'écart suffit. */
.profil__sig + .profil__facts {
  margin-top: 13px;
  padding-top: 0;
  border-top: 0;
}

.profil__fact {
  min-width: 0;
}
.profil__fact-label {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: 1.3;
  color: var(--ink-3);
}
.profil__fact-value {
  margin: 1px 0 0;
  font-family: var(--font-display);
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.25;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.profil__facts-err {
  margin: 11px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--warn);
}

.profil__trust {
  margin: 2px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink-2);
  text-align: center;
}

/* ---------------------------------------------------------------- actions */

.profil__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  background: var(--surface-2);
  border-top: 1px solid var(--line);
}
.profil__actions-spacer {
  flex: 1;
  min-width: 4px;
}
.profil__njump {
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.profil__njump:hover {
  color: var(--link);
}
.profil__warn {
  margin: 0;
  padding: 7px 12px;
  background: var(--warn-soft);
  border-top: 1px solid var(--line);
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--warn);
}

/* ------------------------------------------------------- topics et messages */

/* Rangées bordées, comme la liste de topics : un profil de forum liste des
   posts dans un tableau, il n'empile pas des cartes. */
.prow {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 11px;
  border-top: 1px solid var(--line-soft);
  color: var(--ink);
}
.prow:hover {
  background: var(--surface-3);
  text-decoration: none;
}
.prow:nth-of-type(even) {
  background: var(--surface-2);
}
.prow:nth-of-type(even):hover {
  background: var(--surface-3);
}
.prow__title {
  flex: 1;
  min-width: 0;
  color: var(--link);
  font-weight: 600;
  font-size: var(--fs-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prow:hover .prow__title {
  color: var(--link-hover);
}
/* Ne grandit pas, à la différence du titre de topic au-dessus : c'est ce qui
   permet au nom du topic de rester collé à l'extrait quel qu'il soit. Sinon il
   flotte quelque part entre les deux, à une distance qui change à chaque ligne. */
.prow__text {
  flex: 0 1 auto;
  min-width: 0;
  font-size: var(--fs-md);
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Le topic d'accueil du message : plus pâle que l'extrait, parce qu'il est le
   contexte et non l'objet de la ligne. Il cède la largeur avant l'extrait. */
.prow__in {
  flex: 0 3 auto;
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--ink-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prow__when {
  flex-shrink: 0;
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

.profil__none,
.profil__scope {
  margin: 0;
  padding: 9px 11px;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink-3);
}
.profil__scope {
  border-top: 1px solid var(--line-soft);
  background: var(--surface-2);
  border-radius: 0 0 var(--r-panel) var(--r-panel);
}

/* ------------------------------------------------------ squelettes et erreurs */

.profil__skel {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.profil__skel-name {
  height: 19px;
  width: 42%;
}
.profil__skel-line {
  height: 12px;
  width: 92%;
}
.profil__skel-line--short {
  width: 60%;
}
.profil__skel-rows {
  padding: 8px 11px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.profil__skel-row {
  height: 14px;
}

.profil__bad {
  padding: 22px 18px;
  text-align: center;
}
.profil__bad-title {
  margin: 0 0 5px;
  font-size: var(--fs-title);
  font-weight: 600;
}
.profil__bad-sub {
  margin: 0 0 12px;
  font-size: var(--fs-md);
  color: var(--ink-3);
}

@media (max-width: 720px) {
  .profil {
    padding: 8px;
  }
  .profil__split {
    grid-template-columns: 1fr;
  }
  /* Trois blocs sur une ligne de téléphone ne laissent lire aucun des trois :
     l'extrait prend la ligne, le topic et l'heure passent dessous. */
  .prow--msg {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .prow--msg .prow__text {
    flex: 1 0 100%;
  }
  .prow--msg .prow__in {
    flex: 1;
  }
}
</style>
