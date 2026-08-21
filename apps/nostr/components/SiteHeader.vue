<template>
  <div class="chrome">
    <header class="topbar">
      <NuxtLink to="/" class="topbar__brand" @click="goThreads">
        <!-- Le nom est un seul mot : c'est le point, et non une syllabe coupée, qui
             porte l'accent de marque. -->
        <span class="topbar__brand-a">Forome</span><span class="topbar__brand-b">.</span>
      </NuxtLink>

      <!-- Deux entrées, et ce sont deux LIEUX. Les notifications n'en sont pas
           un — on ne les lit pas, on les dispatche — donc elles vivent dans un
           panneau ancré à droite et non dans cette nav. Le test de débit n'est
           pas un lieu non plus : c'est un outil, sous `?dev=1`. -->
      <nav class="topbar__nav" aria-label="sections">
        <button type="button" class="navlink" :class="{ 'navlink--on': onForum }" @click="goThreads">
          Forum
        </button>
        <NuxtLink to="/dm" class="navlink" :class="{ 'navlink--on': route.path === '/dm' }">
          MP<span v-if="dms.unreadCount" class="navlink__badge mono">{{ dms.unreadCount }}</span>
        </NuxtLink>
      </nav>

      <div class="topbar__right">
        <!-- Un rapport, pas un compte : « 4 relais » cachait combien on en
             visait. Sur un client décentralisé, le dénominateur est ce qui
             explique une liste à moitié vide ou un message refusé. -->
        <Explain term="relais" :body="relaysBody" :items="relaysList" placement="bottom">
          <span
            class="relays"
            :class="{
              'relays--off': !relays.connected,
              'relays--dev': relays.overridden,
              'relays--degraded': relaysDegraded,
            }"
          >
            <span class="relays__dot" />
            <span class="relays__label mono">{{ relaysLabel }}</span>
          </span>
        </Explain>

        <NotifBell />

        <Hint
          :text="theme.isDark.value ? 'passer en thème clair' : 'passer en thème sombre'"
          placement="bottom"
        >
          <!-- L'icône montre la DESTINATION, pas l'état courant — comme le faisait
               le libellé qu'elle remplace, et comme le dit la bulle au survol.
               Le nom accessible est posé par `Hint` : ne pas ajouter d'aria-label
               ici, il figerait le nom sur la première valeur. -->
          <button type="button" class="topbar__theme" @click="theme.toggle()">
            <svg
              v-if="theme.isDark.value"
              class="topbar__theme-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4.4" />
              <path
                d="M12 2.6v1.9M12 19.5v1.9M2.6 12h1.9M19.5 12h1.9M4.36 4.36l1.34 1.34M18.3 18.3l1.34 1.34M4.36 19.64l1.34-1.34M18.3 5.7l1.34-1.34"
              />
            </svg>
            <svg
              v-else
              class="topbar__theme-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20.7 13.1A8.4 8.4 0 1 1 10.9 3.3a6.6 6.6 0 0 0 9.8 9.8Z" />
            </svg>
          </button>
        </Hint>

        <!-- REPLI, pas doublon : le vrai bouton est le primaire orange en tête de
             la colonne de topics. Celui-ci ne paraît que quand cette colonne
             n'est pas à l'écran (voir les deux modificateurs). -->
        <NuxtLink
          to="/new"
          class="topbar__new"
          :class="{ 'topbar__new--off': listAlwaysUp, 'topbar__new--off-wide': listUpWhenWide }"
        >
          Nouveau topic
        </NuxtLink>

        <UserMenu />
      </div>
    </header>

    <!-- Absente sur le forum : le fil d'Ariane y pointerait sur la page courante et
         répéterait l'onglet actif. Sur `/new` et les profils il est le seul repère de
         position, puisqu'aucun onglet ne s'y allume. -->
    <div v-if="showForumbar" class="forumbar">
      <nav v-if="!onForum && crumbHere" class="crumbs" aria-label="fil d'Ariane">
        <NuxtLink to="/" class="crumbs__link" @click="goThreads">Forum</NuxtLink>
        <span class="crumbs__sep" aria-hidden="true">›</span>
        <span class="crumbs__here">{{ crumbHere }}</span>
      </nav>

      <!-- Instrumentation réservée à `?dev=1` : un banc d'essai de débit et trois
           compteurs qui parlent de ce que CET onglet a reçu. Le lecteur n'a rien
           à en faire, le développeur en a besoin — donc caché, pas retiré. -->
      <div v-if="devTools" class="forumbar__stats">
        <Hint
          :text="
            topics.mode === 'firehose'
              ? 'revenir aux vrais topics (kind 11)'
              : 'affiche le flux global kind 1 pour vérifier que le fil tient à plusieurs messages par seconde — on n\'y publie pas'
          "
          placement="bottom"
        >
          <button
            type="button"
            class="forumbar__mode mono"
            :class="{ 'forumbar__mode--on': topics.mode === 'firehose' }"
            @click="toggleFirehose"
          >
            test de débit
          </button>
        </Hint>
        <span class="forumbar__stat mono">{{ topics.rows.length }} topics</span>
        <span class="forumbar__stat mono">{{ relays.eventsSeen }} events</span>
        <!-- Qui décide de l'ordre de l'écran principal ? La réponse est visible :
             le tick de l'indexeur est signé, donc attribuable (spec §5.4). -->
        <Explain
          term="tri"
          placement="bottom"
          :body="
            topics.rankingSource === 'indexer'
              ? [
                  `Classement fourni par l'indexeur ${topics.indexerPubkey?.slice(0, 8)}, et signé — donc attribuable.`,
                  'Il ne peut rien retenir ni falsifier, seulement ordonner.',
                ]
              : [
                  'Classement calculé ici, sur ce que cet onglet a vu passer depuis son ouverture.',
                  'La vue est donc partielle, faute d\'indexeur épinglé.',
                ]
          "
        >
          <span
            class="forumbar__stat mono"
            :class="topics.rankingSource === 'indexer' ? 'forumbar__stat--signed' : ''"
            >tri : {{ topics.rankingSource === 'indexer' ? 'indexeur' : 'local' }}</span
          >
        </Explain>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Chrome global. Les deux entrées de navigation sont deux lieux réels (le forum
 * et la boîte de MP) : pas de lien mort décoratif pour remplir la barre, et
 * aucun outil technique déguisé en section.
 */
