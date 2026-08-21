<template>
  <article
    :id="`msg-${post.id}`"
    class="msg"
    :class="{
      'msg--compact': compact,
      'msg--fresh': fresh,
      'msg--targeted': targeted,
      'msg--root': post.root,
      'msg--own': own,
      'msg--anon': post.anon,
      'msg--pending': state === 'pending',
      'msg--unsent': unsent,
      'msg--failed': state === 'failed',
    }"
  >
    <!-- Liseré de statut du message : racine du topic (orange), le sien (bleu),
         refusé par les relais (cramoisi). Il occupe sa propre colonne de grille
         au lieu d'être une `border-left`, pour que le surlignage de saut puisse
         se poser par-dessus sans le recouvrir. -->
    <span class="msg__rail" aria-hidden="true" />

    <!-- Colonne d'avatar : l'identicon est dérivé de la clé, donc l'usurpation
         de pseudo se voit à l'œil (§3.5). Il est désormais À CÔTÉ du pseudo et
         non sous lui — le pseudo posé au-dessus d'un avatar posé à sa gauche
         était l'anatomie phpBB, et elle creusait une colonne vide sous chaque
         message court. -->
    <div v-if="!compact" class="msg__aside">
      <UserAvatar :pubkey="post.pubkey" :size="30" :alt="`avatar de ${profiles.displayName(post.pubkey)}`" />
    </div>

    <!-- Barre d'auteur : qui, quand, nº du post. Convention forum, jamais chat
         (rangée distincte, jamais fusionnée avec la suivante). -->
    <div class="msg__bar">
      <!-- Le pseudo mène au profil du forum, pas à un visualiseur tiers : cliquer
           sur un auteur au milieu d'un fil ne doit pas sortir du site. Le lien
           vers l'extérieur (njump) reste, une fois, sur la page de profil — là où
           « cette identité ne nous appartient pas » est le propos. -->
      <!-- Pas de lien vers un profil : la clé n'en a pas, n'en aura pas, et
           mener vers une page vide donnerait à croire qu'il y a quelqu'un
           derrière à consulter. Le discriminant fait partie du nom ici — c'est
           lui qui dit « la même voix », donc il ne peut pas être une décoration
           conditionnelle comme sur un compte. -->
      <Explain v-if="post.anon" term="anonyme" :body="BODY_ANON">
        <span class="msg__author msg__author--anon">{{ anonName(post.pubkey) }}</span>
      </Explain>
      <Hint v-else :text="`profil de ${profiles.displayName(post.pubkey)}`">
        <NuxtLink :to="`/profil/${npub}`" class="msg__author">
          {{ profiles.displayName(post.pubkey) }}
        </NuxtLink>
      </Hint>
      <!-- Le pseudo n'est pas unique sur Nostr (spec §3.5) : dès qu'il vient
           d'un kind 0, le discriminant de clé est obligatoire. -->
      <Explain
        v-if="!post.anon && profiles.isClaimedName(post.pubkey)"
        term="discriminant"
        :body="BODY_DISCRIMINANT"
      >
        <span class="msg__disc mono">·{{ profiles.discriminator(post.pubkey) }}</span>
      </Explain>

      <!-- NIP-05 réellement vérifié (§3.5). « Injoignable » n'est pas
           « invalide » : un domaine muet ne prouve rien, et on le dit. -->
      <Explain v-if="nip05 && !post.anon" term="nip-05" variant="chip" :body="nip05Body">
        <span class="tag" :class="nip05TagClass">{{ nip05Label }}</span>
      </Explain>

      <!-- Confiance : le web of trust ne masque rien, il replie (§12.3). -->
      <Explain v-if="trustTag && !post.anon" :term="trustTag.label" variant="chip" :body="trustTag.body">
        <span class="tag" :class="trustTag.cls">{{ trustTag.label }}</span>
      </Explain>

      <!-- Le rôle est affiché avant tout le reste : un modérateur qui intervient
           dans un fil sans marqueur est indistinguable d'un khey qui se donne de
           l'importance, et l'autorité qu'on ne voit pas n'existe pas. -->
      <Explain v-if="staffTag && !post.anon" :term="staffTag.label" variant="chip" :body="staffTag.body">
        <span class="tag tag--staff">
          <Glyph name="shield" :filled="staffTag.admin" />
          <span class="visually-hidden">{{ staffTag.label }}</span>
        </span>
      </Explain>

      <span v-if="post.root" class="tag tag--brand">auteur du topic</span>
      <span v-if="own" class="tag tag--ok">toi</span>

      <!-- La publication ne bloque plus l'interface : le post s'affiche avant
           d'être accepté. Sans ce marqueur, un refus resterait invisible et le
           message aurait l'air publié alors qu'il n'est nulle part. -->
      <Explain
        v-if="state === 'pending'"
        term="envoi"
        variant="chip"
        :body="BODY_PENDING"
      >
        <span class="tag">envoi…</span>
      </Explain>
      <Explain
        v-else-if="state === 'failed'"
        term="non publié"
        variant="chip"
        :body="BODY_FAILED"
      >
        <span class="tag tag--warn">non publié</span>
      </Explain>
      <Explain
        v-else-if="state === 'edit-pending'"
        term="correction en cours"
        variant="chip"
        :body="BODY_EDIT_PENDING"
      >
        <span class="tag">correction…</span>
      </Explain>
      <!-- Distinct de « non publié », et l'écart est le propos : le message,
           lui, est bien sur le réseau. C'est la correction qui n'est nulle part,
           donc le texte affiché est revenu à celui que tout le monde lit. -->
      <Explain
        v-else-if="state === 'edit-failed'"
        term="correction non publiée"
        variant="chip"
        :body="BODY_EDIT_FAILED"
      >
        <span class="tag tag--warn">correction non publiée</span>
      </Explain>

      <span class="msg__bar-spacer" />

      <!-- Horodatage au format long des forums. Le relatif reste en bulle :
           dans un registre append-only, l'heure exacte est l'information. -->
      <Hint :text="relativeTime(post.createdAt)">
        <time class="msg__time mono">{{ forumTime(post.createdAt) }}</time>
      </Hint>

      <!-- « modifié », et pas « 3 versions » : ce qui intéresse le lecteur, c'est
           QUE le texte a bougé et QUOI — jamais combien de fois. Un compteur ici
           serait de l'instrumentation posée devant lui.

           Le mot est un bouton parce que l'historique est la contrepartie de la
           correction : pouvoir se relire suppose qu'on puisse être relu. -->
      <!-- ⚠️ Tombe avec le voile de modération. Sans ce `!veiled`, masquer un
           message laisserait un bouton qui en affiche toutes les versions, texte
           d'origine compris : le geste de modération ne masquerait plus rien. -->
      <Hint
        v-if="post.editedAt && !veiled"
        :text="`modifié le ${absoluteTime(post.editedAt)} — voir les versions`"
      >
        <button
          type="button"
          class="msg__edited mono"
          :class="{ 'msg__edited--on': panel === 'history' }"
          @click="panel = panel === 'history' ? null : 'history'"
        >
          modifié
        </button>
      </Hint>

      <!-- Numérotation LOCALE (spec §6.4) : ce n'est plus une preuve, c'est
           une commodité d'affichage. Le lien copié désigne le message par son id. -->
      <Hint
        :text="
          unsent
            ? 'ce message n’a pas encore d’identifiant — une seconde'
            : `copier le permalien — le nº ${post.index} est l'ordre d'affichage ici, il n'est pas stable d'un client à l'autre`
        "
      >
        <button type="button" class="msg__seq mono" :disabled="unsent" @click="copyPermalink">
          {{ copied ? 'copié' : `#${post.index}` }}
        </button>
      </Hint>
    </div>

    <div class="msg__body">
      <div class="msg__content">
        <!-- Décision de modération. Le message ne disparaît pas : il est replié,
             et ce qui reste dit qui a décidé et pourquoi. C'est la contrepartie
             du §9.2 — on peut retirer de la vue, jamais en silence. -->
        <div v-if="veiled" class="msg__veil">
          <p class="msg__veil-head">
            <span class="msg__veil-title">{{ veil?.title }}</span>
            <span v-if="veil?.reason" class="msg__veil-reason">— {{ veil.reason }}</span>
          </p>
          <p v-if="veil?.note" class="msg__veil-note">{{ veil.note }}</p>
          <div class="msg__veil-foot">
            <span class="msg__veil-by">
              décision de {{ profiles.displayName(veil?.by ?? '') }}
            </span>
            <button
              v-if="veil?.revealable"
              type="button"
              class="msg__act"
              @click="revealed = true"
            >
              afficher quand même
            </button>
          </div>
        </div>

        <template v-else>
        <!-- Ce à quoi on répond est MONTRÉ, pas référencé. Un id d'event en tête
             de post est un code de chat (la référence de réponse Discord) et
             n'apprend rien : il faut cliquer, ou remonter, pour savoir de quoi
             on parle. Un forum cite — l'amorce se lit sur place, et le numéro
             renvoie au message d'origine.

             La citation reste dans le flux du texte (filet à gauche, pas de
             boîte grise) pour la raison qui a déjà écarté les boutons encadrés
             plus bas : sur un fil de 150 messages, des cadres répétés font un
             mur qui écrase le contenu. -->
        <Hint v-if="quoted" :text="quoteTitle">
          <component
            :is="quoted.index ? 'button' : 'div'"
            :type="quoted.index ? 'button' : undefined"
            class="msg__quote"
            :class="{ 'msg__quote--jump': !!quoted.index, 'msg__quote--dead': !quoted.content }"
            @click="quoted.index ? emit('jump', quoted.id) : null"
          >
          <span class="msg__quote-head">
            <span class="msg__quote-who">{{ quotedName }}</span>
            <span class="msg__quote-verb">a écrit</span>
            <span v-if="quoted.index" class="msg__quote-seq mono">#{{ quoted.index }}</span>
            <!-- Le message cité a changé depuis la réponse. On montre la version
                 en vigueur — figer supposerait d'en garder une copie, et
                 afficher un texte que son auteur a remplacé serait le mensonge
                 inverse. Reste à le dire, sinon la réponse a l'air de répondre à
                 côté sans qu'on sache pourquoi. -->
            <span v-if="quoted.edited" class="msg__quote-edited mono">modifié depuis</span>
          </span>
          <span v-if="quotedText" class="msg__quote-text">{{ quotedText }}</span>
          <span v-else class="msg__quote-text msg__quote-text--dead">
            message introuvable sur ces relais
          </span>
          </component>
        </Hint>
        <!-- Retrait par l'auteur : une correction vers le vide (§2.5). La rangée
             reste, comme pour une décision de modération et pour la même raison —
             un message qui s'évapore emporte avec lui les réponses qui le citent,
             et laisse le fil raconter n'importe quoi. L'historique reste ouvrable :
             ce forum cesse d'afficher le texte, il ne prétend pas l'avoir effacé. -->
        <p v-if="retracted" class="msg__retracted">
          Message retiré par son auteur.
        </p>
        <!-- Texte nu : chemin direct, sans analyse. C'est la grande majorité des
             messages, et ça évite de payer un parseur pour rien. -->
        <p v-else-if="!rich" class="msg__text">{{ post.content }}</p>
        <!-- Texte enrichi : arbre de tokens rendu en éléments Vue, jamais en
             v-html — le contenu vient de relais tiers (voir utils/richtext.ts). -->
        <div v-else class="msg__text msg__text--rich">
          <RichText :blocks="rich" />
        </div>

        <!-- Signature. Elle vient du kind 0, qui est remplaçable, alors que le
             post est signé et immuable : la changer réécrit le pied de tous les
             messages déjà publiés. C'est le comportement des forums classiques,
             et c'est ce que le filet dit — au-dessus, ce que la signature de
             l'event couvre ; en dessous, ce qu'elle ne couvre pas.

             Tombe en mode ambiance avec l'avatar et les actions : c'est ce qu'il
             y a de plus sacrifiable quand la densité devient le but. -->
        <p v-if="!compact && signature && !retracted" class="msg__sig">{{ signature }}</p>
        </template>

        <!-- « répondre » permanent, jamais au survol : code de forum (§7.3). -->
        <div v-if="!compact" class="msg__actions">
          <span v-if="flash" class="msg__flash">{{ flash }}</span>

          <Hint
            v-if="!veiled"
            :text="
              unsent
                ? 'ce message n’a pas encore d’identifiant — une seconde'
                : 'répondre à ce message — ta réponse le montrera au-dessus d’elle'
            "
          >
            <button type="button" class="msg__act" :disabled="unsent" @click="emit('reply', post.id)">
              répondre
            </button>
          </Hint>

          <!-- « modifier » vit dans la rangée permanente avec « répondre », jamais
               au survol : c'est la convention du forum, et une action qu'on ne
               découvre qu'en passant la souris n'existe pas au doigt.

               Sur ses propres messages seulement. Le garde-fou d'auteur est
               ailleurs (à la publication et à la résolution) — ici, ne pas
               montrer un bouton qui ne peut rien faire. -->
          <Hint
            v-if="own && !veiled"
            :text="
              unsent
                ? 'ce message n’a pas encore d’identifiant — une seconde'
                : locked
                  ? 'topic verrouillé : les relais n’acceptent plus rien dessus, corrections comprises'
                  : 'corriger ce message — la version d’origine restera lisible'
            "
          >
            <button
              type="button"
              class="msg__act"
              :class="{ 'msg__act--on': editing }"
              :disabled="locked || unsent"
              @click="toggleEdit"
            >
              modifier
            </button>
          </Hint>

          <!-- « signaler » vit avec « répondre » : c'est la rangée d'actions des
               forums, alignée sous le message, pas un menu caché. -->
          <Hint v-if="!own && !veiled" text="signaler ce message à la modération">
            <button
              type="button"
              class="msg__act"
              :class="{ 'msg__act--on': panel === 'report' }"
              @click="panel = panel === 'report' ? null : 'report'"
            >
              signaler
            </button>
          </Hint>

          <Hint v-if="mod.amStaff" text="masquer ce message, ou bannir son auteur">
            <button
              type="button"
              class="msg__act msg__act--staff"
              :class="{ 'msg__act--on': panel === 'moderate' }"
              @click="panel = panel === 'moderate' ? null : 'moderate'"
            >
              modérer
            </button>
          </Hint>
        </div>

        <!-- Variante Lazy : l'import statique embarquait toute la pile d'édition
             (RichEditor, StickerDrawer, MarkupToolbar) dans le chunk du fil, que
             chaque lecteur payait sans jamais éditer. -->
        <LazyPostEditor
          v-if="editing && !compact"
          :content="post.content"
          :imeta="post.imeta"
          @save="(content, tags) => emit('editSave', { id: post.id, content, tags })"
          @cancel="emit('editCancel')"
        />

        <!-- L'historique. Ce ne sont pas des lignes d'un journal reconstitué :
             chaque version est l'event tel qu'il a été signé, et il est encore
             vérifiable séparément. C'est la forme que prend ici « rien ne
             s'écrase » — l'ancienne version n'est pas conservée par bonté, elle
             est indéracinable. -->
        <div v-if="panel === 'history' && !compact && !veiled" class="msg__history">
          <p class="msg__history-lead">Versions de ce message</p>
          <ol class="msg__history-list">
            <li v-for="v in versions" :key="v.id" class="msg__history-item">
              <p class="msg__history-head">
                <span class="msg__history-when mono">{{ absoluteTime(v.createdAt) }}</span>
                <span v-if="v.first" class="tag">version d'origine</span>
                <span v-else-if="v.last" class="tag tag--ok">version affichée</span>
              </p>
              <!-- Rendu, pas brut : une version est du texte de forum comme le
                   message lui-même. En balisage nu, on lit `++non++` au lieu de
                   voir le souligné — donc on ne peut pas comparer deux versions,
                   ce qui est la seule chose qu'on vient faire ici.

                   Le panneau de modération, lui, montre le brut à dessein
                   (`AdminCase`) : on y modère ce qui a été écrit, pas ce que le
                   rendu en fait. Deux publics, deux traitements. -->
              <p v-if="v.empty" class="msg__history-text msg__history-text--empty">
                (retiré par l'auteur)
              </p>
              <div v-else-if="v.rich" class="msg__history-rich">
                <RichText :blocks="v.rich" />
              </div>
              <p v-else class="msg__history-text">{{ v.text }}</p>
            </li>
          </ol>
          <p class="msg__history-note">
            Chaque version est un message signé à part, publié sur les relais. Aucune ne peut être
            retirée du réseau — celle-ci comprise.
          </p>
        </div>

        <LazyPostModeration
          v-if="(panel === 'report' || panel === 'moderate') && !compact"
          :post="post"
          :mode="panel"
          @close="panel = null"
          @done="onModerated"
        />
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, computed, provide } from 'vue'
import { relativeTime, forumTime, absoluteTime, shortId, quotePreview } from '~/utils/format'
import { npubFor, topicTitle } from '~/utils/nostr'
import { topicPath } from '~/utils/permalink'
import { anonName, isProvisional, type OwnState, type Post, type QuotedPost } from '~/types/nostr'
import { ROLE_BADGES } from '~/types/moderation'
import { parseRichText, hasMarkup } from '~/utils/richtext'

