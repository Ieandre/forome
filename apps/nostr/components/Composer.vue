<template>
  <div class="composer">
    <!-- Encart d'onboarding (spec v2 §3.1). Il apparaît APRÈS le premier post,
         jamais avant : « non bloquant » pris au mot — voir le commentaire du
         script pour l'écart assumé avec la formulation d'origine. -->
    <Transition name="encart">
      <div v-if="showEncart" class="encart">
        <p class="encart__text">
          Posté en tant que <strong>{{ identity.displayName }}</strong> — une identité créée sur cet
          appareil, sans inscription. Elle marche aussi dans les autres apps Nostr.
        </p>
        <div v-if="!pickingName" class="encart__actions">
          <button type="button" class="btn btn--sm btn--primary" @click="pickingName = true">Choisir un pseudo</button>
          <button type="button" class="btn btn--sm" @click="identity.markEncartSeen()">Garder {{ identity.displayName }}</button>
        </div>
        <form v-else class="encart__form" @submit.prevent="submitName">
          <input
            v-model="nameDraft"
            class="field__input encart__input"
            maxlength="40"
            placeholder="ton pseudo"
            autofocus
          />
          <button type="submit" class="btn btn--sm btn--primary" :disabled="!nameDraft.trim()">Publier</button>
          <button type="button" class="btn btn--sm btn--ghost" @click="pickingName = false">annuler</button>
        </form>
      </div>
    </Transition>

    <!-- Nudge de sauvegarde (§3.1) : après quelques posts, pas au premier —
         avant, l'utilisateur n'a rien à perdre et le message ne veut rien dire. -->
    <Transition name="encart">
      <div v-if="identity.shouldNudgeBackup && !backupOpen" class="nudge">
        <span>Ton identité vit uniquement sur cet appareil.</span>
        <button type="button" class="btn btn--sm btn--primary" @click="backupOpen = true">Sauvegarder ma clé</button>
        <button type="button" class="btn btn--sm btn--ghost" @click="identity.markKeySaved()">plus tard</button>
      </div>
    </Transition>

    <div v-if="backupOpen" class="backup">
      <p class="backup__warn">
        ⚠ <strong>Qui a cette clé est toi</strong>, définitivement. Elle ne peut être ni annulée ni
        remplacée, et personne ne peut te la redonner si tu la perds.
      </p>
      <code class="backup__nsec">{{ nsecVisible ? nsec : '•'.repeat(63) }}</code>
      <div class="backup__actions">
        <button type="button" class="btn btn--sm" @click="nsecVisible = !nsecVisible">
          {{ nsecVisible ? 'masquer' : 'afficher' }}
        </button>
        <button type="button" class="btn btn--sm" @click="copyNsec">{{ nsecCopied ? 'copié ✓' : 'copier' }}</button>
        <button type="button" class="btn btn--sm btn--primary" @click="doneBackup">c'est sauvegardé</button>
      </div>
    </div>

    <!--
      Boîte de réponse : le gabarit du composeur de la charte du forum, une zone
      bordée avec du chrome au-dessus (qui poste, à qui) et en dessous (état,
      action). Pas de rangée d'outils BBCode : rien ici ne rend le balisage, et
      un bouton « gras » qui insère du texte littéral serait un faux bouton.
    -->
    <form class="composer__box" @submit.prevent="send">
      <div class="composer__top">
        <UserAvatar v-if="identity.pubkey" :pubkey="identity.pubkey" :size="18" />
        <span class="composer__as">{{ identity.displayName }}</span>

        <template v-if="replyTo">
          <span class="composer__replyto">
            <span aria-hidden="true">↳</span> réponse à
            <strong>{{ profiles.displayName(replyTo.pubkey) }}</strong>
          </span>
          <button type="button" class="tool composer__cancel" @click="emit('cancelReply')">annuler</button>
        </template>
      </div>

      <MarkupToolbar
        class="composer__toolbar"
        :uploading="images.busy.value"
        :sticker-open="stickerOpen"
        @inline="editorEl?.toggleInline($event)"
        @block="editorEl?.toggleBlock($event)"
        @link="editorEl?.insertLink()"
        @image="pickImage"
        @sticker="stickerOpen = !stickerOpen"
      />

      <!-- Le texte s'affiche stylisé **pendant la frappe** : pas d'aperçu à
           basculer, donc rien qui puisse différer du résultat publié. -->
      <RichEditor
        ref="editorEl"
        class="composer__input"
        label="Ta réponse"
        placeholder="ta réponse"
        @update:model-value="onEditorInput"
        @files="attachImages"
        @image-resize="onImageResize"
        @submit="send"
      />

      <!-- Sous l'éditeur et non au-dessus : ouvrir le tiroir ne doit pas déplacer
           le texte qu'on est en train d'écrire. -->
      <LazyStickerDrawer
        v-if="stickerOpen"
        class="composer__stickers"
        @pick="onSticker"
        @close="stickerOpen = false"
      />

      <!-- Sélecteur de fichier hors écran : le bouton de la barre d'outils est
           la commande, ce champ n'est que le mécanisme du navigateur. -->
      <input
        ref="fileEl"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        multiple
        class="visually-hidden"
        @change="onFilePicked"
      />

      <div class="composer__bottom">
        <span class="composer__hint">Entrée pour poster, Maj+Entrée pour un saut de ligne</span>
        <!-- La preuve de travail est un mécanisme du client : sa difficulté et sa
             cadence de hachage ne disent rien à qui écrit un message, et « 20
             bits » se lisait comme un compteur du forum. Sous `?dev=1` (voir
             `useDevTools`), où le réglage compte vraiment. -->
        <Explain v-if="devTools" term="preuve de travail" :body="powBody" placement="top">
          <span class="composer__pow mono">{{ powLabel }}</span>
        </Explain>
        <button type="submit" class="btn btn--sm btn--primary" :disabled="!canSend">
          {{ publisher.publishing.value ? 'envoi…' : 'Poster' }}
        </button>
      </div>
    </form>

    <p v-if="images.error.value" class="composer__error">Image : {{ images.error.value }}</p>
    <p v-else-if="publisher.lastError.value" class="composer__error">{{ publisher.lastError.value }}</p>

    <!-- « accepté par 5/5 relais · PoW 20 bits » après chaque message était un
         rapport de machine : quand tout va bien, le message est déjà à l'écran et
         il n'y a rien à ajouter. On ne parle donc que si personne ne l'a pris —
         le seul cas où le lecteur a quelque chose à faire (le marqueur « non
         publié » sur le message lui-même dit le reste). -->
    <p v-else-if="postFailed" class="composer__error">
      Aucun relais n'a accepté ce message : il n'est parti nulle part.
    </p>
    <p v-else-if="devTools && lastPow !== null" class="composer__ok">
      <template v-if="settledResult">
        accepté par {{ settledResult.accepted.length }}/{{ relayStore.relays.length }} relais
      </template>
      <template v-else>envoyé…</template>
      · PoW {{ lastPow }} bits
      <Explain
        v-if="settledResult?.rejected.length"
        term="refus"
        placement="top"
        body="Ces relais ont refusé le message, avec la raison qu'ils ont donnée :"
        :items="rejectedItems"
      >
        <span>· {{ settledResult.rejected.length }} refus</span>
      </Explain>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * Composeur (spec v2 §3.1, §6.3, §12.1).
 *
 * ## Écart assumé avec la formulation de la spec
 *
 * La spec décrit l'encart comme apparaissant **à l'appui sur Entrée**, avec un
 * bouton « [Poster comme ça] » — ce qui, littéralement, retarde le premier post
 * d'un clic. C'est en contradiction avec la thèse « zéro friction » et avec le
 * mot « non bloquant » lui-même.
 *
 * Choix retenu : **le premier post part immédiatement**, et l'encart apparaît
 * juste après, en ligne, dismissible. L'utilisateur apprend qui il est au moment
 * où ça devient pertinent, sans qu'on lui ait fait payer un clic pour écrire.
 */
