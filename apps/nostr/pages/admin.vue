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
          <button v-if="myNpub" type="button" class="btn btn--sm" @click="void copyNpub(myNpub)">
            {{ npubCopied ? 'copié' : 'copier ma clé' }}
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

      <!-- ======================================================== points -->
      <section v-else-if="tab === 'points'" class="adm__page">
        <header class="adm__pagehead">
          <div>
            <h1 class="adm__title">Points</h1>
            <p class="adm__sub">
              Corriger à la main ce que le barème ne sait pas voir — dans les deux sens. Chaque
              opération est <strong>publique</strong> : le motif s'affiche sur le profil de la
              personne, signé par ta clé. C'est ce qui en fait une décision plutôt qu'un
              passe-droit, et ça vaut aussi quand la clé visée est la tienne.
            </p>
          </div>
        </header>

        <form class="adm__grant" @submit.prevent="doGrant">
          <!-- Un SENS, pas un signe à taper. Un champ nombre où l'on saisit
               « -200 » invite le « -0 », le double moins et la faute qu'on ne
               relit pas — sur un geste irréversible côté réseau, c'est cher. -->
          <div class="adm__grant-sens" role="radiogroup" aria-label="donner ou retirer">
            <button
              type="button"
              class="adm__sens"
              :class="{ 'adm__sens--on': grantSign === 1 }"
              :aria-pressed="grantSign === 1"
              @click="grantSign = 1"
            >
              Donner
            </button>
            <button
              type="button"
              class="adm__sens"
              :class="{ 'adm__sens--on': grantSign === -1, 'adm__sens--retrait': grantSign === -1 }"
              :aria-pressed="grantSign === -1"
              @click="grantSign = -1"
            >
              Retirer
            </button>
          </div>

          <div class="adm__grant-row">
            <label class="adm__grant-field adm__grant-field--who">
              <span class="adm__grant-label">À qui</span>
              <input
                v-model="grantTo"
                type="text"
                class="adm__search adm__search--wide"
                placeholder="npub… (bouton « copier » sur son profil)"
                required
              />
            </label>
            <label class="adm__grant-field adm__grant-field--howmuch">
              <span class="adm__grant-label">Combien</span>
              <input
                v-model.number="grantAmount"
                type="number"
                class="adm__search mono"
                min="1"
                :max="MAX_GRANT_AMOUNT"
                required
              />
            </label>
          </div>

          <div class="adm__grant-presets">
            <button
              v-for="p in GRANT_PRESETS"
              :key="p"
              type="button"
              class="adm__preset mono"
              :class="{ 'adm__preset--on': grantAmount === p }"
              @click="grantAmount = p"
            >
              +{{ p }}
            </button>
          </div>

          <label class="adm__grant-field">
            <span class="adm__grant-label">Pourquoi</span>
            <input
              v-model="grantReason"
              type="text"
              class="adm__search adm__search--wide"
              :maxlength="MAX_REASON_LEN"
              placeholder="le meilleur topic de l'année"
              required
            />
          </label>

          <!-- La conséquence avant la signature, comme le bloc de révocation
               juste à côté : sur un réseau sans suppression, « ce que ça va
               faire » vaut mieux que « ce que ça a fait ». -->
          <p
            v-if="grantPreview"
            class="adm__grant-preview"
            :class="{ 'adm__grant-preview--retrait': grantSign === -1 }"
          >
            <strong>{{ grantPreview.name }}</strong>
            <span class="mono">·{{ grantPreview.disc }}</span> passe de
            <span class="mono">{{ grantPreview.before.toLocaleString('fr-FR') }}</span> à
            <span class="mono">{{ grantPreview.after.toLocaleString('fr-FR') }}</span> points
            <template v-if="grantPreview.levelAfter !== grantPreview.levelBefore">
              — et du niveau <span class="mono">{{ grantPreview.levelBefore }}</span> au niveau
              <strong class="mono">{{ grantPreview.levelAfter }}</strong>
            </template>
            <template v-else>
              — il reste au niveau <span class="mono">{{ grantPreview.levelAfter }}</span>
            </template>
            <!-- Le plancher est dit, pas subi : sans cette phrase, retirer 800 à
                 quelqu'un qui en a 300 donnerait l'impression d'avoir marché.
                 Phrase à part et non ponctuation collée : un point précédé d'un
                 saut de ligne dans le gabarit se rend « niveau 1 . Le score ». -->
            <template v-if="grantPreview.floored">
              <br />
              Le score s'arrête à zéro : c'est
              <span class="mono">{{ grantPreview.excess.toLocaleString('fr-FR') }}</span> de plus
              que ce qu'il a.
            </template>
            <template v-if="grantPreview.self">
              <br />
              C'est ta propre clé — l'attribution s'affichera « par soi-même » sur ton profil.
            </template>
          </p>
          <p v-else-if="grantTo.trim()" class="adm__grant-preview adm__grant-preview--bad">
            Cette adresse ne contient pas de clé lisible.
          </p>

          <div class="adm__grant-actions">
            <button
              type="submit"
              class="btn btn--sm"
              :class="grantSign === -1 ? 'btn--danger' : 'btn--primary'"
              :disabled="mod.publishing || !grantPreview"
            >
              {{ mod.publishing ? 'Publication…' : grantSign === -1 ? 'Retirer' : 'Attribuer' }}
            </button>
            <span class="adm__grant-hint">
              {{ mod.myGrants.length }}/{{ MAX_GRANTS_PER_LIST }} dans ta liste
            </span>
          </div>
          <p v-if="mod.lastError" class="adm__error">{{ mod.lastError }}</p>
        </form>

        <h2 class="adm__h2">Attribué</h2>
        <p v-if="mod.grantLog.length === 0" class="adm__grant-empty">
          Rien encore. La première attribution est aussi la première fois que quelqu'un verra une
          distinction sur son profil.
        </p>
        <table v-else class="adm__table">
          <thead>
            <tr>
              <th scope="col">À qui</th>
              <th scope="col" class="adm__num">Points</th>
              <th scope="col">Motif</th>
              <th scope="col">Par</th>
              <th scope="col">Quand</th>
              <th scope="col"><span class="visually-hidden">Annuler</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in mod.grantLog" :key="`${g.by}:${g.target}:${g.at}`">
              <td>
                <NuxtLink :to="`/profil/${npubFor(g.target)}`" class="adm__member-name">
                  {{ profiles.displayName(g.target) }}
                </NuxtLink>
                <span class="adm__disc mono">·{{ profiles.discriminator(g.target) }}</span>
              </td>
              <td class="adm__num mono" :class="{ 'adm__retrait': g.amount < 0 }">
                {{ g.amount > 0 ? '+' : '−' }}{{ Math.abs(g.amount).toLocaleString('fr-FR') }}
              </td>
              <td class="adm__grant-reason">{{ g.reason || '—' }}</td>
              <td>
                <span v-if="g.by === g.target" class="adm__disc mono">soi-même</span>
                <span v-else class="adm__disc mono">·{{ profiles.discriminator(g.by) }}</span>
              </td>
              <td class="mono adm__grant-when">il y a {{ relativeTime(g.at) }}</td>
              <td>
                <!-- Annuler ne vaut que pour SA liste : une récompense n'est pas
                     un état contesté, elle appartient à qui l'a donnée. -->
                <button
                  v-if="g.by === identity.pubkey"
                  type="button"
                  class="btn btn--sm btn--ghost"
                  :disabled="mod.publishing"
                  @click="doUngrant(g.target, g.at)"
                >
                  annuler
                </button>
              </td>
            </tr>
          </tbody>
        </table>
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
        <button type="button" class="btn btn--sm" @click="void copyJson(relayJson)">
          {{ jsonCopied ? 'copié' : 'copier' }}
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
          <button type="button" class="btn btn--sm" @click="void copyPurge(purgeCommand)">
            {{ purgeCopied ? 'copié' : 'copier la commande' }}
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
import {
  MAX_GRANT_AMOUNT,
  MAX_GRANTS_PER_LIST,
  MAX_REASON_LEN,
  normalizePubkey,
  type ActionType,
  type AppliedAction,
  type Role,
} from '@forome/relay-policy/moderation'
import { levelOf, shownPoints } from '@forome/points'
import type { NostrEvent } from '~/types/nostr'

