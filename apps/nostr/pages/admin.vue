<template>
  <div class="adm">
    <!-- ------------------------------------------------------------ portes -->
    <section v-if="!mod.configured" class="adm__gate">
      <h1 class="adm__gate-title">Ce forum n'a pas encore d'équipe</h1>
      <p class="adm__gate-text">
        Personne ne modère, et rien n'est masqué. Une seule commande installe la modération — elle
        configure d'un coup le forum <strong>et</strong> le relais, qui doivent connaître la même
        clé pour que « bannir » bannisse vraiment.
      </p>

      <ol class="adm__steps">
        <li>
          <p class="adm__step-text">Copie ta clé publique :</p>
          <button v-if="myNpub" type="button" class="btn btn--sm" @click="copy(myNpub)">
            {{ copied ? 'copié' : 'copier ma clé' }}
          </button>
        </li>
        <li>
          <p class="adm__step-text">Lance, dans le dossier du projet :</p>
          <pre class="adm__code">npm run setup:moderation</pre>
        </li>
        <li>
          <p class="adm__step-text">Relance les deux processus, et recharge cette page.</p>
          <pre class="adm__code">npm run dev:relay
npm run dev:nostr</pre>
        </li>
      </ol>

      <p class="adm__gate-note">
        Pourquoi une commande et pas un bouton : si l'interface pouvait nommer un administrateur
        pour tout le monde, n'importe qui cliquerait dessus. La clé écrite dans la configuration
        <strong>est</strong> ce qui protège le forum — c'est le seul geste qui ne peut pas vivre
        dans l'app, et il n'arrive qu'une fois.
      </p>
    </section>

    <section v-else-if="!mod.amStaff" class="adm__gate">
      <h1 class="adm__gate-title">Réservé à l'équipe</h1>
      <p class="adm__gate-text">La clé de cet appareil ne figure pas au roster signé de ce forum.</p>
      <p class="adm__gate-text">
        <NuxtLink to="/moderation">Voir qui modère ici</NuxtLink> — l'équipe et ses décisions sont
        publiques.
      </p>
    </section>

    <!-- ------------------------------------------------------------ console -->
    <div v-else class="adm__shell">
      <aside class="adm__rail">
        <div class="adm__me">
          <UserAvatar v-if="identity.pubkey" :pubkey="identity.pubkey" :size="28" />
          <div class="adm__me-main">
            <span class="adm__me-name">{{ profiles.displayName(identity.pubkey ?? '') }}</span>
            <span class="adm__me-role">{{ mod.amAdmin ? 'administrateur' : 'modérateur' }}</span>
          </div>
        </div>

        <nav class="adm__nav">
          <button
            v-for="t in tabs"
            :key="t.id"
            type="button"
            class="adm__navitem"
            :class="{ 'adm__navitem--on': tab === t.id }"
            @click="tab = t.id"
          >
            <span>{{ t.label }}</span>
            <span v-if="t.count" class="adm__navcount">{{ t.count }}</span>
          </button>
        </nav>

        <!-- Les raccourcis sont affichés en permanence, pas cachés derrière « ? » :
             un outil qu'on n'utilise que pendant un raid ne laisse pas le temps
             d'apprendre ses raccourcis avant d'en avoir besoin. -->
        <div v-if="tab === 'queue'" class="adm__keys">
          <p class="adm__keys-title">Clavier</p>
          <p><kbd>J</kbd><kbd>K</kbd> naviguer</p>
          <p><kbd>M</kbd> masquer</p>
          <p><kbd>B</kbd> bannir</p>
          <p><kbd>I</kbd> classer sans suite</p>
          <p><kbd>/</kbd> chercher</p>
        </div>

        <div class="adm__railfoot">
          <NuxtLink to="/moderation" class="adm__raillink">Page publique</NuxtLink>
          <NuxtLink to="/" class="adm__raillink">Retour au forum</NuxtLink>
        </div>
      </aside>

      <!-- ================================================== signalements -->
      <section v-if="tab === 'queue'" class="adm__work">
        <div class="adm__list">
          <header class="adm__listhead">
            <input
              ref="searchEl"
              v-model="search"
              type="search"
              class="adm__search"
              placeholder="chercher un texte, un pseudo…"
            />
            <span class="adm__listcount">{{ queue.length }}</span>
          </header>

          <!-- Le raid vient de l'indexeur (§9.5) et n'apparaissait nulle part dans
               l'outil : la détection existait, l'action était à trois écrans. -->
          <div v-if="raids.length" class="adm__raids">
            <p class="adm__raids-title">Raid probable</p>
            <div v-for="r in raids" :key="r.id" class="adm__raid">
              <NuxtLink :to="r.path" class="adm__raid-title">{{ r.title }}</NuxtLink>
              <button
                type="button"
                class="btn btn--sm btn--danger"
                :disabled="mod.publishing"
                @click="lockRaid(r.id)"
              >
                verrouiller
              </button>
            </div>
          </div>

          <div v-if="queue.length === 0" class="adm__empty">
            <p class="adm__empty-title">{{ search ? 'Rien ne correspond' : 'File vide' }}</p>
            <p class="adm__empty-sub">
              {{
                search
                  ? 'Aucun dossier ne contient ce texte.'
                  : 'Aucun signalement en attente. Les décisions déjà prises sont dans le journal.'
              }}
            </p>
          </div>

          <button
            v-for="(g, i) in queue"
            :key="g.target"
            type="button"
            class="adm__row"
            :class="{ 'adm__row--on': i === index }"
            @click="index = i"
          >
            <span class="adm__row-voices" :class="{ 'adm__row-voices--strong': g.voices > 1 }">
              {{ g.voices }}
            </span>
            <span class="adm__row-main">
              <span class="adm__row-top">
                <span class="adm__row-who">{{ whoOf(g) }}</span>
                <time class="adm__row-when mono">{{ relativeTime(g.lastAt) }}</time>
              </span>
              <span class="adm__row-text">{{ excerpt(g) }}</span>
              <span class="adm__row-tags">
                <span v-for="[type] in g.types" :key="type" class="tag">{{ labelOf(type) }}</span>
              </span>
            </span>
          </button>
        </div>

        <div class="adm__case">
          <AdminCase
            v-if="current"
            ref="caseEl"
            :key="current.target"
            :group="current"
            :target="targetEvent(current.target)"
            :other-reports="otherReportsFor(current)"
            @resolved="onResolved"
          />
          <div v-else class="adm__nocase">
            <p class="adm__empty-title">Aucun dossier sélectionné</p>
            <p class="adm__empty-sub">
              Choisis un signalement à gauche, ou navigue au clavier avec <kbd>J</kbd> et
              <kbd>K</kbd>.
            </p>
          </div>
        </div>
      </section>

      <!-- ======================================================= journal -->
      <section v-else-if="tab === 'journal'" class="adm__page">
        <header class="adm__pagehead">
          <div>
            <h1 class="adm__title">Journal</h1>
            <p class="adm__sub">
              Les décisions en vigueur. Ce sont des messages signés et publics : ce journal ne les
              révèle pas, il les rend lisibles.
            </p>
          </div>
          <input v-model="journalSearch" type="search" class="adm__search" placeholder="filtrer…" />
        </header>

        <div class="adm__filters">
          <button
            v-for="f in journalFilters"
            :key="f.id"
            type="button"
            class="adm__chip"
            :class="{ 'adm__chip--on': journalKind === f.id }"
            @click="journalKind = f.id"
          >
            {{ f.label }}
          </button>
        </div>

        <p v-if="journal.length === 0" class="adm__empty-sub">Aucune décision ne correspond.</p>

        <table v-else class="adm__table">
          <tbody>
            <tr v-for="a in journal" :key="`${a.type}:${a.target}`">
              <!-- La colonne est là pour se parcourir de haut en bas : quatre
                   mots de même longueur et même casse se lisaient un par un,
                   quatre formes se trient à l'œil. Le mot reste dans la bulle
                   et au lecteur d'écran. -->
              <td class="adm__cell-verb">
                <Hint :text="verbLabel(a.type)">
                  <span class="tag" :class="a.class === 'illegal' ? 'tag--warn' : 'tag--staff'">
                    <Glyph :name="badgeOf(a.type).glyph" />
                    <span class="visually-hidden">{{ verbLabel(a.type) }}</span>
                  </span>
                </Hint>
              </td>
              <td class="adm__cell-reason">{{ a.reason }}</td>
              <td class="adm__cell-target mono">{{ shortId(a.target, 10) }}</td>
              <td class="adm__cell-by">{{ profiles.displayName(a.by) }}</td>
              <td class="adm__cell-when mono">{{ relativeTime(a.at) }}</td>
              <td class="adm__cell-act">
                <button
                  type="button"
                  class="btn btn--sm btn--ghost"
                  :disabled="mod.publishing"
                  @click="undo(a)"
                >
                  rétablir
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <p class="adm__note">
          ⚠️ C'est l'<strong>état courant</strong>, pas un historique : les listes sont
          remplaçables, donc une décision retirée disparaît d'ici et des relais. Un historique
          inaltérable demanderait un event par action.
        </p>
      </section>

      <!-- ======================================================== équipe -->
      <section v-else-if="tab === 'team'" class="adm__page">
        <header class="adm__pagehead">
          <div>
            <h1 class="adm__title">Équipe</h1>
            <p class="adm__sub">
              Le roster est signé par la <strong>clé racine du forum</strong>, et par elle seule.
              <template v-if="!isRoot">Cette session n'est pas la sienne : lecture seule.</template>
            </p>
          </div>
        </header>

        <div class="adm__members">
          <article v-for="[pubkey, role] in mod.state.staff" :key="pubkey" class="adm__member">
            <UserAvatar :pubkey="pubkey" :size="34" />
            <div class="adm__member-main">
              <NuxtLink :to="`/profil/${npubFor(pubkey)}`" class="adm__member-name">
                {{ profiles.displayName(pubkey) }}
              </NuxtLink>
              <span class="adm__disc mono">·{{ profiles.discriminator(pubkey) }}</span>
              <p class="adm__member-meta">
                {{ mod.actionsBy(pubkey).length }} décision(s) en vigueur
              </p>
            </div>
            <Explain
              :term="ROLE_BADGES[role].label"
              variant="chip"
              :body="ROLE_BADGES[role].body"
            >
              <span class="tag tag--staff">
                <Glyph name="shield" :filled="ROLE_BADGES[role].admin" />
                <span class="visually-hidden">{{ ROLE_BADGES[role].label }}</span>
              </span>
            </Explain>
            <!-- « clé racine » reste un mot : c'est un fait de configuration,
                 pas un rôle, et aucun pictogramme ne le dit. -->
            <span v-if="pubkey === mod.rootAdmin" class="tag tag--brand">clé racine</span>
            <button
              v-else-if="isRoot"
              type="button"
              class="btn btn--sm btn--danger"
              @click="askRevoke = pubkey"
            >
              révoquer
            </button>
          </article>
        </div>

        <!-- La révocation emporte les décisions : c'est ce qui la rend crédible,
             et c'est brutal. On le dit avant, avec le compte exact. -->
        <div v-if="askRevoke" class="adm__confirm">
          <p class="adm__confirm-text">
            Révoquer <strong>{{ profiles.displayName(askRevoke) }}</strong> retire du même coup ses
            <strong>{{ mod.actionsBy(askRevoke).length }} décision(s)</strong> : les messages
            masqués redeviennent visibles, les clés bannies peuvent réécrire.
          </p>
          <div class="adm__confirm-actions">
            <button type="button" class="btn btn--sm btn--danger" @click="doRevoke">confirmer</button>
            <button type="button" class="btn btn--sm btn--ghost" @click="askRevoke = null">annuler</button>
          </div>
        </div>

        <form v-if="isRoot" class="adm__appoint" @submit.prevent="doAppoint('moderator')">
          <h2 class="adm__h2">Nommer</h2>
          <input
            v-model="newMod"
            type="text"
            class="adm__search adm__search--wide"
            placeholder="npub… de la personne (bouton « copier » sur son profil)"
            required
          />
          <div class="adm__appoint-actions">
            <button type="submit" class="btn btn--sm btn--primary" :disabled="mod.publishing">
              nommer modérateur
            </button>
            <button
              type="button"
              class="btn btn--sm"
              :disabled="mod.publishing"
              @click="doAppoint('admin')"
            >
              nommer administrateur
            </button>
          </div>
          <p v-if="mod.lastError" class="adm__error">{{ mod.lastError }}</p>
        </form>
      </section>

      <!-- ======================================================== relais -->
      <section v-else class="adm__page">
        <header class="adm__pagehead">
          <div>
            <h1 class="adm__title">Relais</h1>
            <p class="adm__sub">
              Masquer et bannir n'agissent d'eux-mêmes que dans ce client. Ce qui suit est l'état à
              appliquer côté relais — la seule barrière qui refuse avant stockage.
            </p>
          </div>
        </header>

        <h2 class="adm__h2">État à servir au relais</h2>
        <p class="adm__hint">
          Fichier lu par le plugin strfry via <code>FOROME_MODERATION_STATE</code>. Le relais de dev
          le reconstruit seul depuis les events qu'il reçoit.
        </p>
        <pre class="adm__code">{{ relayJson }}</pre>
        <button type="button" class="btn btn--sm" @click="copy(relayJson)">
          {{ copied ? 'copié' : 'copier' }}
        </button>

        <h2 class="adm__h2">À purger</h2>
        <p class="adm__hint">
          Contenus classés illégaux. Refuser l'écriture ne suffit pas : ils sont
          <strong>déjà stockés</strong>, et un repli sans bouton ne retire rien — le relais doit
          cesser de les servir.
        </p>
        <p v-if="mod.toPurge.length === 0" class="adm__empty-sub">Rien à purger.</p>
        <template v-else>
          <pre class="adm__code">{{ purgeCommand }}</pre>
          <button type="button" class="btn btn--sm" @click="copy(purgeCommand)">
            {{ copied ? 'copié' : 'copier la commande' }}
          </button>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { relativeTime, shortId } from '~/utils/format'
