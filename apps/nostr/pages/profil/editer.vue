<template>
  <div class="edit">
    <section class="panel edit__card">
      <div class="edit__split">
        <!-- `declared-name` suit la frappe : le rail lâche le handle de repli à
             la seconde où un pseudo est saisi, ce qui montre le mécanisme au lieu
             de l'expliquer. -->
        <ProfileKeyRail
          v-if="identity.pubkey"
          :pubkey="identity.pubkey"
          :declared-name="form.name.trim() || null"
        />
        <div v-else class="edit__rail-wait">
          <div class="skeleton edit__rail-skel" />
        </div>

        <form class="edit__form" @submit.prevent="submit">
          <div v-if="loading" class="edit__skel">
            <div v-for="i in 4" :key="i" class="skeleton edit__skel-field" />
          </div>

          <template v-else>
            <div class="field edit__field">
              <label for="f-name" class="field__label">Pseudo</label>
              <input
                id="f-name"
                v-model="form.name"
                class="field__input"
                maxlength="40"
                placeholder="ton pseudo"
                autocomplete="off"
              />
            </div>

            <div class="field edit__field">
              <label for="f-about" class="field__label">À propos</label>
              <textarea
                id="f-about"
                v-model="form.about"
                class="field__input edit__textarea"
                maxlength="1000"
                rows="4"
                placeholder="deux lignes sur toi"
              />
            </div>

            <!-- Un fichier, pas une adresse : le champ URL d'avant supposait que
                 la personne héberge déjà son image et sache ce qu'est un lien
                 direct. C'est nous qui déposons et qui écrivons l'adresse. -->
            <div class="field edit__field">
              <span class="field__label">Photo de profil</span>
              <div class="pic">
                <!-- Une seule vignette : l'aperçu local s'il y en a un, sinon
                     l'avatar en vigueur. En afficher deux ne dirait pas laquelle
                     compte. -->
                <img v-if="upload.preview.value" :src="upload.preview.value" class="pic__img" alt="" />
                <UserAvatar
                  v-else-if="identity.pubkey"
                  :pubkey="identity.pubkey"
                  :size="56"
                  class="pic__img"
                />

                <div class="pic__acts">
                  <label class="btn btn--sm pic__pick">
                    {{ form.picture ? 'Changer la photo' : 'Choisir une photo' }}
                    <input
                      type="file"
                      accept="image/*"
                      class="pic__file"
                      :disabled="upload.busy.value || !!picking"
                      @change="onPick"
                    />
                  </label>
                  <button
                    v-if="form.picture"
                    type="button"
                    class="btn btn--sm btn--ghost"
                    :disabled="upload.busy.value"
                    @click="clearPicture"
                  >
                    Retirer
                  </button>
                </div>
              </div>

              <!-- Le cadreur prend la place du reste tant qu'il est ouvert : deux
                   états de la même photo côte à côte ne diraient pas lequel compte. -->
              <AvatarCropper v-if="picking" :file="picking" @done="onCropped" @cancel="picking = null" />

              <p v-else-if="upload.busy.value" class="field__hint">Envoi de la photo…</p>
              <p v-else-if="upload.error.value" class="field__error">{{ upload.error.value }}</p>
              <p v-else class="field__hint">
                Recadrée en carré. Sans photo, c'est ton identicon qui s'affiche.
              </p>
            </div>

            <div class="field edit__field">
              <!-- Le nom du standard n'est pas le nom de la chose : « NIP-05 » ne
                   dit pas ce que le champ fait. Il reste dans l'aide, où il sert
                   à chercher la doc de son hébergeur. -->
              <label for="f-nip05" class="field__label">Nom vérifié par un domaine</label>
              <input
                id="f-nip05"
                v-model="form.nip05"
                class="field__input"
                maxlength="200"
                placeholder="toi@ton-domaine.fr"
                autocomplete="off"
              />
              <p class="field__hint">
                Optionnel. Il te faut un site à toi : c'est lui qui confirmera que cette clé est bien
                la tienne.
              </p>
              <p v-if="nip05Note" class="field__hint edit__nip05" :class="nip05NoteClass">{{ nip05Note }}</p>

              <!-- Le champ demandait « toi@ton-domaine.fr » sans dire à qui il
                   s'adresse ni quoi déposer où : intenable sans un site à soi.
                   Le guide est replié (qui sait déjà remplit sans lire) et il ne
                   DÉCRIT pas le fichier, il le DONNE — nom et clé déjà dedans,
                   pris de ce qui est tapé au-dessus. C'est la seule étape qu'un
                   lecteur ne peut pas deviner. -->
              <details class="guide edit__guide">
                <summary class="guide__toggle">Je ne sais pas quoi mettre</summary>
                <ol class="guide__steps">
                  <li class="guide__step">
                    <span class="guide__num mono">1</span>
                    <span>
                      <strong>Il te faut un domaine à toi</strong> — ton site, ton blog. Sans ça,
                      laisse le champ vide : tu peux tout faire sur le forum sans.
                    </span>
                  </li>
                  <li class="guide__step">
                    <span class="guide__num mono">2</span>
                    <span>
                      <strong>Écris l'adresse au-dessus.</strong> Le nom avant le
                      <code>@</code> est libre, le domaine après doit être le tien —
                      <code class="mono">{{ nip05Local }}@{{ nip05Domain }}</code>
                    </span>
                  </li>
                  <li class="guide__step">
                    <span class="guide__num mono">3</span>
                    <span>
                      <strong>Dépose ce fichier sur ton site</strong>, à l'adresse
                      <code class="mono edit__guide-url">{{ nip05FileUrl }}</code>

                      <span class="edit__file">
                        <span class="edit__file-head">
                          <span class="edit__file-name mono">nostr.json</span>
                          <button type="button" class="btn btn--sm" @click="copyNostrJson">
                            {{ jsonCopied ? 'Copié' : 'Copier le fichier' }}
                          </button>
                        </span>
                        <code class="edit__file-body mono">{{ nip05FileBody }}</code>
                      </span>

                      Si ton hébergeur refuse que d'autres sites le lisent, la vérification restera
                      bloquée sur « domaine injoignable » : c'est l'en-tête
                      <code class="mono">Access-Control-Allow-Origin: *</code> qu'il faut lui
                      demander.
                    </span>
                  </li>
                </ol>
                <p class="guide__end">
                  Publie ensuite ton profil : la mention sous le champ passe à « Vérifié » dès que le
                  domaine répond. Si elle dit l'inverse, c'est le fichier qu'il faut corriger, pas ton
                  profil. Et ce nom tient à ce domaine : le perdre te fait perdre le nom, jamais ton
                  identité — elle, c'est ta clé.
                </p>
              </details>
            </div>

            <div class="field edit__field">
              <label for="f-website" class="field__label">Site</label>
              <input
                id="f-website"
                v-model="form.website"
                class="field__input"
                maxlength="300"
                inputmode="url"
                placeholder="https://…"
                autocomplete="off"
              />
            </div>

            <!-- Dernier champ du formulaire, et le seul qui change quelque chose
                 dans le fil : les autres décrivent qui tu es, celui-ci s'ajoute
                 à ce que tu écris. D'où sa place juste au-dessus de l'aperçu,
                 qui le montre en situation. -->
            <div class="field edit__field">
              <label for="f-sig" class="field__label">Signature</label>
              <textarea
                id="f-sig"
                v-model="form.signature"
                class="field__input edit__sig-input"
                maxlength="150"
                rows="2"
                placeholder="deux lignes au bas de chacun de tes messages"
              />
              <p class="field__hint">
                Texte simple : ni image, ni mise en forme. La modifier change aussi le pied de tes messages déjà
                publiés.
              </p>
            </div>

            <!-- Aperçu à la forme réelle : la barre d'auteur d'un post. Une carte
                 de profil générique montrerait un objet qui n'existe nulle part
                 dans ce forum ; ce bandeau-là est ce que les autres verront. -->
            <div class="edit__preview">
              <p class="edit__preview-label">Vu par les autres</p>
              <div class="edit__bar">
                <span class="edit__bar-author">{{ previewName }}</span>
                <span v-if="form.name.trim()" class="edit__bar-disc mono">·{{ identity.discriminator }}</span>
                <span v-if="form.nip05.trim()" class="tag">nip-05 ?</span>
                <span class="edit__bar-spacer" />
                <span class="edit__bar-time mono">à {{ previewTime }}</span>
              </div>
              <!-- Clampée à deux lignes comme dans le fil, pas comme sur la page
                   de profil : un aperçu qui montre plus que la destination ne
                   prévient de rien. -->
              <p v-if="form.signature.trim()" class="edit__sig">{{ form.signature }}</p>
            </div>

            <!-- La fusion avec les champs qu'on n'affiche pas (adresse Lightning,
                 bannière…) est garantie par `publishPatch`, pas par une phrase
                 rassurante à l'écran : le lecteur n'a rien à en faire, et il n'a
                 pas à savoir qu'un bug était possible ici. -->
            <div class="edit__actions">
              <Hint text="publier remplace ton profil précédent sur les relais">
                <button type="submit" class="btn btn--primary" :disabled="!dirty || publishing">
                  {{ publishing ? 'Publication…' : 'Publier le profil' }}
                </button>
              </Hint>
              <button type="button" class="btn" :disabled="!dirty || publishing" @click="reset">
                Annuler les modifications
              </button>
              <NuxtLink v-if="identity.pubkey" :to="`/profil/${npub}`" class="btn btn--ghost">
                Voir mon profil
              </NuxtLink>
            </div>

            <p v-if="error" class="edit__error">{{ error }}</p>
            <p v-else-if="published" class="edit__ok">
              Publié. Ton profil est remplacé sur les relais qui l'ont accepté.
            </p>
          </template>
        </form>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * Modification du profil (spec §11.1).
 *
 * Page jumelle de `/profil/[key]` : même scission, même rail gauche, mais la
 * colonne droite est un formulaire. Ce qui est prouvé reste en lecture seule —
 * on ne « modifie » pas une clé, on en change, et c'est une autre action.
 *
 * Le piège de fond est ailleurs, dans le protocole : **kind 0 est remplaçable**.
 * Publier un profil qui ne contient que les cinq champs de ce formulaire
 * effacerait tous les autres — `lud16`, `banner`, ce qu'un autre client a posé.
 * D'où `publishPatch`, qui relit le profil courant, fusionne, et refuse de
 * publier s'il n'a pas pu le relire.
 */
