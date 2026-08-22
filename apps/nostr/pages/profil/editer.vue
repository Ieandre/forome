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
                <!-- Dit AVANT le choix : découvrir qu'un GIF est refusé après
                     l'avoir choisi est une déception qu'une phrase évite. -->
                <template v-if="myLevel !== null && !open.gifAvatar">
                  Un GIF animé s'ouvre au niveau {{ GIF_AVATAR_LEVEL }}.
                </template>
                <template v-else-if="myLevel !== null">
                  Un GIF animé passe tel quel, sans recadrage, jusqu'à 1 Mo.
                </template>
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

            <!-- ============================================== apparence
                 Ce n'est pas une boutique : aucun prix, aucune pastille de
                 promotion, et le seul élément mis en avant est l'APERÇU juste
                 en dessous. On ne choisit pas une couleur dans une grille, on
                 s'habille devant une glace (§16.9). -->
            <fieldset v-if="myLevel !== null" class="edit__app">
              <legend class="edit__app-legend">Apparence</legend>

              <p class="edit__app-level mono">
                niveau {{ myLevel }}<template v-if="nextUnlock"> · {{ nextUnlock }}</template>
                <NuxtLink to="/classement" class="edit__app-link">classement</NuxtLink>
              </p>

              <!-- Un manque se formule en invitation, jamais en vitrine vide. -->
              <p v-if="myLevel < 2" class="edit__app-empty">
                Ta première couleur s'ouvre au niveau 2, une trentaine de points. Ouvre un topic — le
                premier message compte.
              </p>

              <template v-else>
                <div class="edit__field">
                  <span class="field__label">Couleur du pseudo</span>
                  <!-- Des vrais boutons radio, masqués : le navigateur donne les
                       flèches du clavier et le groupe accessible sans une ligne
                       de JS. Douze boutons auraient fait douze arrêts de
                       tabulation pour un seul choix. -->
                  <div class="edit__pal">
                    <div class="edit__pal-tier">
                      <p class="edit__pal-label mono">sans</p>
                      <div class="edit__pal-row">
                        <label class="pal" :class="{ 'pal--on': !form.color && !form.gradient }">
                          <input v-model="form.color" type="radio" name="pseudo-c" value="" class="visually-hidden" />
                          <span class="pal__dot pal__dot--none" />
                          <span class="visually-hidden">aucune couleur</span>
                        </label>
                      </div>
                    </div>

                    <!-- Les couleurs qu'on n'a pas encore sont montrées DANS
                         leur vraie couleur, en plus petit. Griser détruirait la
                         seule chose qui motive : voir ce qu'on vise. La taille
                         dit la disponibilité, un cadenas dirait « paie ». -->
                    <div v-for="t in colorTiers" :key="t.key" class="edit__pal-tier">
                      <p class="edit__pal-label mono">{{ t.label }}</p>
                      <div class="edit__pal-row">
                        <label
                          v-for="c in t.colors"
                          :key="c.id"
                          class="pal"
                          :class="{ 'pal--on': form.color === c.id, 'pal--locked': !t.open }"
                          @mouseenter="hovered = c.id"
                          @mouseleave="hovered = null"
                        >
                          <input
                            v-model="form.color"
                            type="radio"
                            name="pseudo-c"
                            :value="c.id"
                            :disabled="!t.open"
                            class="visually-hidden"
                          />
                          <span class="pal__dot pseudo--couleur" :style="dotStyle(c)" />
                          <span class="visually-hidden">
                            {{ c.label }}{{ t.open ? '' : ` — niveau ${c.level}` }}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                  <!-- Le nom est toujours là : c'est lui que les gens diront. -->
                  <p class="edit__pal-name">{{ shownColorName }}</p>
                </div>

                <div class="edit__field">
                  <span class="field__label">
                    Dégradé
                    <span v-if="!gradientsOpen" class="edit__app-gate mono">niveau {{ gradientLevel }}</span>
                  </span>
                  <div class="edit__pal">
                    <div class="edit__pal-tier">
                      <div class="edit__pal-row">
                        <label class="pal" :class="{ 'pal--on': !form.gradient }">
                          <input v-model="form.gradient" type="radio" name="pseudo-g" value="" class="visually-hidden" />
                          <span class="pal__dot pal__dot--none" />
                          <span class="visually-hidden">aucun dégradé</span>
                        </label>
                        <label
                          v-for="g in GRADIENTS"
                          :key="g.id"
                          class="pal"
                          :class="{ 'pal--on': form.gradient === g.id, 'pal--locked': !gradientsOpen }"
                          @mouseenter="hovered = g.id"
                          @mouseleave="hovered = null"
                        >
                          <input
                            v-model="form.gradient"
                            type="radio"
                            name="pseudo-g"
                            :value="g.id"
                            :disabled="!gradientsOpen"
                            class="visually-hidden"
                          />
                          <span class="pal__dot pal__dot--grad" :style="gradStyle(g)" />
                          <span class="visually-hidden">
                            {{ g.label }}{{ gradientsOpen ? '' : ` — niveau ${g.level}` }}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <label class="edit__check">
                    <input v-model="form.animated" type="checkbox" :disabled="!canAnimate" />
                    <span>
                      Le faire glisser
                      <span v-if="!open.animation" class="edit__app-gate mono">niveau {{ ANIMATION_LEVEL }}</span>
                    </span>
                  </label>
                  <p v-if="form.animated" class="field__hint">
                    Le seul mouvement du site. Il s'arrête de lui-même chez qui a demandé à son
                    système de réduire les animations.
                  </p>
                </div>

                <div class="edit__field">
                  <span class="field__label">
                    Cadre d'avatar
                    <span v-if="!open.ring" class="edit__app-gate mono">niveau {{ RING_LEVEL }}</span>
                  </span>
                  <div class="edit__radios">
                    <label class="edit__radio">
                      <input v-model="form.ring" type="radio" name="cadre" value="none" />
                      <span>aucun</span>
                    </label>
                    <label class="edit__radio">
                      <input v-model="form.ring" type="radio" name="cadre" value="color" :disabled="!open.ring" />
                      <span>ta couleur</span>
                    </label>
                    <label class="edit__radio">
                      <input
                        v-model="form.ring"
                        type="radio"
                        name="cadre"
                        value="gradient"
                        :disabled="!open.ringGradient"
                      />
                      <span>
                        dégradé
                        <span v-if="!open.ringGradient" class="edit__app-gate mono">
                          niveau {{ RING_GRADIENT_LEVEL }}
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <div class="field edit__field">
                  <label for="f-titre" class="field__label">
                    Titre
                    <span v-if="!open.title" class="edit__app-gate mono">niveau {{ TITLE_LEVEL }}</span>
                  </label>
                  <input
                    id="f-titre"
                    v-model="form.title"
                    type="text"
                    class="field__input"
                    :maxlength="TITLE_MAX_LEN"
                    :disabled="!open.title"
                    placeholder="gardien du seuil"
                  />
                  <p v-if="titleRejected" class="edit__app-refus">
                    Ce titre se ferait passer pour un rôle du forum. Le bouclier des modérateurs est
                    un objet à part, et un titre libre ne peut pas l'imiter.
                  </p>
                  <p v-else class="field__hint">
                    Ce que tu t'écris à côté de ton pseudo, {{ TITLE_MAX_LEN }} caractères au plus.
                  </p>
                </div>
              </template>
            </fieldset>

            <!-- Aperçu à la forme réelle : la barre d'auteur d'un post. Une carte
                 de profil générique montrerait un objet qui n'existe nulle part
                 dans ce forum ; ce bandeau-là est ce que les autres verront. -->
            <div class="edit__preview">
              <p class="edit__preview-label">Vu par les autres</p>
              <div class="edit__bar">
                <!-- L'avatar est ici depuis que le cadre existe : sans lui, un
                     item du catalogue serait invisible au moment où on le choisit. -->
                <UserAvatar
                  v-if="identity.pubkey"
                  :pubkey="identity.pubkey"
                  :size="26"
                  v-bind="previewRing"
                />
                <span class="edit__bar-author" v-bind="previewPseudo">{{ previewName }}</span>
                <span v-if="form.name.trim()" class="edit__bar-disc mono">·{{ identity.discriminator }}</span>
                <span v-if="previewTitle" class="titre-libre">{{ previewTitle }}</span>
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
import { prepareAvatarGif } from '~/utils/image'
import {
  ANIMATION_LEVEL,
  COLORS,
  GRADIENTS,
  GIF_AVATAR_LEVEL,
  RING_GRADIENT_LEVEL,
  RING_LEVEL,
  TITLE_LEVEL,
  TITLE_MAX_LEN,
  cleanTitle,
  colorById,
  gradientById,
  grantStyle,
  unlocks,
  type RingStyle,
} from '~/types/nostr'

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
  /* Apparence (§16.9). Dans le MÊME formulaire que le reste, donc dans le même
     `dirty` et le même « Publier le profil » : une pastille qui publierait au
     clic remplacerait le kind 0 une douzaine de fois pendant qu'on regarde, et
     chaque remplacement est un event poussé sur tous les relais. */
  color: string
  gradient: string
  animated: boolean
  ring: RingStyle
  title: string
  /** L'avatar déposé est un GIF animé (§16.9). Posé par le dépôt, pas à la main. */
  avatarAnim: boolean
}