usePageTitle('Modération')

const mod = useModerationStore()
const social = useSocialStore()
const profiles = useProfileStore()
const topics = useTopicStore()
const relayStore = useRelayStore()
const identity = useIdentityStore()
const points = useUserPointsStore()

type Tab = 'queue' | 'journal' | 'team' | 'points' | 'relay'
const tab = ref<Tab>('queue')

const search = ref('')
const searchEl = ref<HTMLInputElement | null>(null)
const caseEl = ref<{ focusReason: () => void; apply: (v: 'hide' | 'ban' | 'ignore') => void } | null>(null)
const index = ref(0)

const journalSearch = ref('')
const journalKind = ref<'all' | 'hidden' | 'banned' | 'locked' | 'pinned'>('all')

const askRevoke = ref<string | null>(null)
const newMod = ref('')
/**
 * Une confirmation par bouton : les trois « copier » de la page se touchent, et
 * un seul drapeau partagé faisait clignoter « copié » sur les deux autres.
 */
const { copied: npubCopied, copy: copyNpub } = useCopy()
const { copied: jsonCopied, copy: copyJson } = useCopy()
const { copied: purgeCopied, copy: copyPurge } = useCopy()

/** Messages visés par un signalement, chargés à la demande. */
const targets = ref(new Map<string, NostrEvent>())