import { npubFor, topicTitle } from '~/utils/nostr'
import { topicPath } from '~/utils/permalink'
import {
  ACTION_BADGES,
  ROLE_BADGES,
  REPORT_LABELS,
  type ReportType,
  type ReportGroup,
} from '~/types/moderation'
import type { ActionType, AppliedAction, Role } from '@forome/relay-policy/moderation'
import type { NostrEvent } from '~/types/nostr'

usePageTitle('Modération')

const mod = useModerationStore()
const social = useSocialStore()
const profiles = useProfileStore()
const topics = useTopicStore()
const relayStore = useRelayStore()
const identity = useIdentityStore()

type Tab = 'queue' | 'journal' | 'team' | 'relay'
const tab = ref<Tab>('queue')

const search = ref('')
const searchEl = ref<HTMLInputElement | null>(null)
const caseEl = ref<{ focusReason: () => void; apply: (v: 'hide' | 'ban' | 'ignore') => void } | null>(null)
const index = ref(0)

const journalSearch = ref('')
const journalKind = ref<'all' | 'hidden' | 'banned' | 'locked' | 'pinned'>('all')

const askRevoke = ref<string | null>(null)
const newMod = ref('')
const copied = ref(false)

/** Messages visés par un signalement, chargés à la demande. */
const targets = ref(new Map<string, NostrEvent>())