const EMPTY: Form = {
  name: '',
  about: '',
  picture: '',
  nip05: '',
  website: '',
  signature: '',
  color: '',
  gradient: '',
  animated: false,
  ring: 'none',
  title: '',
  avatarAnim: false,
}

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

/* --------------------------------------------------------------- apparence */

const points = useUserPointsStore()

/** `null` tant qu'on ne sait pas : sans indexeur épinglé, il n'y a pas de niveau. */
const myLevel = computed(() => (identity.pubkey ? points.levelOf(identity.pubkey) : null))
const open = computed(() => unlocks(myLevel.value ?? 1))

/**
 * La palette rangée par palier, **jamais par teinte**.
 *
 * Le regroupement encode quelque chose de vrai — c'est une progression, pas un
 * nuancier — et c'est lui qui transforme la différence de taille des pastilles
 * en information plutôt qu'en second plan.
 */
const colorTiers = computed(() => {
  const lvl = myLevel.value ?? 1
  const out: { key: string; open: boolean; label: string; colors: typeof COLORS }[] = []
  // Tout l'acquis dans UN groupe : deux groupes étiquetés « à toi » côte à côte
  // ne distinguaient rien et lisaient comme une répétition. Ce qui mérite une
  // frontière, c'est acquis / pas encore.
  const acquises = COLORS.filter((c) => c.level <= lvl)
  if (acquises.length > 0) out.push({ key: 'acquis', open: true, label: 'à toi', colors: acquises })
  const aVenir = [...new Set(COLORS.filter((c) => c.level > lvl).map((c) => c.level))].sort(
    (a, b) => a - b,
  )
  for (const level of aVenir) {
    out.push({
      key: `n${level}`,
      open: false,
      label: `niveau ${level}`,
      colors: COLORS.filter((c) => c.level === level),
    })
  }
  return out
})