import { ref, computed } from 'vue'
import type { NostrEvent } from '~/types/nostr'
import type { MarkupKind, BlockKind } from '~/utils/serialize'
import { imetaTags, type ImageMeta } from '~/utils/media'

const props = defineProps<{
  rootId: string
  root: NostrEvent | null
  replyTo?: NostrEvent | null
}>()
const emit = defineEmits<{ posted: [event: NostrEvent, replacedId?: string]; settled: [id: string, accepted: boolean]; cancelReply: [] }>()

const identity = useIdentityStore()
const profiles = useProfileStore()
const relayStore = useRelayStore()
const publisher = usePublisher()
const devTools = useDevTools()
const images = useImageUpload()

const draft = ref('')
const editorEl = ref<{
  toggleInline: (k: MarkupKind) => void
  toggleBlock: (k: BlockKind) => void
  insertLink: () => void
  insertImage: (img: ImageMeta) => void
  clear: () => void
  focus: () => void
} | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const stickerOpen = ref(false)
const pickingName = ref(false)
const nameDraft = ref('')
const backupOpen = ref(false)
const nsecVisible = ref(false)
const nsecCopied = ref(false)
const lastPow = ref<number | null>(null)
const settledResult = computed(() => publisher.lastResult.value)

/**
 * Le seul cas où l'envoi mérite une phrase : le verdict est tombé et aucun relais
 * n'a pris le message. Tant qu'il est en vol (`settledResult` nul), on ne dit
 * rien — le message est déjà affiché, et le marqueur « envoi… » vit sur lui.
 */