const myNpub = computed(() => (identity.pubkey ? npubFor(identity.pubkey) : ''))
const isRoot = computed(() => !!mod.rootAdmin && mod.rootAdmin === identity.pubkey)

const tabs = computed(() => [
  { id: 'queue' as const, label: 'Signalements', count: mod.reportQueue.length },
  { id: 'journal' as const, label: 'Journal', count: mod.journal.length },
  { id: 'team' as const, label: 'Équipe', count: 0 },
  { id: 'relay' as const, label: 'Relais', count: 0 },
])

/* --------------------------------------------------------------- la file */

function targetEvent(id: string): NostrEvent | null {
  return targets.value.get(id) ?? null
}

function whoOf(g: ReportGroup): string {
  const pk = g.targetKind === 'pubkey' ? g.target : targetEvent(g.target)?.pubkey
  return pk ? profiles.displayName(pk) : 'auteur inconnu'
}

function excerpt(g: ReportGroup): string {
  if (g.targetKind === 'pubkey') return 'signalement visant le compte'
  const ev = targetEvent(g.target)
  if (!ev) return 'message introuvable sur ces relais'
  const flat = ev.content.replace(/\s+/g, ' ').trim()
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat
}

const queue = computed<ReportGroup[]>(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return mod.reportQueue
  return mod.reportQueue.filter((g) => {
    const ev = targetEvent(g.target)
    return (
      whoOf(g).toLowerCase().includes(needle) ||
      (ev?.content ?? '').toLowerCase().includes(needle) ||
      g.notes.join(' ').toLowerCase().includes(needle)
    )
  })
})