import { computed } from 'vue'
import { FIREHOSE_TOPIC_ID } from '~/types/nostr'
import { topicPath } from '~/utils/permalink'

const relays = useRelayStore()
const topics = useTopicStore()
const dms = useDmStore()
const theme = useTheme()
const devTools = useDevTools()
const route = useRoute()
const router = useRouter()

const onForum = computed(() => route.path === '/' || route.path.startsWith('/t/'))

/**
 * Où vit « Nouveau topic ». Il y en avait deux à l'écran en permanence : le
 * primaire orange en tête de la colonne de topics, et un repli dans la barre.
 * Le repli est nécessaire — la colonne n'est pas rendue sur les MP ni sur les
 * profils, et `ForumShell` la masque sous 820 px dès qu'un topic ou le
 * formulaire occupe la place — mais il n'avait jamais été conditionné, donc il
 * doublait le vrai bouton partout ailleurs.
 *
 * Deux drapeaux et pas un seul, parce que la colonne ne disparaît pas aux mêmes
 * conditions selon la route :
 *   - sur `/`, elle est là à TOUTE largeur → le repli ne sert jamais
 *   - sur `/t/:id` et `/new`, elle tombe sous 820 px → le repli sert en dessous
 *   - ailleurs, elle n'existe pas → le repli est le seul accès
 */
const listAlwaysUp = computed(() => route.path === '/')
const listUpWhenWide = computed(() => route.path.startsWith('/t/') || route.path === '/new')

/**
 * La barre n'existe que si elle a quelque chose à porter : un fil d'Ariane qui
 * situe (hors forum) ou la rangée d'outils de dev. Sur le forum sans `?dev=1`
 * elle serait une bande de 36 px vide avec sa bordure et son ombre.
 */