/**
 * Corps des bulles d'explication, en constantes : un littéral `:body="[…]"`
 * fabrique un tableau neuf à chaque rendu de chaque rangée, donc chaque
 * `Explain` re-rendait systématiquement au lieu de court-circuiter sur props
 * identiques — multiplié par ~150 messages affichés.
 */
const BODY_DISCRIMINANT = [
  'Les six premiers caractères de la clé publique de cet auteur, en hexadécimal.',
  "Sur Nostr, n'importe qui peut prendre n'importe quel pseudo — seule la clé est unique. Deux comptes du même nom se distinguent ici.",
]
const BODY_ANON = [
  'Ce message est signé par une clé créée pour ce fil seulement : rien ne le relie au compte de son auteur.',
  'Le suffixe est stable ICI — deux messages qui le partagent viennent bien de la même personne. Dans un autre topic, la même personne aura un autre suffixe.',
  "L'anonymat vaut vis-à-vis des lecteurs : le relais, lui, voit la connexion.",
]
const BODY_PENDING = [
  "Le message est signé et affiché ici, mais aucun relais n'a encore accusé réception.",
  "Personne d'autre ne le voit tant que ce marqueur est là.",
]
const BODY_FAILED = [
  "Tous les relais ont refusé ce message : il n'est sur le réseau nulle part.",
  'Le plus souvent, la preuve de travail est trop faible pour eux, ou ils demandent un compte payant.',
]
const BODY_EDIT_PENDING = [
  "Ta correction est signée et affichée ici, mais aucun relais ne l'a encore acceptée.",
  'Les autres lisent encore la version précédente.',
]
const BODY_EDIT_FAILED = [
  'Tous les relais ont refusé ta correction : le message reste dans sa version précédente, ici comme ailleurs.',
  "Le message d'origine, lui, est bien publié — c'est celui que tu lis.",
]