const current = computed<ReportGroup | null>(() => queue.value[index.value] ?? null)

/** Combien d'autres dossiers en attente visent le même auteur. */
function otherReportsFor(g: ReportGroup): number {
  const pk = g.targetKind === 'pubkey' ? g.target : targetEvent(g.target)?.pubkey
  if (!pk) return 0
  return queue.value.filter((o) => {
    if (o.target === g.target) return false
    const opk = o.targetKind === 'pubkey' ? o.target : targetEvent(o.target)?.pubkey
    return opk === pk
  }).length
}

function labelOf(type: string): string {
  return REPORT_LABELS[type as ReportType] ?? type
}

/**
 * Après une décision, on ne revient pas à la liste : le dossier suivant prend la
 * place. Traiter une file en repartant du haut à chaque fois, c'est perdre son
 * rang à chaque geste — insupportable au-delà de dix dossiers.
 */
function onResolved(): void {
  if (index.value >= queue.value.length - 1) index.value = Math.max(0, queue.value.length - 2)
}

/* --------------------------------------------------------------- raids */

const raids = computed(() =>
  [...topics.flaggedTopics]
    .filter((id) => !mod.isLocked(id))
    .map((id) => {
      const root = topics.rootById(id)
      const title = root ? topicTitle(root) : (topics.rowById(id)?.title ?? 'topic')
      return { id, title, path: topicPath(id, title) }
    }),
)