const gradientLevel = GRADIENTS[0]?.level ?? 9
const gradientsOpen = computed(() => (myLevel.value ?? 1) >= gradientLevel)

/** Survolée, sinon choisie. Les noms sont le propos : ils ne disparaissent jamais. */
const hovered = ref<string | null>(null)
const shownColorName = computed(() => {
  const id = hovered.value ?? form.value.color
  const c = COLORS.find((x) => x.id === id)
  if (c) return c.level > (myLevel.value ?? 1) ? `${c.label} — niveau ${c.level}` : c.label
  const g = GRADIENTS.find((x) => x.id === id)
  if (g) return g.level > (myLevel.value ?? 1) ? `${g.label} — niveau ${g.level}` : g.label
  return 'aucune couleur'
})

/**
 * La prochaine chose, et rien d'autre.
 *
 * Dérouler les cinq paliers à venir donnerait l'écran de progression d'un jeu
 * mobile ; une phrase est une information.
 */
const nextUnlock = computed(() => {
  const lvl = myLevel.value
  if (lvl === null) return null
  const steps: [number, string][] = [
    [2, 'les six premières couleurs'],
    [TITLE_LEVEL, 'les couleurs vives et le titre libre'],
    [RING_LEVEL, "le cadre d'avatar"],
    [RING_GRADIENT_LEVEL, 'les dégradés'],
    [ANIMATION_LEVEL, 'le dégradé animé'],
    [GIF_AVATAR_LEVEL, "l'avatar animé"],
  ]
  const next = steps.find(([at]) => lvl < at)
  return next ? `le niveau ${next[0]} ouvre ${next[1]}` : 'tout est ouvert'
})

/** Les deux thèmes partent ensemble : c'est le CSS qui tranche (voir `main.css`). */
function dotStyle(c: { light: string; dark: string }): Record<string, string> {
  return { '--pseudo-l': c.light, '--pseudo-d': c.dark }
}

function gradStyle(g: { light: string[]; dark: string[] }): Record<string, string> {
  return { '--grad-l': g.light.join(', '), '--grad-d': g.dark.join(', ') }
}

/**
 * Le titre est refusé, et on dit pourquoi.
 *
 * `cleanTitle` rend `null` sur un titre qui usurpe une autorité du forum. Le
 * taire laisserait publier un champ qui disparaît au rendu — donc un bug, du
 * point de vue de la personne.
 */