const showForumbar = computed(() => (!onForum.value && crumbHere.value !== null) || devTools.value)

/**
 * L'état des relais se dit en rapport : combien répondent sur combien on
 * interroge. Le compte seul laissait croire à une connexion complète alors
 * qu'un relais mort avale silencieusement les publications.
 *
 * Sauf en local, où le rapport ne dit rien : « 1/1 relais » est vrai et vide,
 * alors que la seule chose qui compte est que rien ne sort de la machine.
 */
const relaysLabel = computed(() => {
  if (!relays.connected) return 'hors-ligne'
  if (relays.localOnly) return 'local'
  return `${relays.connectedCount}/${relays.relays.length} relais`
})

/**
 * Deux canaux distincts, un sens chacun, parce qu'une couleur qui porte deux
 * significations ne se lit plus :
 *   - le point : sommes-nous connectés du tout (vert, gris, ambre si surcharge)
 *   - le texte du rapport : est-il complet (encre, ambre si un relais a échoué)
 *
 * L'ambre du texte est déclenchée par `deadCount`, pas par le rapport lui-même :
 * au démarrage il passe par 0/5 puis 2/5 le temps que les connexions
 * s'établissent, et ça ne doit rien signaler.
 */
const relaysDegraded = computed(() => relays.deadCount > 0)

/**
 * Prose d'abord, URL brutes ensuite : le `title` aplatissait les deux.
 *
 * L'ordre des phrases est le sujet même de ce bloc. Il disait « N relais sur M
 * répondent », c'est-à-dire l'état d'une plomberie ; la question du lecteur est
 * « où va ce que j'écris, et qui peut l'effacer ». On répond donc dans cet
 * ordre : où l'on est, ce que la publication engage, puis seulement l'état des
 * connexions.
 *
 * Ce n'est plus cosmétique depuis que lire et écrire ne visent plus les mêmes
 * relais (`utils/relayTargets.ts`) : le rapport de connexion décrit la lecture,
 * alors que « personne ne peut l'effacer partout » est une propriété de
 * l'écriture. Afficher le premier en laissant croire qu'il dit le second est
 * précisément ce qui a permis de publier sur le réseau public sans le voir.
 */
const relaysBody = computed(() => {
  const lines: string[] = []
  const writes = relays.writeList.length

  if (relays.localOnly) {
    lines.push('Bac à sable : tu parles à un relais sur cette machine.')
    lines.push('Rien de ce que tu publies ne part sur le réseau, et tout disparaît si tu l’arrêtes.')
  } else {
    if (relays.overridden) lines.push('Relais choisi à la main (surcharge ?relays=).')
    lines.push(
      writes > 1
        ? `Ce que tu publies part vers ${writes} relais indépendants : personne ne peut l’effacer partout.`
        : 'Ce que tu publies part vers un seul relais — s’il ferme, ton message n’est plus servi nulle part.',
    )
  }

  // L'autorisation d'écrire sur le réseau ne s'obtient qu'en la demandant, et
  // elle expire seule : le dire ici est ce qui rend la session lisible d'un
  // coup d'œil, plutôt qu'au moment où c'est déjà parti.
  if (relays.publicWriteAllowed && !relays.localOnly) {
    lines.push('Écriture sur le réseau public autorisée pour cette session (?public=1).')
  }

  if (!relays.connected) lines.push('Aucun relais ne répond : la liste est vide parce qu’on ne joint rien.')
  else if (relaysDegraded.value) {
    lines.push(
      `${relays.deadCount} injoignable${relays.deadCount > 1 ? 's' : ''} : ce qui y est publié n'y arrive pas, et ce qui y vit ne se voit pas ici.`,
    )
  }
  return lines
})