const postFailed = computed(
  () => lastPow.value !== null && !!settledResult.value && settledResult.value.accepted.length === 0,
)

/**
 * L'éditeur est la source de vérité : il émet le balisage sérialisé à chaque
 * frappe. On garde `draft` pour la publication et le minage spéculatif, sans
 * jamais le réinjecter dans l'éditeur (voir `RichEditor`).
 */
function onEditorInput(value: string): void {
  draft.value = value
  onInput()
}

const nsec = computed(() => identity.exportNsec() ?? '(clé dans une extension NIP-07)')

const showEncart = computed(
  () => identity.postCount === 1 && !identity.encartSeen && identity.signerMode === 'local',
)

/**
 * Un dépôt en cours bloque l'envoi : publier maintenant partirait sans l'image
 * que l'utilisateur vient d'ajouter, et il ne le verrait qu'après coup.
 */
const canSend = computed(
  () => !!draft.value.trim() && !publisher.publishing.value && !images.busy.value && identity.ready,
)

const powLabel = computed(() => {
  if (publisher.miner.mining.value) return 'PoW…'
  if (!publisher.miner.available.value) return 'PoW off'
  return `${publisher.miner.difficulty.value} bits`
})
const powBody = computed<string[]>(() => {
  const rate = publisher.miner.hashRate.value
  const ms = publisher.miner.lastMs.value
  const out = [
    'Certains relais n\'acceptent un message que s\'il a coûté un peu de calcul. Ça freine le spam sans compte ni mot de passe.',
    `Difficulté calibrée sur cet appareil : ${publisher.miner.difficulty.value} bits.`,
  ]
  const mesures = []
  if (rate) mesures.push(`~${Math.round(rate / 1000)}k hachages/s`)
  if (ms !== null) mesures.push(`dernier minage : ${Math.round(ms)} ms`)
  if (mesures.length) out.push(mesures.join(' · '))
  if (!publisher.miner.available.value) {
    out.push('Le worker est indisponible : la publication part sans preuve de travail.')
  }
  return out
})

const rejectedItems = computed(() =>
  (settledResult.value?.rejected ?? []).map((r) => `${r.url} : ${r.reason}`),
)

/**
 * Tags `imeta` des images encore présentes dans le texte (NIP-92) : dimensions,
 * type et empreinte. Ce sont eux qui permettent au fil de réserver la place de
 * l'image avant son chargement, chez nous comme chez les autres clients.
 */
const imageTags = computed(() => imetaTags(draft.value, images.attached.value))

/** Minage spéculatif sur le brouillon : voir l'en-tête de `usePowMiner`. */
function onInput(): void {
  publisher.miner.speculate(() =>
    publisher.draftReply(draft.value, props.rootId, props.root, props.replyTo ?? null, imageTags.value),
  )
}

function pickImage(): void {
  fileEl.value?.click()
}

/**
 * Taille choisie à la poignée : elle vit dans l'`imeta`, pas dans le texte —
 * d'où le passage par `resize` puis la re-spéculation du minage, que le brouillon
 * inchangé n'aurait pas déclenchée.
 */
function onImageResize(url: string, width: number): void {
  images.resize(url, width)
  onInput()
}

/**
 * Un sticker suit le chemin d'une image jointe : `adopt` pour qu'il produise son
 * `imeta` (dimensions comprises), puis insertion dans le corps du message.
 *
 * Le tiroir reste ouvert : sur un forum, les stickers s'empilent — en refermer un
 * à chaque insertion ferait payer un clic pour chacun.
 */
function onSticker(meta: ImageMeta): void {
  images.adopt(meta)
  editorEl.value?.insertImage(meta)
  onInput()
}

function onFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement
  void attachImages([...(input.files ?? [])])
  // Sans ça, choisir deux fois le même fichier ne déclencherait pas `change`.
  input.value = ''
}

/**
 * Dépose puis insère, dans l'ordre des fichiers. L'insertion est faite ici et
 * non par l'éditeur : lui ne connaît ni les clés ni le réseau, il reçoit une
 * adresse déjà déposée (voir `insertImage`).
 */
async function attachImages(files: File[]): Promise<void> {
  await images.addMany(files, (meta) => {
    editorEl.value?.insertImage(meta)
    onInput()
  })
}

async function send(): Promise<void> {
  if (!canSend.value) return
  const content = draft.value
  const outcome = await publisher.publishReply({
    content,
    rootId: props.rootId,
    root: props.root,
    parent: props.replyTo ?? null,
    tags: imageTags.value,
    // affichage optimiste : le fil montre le message avant la diffusion (§6.3)
    onOptimistic: (ev, replacedId) => {
      draft.value = ''
      editorEl.value?.clear()
      images.reset()
      stickerOpen.value = false
      emit('posted', ev, replacedId)
    },
  })
  if (outcome) {
    lastPow.value = outcome.pow
    // Le verdict arrive après : on le renvoie au fil pour marquer le post
    // « non publié » si personne ne l'a accepté.
    const settled = outcome.settled
    if (settled) void settled.then((r) => emit('settled', outcome.event.id, r.accepted.length > 0))
    else emit('settled', outcome.event.id, outcome.result.accepted.length > 0)
  }
  // échec avant signature : le texte reste dans l'éditeur, rien n'a été vidé
}

/**
 * Le pseudo de l'encart passe par `publishPatch`, pas par le publieur brut :
 * kind 0 est remplaçable, donc publier `{name}` seul effacerait un profil déjà
 * rempli ailleurs (à propos, avatar, NIP-05). L'encart ne s'adresse pourtant
 * pas qu'aux clés neuves — une clé importée depuis un autre client passe ici
 * aussi.
 */
async function submitName(): Promise<void> {
  const name = nameDraft.value.trim()
  if (!name) return
  const res = await profiles.publishPatch({ name })
  if (res.ok) {
    pickingName.value = false
    identity.markEncartSeen()
  }
}

async function copyNsec(): Promise<void> {
  const value = identity.exportNsec()
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    nsecCopied.value = true
    setTimeout(() => (nsecCopied.value = false), 1500)
  } catch {
    /* presse-papier indisponible — l'affichage reste la porte de sortie */
  }
}

function doneBackup(): void {
  identity.markKeySaved()
  backupOpen.value = false
  nsecVisible.value = false
}
</script>

<style scoped>
.composer {
  flex-shrink: 0;
  border-top: 1px solid var(--line-soft);
  background: var(--surface);
  padding: 12px 20px 14px;
}

/* La boîte de réponse : un champ enfoncé plutôt qu'un panneau posé. Le chrome
   gris au-dessus et en dessous a disparu — trois bandes de gris empilées pour
   écrire une ligne, c'était le composeur de 2005. Le focus est porté par la
   boîte entière, pas par le seul champ, sinon deux bordures se battent. */
.composer__box {
  max-width: var(--topic-col, 880px);
  margin: 0 auto;
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-panel);
  overflow: hidden;
  transition: border-color 0.14s ease, box-shadow 0.14s ease, background 0.14s ease;
}
.composer__box:focus-within {
  background: var(--surface);
  border-color: var(--link);
  box-shadow: var(--ring);
}