/**
 * `state` n'existe que pour ses propres messages, et il est là parce que la
 * publication ne bloque plus l'interface : le post s'affiche avant d'être accepté
 * par un relais. Sans marqueur, un refus passerait inaperçu — le message
 * resterait à l'écran comme s'il était publié.
 *   - `pending` : signé et affiché, aucun relais n'a encore accusé réception
 *   - `failed`  : tous les relais ont refusé ; il n'est sur le réseau nulle part
 */
const props = defineProps<{
  post: Post
  /** Le message cité, déjà résolu par le fil (voir `QuotedPost`). */
  quoted?: QuotedPost | null
  compact?: boolean
  fresh?: boolean
  /** Cible d'un saut depuis une citation : surligné brièvement. */
  targeted?: boolean
  own?: boolean
  state?: OwnState
  /** L'éditeur de correction est ouvert sur ce message (§2.5). */
  editing?: boolean
  nevent: string
}>()
const emit = defineEmits<{
  reply: [id: string]
  jump: [id: string]
  edit: [id: string]
  editCancel: []
  editSave: [payload: { id: string; content: string; tags: string[][] }]
}>()

const profiles = useProfileStore()
const social = useSocialStore()
const topics = useTopicStore()
const mod = useModerationStore()
const { copied, copy } = useCopy()