const myNpub = computed(() => (identity.pubkey ? npubFor(identity.pubkey) : ''))
const isRoot = computed(() => !!mod.rootAdmin && mod.rootAdmin === identity.pubkey)

const tabs = computed(() => [
  { id: 'queue' as const, label: 'Signalements', count: mod.reportQueue.length },
  { id: 'journal' as const, label: 'Journal', count: mod.journal.length },
  { id: 'team' as const, label: 'Équipe', count: 0 },
  { id: 'points' as const, label: 'Points', count: mod.grantLog.length },
  { id: 'relay' as const, label: 'Relais', count: 0 },
])

/* ---------------------------------------------------- attribution de points */

/** Trois montants pour le geste courant. Le champ reste libre — c'est le propos. */
const GRANT_PRESETS = [25, 100, 500] as const

const grantTo = ref('')
const grantAmount = ref(100)
const grantReason = ref('')
/** Le sens de l'opération. Le champ « combien » reste toujours positif. */
const grantSign = ref<1 | -1>(1)

/**
 * Ce que l'attribution va faire, avant de la signer.
 *
 * Même raisonnement que le bloc de confirmation d'une révocation : sur un réseau
 * sans suppression, montrer la conséquence coûte moins cher que la réparer. Et
 * le passage de niveau est la seule partie non évidente — 500 points ne disent
 * rien, « du niveau 4 au niveau 6 » dit tout.
 */
const grantPreview = computed(() => {
  const target = normalizePubkey(grantTo.value)
  if (!target) return null
  const n = Math.trunc(Number(grantAmount.value))
  const magnitude = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_GRANT_AMOUNT) : 0
  const delta = magnitude * grantSign.value
  const before = points.pointsOf(target)
  const brut = before + delta
  // Le même plancher que le score affiché, par la même fonction : l'aperçu doit
  // montrer ce que la personne verra, pas un calcul intermédiaire (§16.8).
  const after = shownPoints(before, delta)
  return {
    name: profiles.displayName(target),
    disc: profiles.discriminator(target),
    before,
    after,
    levelBefore: levelOf(before),
    levelAfter: levelOf(after),
    floored: brut < 0,
    excess: -brut,
    self: target === identity.pubkey,
  }
})