import { ref, computed, watch } from 'vue'
import { npubFor } from '~/utils/nostr'

usePageTitle('Modifier mon profil')

const identity = useIdentityStore()
const profiles = useProfileStore()

interface Form {
  name: string
  about: string
  picture: string
  nip05: string
  website: string
  signature: string
}

const EMPTY: Form = { name: '', about: '', picture: '', nip05: '', website: '', signature: '' }

const form = ref<Form>({ ...EMPTY })
const initial = ref<Form>({ ...EMPTY })
const loading = ref(true)
const publishing = ref(false)
const published = ref(false)
const error = ref<string | null>(null)
/**
 * Vrai si le profil courant porte déjà un `display_name`. Ce client affiche
 * `display_name ?? name` : si on n'écrivait que `name`, le pseudo saisi ici ne
 * serait pas celui affiché. On garde donc les deux alignés — sans jamais
 * introduire `display_name` de notre côté, ni le supprimer.
 */
const hadDisplayName = ref(false)

const npub = computed(() => (identity.pubkey ? npubFor(identity.pubkey) : ''))

const upload = useAvatarUpload()

/** Le fichier en cours de cadrage. Non nul = le cadreur est ouvert. */
const picking = ref<File | null>(null)

function onPick(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // Le champ est remis à zéro tout de suite : sans ça, rechoisir le même fichier
  // après une annulation ou un échec ne déclencherait aucun `change`.
  input.value = ''
  if (file) picking.value = file
}