/** Encart ouvert sous les actions : signalement, modération, ou historique. */
const panel = ref<'report' | 'moderate' | 'history' | null>(null)

/**
 * Rangée affichée avant que son event existe : le fil montre le message dès le
 * clic sur « Poster », donc pendant un instant il n'a pas encore d'id.
 *
 * Répondre et corriger sont désactivés le temps que ça dure. Les deux écriraient un
 * tag pointant l'id provisoire — un lien vers un event qui n'existera jamais,
 * publié sur un réseau qui ne sait pas effacer. Désactivés et non masqués : la
 * rangée d'actions ne doit pas se réorganiser sous le doigt une demi-seconde
 * après l'envoi.
 */
const unsent = computed(() => isProvisional(props.post.id))

/**
 * Retrait par l'auteur : une correction dont le texte est vide (§2.5). Ce n'est
 * pas une suppression — l'event d'origine est toujours sur les relais, et
 * l'historique le montre. Un message ne peut pas naître vide (le composeur le
 * refuse), donc `editedAt` suffit à distinguer les deux cas.
 */
const retracted = computed(() => !!props.post.editedAt && !props.post.content.trim())

/**
 * Topic verrouillé : les relais refusent tout kind 1111 dessus, corrections
 * comprises (`relay-policy`). Le bouton est donc désactivé plutôt qu'absent —
 * l'action existe, c'est le fil qui est fermé, et le dire vaut mieux que laisser
 * chercher.
 */
const locked = computed(() => mod.isLocked(props.post.topicId))
const flash = ref<string | null>(null)
const revealed = ref(false)

/**
 * Ce qui remplace le message quand la modération est passée par là.
 *
 * Deux causes, un seul traitement : le message lui-même est masqué, ou son
 * auteur est banni. Dans les deux cas la rangée **reste** — numéro, auteur,
 * motif, nom du modérateur. Le §9.2 refuse la censure silencieuse autant que la
 * censure, et un message qui disparaît sans trace est exactement ça.
 */
const veil = computed(() => {
  const hidden = mod.hiddenNotice(props.post.id)
  if (hidden) {
    return {
      title: hidden.revealable ? 'Message masqué par la modération' : 'Message retiré',
      reason: hidden.reason,
      by: hidden.by,
      // Pas de bouton sur la catégorie illégale : ce serait un chemin vers un
      // contenu dont l'opérateur répond (doc modération §5.2).
      revealable: hidden.revealable,
      note: hidden.revealable ? null : 'Ce forum ne le sert plus. Il reste sur le réseau ailleurs.',
    }
  }
  const banned = mod.banNotice(props.post.pubkey)
  if (banned) {
    return {
      title: 'Auteur banni du forum',
      reason: banned.reason,
      by: banned.by,
      revealable: true,
      note: null,
    }
  }
  return null
})

const veiled = computed(() => !!veil.value && !revealed.value)

/** Le rôle de l'auteur, s'il en a un. Une autorité invisible n'existe pas. */
const staffTag = computed(() => {
  const role = mod.roleOf(props.post.pubkey)
  return role ? ROLE_BADGES[role] : null
})

/**
 * Ouvre ou referme l'éditeur, en refermant l'encart ouvert. Deux tiroirs
 * dépliés sous la même rangée — l'historique et la correction, par exemple —
 * poussent le message hors de l'écran juste au moment où on veut le relire.
 */
function toggleEdit(): void {
  if (props.editing) {
    emit('editCancel')
    return
  }
  panel.value = null
  emit('edit', props.post.id)
}

function onModerated(message: string): void {
  flash.value = message
  setTimeout(() => (flash.value = null), 2500)
}

/**
 * Pseudo de l'auteur cité. Quand le parent n'est pas chargé on ne connaît même
 * pas sa clé, donc on le dit au lieu d'afficher un pseudo par défaut qui se
 * confondrait avec un vrai compte.
 */
const quotedName = computed(() =>
  props.quoted?.pubkey ? profiles.displayName(props.quoted.pubkey) : 'auteur inconnu',
)

const quotedText = computed(() =>
  props.quoted?.content
    ? // Les pseudos de l'amorce viennent des profils, comme ceux du fil : sans
      // ça, la même personne s'appellerait `khey_…` dans la citation et « Théo »
      // trois lignes plus bas.
      quotePreview(props.quoted.content, 220, (pubkey) => profiles.displayName(pubkey))
    : '',
)