async function lockRaid(id: string): Promise<void> {
  await mod.lock(id, 'raid détecté — verrouillage préventif')
}

/* ------------------------------------------------------------- journal */

const journalFilters = [
  { id: 'all' as const, label: 'tout' },
  { id: 'hidden' as const, label: 'masqués' },
  { id: 'banned' as const, label: 'bannis' },
  { id: 'locked' as const, label: 'verrouillés' },
  { id: 'pinned' as const, label: 'épinglés' },
]

const journal = computed<AppliedAction[]>(() => {
  const needle = journalSearch.value.trim().toLowerCase()
  const kind = journalKind.value
  return mod.journal.filter((a) => {
    if (kind !== 'all') {
      const family =
        a.type === 'hide' ? 'hidden' : a.type === 'ban' ? 'banned' : a.type === 'lock' ? 'locked' : 'pinned'
      if (family !== kind) return false
    }
    if (!needle) return true
    return (
      a.reason.toLowerCase().includes(needle) ||
      a.target.includes(needle) ||
      profiles.displayName(a.by).toLowerCase().includes(needle)
    )
  })
})

/** Voir `ACTION_BADGES` : un inverse ne s'affiche jamais, d'où le repli. */
function badgeOf(type: ActionType) {
  return ACTION_BADGES[type as keyof typeof ACTION_BADGES] ?? ACTION_BADGES.lock
}

/**
 * Le mot que l'icône remplace. Le panneau a sa propre colonne de cible, donc
 * il lui suffit du verbe — la page publique, elle, nomme l'objet.
 */