const titleRejected = computed(
  () => form.value.title.trim().length > 0 && cleanTitle(form.value.title) === null,
)

/** L'animation n'anime qu'un dégradé : sans dégradé choisi, la case ne sert à rien. */
const canAnimate = computed(() => open.value.animation && !!form.value.gradient)

/**
 * Ce que l'aperçu montre : l'apparence **accordée** au formulaire en cours, pas
 * celle du profil publié.
 *
 * La différence compte : on veut voir ce qu'on vient de choisir, et on veut le
 * voir passer par le même portier que les autres lecteurs — donc une couleur
 * revendiquée trop haut ne s'affiche pas ici non plus, plutôt que de mentir
 * jusqu'à la publication.
 */
const previewStyle = computed(() =>
  grantStyle(
    {
      color: form.value.color || null,
      gradient: form.value.gradient || null,
      animated: form.value.animated,
      ring: form.value.ring,
      title: cleanTitle(form.value.title),
      avatarAnim: form.value.avatarAnim,
    },
    myLevel.value ?? 1,
  ),
)

const previewTitle = computed(() => previewStyle.value.title)

const previewPseudo = computed<Record<string, unknown>>(() => {
  const g = gradientById(previewStyle.value.gradient)
  if (g) {
    return {
      class: ['pseudo--degrade', previewStyle.value.animated ? 'pseudo--anime' : null],
      style: gradStyle(g),
    }
  }
  const c = colorById(previewStyle.value.color)
  return c ? { class: 'pseudo--couleur', style: dotStyle(c) } : {}
})

const previewRing = computed<Record<string, unknown>>(() => {
  const s = previewStyle.value
  if (s.ring === 'none') return {}
  const g = gradientById(s.gradient)
  if (s.ring === 'gradient' && g) return { class: 'cadre--degrade', style: gradStyle(g) }
  const c = colorById(s.color)
  return c ? { class: 'cadre--couleur', style: dotStyle(c) } : {}
})

const upload = useAvatarUpload()

/** Le fichier en cours de cadrage. Non nul = le cadreur est ouvert. */
const picking = ref<File | null>(null)

async function onPick(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // Le champ est remis à zéro tout de suite : sans ça, rechoisir le même fichier
  // après une annulation ou un échec ne déclencherait aucun `change`.
  input.value = ''
  if (!file) return

  /*
   * Un GIF ne passe PAS par le cadreur (§16.9) : celui-ci recadre au canevas, et
   * un canevas ne garde que la première image — le recadrage tuerait exactement
   * ce qu'on est venu chercher. Il part donc tel quel, et le carré est fait à
   * l'affichage par `object-fit`.
   */
  if (file.type === 'image/gif') {
    if (!open.value.gifAvatar) {
      upload.error.value = `L'avatar animé s'ouvre au niveau ${GIF_AVATAR_LEVEL}. Une image fixe, en revanche, marche tout de suite.`
      return
    }
    try {
      const prepared = await prepareAvatarGif(file)
      const url = await upload.upload(prepared.blob, prepared.type)
      if (url) {
        form.value.picture = url
        form.value.avatarAnim = true
      }
    } catch (err) {
      upload.error.value = err instanceof Error ? err.message : 'ce GIF n’a pas pu être lu'
    }
    return
  }

  picking.value = file
}

/**
 * Le dépôt suit le cadrage, mais l'enregistrement du profil reste explicite :
 * `picture` ne contient l'adresse qu'après un envoi réussi, et « Enregistrer »
 * décide seul de ce qui part dans le kind 0.
 */
async function onCropped(blob: Blob, type: string): Promise<void> {
  picking.value = null
  const url = await upload.upload(blob, type)
  if (url) {
    form.value.picture = url
    // Une image fixe remplace un GIF : laisser la marque d'animation ferait
    // décoder une première image qui n'existe pas, à chaque vignette.
    form.value.avatarAnim = false
  }
}