/**
 * Trois états, trois phrases : on peut sauter, le parent est chargé mais hors du
 * cap DOM, ou il n'est sur aucun de nos relais. Le dernier cas n'est pas une
 * panne — c'est la conséquence normale d'un réseau où personne ne détient tout.
 */
const quoteTitle = computed(() => {
  const q = props.quoted
  // Inatteignable : le bloc est sous `v-if="quoted"`. Mais le type doit rester
  // `string` et non `string | undefined`, sinon le `Hint` qui l'enveloppe refuse.
  if (!q) return ''
  if (!q.content) {
    return `le message cité (${shortId(q.id, 10)}) n'est sur aucun des relais interrogés : il existe peut-être ailleurs sur le réseau`
  }
  if (!q.index) return `message de ${quotedName.value}, plus haut que ce que ce fil garde affiché`
  return `aller au message nº ${q.index} de ${quotedName.value}`
})

const npub = computed(() => npubFor(props.post.pubkey))
const nip05 = computed(() => profiles.get(props.post.pubkey)?.nip05 ?? null)
const signature = computed(() => profiles.get(props.post.pubkey)?.signature ?? null)
const nip05Status = computed(() => profiles.nip05StatusOf(props.post.pubkey))

/**
 * Marqueurs en texte, pas en pictogrammes : « ✓ » et « ✗ » se ressemblent en
 * 10 px et n'ont aucun sens sans légende. Un mot en petites capitales se lit,
 * se traduit, et passe au lecteur d'écran.
 */
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
  switch (nip05Status.value) {
    case 'valid':
      return [
        `Le domaine ${nip05.value} reconnaît cette clé sous ce nom.`,
        'Vérifié par ce navigateur à l\'instant, pas un badge accordé par le forum.',
      ]
    case 'invalid':
      return [
        `Le domaine ${nip05.value} ne reconnaît PAS cette clé.`,
        'Quelqu\'un affiche une adresse qui ne lui appartient pas. Usurpation probable.',
      ]
    case 'unreachable':
      return [
        `Le domaine ${nip05.value} n'a pas répondu.`,
        'Ça ne prouve rien, ni dans un sens ni dans l\'autre : le domaine peut être hors service ou refuser les requêtes du navigateur.',
      ]
    default:
      return [`Vérification de ${nip05.value} en cours.`]
  }
})

const trust = computed(() => social.trustOf(props.post.pubkey))
const trustTag = computed(() => {
  switch (trust.value) {
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
        body: [
          `Suivie par ${social.networkCount(props.post.pubkey)} personne(s) que tu suis.`,
          'Tu ne la suis pas toi-même.',
        ],
      }
    case 'muted':
      return {
        label: 'bloqué',
        cls: 'tag--warn',
        body: [
          'Tu as bloqué cette clé.',
          'Son message reste lisible : le forum replie, il ne masque rien en silence.',
        ],
      }
    default:
      // `unknown` et `self` : rien, pour ne pas bruiter le fil
      return null
  }
})

/**
 * Analyse **paresseuse** : seulement si un balisage est présent. Les messages de
 * forum sont majoritairement du texte nu, et faire tourner un parseur par
 * message sur un fil de 150 rangées se sentirait.
 *
 * Les URLs d'image SONT rendues comme des images (§8 relu) : sur un forum, un
 * lien nu à la place d'une image est une régression d'usage, pas une protection.
 * Ce que le §8 refuse — livrer l'IP du lecteur à un hébergeur tiers du seul fait
 * de lire — est traité par le proxy `/api/img`, pas en s'interdisant l'image.
 */
const rich = computed(() => (hasMarkup(props.post.content) ? parseRichText(props.post.content) : null))

/**
 * Les versions, prêtes à rendre. Calculé seulement quand l'encart est ouvert :
 * analyser chaque version de chaque message corrigé d'un fil de 150 rangées se
 * paierait à chaque rendu, pour un panneau que presque personne n'ouvre.
 */
const versions = computed(() => {
  if (panel.value !== 'history') return []
  const all = props.post.versions ?? []
  return all.map((v, i) => ({
    id: v.id,
    createdAt: v.created_at,
    text: v.content,
    empty: !v.content.trim(),
    rich: hasMarkup(v.content) ? parseRichText(v.content) : null,
    first: i === 0,
    last: i === all.length - 1,
  }))
})

/**
 * Dimensions des images de CE message, pour que `RichInline` réserve leur place.
 * Fourni plutôt que passé en prop : `RichText` est récursif (citations), et
 * traverser une donnée d'affichage sur toute la profondeur n'apprend rien à
 * personne au passage.
 */
provide(
  'postImeta',
  computed(() => props.post.imeta ?? {}),
)

/**
 * Le lien copié est l'URL du forum (slug + id du topic, ancre du message), pas
 * l'`nevent` de la spec §4 — qui arrive en prop et n'est pas encore exposé. Le
 * titre est résolu au clic : à 150 rangées, seule la rangée cliquée en a besoin.
 */
function copyPermalink(): void {
  const root = topics.rootById(props.post.topicId)
  const path = topicPath(props.post.topicId, root ? topicTitle(root) : null)
  void copy(`${window.location.origin}${path}#msg-${props.post.id}`)
}
</script>

<style scoped>
/*
 * Le fil est une suite de posts numérotés dans un registre, pas une
 * conversation en bulles : chaque message reste une rangée distincte, jamais
 * fusionnée avec la suivante, avec son nº et son bouton « répondre » permanents.
 *
 * Ce qui change, c'est l'anatomie : la barre d'auteur grise à filet, la colonne
 * d'avatar de 42 px et les quatre bordures ont disparu. Le message est une
 * grille — liseré, avatar, barre, corps — sur une surface unie, séparée de la
 * suivante par un seul filet très pâle. À 150 rangées, c'est la différence
 * entre un registre et un mur de cadres.
 */