function verbLabel(type: ActionType): string {
  return badgeOf(type).label
}

async function undo(a: AppliedAction): Promise<void> {
  const reason = 'décision annulée'
  if (a.type === 'hide') await mod.show(a.target, reason)
  else if (a.type === 'ban') await mod.unban(a.target, reason)
  else if (a.type === 'lock') await mod.unlock(a.target, reason)
  else if (a.type === 'pin') await mod.unpin(a.target, reason)
}

/* -------------------------------------------------------------- équipe */

async function doAppoint(role: Role): Promise<void> {
  const ok = await mod.appoint(newMod.value.trim(), role)
  if (ok) newMod.value = ''
}

async function doRevoke(): Promise<void> {
  if (askRevoke.value) await mod.revoke(askRevoke.value)
  askRevoke.value = null
}

/* -------------------------------------------------------------- relais */

const relayJson = computed(() => JSON.stringify(mod.relayState, null, 2))
const purgeCommand = computed(
  () => `strfry delete --filter '${JSON.stringify({ ids: mod.toPurge })}'`,
)

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* presse-papier indisponible — pas bloquant */
  }
}

/* ------------------------------------------------------------- clavier */

/**
 * Les raccourcis ne se déclenchent pas dans un champ, **sauf** Échap : sinon
 * taper « masquer » dans un motif déclencherait un bannissement à la lettre B.
 */
function onKey(e: KeyboardEvent): void {
  const el = e.target as HTMLElement | null
  const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

  if (e.key === 'Escape') {
    if (typing) (el as HTMLInputElement).blur()
    return
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return
  if (tab.value !== 'queue') return

  switch (e.key) {
    case 'j':
      index.value = Math.min(index.value + 1, queue.value.length - 1)
      e.preventDefault()
      break
    case 'k':
      index.value = Math.max(index.value - 1, 0)
      e.preventDefault()
      break
    case '/':
      searchEl.value?.focus()
      e.preventDefault()
      break
    case 'm':
      caseEl.value?.apply('hide')
      e.preventDefault()
      break
    case 'b':
      caseEl.value?.apply('ban')
      e.preventDefault()
      break
    case 'i':
      caseEl.value?.apply('ignore')
      e.preventDefault()
      break
  }
}

/* ------------------------------------------------------------ chargement */

/**
 * Charge ce qu'il faut pour décider : les messages visés, et le graphe de
 * follows des signalants — c'est lui qui transforme un compte de signalements en
 * compte de voix (§9.6).
 */
async function hydrate(): Promise<void> {
  const groups = mod.reportQueue
  if (groups.length === 0) return

  await social.fetchFollowsFor(groups.flatMap((g) => [...g.reporters]))

  const missing = groups
    .filter((g) => g.targetKind === 'event' && !targets.value.has(g.target))
    .map((g) => g.target)
  if (missing.length === 0) return
  const found = await relayStore.query({ ids: missing.slice(0, 100) })
  const next = new Map(targets.value)
  for (const ev of found) next.set(ev.id, ev)
  targets.value = next
  for (const ev of found) profiles.want(ev.pubkey)
}

onMounted(() => {
  mod.watchReports()
  void hydrate()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

watch(() => mod.reportQueue.length, () => void hydrate())
watch(queue, (list) => {
  if (index.value > list.length - 1) index.value = Math.max(0, list.length - 1)
})
</script>

<style scoped>
/* La console prend toute la hauteur disponible : une file de modération se
   travaille dans un écran fixe avec ses propres zones de défilement, pas dans
   une page qui s'allonge. Même parti que la vue 30/70 du forum. */
.adm {
  height: 100%;
  min-height: 0;
}

/* ------------------------------------------------------------------ portes */
.adm__gate {
  max-width: 580px;
  margin: 40px auto;
  padding: 22px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-1);
}
.adm__gate-title {
  margin: 0 0 10px;
  font-family: var(--font-display);
  font-size: var(--fs-h);
  color: var(--ink);
}
.adm__gate-text {
  margin: 0 0 10px;
  font-size: var(--fs-lg);
  line-height: 1.6;
  color: var(--ink-2);
}
.adm__steps {
  margin: 18px 0;
  padding-left: 20px;
}
.adm__steps li {
  margin-bottom: 16px;
}
.adm__step-text {
  margin: 0 0 7px;
  font-size: var(--fs-md);
  color: var(--ink-2);
}
.adm__gate-note {
  margin: 18px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--ink-4);
}

/* ----------------------------------------------------------------- coque */
.adm__shell {
  display: grid;
  grid-template-columns: 208px 1fr;
  gap: var(--gutter);
  height: 100%;
  min-height: 0;
}

.adm__rail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-1);
  overflow-y: auto;
}
.adm__me {
  display: flex;
  align-items: center;
  gap: 9px;
}
.adm__me-main {
  min-width: 0;
}
.adm__me-name {
  display: block;
  font-weight: 700;
  font-size: var(--fs-base);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
}
.adm__me-role {
  font-size: var(--fs-sm);
  color: var(--ink-4);
}