async function doGrant(): Promise<void> {
  const magnitude = Math.abs(Math.trunc(Number(grantAmount.value)))
  const ok = await mod.grant(grantTo.value, magnitude * grantSign.value, grantReason.value)
  if (!ok) return
  // On garde le montant : récompenser plusieurs personnes du même geste pour le
  // même fait est le cas courant (un bon fil, trois participants).
  grantTo.value = ''
  grantReason.value = ''
}

async function doUngrant(target: string, at: number): Promise<void> {
  await mod.ungrant(target, at)
}

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
/* Le journal n'a pas d'en-tête (ses colonnes se lisent d'elles-mêmes) ; la table
   des attributions en a une, parce que « +500 » sans intitulé ne dit pas si
   c'est un montant ou un total. */
.adm__table th {
  padding: 6px 8px;
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  text-align: left;
  color: var(--ink-4);
  white-space: nowrap;
}
.adm__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* -------------------------------------------------------------- attribution
 * Un formulaire, pas une caisse : aucune pastille de prix, aucun aplat coloré,
 * et le seul élément mis en avant est la CONSÉQUENCE (le passage de niveau).
 */
.adm__grant {
  margin: 0 0 22px;
  padding: 14px;
  background: var(--surface-sunken);
  border-radius: var(--r-control);
}
/* Le sens : un segmenté, dans la grammaire du sélecteur Topics/MP. Deux boutons
   côte à côte plutôt qu'une case à cocher « retirer » — une case ne dit pas
   laquelle des deux opérations est en cours quand on regarde le bouton d'envoi. */
.adm__grant-sens {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  margin-bottom: 12px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: 999px;
}
.adm__sens {
  padding: 4px 13px;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--ink-3);
  background: none;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}
.adm__sens--on {
  color: var(--link);
  background: var(--link-soft);
}
/* Retirer est la seule opération de cet écran qui enlève quelque chose à
   quelqu'un : elle porte la couleur des états négatifs, pas celle de
   l'interface. */
.adm__sens--retrait.adm__sens--on {
  color: var(--warn);
  background: var(--warn-soft);
}

.adm__grant-preview--retrait {
  border-left-color: var(--warn);
}
.adm__retrait {
  color: var(--warn);
}

.adm__grant-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.adm__grant-field {
  display: block;
  min-width: 0;
}
.adm__grant-field--who {
  flex: 1;
}
.adm__grant-field--howmuch {
  width: 108px;
  flex-shrink: 0;
}
.adm__grant-label {
  display: block;
  margin-bottom: 4px;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.adm__grant-field + .adm__grant-field,
.adm__grant-presets + .adm__grant-field {
  margin-top: 10px;
}

.adm__grant-presets {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
/* Trois raccourcis pour le geste courant. Le champ reste libre juste au-dessus :
   ce sont des raccourcis, pas un tarif. */
.adm__preset {
  padding: 3px 9px;
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  color: var(--ink-3);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  cursor: pointer;
}
.adm__preset:hover {
  color: var(--ink);
  border-color: var(--line-strong);
}
.adm__preset--on {
  color: var(--link);
  border-color: var(--link);
  background: var(--link-soft);
}

.adm__grant-preview {
  margin: 12px 0 0;
  padding: 9px 11px;
  font-size: var(--fs-md);
  line-height: 1.5;
  color: var(--ink-2);
  background: var(--surface);
  border-radius: var(--r-pastille);
  border-left: 3px solid var(--link);
}
.adm__grant-preview--bad {
  color: var(--ink-4);
  border-left-color: var(--line-strong);
}
.adm__grant-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.adm__grant-hint {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--ink-4);
}
.adm__grant-empty {
  margin: 4px 0 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-4);
}
.adm__grant-reason {
  color: var(--ink);
}
.adm__grant-when {
  font-size: 10.5px;
  color: var(--ink-4);
  white-space: nowrap;
}

@media (max-width: 560px) {
  .adm__grant-row {
    flex-wrap: wrap;
  }
  .adm__grant-field--howmuch {
    width: 100%;
  }
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