const relaysList = computed(() => {
  // Le suffixe est en mots et non en pictogramme : un « ✕ » en tête de ligne
  // demande d'être décodé et ne se lit pas au lecteur d'écran, alors que
  // « (injoignable) » se lit tel quel.
  const dead = new Set(relays.deadRelays)
  const read = new Set(relays.relays)
  const write = new Set(relays.writeList)
  // Le rôle n'est annoté que lorsque les deux ensembles diffèrent : quand ils
  // coïncident, répéter « lecture et écriture » sur chaque ligne est du bruit.
  const split = [...write].some((url) => !read.has(url)) || [...read].some((url) => !write.has(url))

  return [...new Set([...read, ...write])].map((url) => {
    const notes: string[] = []
    if (split) notes.push(read.has(url) ? (write.has(url) ? 'lecture et écriture' : 'lecture') : 'écriture')
    if (dead.has(url)) notes.push('injoignable')
    return notes.length > 0 ? `${url} (${notes.join(', ')})` : url
  })
})

// `null` plutôt qu'un repli : une route sans branche ici n'a pas de nom à
// afficher, et en inventer un donnerait un fil d'Ariane faux plutôt qu'absent.
const crumbHere = computed<string | null>(() => {
  if (route.path === '/dm') return 'Messages privés'
  if (route.path === '/new') return 'Nouveau topic'
  if (route.path === '/appareils') return 'Mes appareils'
  if (route.path === '/comment-ca-marche') return 'Comment ça marche'
  if (route.path === '/profil/editer') return 'Modifier mon profil'
  if (route.path.startsWith('/profil/')) return 'Profil'
  return null
})

/** La query est préservée : sans ça `?relays=` et `?indexer=` disparaissent. */
function goHome(): void {
  if (route.path !== '/') void router.push({ path: '/', query: route.query })
}

function goThreads(): void {
  topics.setMode('threads')
  goHome()
}

function toggleFirehose(): void {
  if (topics.mode === 'firehose') {
    goThreads()
    return
  }
  topics.setMode('firehose')
  // Le flux global n'est pas un topic de la liste : on l'ouvre directement.
  void router.push({ path: topicPath(FIREHOSE_TOPIC_ID), query: route.query })
}
</script>

<style scoped>
.chrome {
  flex-shrink: 0;
  position: relative;
  z-index: 30;
}

/* ------------------------------------------------------------------- topbar
   Plus de barre noire pleine largeur : le chrome est posé À MÊME LE CANEVAS,
   sans fond ni bordure. Ce sont les panneaux qui flottent en dessous, et la
   tête de page n'a donc rien à délimiter — l'espace le fait. */
.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: var(--topbar-h);
  /* `viewport-fit=cover` est posé dans `nuxt.config.ts` : sans ces marges, le
     wordmark passe sous l'encoche dès qu'un téléphone est tenu en paysage. */
  padding: 0 calc(var(--gutter) + 6px + env(safe-area-inset-right, 0px)) 0
    calc(var(--gutter) + 6px + env(safe-area-inset-left, 0px));
}

/* Le nom est un seul mot : le point, et non une syllabe coupée, porte l'accent.
   C'est le seul endroit de la barre où Bricolage sort, et il y est serré à
   -0.045em — le wordmark est un dessin, pas une ligne de texte. */
.topbar__brand {
  display: flex;
  align-items: baseline;
  flex-shrink: 0;
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 800;
  letter-spacing: -0.045em;
  text-decoration: none !important;
}
.topbar__brand-a {
  color: var(--ink);
}
.topbar__brand-b {
  color: var(--brand);
}

/* Contrôle segmenté : une piste claire posée sur le canevas, un curseur plein
   qui dit où on est. Le bleu et pas l'orange — « où tu es » est un état de
   navigation, pas une chaleur (voir l'en-tête de main.css). */
.topbar__nav {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  /* ⚠️ Surtout pas `min-width: 0` : le segmenté se comprimait alors sous la
     largeur de ses deux pastilles, et « Forum » passait SOUS l'indicateur de
     relais — de 480 px vers le bas, sur toutes les routes qui portent le repli
     « Nouveau topic ». Ce qui doit céder quand la barre est trop courte, c'est
     le nombre d'objets qu'elle porte (plus bas), jamais leur largeur. */
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  box-shadow: var(--elev-1);
}