.msg {
  display: grid;
  grid-template-columns: 3px 30px 1fr;
  grid-template-areas:
    'rail av bar'
    'rail .  body';
  column-gap: 11px;
  row-gap: 2px;
  padding: 9px 16px 9px 11px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  box-shadow: var(--elev-1);
  /* Le navigateur saute layout et paint des rangées hors écran : c'est ce qui
     rend les ~150 rangées du cap gratuites au scroll, sans virtualisation
     (§6.2). `auto` en taille : l'estimation initiale est remplacée par la
     hauteur réellement mesurée dès qu'une rangée a été rendue une fois, donc
     les corrections de scrollTop du fil restent justes en revenant dessus. */
  content-visibility: auto;
  contain-intrinsic-size: auto 90px;
}

/* Liseré de statut. Transparent par défaut : la grande majorité des messages
   n'a rien de particulier à signaler, et une colonne de traits gris à gauche du
   fil serait exactement le bruit qu'on vient de retirer. */
.msg__rail {
  grid-area: rail;
  align-self: stretch;
  border-radius: 999px;
  background: transparent;
}

.msg__aside {
  grid-area: av;
  align-self: start;
  padding-top: 1px;
}

.msg__bar {
  grid-area: bar;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: var(--fs-sm);
}
.msg__bar-spacer {
  flex: 1;
  min-width: 8px;
}

/* Le pseudo est bleu : l'identité est du même ordre que « où tu es » — c'est un
   lien vers quelqu'un, et c'est le seul lien de la barre. */
.msg__author {
  font-weight: 700;
  font-size: var(--fs-base);
  letter-spacing: -0.01em;
  color: var(--link);
  text-decoration: none !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 22ch;
}
.msg__author:hover {
  color: var(--link-hover);
  text-decoration: underline !important;
  text-underline-offset: 2px;
}
/* La vignette d'un masque est rendue par `UserAvatar`, qui porte seul la règle
   « photo, identicon ou losange ». */
.msg__author--anon {
  color: var(--ink-3);
  cursor: help;
  /* Pas de `max-width` en ch comme le pseudo d'un compte : ce nom est calibré
     (« Anonyme·a3f81b »), il ne peut pas déborder. */
  max-width: none;
}
.msg--anon .msg__rail {
  background: color-mix(in srgb, var(--ink-4) 45%, transparent);
}

.msg__disc {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
  flex-shrink: 0;
}

.msg__time {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
  white-space: nowrap;
}

/* Le nº de post est le permalien : c'est l'objet le plus cliqué de la barre.
   Puce discrète au repos qui s'allume à l'orange au survol — c'est une action,
   et l'orange est la couleur des actions. */
.msg__seq {
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 2px 7px;
  border-radius: var(--r-pastille);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--ink-3);
  transition: background 0.13s ease, color 0.13s ease;
}
.msg__seq:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--ink);
}

/*
 * Rangée posée avant que son event existe : ses actions sont neutralisées le
 * temps qu'il ait un id, mais elles ne doivent RIEN montrer. Les griser puis les
 * rallumer une demi-seconde plus tard ferait clignoter la rangée que l'auteur
 * vient de créer — exactement ce que l'affichage immédiat cherchait à éviter.
 */
.msg--unsent .msg__act:disabled,
.msg--unsent .msg__seq:disabled {
  opacity: 1;
  cursor: default;
}

/* « modifié » : le poids d'une mention, pas d'un badge. Il vit à côté de l'heure
   parce qu'il en dit long sur la même chose — quand ce texte a pris sa forme
   actuelle. Un `tag` coloré ici ferait passer une correction de faute pour un
   incident. */
.msg__edited {
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 2px 6px;
  border-radius: var(--r-pastille);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  transition: background 0.13s ease, color 0.13s ease;
}
.msg__edited:hover,
.msg__edited--on {
  background: var(--surface-3);
  color: var(--ink-2);
}

/* --------------------------------------------------------------------- corps */
.msg__body {
  grid-area: body;
  min-width: 0;
}
/* Le corps d'un message est le seul texte de l'écran qu'on LIT, par opposition à
   tout ce qu'on balaye : il a droit à un cran de plus que le châssis, et au même
   corps que ce qu'on tape dans le composeur — on lisait à 14/1,5 ce qu'on
   écrivait à 15/1,6, ce qui est l'inverse de l'ordre des priorités. */
.msg__content {
  min-width: 0;
  font-size: var(--fs-lg);
  line-height: 1.62;
}

/* ------------------------------------------------------------- citation --- */
/*
 * Citation en tête de réponse. Filet à gauche et fond très légèrement teinté,
 * comme `.rt-quote` du texte enrichi : les deux sont la même chose pour le
 * lecteur (du texte de quelqu'un d'autre), donc elles se ressemblent.
 *
 * C'est un bouton, mais il ne ressemble pas à un bouton : bordure gauche seule,
 * pas de cadre. La rangée « répondre | signaler » plus bas a écarté les cadres pour
 * la même raison — répétés sur un fil long, ils écrasent le contenu.
 */
.msg__quote {
  display: block;
  width: 100%;
  margin: 0 0 8px;
  padding: 7px 11px;
  border: none;
  border-left: 2px solid var(--line-strong);
  border-radius: 0 var(--r-pastille) var(--r-pastille) 0;
  background: var(--surface-sunken);
  font-family: inherit;
  text-align: left;
  color: var(--ink-3);
}
.msg__quote--jump {
  cursor: pointer;
  transition: background 0.13s ease, border-color 0.13s ease;
}
.msg__quote--jump:hover {
  background: var(--surface-3);
  border-left-color: var(--link);
}

.msg__quote-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
  font-size: var(--fs-xs);
}
.msg__quote-who {
  font-weight: 700;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg__quote-verb {
  color: var(--ink-4);
}
/* Le numéro reste collé à « a écrit » et n'est PAS poussé à droite : sur un fil
   large, un `margin-left: auto` l'envoyait à 700 px du pseudo, où il n'appartenait
   plus à la phrase qu'il complète. Groupé à gauche, « khey_bob a écrit #2 » se lit
   d'un trait. */
.msg__quote-seq {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-3);
}

/* Encore plus effacé que le numéro : c'est une réserve sur ce qu'on lit, pas une
   alerte. Le lecteur doit pouvoir l'ignorer et continuer sa phrase. */
.msg__quote-edited {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
  font-style: italic;
}

/* Deux lignes maximum : une citation est une amorce. Au-delà, elle ferait
   concurrence à la réponse — et sur les fils où tout le monde cite, la page ne
   serait plus qu'un empilement de citations. */