/**
 * Le dépôt suit le cadrage, mais l'enregistrement du profil reste explicite :
 * `picture` ne contient l'adresse qu'après un envoi réussi, et « Enregistrer »
 * décide seul de ce qui part dans le kind 0.
 */
async function onCropped(blob: Blob, type: string): Promise<void> {
  picking.value = null
  const url = await upload.upload(blob, type)
  if (url) form.value.picture = url
}

function clearPicture(): void {
  upload.clearPreview()
  form.value.picture = ''
}

const dirty = computed(() => (Object.keys(form.value) as (keyof Form)[]).some((k) => form.value[k] !== initial.value[k]))

const previewName = computed(() => form.value.name.trim() || identity.handle || '…')
const previewTime = computed(() =>
  new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
)

/** État de vérification du NIP-05 déjà publié — jamais de celui en cours de frappe. */
const nip05Note = computed(() => {
  if (!identity.pubkey) return null
  if (form.value.nip05.trim() !== initial.value.nip05.trim()) {
    return initial.value.nip05.trim()
      ? 'Vérifié seulement après publication : la valeur affichée ci-dessous ne bougera qu’une fois le profil publié.'
      : null
  }
  switch (profiles.nip05StatusOf(identity.pubkey)) {
    case 'valid':
      return 'Vérifié : le domaine reconnaît ta clé sous ce nom.'
    case 'invalid':
      return 'Le domaine ne reconnaît pas ta clé sous ce nom — il manque l’entrée dans son fichier nostr.json.'
    case 'unreachable':
      return 'Domaine injoignable (ou CORS refusé). Ça ne prouve rien, ni dans un sens ni dans l’autre.'
    default:
      return null
  }
})
const nip05NoteClass = computed(() => {
  if (!identity.pubkey) return ''
  const s = profiles.nip05StatusOf(identity.pubkey)
  if (form.value.nip05.trim() !== initial.value.nip05.trim()) return ''
  return s === 'invalid' ? 'edit__nip05--bad' : s === 'valid' ? 'edit__nip05--ok' : ''
})