.composer__top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 13px 2px;
  font-size: var(--fs-sm);
}
.composer__as {
  font-weight: 700;
  font-size: var(--fs-md);
  color: var(--ink-2);
}
.composer__replyto {
  min-width: 0;
  margin-left: 4px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer__replyto strong {
  color: var(--ink-2);
}
.composer__cancel {
  margin-left: auto;
  flex-shrink: 0;
}

/* `:deep()` obligatoire : RichEditor a deux racines (le champ + le Teleport de
   la poignée), donc l'attribut de scope du parent ne tombe pas sur le champ et
   un sélecteur scopé ordinaire ne le matche jamais — le texte se collait au
   bord, sans padding. */
.composer__box :deep(.composer__input) {
  display: block;
  width: 100%;
  border: none;
  padding: 10px 13px 10px;
  font-size: var(--fs-lg);
  line-height: 1.6;
  outline: none;
  /* ~3 lignes visibles : une seule ligne fait un composeur écrasé, qui
     n'invite pas à écrire plus d'une phrase. */
  min-height: 88px;
}

/* 5px : les 8px de padding interne des boutons complètent la marge de 13px du
   texte en dessous. Le filet sépare le chrome (identité + outils) de la zone de
   frappe — même partition que sur la création de topic. */
.composer__toolbar {
  padding: 2px 5px 6px;
  border-bottom: 1px solid var(--line);
}
/* Le tiroir vit dans la boîte, aligné sur le retrait de la barre d'outils. Sous
   700 px il devient une feuille fixée au bas de l'écran et ces marges ne
   s'appliquent plus (voir `StickerDrawer.vue`). */
.composer__stickers {
  margin: 0 5px 6px;
}

.composer__bottom {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px 10px;
}
/* `flex: 1` : sans lui le bouton « Poster » se collait à la fin de l'astuce
   clavier, au milieu du pied, au lieu de tomber au bord droit où le curseur
   remonte du champ. */
.composer__hint {
  flex: 1;
  font-size: var(--fs-xs);
  color: var(--ink-4);
  min-width: 0;
  padding-left: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer__pow {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

/* L'erreur est une phrase en français, pas une trace : elle sort du mono, qui
   la faisait lire comme un log. Cramoisi — l'orange est la couleur des actions,
   pas des échecs. */
.composer__error,
.composer__ok {
  max-width: var(--topic-col, 880px);
  margin: 8px auto 0;
  font-size: var(--fs-sm);
}
.composer__error {
  color: var(--warn);
  font-weight: 600;
}
.composer__ok {
  color: var(--ink-3);
}

/* Encarts d'identité : aplat teinté, sans bordure. Ils portent des informations
   irréversibles, ils ne doivent pas se lire comme de la décoration — mais un
   cadre gris à liseré ne les rendait pas plus sérieux, juste plus lourds. */
.encart,
.nudge,
.backup {
  max-width: var(--topic-col, 880px);
  margin: 0 auto 10px;
  padding: 12px 14px;
  background: var(--link-soft);
  border: none;
  border-radius: var(--r-control);
}
.encart__text {
  margin: 0 0 10px;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-2);
}
.encart__text strong {
  color: var(--ink);
}
.encart__actions,
.encart__form {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.encart__input {
  flex: 1;
  min-width: 140px;
}
.encart__hint {
  flex-basis: 100%;
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}

/* Le nudge et la sauvegarde parlent d'une perte possible, pas d'une identité :
   cramoisi, la seule couleur d'alerte de la charte. */
.nudge {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: var(--fs-md);
  color: var(--ink-2);
  background: var(--warn-soft);
}

.backup {
  background: var(--warn-soft);
}
.backup__warn {
  margin: 0 0 10px;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-2);
}
.backup__warn strong {
  color: var(--ink);
}
.backup__nsec {
  display: block;
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--ink);
  background: var(--surface);
  border: none;
  border-radius: var(--r-control);
  padding: 10px 12px;
  overflow-wrap: anywhere;
  margin-bottom: 10px;
}
.backup__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.encart-enter-active,
.encart-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.encart-enter-from,
.encart-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

@media (max-width: 820px) {
  .composer {
    padding-left: 10px;
    padding-right: 10px;
  }
  /* L'astuce clavier ne sert à rien au doigt, et elle mange la place du bouton. */
  .composer__hint {
    display: none;
  }
}

/* ------------------------------------------------------------ écran COURT
 * Le téléphone en paysage : 390 px de haut, dont 56 pour la barre. Le composeur
 * y prenait 200 px à lui seul — il ne restait du fil qu'une bande de 50 px, et
 * « Poster » tombait hors de l'écran. Une requête de LARGEUR ne voit rien de ce
 * cas : l'écran fait 844 px de large, il est « grand ».
 *
 * Ce qui rend de la hauteur, c'est la zone de frappe : elle est généreuse pour
 * inviter à écrire plus d'une phrase, et cette invitation ne vaut pas de cacher
 * ce à quoi on répond. Elle grandit toute seule à la frappe.
 */
@media (max-height: 560px) {
  .composer {
    padding-top: 6px;
    padding-bottom: 8px;
  }
  .composer__box :deep(.composer__input) {
    min-height: 44px;
  }
}
</style>