.msg__quote-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  font-size: var(--fs-md);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.msg__quote-text--dead {
  font-style: italic;
  color: var(--ink-4);
}
/* Parent absent : le filet perd sa couleur d'encre. Rien d'ambre ici — ce n'est
   pas une alerte, c'est une propriété du réseau. */
.msg__quote--dead {
  border-left-color: var(--line);
}

/* En ambiance (> ~4 msg/s), la citation tombe à une ligne : la densité est le
   but du mode, mais supprimer le contexte rendrait le fil illisible. */
.msg--compact .msg__quote {
  margin-bottom: 3px;
  padding-top: 2px;
  padding-bottom: 2px;
}
.msg--compact .msg__quote-text {
  -webkit-line-clamp: 1;
  line-clamp: 1;
}

.msg__text {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: 1.6;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Le chemin enrichi délègue le blanc à ses blocs : `.rt-p` porte son propre
   `pre-wrap`. Garder `pre-wrap` sur le conteneur ferait remonter l'indentation
   du template comme blanc visible entre les blocs. */
.msg__text--rich {
  white-space: normal;
}

/* ------------------------------------------------------------ signature ---
 * Anatomie phpBB : un filet en travers de la colonne, puis le texte en plus
 * petit et plus clair. Le filet est ce qui empêche de la lire comme la dernière
 * phrase du message — sans lui, elle se confond avec le contenu signé.
 *
 * Filet en `--line-soft` et non `--line` : il ne doit pas peser autant que les
 * bordures de panneau, sinon 150 messages font 150 traits durs.
 *
 * Deux lignes maximum. La borne à 150 caractères du store suffit en prose, donc
 * ce clamp n'attrape en pratique qu'un empilement de retours à la ligne — la
 * seule façon qui reste de se faire un pied de message de dix lignes de haut.
 */
/* Retrait par l'auteur : de l'encre morte à la place du texte, pas un panneau.
   La rangée garde son auteur, son heure et son numéro — c'est tout l'intérêt de
   ne pas la supprimer. */
.msg__retracted {
  margin: 0;
  font-size: var(--fs-base);
  font-style: italic;
  color: var(--ink-4);
}

/* Historique : le tiroir de `PostModeration`, même gabarit. Un fond creusé dans
   le message, pas une carte à côté — ce sont les versions de CE message. */
.msg__history {
  margin: 8px 0 0;
  padding: 11px 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-control);
}
.msg__history-lead {
  margin: 0 0 9px;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--ink-2);
}
.msg__history-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
/* Filet à gauche plutôt que cartes empilées : les versions sont une même chose
   qui a bougé, pas une liste d'objets distincts. */
.msg__history-item {
  padding-left: 10px;
  border-left: 2px solid var(--line);
}
.msg__history-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 3px;
}
.msg__history-when {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
}
.msg__history-text {
  margin: 0;
  font-size: var(--fs-md);
  line-height: 1.5;
  color: var(--ink-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.msg__history-text--empty {
  font-style: italic;
  color: var(--ink-4);
}
/* Le rendu enrichi porte ses propres blancs (`.rt-p`, `.rt-list`) : pas de
   `white-space: pre-wrap` ici, il doublerait les sauts de ligne des blocs. */
.msg__history-rich {
  font-size: var(--fs-md);
  line-height: 1.5;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}
.msg__history-note {
  margin: 10px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink-4);
}

.msg__sig {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  position: relative;
  margin: 8px 0 0;
  padding-top: 8px;
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--ink-4);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* Le filet ne traverse plus la colonne : à 880 px de large, un trait plein sous
   chaque message faisait une seconde grille par-dessus celle des rangées. Une
   amorce de 34 px suffit à dire « ce qui suit n'est pas couvert par la
   signature ». D'où le pseudo-élément : le texte garde sa largeur, le trait
   reste court. */
.msg__sig::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 34px;
  height: 1px;
  background: var(--line-strong);
}

/* Actions permanentes, alignées à droite comme au pied d'un bloc message. */
/*
 * Rangée d'actions en liens texte séparés d'un filet, pas en boutons encadrés.
 * Deux raisons : c'est la convention des forums, qui alignent « signaler |
 * bloquer | citer » en liens sous le message, et sur un fil de 150 messages
 * douze boîtes grises répétées faisaient un mur de bruit qui écrasait le
 * contenu.
 *
 * Permanentes, jamais au survol : voir §7.3, le survol n'est pas un code de
 * forum.
 */
/* Les actions ne sont plus des liens séparés d'un filet mais des puces
   fantômes : le filet vertical entre deux mots gris était un reste de barre
   d'outils, et il pesait autant que le texte qu'il séparait. */
.msg__actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 2px;
  /* Marge négative à droite : la puce de survol déborde dans le padding du
     message, ce qui aligne le TEXTE des actions sur le bord du contenu plutôt
     que sur le bord de sa zone cliquable. */
  margin: 0 -7px -3px 0;
}
.msg__act {
  background: none;
  border: none;
  padding: 3px 7px;
  border-radius: var(--r-pastille);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-4);
  transition: color 0.13s ease, background 0.13s ease;
}
.msg__act:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--ink);
}
.msg__act:disabled {
  opacity: 0.45;
  cursor: default;
}
.msg__act--on {
  color: var(--ok);
}
/* L'action de modération se distingue sans crier : elle n'apparaît que pour le
   staff, donc elle n'a pas à se battre pour l'attention — elle doit juste ne pas
   se confondre avec « répondre » au moment de viser. */
.msg__act--staff {
  color: var(--link);
}

/* Confirmation d'un geste, à sa place : au bout de la rangée d'actions plutôt
   qu'en superposition — un toast flottant sur un fil qui défile se perd. */
.msg__flash {
  margin-right: auto;
  font-size: var(--fs-sm);
  color: var(--ok);
}

/* ------------------------------------------------------------------ repli ---
 * Un message masqué garde sa rangée : le §9.2 refuse la censure silencieuse
 * autant que la censure. Ce bloc dit ce qui a été décidé, par qui, et rend la
 * main au lecteur — sauf pour la catégorie illégale, qui n'a pas de bouton.
 *
 * Traitement neutre et non alarmant : ni ambre ni cramoisi. Une décision de
 * modération est un fait ordinaire de la vie du forum, pas une erreur ; la
 * peindre en rouge ferait de chaque repli un incident.
 */