/**
 * Le guide n'explique pas un format, il rend le fichier à déposer : le nom vient
 * de ce qui est tapé au-dessus, la clé de cette identité. Tant que le champ est
 * vide, il montre l'exemple du gabarit plutôt qu'un trou.
 */
const nip05Parts = computed(() => {
  const [local = '', domain = ''] = form.value.nip05.trim().split('@')
  return { local: local.trim(), domain: domain.trim() }
})
const nip05Local = computed(() => nip05Parts.value.local || 'toi')
const nip05Domain = computed(() => nip05Parts.value.domain || 'ton-domaine.fr')
const nip05FileUrl = computed(() => `https://${nip05Domain.value}/.well-known/nostr.json`)
const nip05FileBody = computed(() =>
  JSON.stringify(
    { names: { [nip05Local.value]: identity.pubkey || 'ta-clé-publique-en-hexadécimal' } },
    null,
    2,
  ),
)

const jsonCopied = ref(false)
let jsonTimer: ReturnType<typeof setTimeout> | null = null

async function copyNostrJson(): Promise<void> {
  try {
    await navigator.clipboard.writeText(nip05FileBody.value)
    jsonCopied.value = true
    if (jsonTimer) clearTimeout(jsonTimer)
    jsonTimer = setTimeout(() => (jsonCopied.value = false), 1600)
  } catch {
    // presse-papiers refusé (contexte non sécurisé, permission) : le bloc reste
    // sélectionnable à la main, on n'affiche pas d'erreur pour ça
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Remplit le formulaire depuis le kind 0 **brut**, pas depuis sa réduction. */
async function loadCurrent(): Promise<void> {
  const me = identity.pubkey
  if (!me) return
  loading.value = true
  error.value = null
  const status = await profiles.fetchOne(me)
  if (status === 'error') {
    error.value =
      'Ton profil actuel est illisible : aucun relais n’a répondu. Publier maintenant écraserait ce qu’on n’a pas pu lire — recharge la page quand la connexion est revenue.'
  }

  let raw: Record<string, unknown> = {}
  const current = profiles.rawOf(me)
  if (current) {
    try {
      const parsed = JSON.parse(current.content) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
    } catch {
      // kind 0 illisible : formulaire vide, publier le remplacera par du valide
    }
  }

  hadDisplayName.value = !!str(raw.display_name).trim()
  const next: Form = {
    name: (str(raw.display_name).trim() || str(raw.name)).slice(0, 40),
    about: str(raw.about).slice(0, 1000),
    picture: str(raw.picture).slice(0, 500),
    nip05: str(raw.nip05).slice(0, 200),
    website: str(raw.website).slice(0, 300),
    signature: str(raw.forome_signature).slice(0, 150),
  }
  form.value = { ...next }
  initial.value = { ...next }
  loading.value = false
}

function reset(): void {
  form.value = { ...initial.value }
  error.value = null
  published.value = false
}

async function submit(): Promise<void> {
  if (!dirty.value || publishing.value) return
  publishing.value = true
  error.value = null
  published.value = false
  try {
    const patch: Record<string, string | null> = {
      name: form.value.name,
      about: form.value.about,
      picture: form.value.picture,
      nip05: form.value.nip05,
      website: form.value.website,
      forome_signature: form.value.signature,
    }
    if (hadDisplayName.value) patch.display_name = form.value.name

    const res = await profiles.publishPatch(patch)
    if (res.ok) {
      published.value = true
      initial.value = { ...form.value }
      // `publishPatch` a ingéré le nouveau kind 0 : `UserAvatar` lit désormais la
      // photo publiée, et garder l'aperçu local afficherait la même chose deux fois.
      upload.clearPreview()
    } else {
      error.value = res.error
    }
  } finally {
    publishing.value = false
  }
}

// L'identité est générée au démarrage par un plugin client : à l'arrivée
// directe sur cette URL, elle peut n'être prête qu'un tour plus tard. Le
// watcher immédiat couvre les deux cas — un `onMounted` en plus relancerait une
// seconde requête concurrente sur le même profil.
watch(() => identity.pubkey, () => void loadCurrent(), { immediate: true })
</script>

<style scoped>
/* Même carcasse que `/profil/[key]` : c'est volontaire, les deux pages sont la
   même anatomie, l'une en lecture et l'autre en écriture. */
.edit {
  height: 100%;
  overflow-y: auto;
  padding: 20px 12px 28px;
  max-width: 940px;
  margin: 0 auto;
}

.edit__card {
  overflow: hidden;
}
.edit__split {
  display: grid;
  grid-template-columns: 210px 1fr;
}

.edit__rail-wait {
  padding: 22px 16px;
  background: var(--surface-2);
  border-right: 1px solid var(--line-soft);
}
.edit__rail-skel {
  height: 88px;
}

/* ------------------------------------------------------------- formulaire */

.edit__form {
  padding: 20px 22px 22px;
  min-width: 0;
}

.edit__field {
  margin-bottom: 14px;
}
.edit__textarea {
  resize: vertical;
  min-height: 68px;
  line-height: 1.5;
}

/* ------------------------------------------------------------ photo de profil */
.pic {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}
.pic__img {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  object-fit: cover;
  background: var(--surface-2);
  border-radius: var(--r-control);
  box-shadow: inset 0 0 0 1px rgba(13, 22, 44, 0.08);
}
.pic__acts {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
/* Le `<label>` EST le bouton : un vrai `<input type=file>` visible n'a ni le même
   dessin d'un navigateur à l'autre ni le libellé qu'on veut. Il reste dans le
   label, donc le clavier et le lecteur d'écran l'atteignent normalement — le
   masquer avec `display: none` le retirerait de l'ordre de tabulation. */
.pic__pick {
  position: relative;
  overflow: hidden;
}
.pic__file {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  font-size: 0;
}
.edit__nip05--ok {
  color: var(--ok);
}
.edit__nip05--bad {
  color: var(--warn);
}

.edit__guide {
  margin-top: 3px;
}
/* Une URL ne se coupe pas comme une phrase, et celle-ci est le seul endroit du
   guide où un caractère de travers fait tout échouer. */
.edit__guide-url {
  overflow-wrap: anywhere;
}

/* Le fichier est l'objet à emporter, pas une citation : surface enfoncée,
   en-tête qui le nomme, et le bouton dans son cadre plutôt qu'à côté du texte. */
.edit__file {
  display: block;
  margin: 7px 0;
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  background: var(--surface-sunken);
  overflow: hidden;
}
.edit__file-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  padding: 5px 6px 5px 9px;
  border-bottom: 1px solid var(--line);
}
.edit__file-name {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.edit__file-body {
  display: block;
  padding: 8px 9px 9px;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink);
  white-space: pre;
  overflow-x: auto;
}

/* ---------------------------------------------------------------- aperçu */

.edit__preview {
  margin: 16px 0 12px;
}
.edit__preview-label {
  margin: 0 0 5px;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
/* Reprise exacte de la barre d'auteur du fil, refonte comprise : plus de fond
   gris ni de cadre, la carte de message n'en a plus. Pseudo en bleu et en gras,
   discriminant en mono, heure à droite. */
.edit__bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  box-shadow: var(--elev-1);
  font-size: var(--fs-sm);
}
.edit__bar-author {
  font-weight: 700;
  font-size: var(--fs-base);
  letter-spacing: -0.01em;
  color: var(--link);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 22ch;
}
.edit__bar-disc {
  font-size: var(--fs-xs);
  color: var(--ink-4);
}
.edit__bar-spacer {
  flex: 1;
  min-width: 6px;
}
.edit__bar-time {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

.edit__sig-input {
  resize: vertical;
  min-height: 46px;
  line-height: 1.45;
}

/* Reprise de `.msg__sig` : l'aperçu n'a d'intérêt que s'il est le même objet que
   dans le fil. Sans le retrait de 53 px de la colonne d'avatar, en revanche —
   l'aperçu ne montre pas l'avatar, et une gouttière vide creusée pour un objet
   absent se lit comme un défaut d'alignement, pas comme une fidélité. */
.edit__sig {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  margin: 9px 0 0;
  padding-top: 6px;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--ink-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}


.edit__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
}

.edit__error,
.edit__ok {
  margin: 11px 0 0;
  font-size: var(--fs-md);
  line-height: 1.55;
}
.edit__error {
  color: var(--warn);
  font-weight: 600;
}
.edit__ok {
  color: var(--ok);
}

.edit__skel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.edit__skel-field {
  height: 46px;
}

@media (max-width: 720px) {
  .edit {
    padding: 8px;
  }
  .edit__split {
    grid-template-columns: 1fr;
  }
  .edit__rail-wait {
    border-right: none;
    border-bottom: 1px solid var(--line);
  }
}
</style>