.adm__nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.adm__navitem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: var(--r-control);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--ink-3);
  text-align: left;
  transition: background 0.13s ease, color 0.13s ease;
}
.adm__navitem:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.adm__navitem--on {
  background: var(--link-soft);
  color: var(--link);
}
/* Le seul compteur du chrome, et il décide : combien de dossiers restent. */
.adm__navcount {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
}
.adm__navitem--on .adm__navcount {
  color: var(--link);
}

.adm__keys {
  padding: 10px;
  background: var(--surface-sunken);
  border-radius: var(--r-control);
  font-size: var(--fs-sm);
  line-height: 1.7;
  color: var(--ink-4);
}
.adm__keys-title {
  margin: 0 0 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.adm__keys p {
  margin: 0;
}

.adm__railfoot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
}
.adm__raillink {
  font-size: var(--fs-sm);
  color: var(--ink-3);
  text-decoration: none;
}
.adm__raillink:hover {
  color: var(--link);
}

/* ------------------------------------------------------- file + dossier */
.adm__work {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: var(--gutter);
  min-height: 0;
}

.adm__list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-1);
  overflow-y: auto;
}
.adm__listhead {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--line-soft);
}
.adm__search {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-family: inherit;
  font-size: var(--fs-md);
  color: var(--ink);
}
.adm__search--wide {
  width: 100%;
  flex: none;
}
.adm__search:focus {
  outline: none;
  border-color: var(--link);
  box-shadow: var(--ring);
}
.adm__listcount {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
}

/* Bande de raid. Le seul endroit de l'outil qui crie, et il le mérite : c'est la
   situation où dix minutes d'inaction font les dégâts (§9.5). */
.adm__raids {
  padding: 10px 12px;
  background: var(--warn-soft);
  border-bottom: 1px solid var(--line-soft);
}
.adm__raids-title {
  margin: 0 0 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--warn);
}
.adm__raid {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
}
.adm__raid-title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--ink-2);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.adm__row {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--line-soft);
  text-align: left;
  transition: background 0.12s ease;
}
.adm__row:hover {
  background: var(--surface-2);
}
/* Le dossier ouvert porte un liseré, pas un aplat fort : la rangée doit rester
   lisible pendant qu'on lit le dossier à droite. */
.adm__row--on {
  background: var(--link-soft);
  box-shadow: inset 2px 0 0 var(--link);
}
.adm__row-voices {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: var(--r-pastille);
  background: var(--surface-3);
  font-size: var(--fs-md);
  font-weight: 700;
  color: var(--ink-2);
}
.adm__row-voices--strong {
  background: var(--brand-soft);
  color: var(--brand-ink);
}
.adm__row-main {
  min-width: 0;
  flex: 1;
}
.adm__row-top {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.adm__row-who {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adm__row-when {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
}
.adm__row-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  margin-top: 2px;
  font-size: var(--fs-md);
  line-height: 1.4;
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
.adm__row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.adm__case {
  min-height: 0;
  padding: 16px 18px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-1);
  overflow: hidden;
}
.adm__nocase {
  display: grid;
  place-content: center;
  height: 100%;
  text-align: center;
}

.adm__empty {
  padding: 34px 20px;
  text-align: center;
}
.adm__empty-title {
  margin: 0 0 4px;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink-2);
}
.adm__empty-sub {
  margin: 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-4);
}

