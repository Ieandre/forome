<template>
  <div class="col">
    <!-- Le chrome du site, descendu de la barre. Marque à gauche parce qu'elle
         est aussi le retour à l'accueil, outils à droite dans l'ordre où on les
         touche : ce qui réclame (cloche), ce qui se règle (thème), qui je suis. -->
    <div class="col__top">
      <button type="button" class="col__brand" @click="goHome">
        Forome<span class="col__brand-dot">.</span>
      </button>

      <span class="col__spacer" />

      <NotifBell />

      <Hint
        :text="theme.isDark.value ? 'passer en thème clair' : 'passer en thème sombre'"
        placement="bottom"
      >
        <!-- L'icône montre la DESTINATION, pas l'état courant. Le nom accessible
             est posé par `Hint` : pas d'aria-label ici, il figerait le nom sur la
             première valeur. -->
        <button type="button" class="col__theme" @click="theme.toggle()">
          <svg
            v-if="theme.isDark.value"
            class="col__theme-icon"
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
            class="col__theme-icon"
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

      <UserMenu />
    </div>

    <DmList v-if="onDm" class="col__body" />
    <TopicList v-else class="col__body" :open-topic-id="openTopicId" :new-topic="newTopic" />

    <!-- Le pied ne porte aucune commande de l'app : ce que devient un message une
         fois posté, où se lit le code qui en décide, à combien de relais on
         parle. L'indicateur de relais était en haut, où il concurrençait la
         navigation pour une information qu'on ne consulte qu'en cas de doute.

         Le lien des sources est ici et pas dans un menu : la licence du client
         (AGPL) demande de les offrir à qui s'en sert par le réseau, et c'est le
         seul endroit de l'écran où les deux autres phrases s'affirment — elles
         ne valent que si on peut aller les vérifier depuis le même endroit.

         Et à DROITE, avec les relais : à gauche la phrase s'adresse à celui qui
         écrit, à droite se rangent les deux choses qu'on va voir quand on doute.
         Collé derrière la phrase, le lien se lisait comme sa suite. Les relais
         gardent le bord parce qu'ils sont le seul des deux qui change. -->
    <div class="col__foot">
      <Explain
        term="définitif"
        placement="top"
        :body="[
          'Un message part sur plusieurs relais indépendants, qui en gardent chacun leur copie. Personne ne peut les effacer toutes.',
          'Tu peux demander la suppression : les relais qui l\'acceptent cessent de servir le message, les autres continuent.',
        ]"
        >Tout ce qui est posté ici est définitif.</Explain
      >

      <span class="col__spacer" />

      <Hint text="le code de ce forum, libre et relisible (AGPL-3.0)" placement="top">
        <a class="col__src" :href="sourceUrl" target="_blank" rel="noopener noreferrer">
          <!-- La marque GitHub, à l'échelle du texte de pied : elle dit « du code
               qui se lit » en un coup d'œil là où « voir les sources » demanderait
               trois mots à 11 px. Le nom accessible est posé par `Hint`. -->
          <svg class="col__src-mark" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.05-.13-.36-.66.07-1.37 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.43.71.12 1.24.07 1.37.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
          </svg>
          <span class="col__src-label">code source</span>
        </a>
      </Hint>

      <Explain term="relais" :body="relaysBody" :items="relaysList" placement="top">
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
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Le volet de gauche, sur toutes les routes.
 *
 * Il portait autrefois son propre en-tête, qui a été remonté en barre de site
 * parce qu'il disparaissait sur `/dm` (voir l'historique de `layouts/default`).
 * Le motif tombe ici : la colonne est rendue par le LAYOUT, donc elle existe
 * partout — sur les MP, sur un profil, sur `/appareils` — et `SectionTabs` la
 * fait basculer d'un contenu à l'autre. Une barre pleine largeur de 56 px en
 * moins, rendue au panneau de lecture.
 *
 * Elle est le panneau : `TopicList` et `DmList` n'ont plus de surface propre,
 * ce sont ses étages.
 */
