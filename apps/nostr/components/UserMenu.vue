<template>
  <div class="um">
    <!-- Identicon seul : le pseudo tient déjà dans le popover et dans le
         placeholder du composeur, et le mettre ici mangeait la place du titre
         de la liste au point de le tronquer à « khe… ». -->
    <!-- `disabled` pendant l'ouverture, comme `NotifBell` : la bulle nommerait
         le bouton avec la phrase que le popover affiche déjà, par-dessus lui. -->
    <Hint :text="btnTitle" placement="bottom" :disabled="open">
      <button type="button" class="um__btn" :aria-label="btnTitle" @click="open = !open">
        <UserAvatar v-if="identity.pubkey" :pubkey="identity.pubkey" :size="20" />
        <span v-else class="um__handle">…</span>
      </button>
    </Hint>

    <div v-if="open" class="um__pop">
      <p class="um__id">
        <strong>{{ displayName }}</strong>
        <span class="um__disc">·{{ identity.discriminator }}</span>
      </p>
      <p class="um__mono">{{ signerLabel }}</p>
      <!-- Le seul cas où l'identité affichée n'est pas celle que l'utilisateur
           attendait sans qu'il ait rien demandé (extension muette au démarrage).
           Le taire donnerait « pourquoi je ne suis plus moi ? » sans réponse. -->
      <p v-if="identity.signerError" class="um__warn">{{ identity.signerError }}</p>
      <p class="um__mono">
        {{ identity.postCount }} post{{ identity.postCount > 1 ? 's' : '' }}
        <template v-if="identity.signerMode === 'local'">
          · clé {{ identity.keySaved ? 'sauvegardée' : 'non sauvegardée' }}
        </template>
      </p>
      <!-- Son propre niveau se voit ici et pas seulement sur son profil : la
           progression n'intéresse que soi, et c'est en regardant son identité
           qu'on se demande où on en est. Le chiffre est là, contrairement à la
           bande d'auteur du fil (§16). -->
      <p v-if="myLevel !== null" class="um__mono">
        niveau {{ myLevel }} · {{ myPoints.toLocaleString('fr-FR') }} point{{ myPoints > 1 ? 's' : '' }}
      </p>

      <hr class="um__sep" />

      <!-- La porte « je reviens », dans le vocabulaire de l'utilisateur — pas
           « importer une clé ». Visible seulement tant que l'identité générée
           ici n'a jamais servi : après un post ou une sauvegarde, celui qui est
           là est probablement celui qu'il veut être. -->
      <NuxtLink
        v-if="identity.unusedIdentity"
        to="/appareils"
        class="um__item um__item--strong"
        @click="open = false"
      >
        J'ai déjà un compte
      </NuxtLink>

      <!-- Une seule entrée, pas deux : « Modifier » est un bouton de la page de
           profil, pas une destination concurrente dans le menu. Le pseudo ne se
           choisit plus ici — il se modifie sur la page, avec le reste (à propos,
           avatar, NIP-05), au lieu d'un champ isolé qui ferait doublon. -->
      <NuxtLink v-if="npub" :to="`/profil/${npub}`" class="um__item" @click="open = false">
        Mon profil
      </NuxtLink>

      <NuxtLink to="/appareils" class="um__item" @click="open = false">
        Mes appareils
      </NuxtLink>

      <NuxtLink to="/classement" class="um__item" @click="open = false">
        Classement
      </NuxtLink>

      <!-- La doc vit ici et non dans la nav du haut : celle-ci porte deux lieux
           du forum, et une page qui s'explique n'en est pas un troisième. C'est
           au moment où l'on regarde son identité qu'on se demande comment tout
           ça marche. -->
      <NuxtLink to="/comment-ca-marche" class="um__item" @click="open = false">
        Comment ça marche
      </NuxtLink>

      <!-- Le même interrupteur que celui de la barre, qui disparaît sous 560 px
           (voir `SiteHeader.vue`). Il n'est donc jamais offert deux fois : la
           requête média ci-dessous est l'exacte complémentaire de la sienne. -->
      <button type="button" class="um__item um__item--theme" @click="theme.toggle()">
        {{ theme.isDark.value ? 'Thème clair' : 'Thème sombre' }}
      </button>

      <!-- Il vit ICI et pas dans l'éditeur d'apparence : il parle de ce que TU
           vois, pas de ce que tu es — même catégorie que le thème. Dans
           l'éditeur, personne n'irait le chercher (§16.9). -->
      <button type="button" class="um__item um__item--theme" @click="apparence.toggle()">
        {{ apparence.enabled.value ? 'Masquer les couleurs de pseudo' : 'Afficher les couleurs de pseudo' }}
      </button>

      <!-- L'entrée n'apparaît que si la clé est au roster signé du forum : ce
           n'est pas une case à cocher, c'est une propriété vérifiée. -->
      <NuxtLink v-if="mod.amStaff" to="/admin" class="um__item um__item--staff" @click="open = false">
        Modération
        <span v-if="mod.reportQueue.length" class="um__badge">{{ mod.reportQueue.length }}</span>
      </NuxtLink>

      <NuxtLink v-if="mod.configured" to="/moderation" class="um__item" @click="open = false">
        Qui modère ici
      </NuxtLink>

      <button
        v-if="identity.hasExtension && identity.signerMode === 'local'"
        type="button"
        class="um__item"
        @click="switchToExtension"
      >
        Utiliser mon extension Nostr
      </button>
      <button v-if="identity.signerMode === 'nip07'" type="button" class="um__item" @click="identity.useLocalKey()">
        Revenir à la clé de cet appareil
      </button>

      <!-- « ↻ new khey » (§3.6) : action secondaire et délibérée, jamais un mode.
           Confirmation explicite parce que l'ancienne identité est irrécupérable
           si la clé n'a pas été sauvegardée. -->
      <button v-if="!confirming" type="button" class="um__item um__item--warn" @click="confirming = true">
        ↻ new khey
      </button>
      <div v-else class="um__confirm">
        <p class="um__confirm-text">
          {{
            identity.keySaved
              ? 'Nouvelle identité. L\'actuelle est sauvegardée, tu pourras la réimporter.'
              : 'Nouvelle identité. L\'actuelle n\'est PAS sauvegardée : elle sera perdue définitivement, avec ses posts.'
          }}
        </p>
        <div class="um__confirm-actions">
          <button type="button" class="btn btn--sm btn--danger" @click="doNewKhey">confirmer</button>
          <button type="button" class="btn btn--sm btn--ghost" @click="confirming = false">annuler</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { npubFor } from '~/utils/nostr'