/* --------------------------------------------------------- pages simples */
.adm__page {
  min-height: 0;
  overflow-y: auto;
  padding: 20px 22px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-1);
}
.adm__pagehead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.adm__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-h);
  color: var(--ink);
}
.adm__sub {
  margin: 4px 0 0;
  max-width: 62ch;
  font-size: var(--fs-md);
  line-height: 1.6;
  color: var(--ink-4);
}
.adm__h2 {
  margin: 24px 0 4px;
  font-size: var(--fs-title);
  color: var(--ink);
}
.adm__hint {
  margin: 0 0 10px;
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--ink-4);
}
.adm__note {
  margin: 18px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--ink-4);
}
.adm__error {
  margin: 9px 0 0;
  font-size: var(--fs-sm);
  color: var(--warn);
}
.adm__code {
  margin: 0 0 10px;
  padding: 11px 13px;
  background: var(--surface-sunken);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-control);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink-2);
  overflow-x: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.adm__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 14px;
}
.adm__chip {
  padding: 4px 11px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-3);
  transition: border-color 0.13s ease, color 0.13s ease, background 0.13s ease;
}
.adm__chip:hover {
  border-color: var(--line-strong);
  color: var(--ink);
}
.adm__chip--on {
  background: var(--link-soft);
  border-color: var(--link);
  color: var(--link);
}

.adm__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-md);
}
.adm__table td {
  padding: 9px 8px;
  border-top: 1px solid var(--line-soft);
  vertical-align: middle;
  color: var(--ink-2);
}
.adm__cell-verb,
.adm__cell-act {
  width: 1%;
  white-space: nowrap;
}
.adm__cell-target,
.adm__cell-when {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
  white-space: nowrap;
}
.adm__cell-reason {
  color: var(--ink);
}
.adm__cell-by {
  color: var(--ink-3);
  white-space: nowrap;
}

/* --------------------------------------------------------------- équipe */
.adm__members {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.adm__member {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  background: var(--surface-sunken);
  border-radius: var(--r-control);
}
.adm__member-main {
  flex: 1;
  min-width: 0;
}
.adm__member-name {
  font-weight: 700;
  color: var(--link);
  text-decoration: none;
}
.adm__disc {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
  margin-left: 4px;
}
.adm__member-meta {
  margin: 2px 0 0;
  font-size: var(--fs-sm);
  color: var(--ink-4);
}

.adm__confirm {
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--warn-soft);
  border-radius: var(--r-control);
}
.adm__confirm-text {
  margin: 0 0 10px;
  font-size: var(--fs-md);
  line-height: 1.6;
  color: var(--ink-2);
}
.adm__confirm-actions,
.adm__appoint-actions {
  display: flex;
  gap: 6px;
}
.adm__appoint {
  margin-top: 26px;
  padding-top: 16px;
  border-top: 1px solid var(--line-soft);
}
.adm__appoint-actions {
  margin-top: 9px;
}

kbd {
  display: inline-block;
  min-width: 15px;
  margin-right: 2px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-3);
  font-family: var(--font-mono);
  font-size: 9.5px;
  text-align: center;
  color: var(--ink-3);
}

/* Sous 1000 px la file et le dossier ne tiennent plus côte à côte : le rail
   passe en barre, et le dossier sous la file. */
@media (max-width: 1000px) {
  .adm__shell {
    grid-template-columns: 1fr;
    height: auto;
  }
  .adm__rail {
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
  }
  .adm__nav {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .adm__keys,
  .adm__railfoot {
    display: none;
  }
  .adm__work {
    grid-template-columns: 1fr;
  }
  .adm__list {
    max-height: 42vh;
  }
}
</style>