.navlink {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 15px;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--ink-3);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  text-decoration: none !important;
  transition: color 0.14s ease, background 0.14s ease;
}
.navlink:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.navlink--on,
.navlink--on:hover {
  background: var(--link);
  color: #fff;
}
.navlink__badge {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--brand);
  color: var(--brand-on);
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
/* Sur le curseur bleu plein, la pastille inverse : en orange sur bleu elle
   ferait vibrer deux saturés l'un contre l'autre. */
.navlink--on .navlink__badge {
  background: rgba(255, 255, 255, 0.92);
  color: var(--link);
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

/* État réel des relais : le point porte l'information, pas la décoration. */
.topbar__right :deep(.explain__trigger) {
  color: var(--ink-3);
}
.topbar__right :deep(.explain__trigger[aria-expanded='true']) {
  color: var(--ink);
  text-decoration-color: var(--link);
}

.relays {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px 5px 9px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  box-shadow: var(--elev-1);
}
.relays__dot {
  position: relative;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ok);
  flex-shrink: 0;
  /* Le halo tient lieu de « ça respire » sans animation : sur un client qui
     reste ouvert des heures, un point qui clignote en permanence use. */
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent);
}
.relays__label {
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--ink-3);
  white-space: nowrap;
}
.relays--off .relays__dot {
  background: var(--ink-4);
  box-shadow: none;
}

/* Rapport incomplet : c'est le texte qui passe au cramoisi, pas le point. On EST
   connecté, simplement pas partout. */
.relays--degraded .relays__label {
  color: var(--warn);
}

/* La surcharge `?relays=` est le signal le plus fort des deux : elle change la
   nature de ce qu'on lit, pas seulement sa complétude. Elle prend le point, et
   le texte avec, donc elle passe devant `--degraded` (déclarée après). */
.relays--dev .relays__dot {
  background: var(--warn);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 22%, transparent);
}
.relays--dev .relays__label {
  color: var(--warn);
}

/* Carré parfait : c'est un bouton d'icône, pas un bouton de texte rétréci — un
   padding horizontal le décentrerait dans son propre halo au survol. */
.topbar__theme {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--ink-3);
  transition: background 0.14s ease, color 0.14s ease;
}
.topbar__theme-icon {
  width: 17px;
  height: 17px;
}
.topbar__theme:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.topbar__theme:active {
  transform: translateY(1px);
}

/* Secondaire assumé : quand ce bouton paraît, c'est qu'on n'est pas sur le
   forum (ou qu'il n'y tient plus), et ouvrir un topic n'est alors pas l'action
   pour laquelle on est venu. La prominence suit la pertinence — orange plein
   dans la colonne, discret ici. */
.topbar__new {
  display: inline-flex;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink);
  font-size: var(--fs-md);
  font-weight: 600;
  padding: 6px 14px;
  white-space: nowrap;
  text-decoration: none !important;
  box-shadow: var(--elev-1);
  transition: background 0.14s ease, border-color 0.14s ease;
}
.topbar__new:hover {
  background: var(--surface-3);
  border-color: var(--line-strong);
  color: var(--ink);
}
.topbar__new:active {
  transform: translateY(1px);
}

/* La colonne porte déjà le bouton : celui-ci s'efface. `--off` vaut à toute
   largeur, `--off-wide` seulement tant que la colonne tient à l'écran — la
   requête média qui le rallume est plus bas, avec le reste du < 820 px. */
.topbar__new--off,
.topbar__new--off-wide {
  display: none;
}

/* ----------------------------------------------------------------- forumbar
   Bande de repère, elle aussi à même le canevas : elle situe, elle ne cadre
   rien. Le fond blanc et l'ombre d'avant en faisaient une seconde barre. */
.forumbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--forumbar-h);
  padding: 0 calc(var(--gutter) + 6px + env(safe-area-inset-right, 0px)) 0
    calc(var(--gutter) + 6px + env(safe-area-inset-left, 0px));
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: var(--fs-md);
}
.crumbs__link {
  color: var(--ink-3);
  font-weight: 500;
}
.crumbs__sep {
  color: var(--ink-4);
}
.crumbs__here {
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forumbar__stats {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  flex-shrink: 0;
}
.forumbar__stat {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  white-space: nowrap;
}
.forumbar__stat--signed {
  color: var(--ok);
}

/* Contrôle de dev : discret au repos, franchement cramoisi quand il est actif —
   « tu ne lis pas le forum » doit se voir sans être expliqué. */
.forumbar__mode {
  padding: 3px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-3);
  font-size: var(--fs-xs);
  font-weight: 500;
  white-space: nowrap;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.forumbar__mode:hover {
  background: var(--surface-3);
  border-color: var(--line-strong);
  color: var(--ink);
}
.forumbar__mode:active {
  transform: translateY(1px);
}
.forumbar__mode--on {
  background: var(--warn-soft);
  border-color: color-mix(in srgb, var(--warn) 35%, transparent);
  color: var(--warn);
  font-weight: 700;
}

/* `ForumShell` masque la colonne à ce seuil dès qu'un topic ou le formulaire
   occupe la place : le repli reprend son rôle, et redevient le seul accès. */
@media (max-width: 820px) {
  .topbar__new--off-wide {
    display: inline-flex;
  }
}

/* -------------------------------------------------------------- < 900 px --- */
@media (max-width: 900px) {
  .relays__label {
    display: none;
  }
  .relays {
    padding: 5px 8px;
  }
  .forumbar__stats {
    gap: 9px;
  }
}

/* Sous 700 px la barre doit tenir sur une ligne. */
@media (max-width: 700px) {
  .topbar {
    gap: 10px;
    padding: 0 calc(12px + env(safe-area-inset-right, 0px)) 0 calc(12px + env(safe-area-inset-left, 0px));
  }
  .navlink {
    padding: 6px 12px;
  }
  /* Le libellé reste : entre 560 et 820 px avec un topic ouvert, ce bouton est
     le seul accès à la publication, et un « + » nu n'annonce rien — ni à l'œil,
     ni au lecteur d'écran. */
  .topbar__new {
    padding: 6px 11px;
  }
  .forumbar {
    padding: 0 calc(12px + env(safe-area-inset-right, 0px)) 0 calc(12px + env(safe-area-inset-left, 0px));
  }
  .forumbar__stat:not(:last-child) {
    display: none;
  }
}

/* -------------------------------------------------------------- < 560 px ---
 * Le téléphone. Sept objets ne tiennent pas sur 360 px de large, et les serrer
 * est ce qui cassait la barre : on en RETIRE donc deux, en choisissant lesquels
 * par ce qu'ils coûtent à qui les perd.
 *
 *   le thème  → descend dans le menu utilisateur. C'est une préférence, on la
 *               règle une fois ; sa place permanente dans la barre est un luxe
 *               de grand écran. (Le pendant est dans `UserMenu.vue`.)
 *   « Nouveau topic » → part. Il n'est un repli que parce que la colonne de
 *               topics n'est pas à l'écran, et sur téléphone elle est TOUJOURS à
 *               un tap : l'onglet Forum, ou la flèche retour d'un topic ouvert.
 *               Elle porte, elle, le vrai bouton primaire.
 *
 * Restent le wordmark, les deux lieux, l'état des relais, les notifications et
 * l'identité — tout ce qui dit où l'on est et ce qui attend.
 */
@media (max-width: 559px) {
  .topbar {
    gap: 8px;
  }
  .topbar__right {
    gap: 6px;
  }
  .topbar__theme {
    display: none;
  }
  /* Après le bloc 820 px : à spécificité égale, c'est la dernière règle qui
     gagne, donc `--off-wide` ne le rallume pas ici. */
  .topbar__new {
    display: none;
  }
}

/* -------------------------------------------------------------- < 400 px ---
   Les petits téléphones (SE, vieux Android). Le wordmark rend deux points de
   corps et les pastilles leur padding — c'est tout ce qui manque pour tenir. */
@media (max-width: 399px) {
  .topbar__brand {
    font-size: 19px;
  }
  .navlink {
    padding: 6px 10px;
  }
}
</style>