const identity = useIdentityStore()
const profiles = useProfileStore()
const mod = useModerationStore()
const theme = useTheme()
const points = useUserPointsStore()
const apparence = useApparence()

const open = ref(false)
const confirming = ref(false)

const npub = computed(() => (identity.pubkey ? npubFor(identity.pubkey) : ''))

const myLevel = computed(() => (identity.pubkey ? points.levelOf(identity.pubkey) : null))
const myPoints = computed(() => (identity.pubkey ? points.pointsOf(identity.pubkey) : 0))

const displayName = computed(() =>
  identity.pubkey ? profiles.displayName(identity.pubkey) : '…',
)
const signerLabel = computed(() => {
  switch (identity.signerMode) {
    case 'nip46':
      return 'clé gardée par une autre app'
    case 'nip07':
      return 'clé dans une extension'
    default:
      return 'clé sur cet appareil'
  }
})
const btnTitle = computed(() =>
  identity.pubkey
    ? `${displayName.value} — identité générée sur cet appareil, clé ${identity.keySaved ? 'sauvegardée' : 'non sauvegardée'}`
    : 'génération de la clé…',
)

async function switchToExtension(): Promise<void> {
  await identity.useExtension()
  open.value = false
}

function doNewKhey(): void {
  identity.newKhey()
  confirming.value = false
  open.value = false
}
</script>

<style scoped>
.um {
  position: relative;
}

/* La barre de site n'est plus sombre : le déclencheur prend les tokens de page,
   et se pose comme les autres commandes de la tête — pastille claire, ombre
   d'un pixel. */
.um__btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  padding: 4px;
  color: var(--ink-3);
  box-shadow: var(--elev-1);
  transition: border-color 0.14s ease, transform 0.1s ease;
}
.um__btn:hover {
  border-color: var(--line-strong);
}
.um__btn:active {
  transform: translateY(1px);
}
.um__handle {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  padding: 0 5px;
}

/* Le panneau flotte : ombre longue, pas de bordure marquée. */
.um__pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 272px;
  max-height: min(80vh, 640px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-pop);
  padding: 12px;
}
.um__id {
  margin: 0 0 3px;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
}
.um__disc {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  letter-spacing: -0.02em;
  color: var(--ink-4);
  margin-left: 4px;
}
.um__mono {
  margin: 2px 0;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.um__warn {
  margin: 6px 0 2px;
  font-size: var(--fs-sm);
  line-height: 1.4;
  color: var(--warn);
}
.um__sep {
  border: none;
  border-top: 1px solid var(--line-soft);
  margin: 10px 0;
}
.um__item {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--ink-2);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 500;
  padding: 8px 10px;
  border-radius: var(--r-control);
  transition: background 0.13s ease, color 0.13s ease;
}
.um__item:hover {
  background: var(--surface-3);
  color: var(--ink);
  /* Les entrées de menu sont des lignes, pas des liens de texte : le
     soulignement au survol d'un `<a>` casserait l'alignement de la colonne. */
  text-decoration: none;
}

/* Le thème n'a sa place ici que quand la barre ne le porte plus. */
.um__item--theme {
  display: none;
}
@media (max-width: 559px) {
  .um__item--theme {
    display: block;
  }
}

/* Encre pleine et graisse : tant qu'elle existe, c'est l'entrée que le
   revenant cherche — mais pas bleue, ce n'est pas un marqueur d'équipe. */
.um__item--strong {
  color: var(--ink);
  font-weight: 600;
}

/* Bleu comme les autres marqueurs d'équipe, et le compte de dossiers en attente
   à droite : c'est la seule entrée du menu qui a du travail derrière elle. */
.um__item--staff {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--link);
  font-weight: 600;
}
.um__badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--link-soft);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  color: var(--link);
}

/* « new khey » détruit l'identité courante : cramoisi, la couleur d'alerte —
   l'orange dit « agis », pas « attention à ce que tu fais ». */
.um__item--warn {
  color: var(--warn);
  font-weight: 600;
}
.um__item--warn:hover {
  background: var(--warn-soft);
  color: var(--warn);
}
.um__confirm {
  padding: 8px 10px;
  background: var(--warn-soft);
  border-radius: var(--r-control);
}
.um__confirm-text {
  margin: 0 0 9px;
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--ink-2);
}
.um__confirm-actions {
  display: flex;
  gap: 6px;
}
</style>