.msg__veil {
  padding: 9px 12px;
  background: var(--surface-sunken);
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-control);
}
.msg__veil-head {
  margin: 0;
  font-size: var(--fs-md);
  line-height: 1.5;
}
.msg__veil-title {
  font-weight: 700;
  color: var(--ink-2);
}
/* L'espace avant le tiret vient d'ici et non du gabarit : Vue condense les
   nœuds de texte entre deux balises séparées par un retour à la ligne, et
   « modération— motif » se recollait. */
.msg__veil-reason {
  margin-left: 5px;
  color: var(--ink-3);
}
.msg__veil-note {
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink-4);
}
.msg__veil-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.msg__veil-by {
  font-size: var(--fs-sm);
  color: var(--ink-4);
}

/* ------------------------------------------------------------------- variantes
   Trois canaux, du plus discret au plus fort : le liseré (toujours), la teinte
   de bordure, et l'aplat (réservé à la racine). Racine en orange — c'est le
   topic lui-même, la seule carte du fil qui ne soit pas une réponse. Le sien
   en bleu : « toi », comme partout ailleurs. */
.msg--root .msg__rail {
  background: var(--brand);
}
.msg--root {
  background: var(--brand-soft);
  border-color: color-mix(in srgb, var(--brand) 22%, transparent);
}
.msg--own .msg__rail {
  background: var(--link);
}
.msg--own {
  border-color: color-mix(in srgb, var(--link) 22%, transparent);
}

/*
 * États de publication. Depuis que la publication ne bloque plus l'interface, le
 * message s'affiche avant qu'un relais l'ait accepté : les deux issues doivent
 * se voir sans infobulle.
 *
 * L'étiquette en clair (« envoi… », « non publié ») est rendue dans le template
 * avec les classes `tag` / `tag--warn` ; ici on ne porte que le traitement du
 * bloc, accordé à la couleur de cette étiquette.
 *   - `pending` : simplement atténué. Rien n'est perdu, donc rien n'alarme.
 *   - `failed`  : bordure gauche et barre ambre. Le message n'est nulle part sur
 *     le réseau, et ça ne doit pas pouvoir se confondre avec un post publié.
 */
.msg--pending {
  opacity: 0.55;
}

.msg--failed .msg__rail {
  background: var(--warn);
}
.msg--failed {
  background: var(--warn-soft);
  border-color: color-mix(in srgb, var(--warn) 26%, transparent);
}

.msg--fresh {
  animation: msg-in 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes msg-in {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
}

/* Cible d'un saut depuis une citation. Un `box-shadow` interne et non un
   `background` : la rangée peut déjà porter le sien (`--own`, `--root`), et le
   surlignage n'a pas à connaître lequel pour se poser dessus.
   Bleu et non orange : arriver au bon message est un fait de navigation.
   Coupé sous `prefers-reduced-motion` (main.css). */
.msg--targeted {
  animation: msg-target 1.6s ease-out;
}
/* L'ombre de carte est reprise dans les deux images-clés : sans elle,
   l'animation la remplacerait et la carte s'aplatirait le temps du surlignage. */
@keyframes msg-target {
  from {
    box-shadow: inset 0 0 0 2px var(--link), var(--elev-1);
  }
  to {
    box-shadow: inset 0 0 0 2px transparent, var(--elev-1);
  }
}

/* Mode ambiance (> ~4 msg/s) : plus personne ne lit, on passe en rangée simple.
   Une seule ligne, pas d'avatar, pas d'actions. La grille laisse la place au
   flex — il n'y a plus de colonnes à tenir. */
.msg--compact {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 3px 14px;
  background: var(--surface);
  border: none;
  border-bottom: 1px solid var(--line-soft);
  border-radius: 0;
  box-shadow: none;
}
.msg--compact .msg__rail {
  display: none;
}
.msg--compact .msg__bar {
  flex: 0 1 auto;
  max-width: 46%;
}
.msg--compact .msg__author {
  font-size: var(--fs-md);
}
.msg--compact .msg__bar-spacer,
.msg--compact .msg__time {
  display: none;
}
.msg--compact .msg__body {
  flex: 1;
  min-width: 0;
}
.msg--compact .msg__text {
  font-size: var(--fs-md);
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 640px) {
  .msg {
    column-gap: 9px;
    padding: 12px 14px 13px 10px;
  }
  .msg__author {
    max-width: 14ch;
  }
  /*
   * La barre d'auteur passe sur deux lignes.
   *
   * « Le 15 août 2026 à 22:19:26 » fait 158 px et ne se coupe pas — c'est
   * voulu : dans un registre où rien ne s'efface, l'heure exacte EST
   * l'information, elle ne se résume pas en « il y a 3 j ». Mais pseudo +
   * heure + nº demandent 440 px, et sur un téléphone la rangée débordait de sa
   * carte : le fil devenait défilable latéralement et les messages étaient
   * coupés à droite.
   *
   * L'espaceur porte déjà `flex: 1` : il suffit de l'autoriser à passer à la
   * ligne pour que le pseudo garde la première et que l'heure et le nº se
   * posent sous lui, toujours calés à droite. Rien n'est retiré, rien n'est
   * abrégé.
   */
  .msg__bar {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  /* L'espaceur cède la place à une marge automatique portée par l'heure : il
     tiendrait la première ligne et l'heure repassée dessous serait calée à
     GAUCHE. Avec la marge, le groupe reste à droite qu'il ait replié ou non —
     donc la rangée ne se coupe en deux que quand elle en a besoin. */
  .msg__bar-spacer {
    display: none;
  }
  .msg__time {
    margin-left: auto;
  }
}

/* Au doigt : « répondre », « signaler » et leurs voisines sont côte à côte à
   2 px d'écart et hautes de 21 px — on en visait une et on en touchait une autre.
   La hauteur de la puce et l'écart augmentent ; le texte, lui, ne bouge pas,
   donc le mur de bruit que ces actions devaient éviter ne revient pas. */
@media (pointer: coarse) {
  .msg__actions {
    gap: 4px;
  }
  .msg__act {
    min-height: 32px;
    padding: 3px 10px;
  }
}
</style>