import { computed } from 'vue'
import { topicIdFromParam } from '~/utils/permalink'

const relays = useRelayStore()
const topics = useTopicStore()
const theme = useTheme()
const sourceUrl = useRuntimeConfig().public.sourceUrl
const route = useRoute()
const router = useRouter()

const onDm = computed(() => route.path === '/dm')
const newTopic = computed(() => route.path === '/new')
const openTopicId = computed(() => {
  const raw = String(route.params.id ?? '')
  return raw ? topicIdFromParam(raw) : null
})

/** La query est préservée : sans ça `?relays=` et `?indexer=` disparaissent. */
function goHome(): void {
  topics.setMode('threads')
  const { peer: _peer, ...query } = route.query
  void router.push({ path: '/', query })
}

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
 *   - le point : sommes-nous connectés du tout
 *   - le texte du rapport : est-il complet
 *
 * Déclenchée par `deadCount` et non par le rapport : au démarrage il passe par
 * 0/5 puis 2/5 le temps que les connexions s'établissent, et ça ne signale rien.
 */
const relaysDegraded = computed(() => relays.deadCount > 0)

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
  // demande d'être décodé et ne se lit pas au lecteur d'écran.
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
</script>

<style scoped>
.col {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-2);
  overflow: hidden;
}

/* Le filet sépare deux natures : au-dessus le chrome du site (qui je suis, ce
   qui me réclame, comment je règle l'app), en dessous le contenu de la colonne
   et de quoi le parcourir. Sans lui les deux rangées se lisaient comme une
   seule barre de six objets hétéroclites. */
.col__top {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 10px 12px 10px 14px;
  border-bottom: 1px solid var(--line-soft);
}
.col__spacer {
  flex: 1;
  min-width: 0;
}

.col__brand {
  padding: 0;
  background: none;
  border: none;
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 1;
  color: var(--ink);
}
.col__brand-dot {
  color: var(--brand);
}

.col__theme {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--r-pastille);
  color: var(--ink-3);
  transition: background 0.13s ease, color 0.13s ease;
}
.col__theme:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.col__theme-icon {
  width: 18px;
  height: 18px;
}

.col__body {
  flex: 1;
  min-height: 0;
}

/* Le pied : deux états, jamais une commande. Le filet le sépare de la liste
   comme le filet du haut sépare le chrome. */
.col__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 8px 12px 8px 14px;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

/* Encre de pied et pas de lien bleu : dans une ligne qu'on ne lit qu'en cas de
   doute, un lien de couleur tirerait l'œil plus fort que le fil qu'on est venu
   lire. Le survol suffit à le désigner comme cliquable. */
.col__src {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  color: inherit;
  white-space: nowrap;
  text-decoration: none;
}
.col__src:hover {
  color: var(--ink-2);
  text-decoration: none;
}
.col__src-mark {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.col__src-label {
  border-bottom: 1px solid transparent;
}
.col__src:hover .col__src-label {
  border-bottom-color: var(--line-strong);
}

/* Sous 480 px la phrase « définitif » passerait à deux lignes si on lui prenait
   davantage : la marque reste, le mot se retire de l'écran seulement.
   Retiré et non `display: none` : c'est ce texte qui NOMME le lien, et
   `Hint` ne pose son `aria-label` que sur un déclencheur sans contenu lisible
   (voir `nameChild`) — masqué pour de bon, le lien n'aurait plus de nom du tout. */
@media (max-width: 480px) {
  .col__src-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

/* Repris de la barre de site : l'objet n'a pas changé, seulement sa place. Sans
   surface ni filet ici — le pied en est déjà un, et une pastille posée dessus
   ferait un objet dans un objet pour un état qu'on ne consulte qu'en cas de
   doute. */
.relays {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.relays__dot {
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
.relays--degraded .relays__label {
  color: var(--warn);
}
.relays--dev .relays__dot {
  background: var(--warn);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 22%, transparent);
}
.relays--dev .relays__label {
  color: var(--warn);
}

@media (max-width: 700px) {
  .col {
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
}
</style>