function clearPicture(): void {
  form.value.avatarAnim = false
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

const { copied: jsonCopied, copy } = useCopy()

function copyNostrJson(): void {
  void copy(nip05FileBody.value)
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
    color: str(raw.forome_color).slice(0, 40),
    gradient: str(raw.forome_gradient).slice(0, 40),
    animated: raw.forome_anim === '1',
    ring: raw.forome_ring === 'color' || raw.forome_ring === 'gradient' ? raw.forome_ring : 'none',
    title: str(raw.forome_title).slice(0, TITLE_MAX_LEN),
    avatarAnim: raw.forome_avatar_anim === '1',
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
      // Chaîne vide = clé retirée du kind 0 (voir `publishPatch`) : « aucune
      // couleur » ne laisse donc pas un champ orphelin derrière lui.
      forome_color: form.value.color,
      forome_gradient: form.value.gradient,
      forome_anim: form.value.animated ? '1' : '',
      forome_ring: form.value.ring === 'none' ? '' : form.value.ring,
      forome_title: form.value.title,
      forome_avatar_anim: form.value.avatarAnim ? '1' : '',
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

/* ----------------------------------------------------------------- apparence
 * Un formulaire, jamais une boutique. Deux règles portent tout :
 *
 *   1. **aucun cadenas, aucun grisé.** Les couleurs qu'on n'a pas encore sont
 *      montrées dans leur VRAIE couleur, en plus petit. Griser détruirait la
 *      seule chose qui motive — voir ce qu'on vise — et un cadenas a le
 *      vocabulaire du paiement. La taille dit la disponibilité.
 *   2. **le nom est toujours affiché.** « Le mec au pseudo cramoisi » est une
 *      phrase que les gens diront ; une pastille anonyme ne la produit pas.
 */
.edit__app {
  margin: 0 0 14px;
  padding: 13px 14px 4px;
  border: 0;
  background: var(--surface-sunken);
  border-radius: var(--r-control);
}
.edit__app-legend {
  padding: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
}
.edit__app-level {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
  margin: 0 0 14px;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.edit__app-link {
  margin-left: auto;
  color: var(--link);
}
.edit__app-empty {
  margin: 0 0 12px;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-4);
}
/* Le palier qui manque, dans le registre de la provenance : un nombre, pas une
   promesse commerciale. */
.edit__app-gate {
  margin-left: 6px;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--ink-4);
}
.edit__app-refus {
  margin: 5px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--warn);
}

.edit__pal {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 6px;
}
.edit__pal-tier {
  min-width: 0;
}
.edit__pal-label {
  margin: 0 0 5px;
  font-size: var(--fs-xs);
  color: var(--ink-4);
}
.edit__pal-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.edit__pal-name {
  margin: 9px 0 0;
  font-size: var(--fs-md);
  color: var(--ink-2);
}

.pal {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  cursor: pointer;
}
.pal__dot {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background-color: var(--pseudo-couleur, var(--ink-4));
  transition: width 0.12s ease, height 0.12s ease;
}
.pal__dot--grad {
  background-color: transparent;
  background-image: linear-gradient(135deg, var(--grad-l));
}
/* « aucune » : un anneau creux, pas une pastille grise — l'absence de couleur
   est un choix, pas une couleur éteinte. */
.pal__dot--none {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--line-strong);
}
/* La taille EST l'affordance : pas encore à toi, donc plus petit. */
.pal--locked .pal__dot {
  width: 15px;
  height: 15px;
}
.pal--locked {
  cursor: not-allowed;
}
.pal--on {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px var(--ink-3);
}
.pal:focus-within {
  box-shadow: var(--ring);
}
@media (prefers-reduced-motion: reduce) {
  .pal__dot {
    transition: none;
  }
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .pal__dot--grad {
    background-image: linear-gradient(135deg, var(--grad-d));
  }
}
:root[data-theme='dark'] .pal__dot--grad {
  background-image: linear-gradient(135deg, var(--grad-d));
}

.edit__check,
.edit__radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-md);
  color: var(--ink-2);
  cursor: pointer;
}
.edit__check {
  margin-top: 10px;
}
.edit__radios {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 6px;
}
.edit__check input:disabled + span,
.edit__radio input:disabled + span {
  color: var(--ink-4);
  cursor: not-allowed;
}

/* La glace ne doit pas quitter l'écran pendant qu'on choisit : au téléphone,
   choisir une couleur sans voir son pseudo revient à choisir à l'aveugle. */
@media (max-width: 700px) {
  .edit__preview {
    position: sticky;
    bottom: 0;
    z-index: 1;
    margin-bottom: 0;
    padding: 8px 0;
    background: var(--surface);
  }
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
/* Même contrat que dans le fil : la couleur vient de `--pseudo-couleur` quand
   l'apparence en pose une, du bleu de l'interface sinon (voir `main.css`). */
.edit__bar-author {
  font-weight: 700;
  font-size: var(--fs-base);
  letter-spacing: -0.01em;
  color: var(--pseudo-couleur, var(--link));
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
