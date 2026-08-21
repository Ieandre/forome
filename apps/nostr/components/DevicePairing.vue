<template>
  <div class="pair" :class="{ 'pair--neuf': identity.unusedIdentity, 'pair--recu': arrivedByQr }">
    <!-- Trois actions à plat, pas trois onglets : ce ne sont pas trois vues d'un
         même objet mais trois conséquences distinctes (copier / remplacer /
         sortir la clé). Les cacher derrière des onglets obligeait à cliquer pour
         découvrir ce qui existe, et masquait la seule option qui protège
         vraiment — le signeur distant. L'ordre, lui, dépend d'où l'on se tient :
         sur un appareil dont l'identité n'a jamais servi, on vient REPRENDRE un
         compte, et cette carte passe en tête (`.pair--neuf`). -->

    <section class="card card--export">
      <div class="card__head">
        <h2 class="card__title">Ajouter un appareil</h2>
        <span class="card__lead">Ta clé part sur l'autre appareil, par QR ou par copie.</span>
      </div>

      <template v-if="nsec">
        <p class="card__warn">
          <strong>Qui photographie ce QR devient toi</strong>, définitivement — une clé ne s'annule
          pas et ne se remplace pas. Regarde autour de toi avant de l'afficher.
        </p>

        <div v-if="!revealed" class="card__actions">
          <button type="button" class="btn btn--primary" @click="reveal">
            Afficher le QR ({{ HOLD_S }} s)
          </button>
          <button type="button" class="btn" @click="copy">
            {{ copied ? 'copié' : 'Copier ma clé' }}
          </button>
        </div>

        <div v-else class="reveal">
          <QrCode :text="qrText" :size="200" />
          <div class="reveal__side">
            <p class="reveal__count mono">masqué dans {{ remaining }} s</p>
            <!-- Le QR porte un LIEN vers cette page, clé dans le fragment : un
                 appareil photo n'a alors rien à faire recopier, il ouvre Forome
                 qui propose la reprise. Le fragment ne part pas dans la requête
                 HTTP — c'est ce qui rend le lien acceptable. -->
            <p v-if="qrMode === 'link'" class="reveal__steps">
              Sur l'autre appareil : scanne ce code avec l'appareil photo et ouvre le lien. Forome
              s'ouvre sur cette page et te propose de redevenir toi — rien à recopier.
            </p>
            <p v-else class="reveal__steps">
              La clé nue, sans lien autour : ce QR-là est pour une app signeur qui sait le lire.
              Un appareil photo n'en tirera qu'un texte à copier.
            </p>
            <div class="card__actions">
              <button type="button" class="btn btn--sm" @click="hide">Masquer</button>
              <button type="button" class="btn btn--sm" @click="copy">
                {{ copied ? 'copié' : 'Copier ma clé' }}
              </button>
            </div>
            <button type="button" class="reveal__swap" @click="swapQr">
              {{ qrMode === 'link' ? 'QR de la clé nue, pour une app signeur' : 'QR de reprise, pour un appareil photo' }}
            </button>
          </div>
        </div>
      </template>

      <p v-else class="card__note">
        Ta clé est dans ton extension, et cette page n'y a pas accès. Installe la même extension sur
        l'autre appareil.
      </p>
    </section>

    <!-- « Reprendre mon compte », pas « Importer une clé » : la carte se nomme
         par l'intention de celui qui la cherche, pas par le geste technique. -->
    <section class="card card--import">
      <div class="card__head">
        <h2 class="card__title">Reprendre mon compte</h2>
        <span class="card__lead">
          Redeviens toi sur cet appareil, en collant la clé de ton identité.
        </span>
      </div>

      <!-- Arrivée par le QR : la clé est déjà dans le champ, il ne reste que la
           vérification. On n'importe PAS tout seul — un lien ouvert par erreur
           ne doit pas remplacer une identité. -->
      <p v-if="arrivedByQr" class="card__got">
        Clé reçue par le QR. Vérifie ci-dessous que c'est bien toi, puis confirme.
      </p>

      <!-- Prévenir du remplacement quand il n'y a rien à remplacer ferait peur
           pour rien : l'avertissement n'existe que si l'identité courante a
           servi ou est déjà sauvegardée quelque part. -->
      <p v-if="!identity.unusedIdentity" class="card__warn card__warn--soft">
        <strong>{{ identity.displayName }} sera remplacé</strong> sur cet appareil. Sauvegarde cette
        identité d'abord si tu comptes y revenir.
      </p>

      <form class="row" @submit.prevent="doImport">
        <input
          v-model="importDraft"
          class="field__input row__input"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="nsec1… ou 64 caractères hex"
        />
        <button type="submit" class="btn" :disabled="!importDraft.trim()">Reprendre</button>
      </form>

      <!-- Le champ est masqué (regards par-dessus l'épaule), donc impossible de
           relire ce qu'on a collé : l'identicon dérivé en direct rend la seule
           vérification qui compte — c'est bien MOI que cette clé reconstruit. -->
      <p v-if="peekPubkey" class="card__peek">
        <IdenticonAvatar :pubkey="peekPubkey" :size="20" />
        <span>
          clé reconnue — tu redeviendras
          <strong>{{ profiles.displayName(peekPubkey) }}</strong>
          <span class="mono card__disc">·{{ keyDiscriminator(peekPubkey) }}</span>
        </span>
      </p>
      <p v-else-if="importError" class="card__error">{{ importError }}</p>
      <p v-else-if="peekIsNpub" class="card__error">
        ceci est une clé PUBLIQUE (npub) — il faut la clé privée (nsec)
      </p>
      <div v-else-if="importedPubkey" class="card__done">
        <IdenticonAvatar :pubkey="importedPubkey" :size="20" />
        <p class="card__ok card__ok--flat">
          Tu es de nouveau <strong>{{ profiles.displayName(importedPubkey) }}</strong>
          <span class="mono card__disc">·{{ keyDiscriminator(importedPubkey) }}</span>
        </p>
        <NuxtLink to="/" class="btn btn--sm">Retour au forum</NuxtLink>
      </div>
    </section>

    <section class="card card--bunker">
      <div class="card__head">
        <h2 class="card__title">Sortir la clé de cet appareil</h2>
        <span class="card__lead">
          Une autre app garde ta clé et signe à ta place, quand ce site le lui demande.
        </span>
      </div>

      <template v-if="identity.signerMode === 'nip46'">
        <p class="card__ok">Connecté. Ta clé n'est pas sur cet appareil.</p>
        <div class="card__actions">
          <button type="button" class="btn" @click="identity.disconnectBunker()">
            Se déconnecter
          </button>
        </div>
      </template>

      <template v-else>
        <p class="card__note">
          C'est la seule option qui te laisse reprendre la main si tu perds un appareil : tu retires
          l'autorisation, sans changer d'identité.
        </p>

        <!-- Ici c'est le signeur qui scanne, et c'est tout l'intérêt : ce QR ne
             contient rien de secret et rien d'irréversible, à l'inverse de
             celui de la clé. L'invitation reste ouverte jusqu'à l'annulation. -->
        <div v-if="identity.connectUri" class="reveal">
          <QrCode :text="identity.connectUri" :size="200" />
          <div class="reveal__side">
            <p class="reveal__count mono">en attente de ton app signeur…</p>
            <p class="reveal__steps">
              Scanne ce code depuis ton app signeur : elle demandera d'autoriser Forome. Ta clé ne
              bouge pas de là — et tu pourras retirer l'autorisation sans changer d'identité.
            </p>
            <div class="card__actions">
              <button type="button" class="btn btn--sm" @click="identity.cancelNostrConnect()">
                Annuler
              </button>
              <!-- Signeur sur CE téléphone : on ne peut pas scanner son propre
                   écran, l'invitation se colle alors dans l'app. -->
              <button type="button" class="btn btn--sm" @click="copyInvite">
                {{ inviteCopied ? 'copié' : 'Copier l’invitation' }}
              </button>
            </div>
          </div>
        </div>
        <div v-else class="card__actions">
          <button
            type="button"
            class="btn btn--primary"
            :disabled="identity.bunkerConnecting"
            @click="doNostrConnect"
          >
            Connecter par QR
          </button>
        </div>

        <!-- Replié : qui a déjà son URI la colle sans lire. La numérotation dit
             un ordre réel — on ne peut pas autoriser avant d'avoir l'app. -->
        <details class="guide">
          <summary class="guide__toggle">Je n'ai pas encore d'app signeur</summary>
          <ol class="guide__steps">
            <li class="guide__step">
              <span class="guide__num mono">1</span>
              <span>
                <strong>Installe une app signeur.</strong> Sur Android, Amber. Dans un navigateur,
                nsec.app. C'est elle qui gardera ta clé.
              </span>
            </li>
            <li class="guide__step">
              <span class="guide__num mono">2</span>
              <span>
                <strong>Donne-lui la clé que tu utilises déjà</strong>, avec « Copier ma clé » plus
                haut. Si tu en crées une neuve à la place, tu repars de zéro sous un autre pseudo.
              </span>
            </li>
            <li class="guide__step">
              <span class="guide__num mono">3</span>
              <span>
                <strong>Reviens ici et scanne.</strong> « Connecter par QR » affiche l'invitation que
                ton app doit lire. Si elle ne sait pas scanner, elle donne une adresse
                <code>bunker://</code> — le champ ci-dessous l'accepte aussi.
              </span>
            </li>
          </ol>
          <p class="guide__end">
            Ensuite, chaque message que tu postes demande une signature à cette app. Ta clé, elle, ne
            revient jamais ici.
          </p>
        </details>

        <form class="row" @submit.prevent="doConnect">
          <input
            v-model="bunkerDraft"
            class="field__input row__input"
            spellcheck="false"
            placeholder="bunker://… ou toi@domaine"
          />
          <button type="submit" class="btn" :disabled="!bunkerDraft.trim() || identity.bunkerConnecting">
            {{ identity.bunkerConnecting ? '…' : 'Connecter' }}
          </button>
        </form>
        <p v-if="identity.bunkerError" class="card__error">{{ identity.bunkerError }}</p>
        <p v-if="devTools" class="card__note mono">
          dev : <code>npm run dev:bunker</code> affiche une URI à coller ici.
        </p>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * Nostr n'a ni délégation ni révocation (§3.2), donc c'est **la clé elle-même
 * qui voyage** — d'où l'affichage temporisé du QR et l'avertissement sur chaque
 * carte plutôt qu'une fois en tête de page.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { keyDiscriminator, decodeSecretInput } from '~/utils/nostr'

const HOLD_S = 30
/**
 * Le fragment que porte le QR de reprise. À garder en phase avec le script de
 * tête de `nuxt.config.ts`, qui le vide de l'URL avant que cette page existe.
 */
const KEY_HASH = '#k='

const identity = useIdentityStore()
const profiles = useProfileStore()
const devTools = useDevTools()

const bunkerDraft = ref('')
const revealed = ref(false)
const remaining = ref(HOLD_S)
const { copied, copy: copyText } = useCopy()
const importDraft = ref('')
const importError = ref<string | null>(null)
const importedPubkey = ref<string | null>(null)
const arrivedByQr = ref(false)
const { copied: inviteCopied, copy: copyInviteText } = useCopy()
/** `link` = QR vers cette page ; `key` = clé nue, pour une app signeur. */
const qrMode = ref<'link' | 'key'>('link')

/** Pubkey dérivée en direct de la saisie — sans toucher l'identité courante. */
const peekPubkey = computed(() => {
  const raw = importDraft.value.trim()
  if (!raw) return null
  const res = decodeSecretInput(raw)
  return res.ok ? res.pubkey : null
})
/** L'erreur n°1 (coller sa npub) se détecte sans attendre le submit. */
const peekIsNpub = computed(() => importDraft.value.trim().startsWith('npub'))

/* Le pseudo kind-0, s'il existe, vaut mieux que le handle de repli pour se
   reconnaître : on le demande dès que la clé se décode. */
watch(peekPubkey, (pk) => {
  if (pk) profiles.want(pk)
})
/* Reprendre la saisie invalide le résultat du coup d'avant, erreur comme
   confirmation — sinon « tu es de nouveau X » reste affiché sous une clé Y. */
watch(importDraft, (draft) => {
  importError.value = null
  if (draft.trim()) importedPubkey.value = null
})

let timer: ReturnType<typeof setInterval> | null = null

/** null quand la clé vit dans une extension : rien à exporter. */
const nsec = computed(() => identity.exportNsec())

/**
 * Le QR par défaut est un **lien vers cette page**, clé dans le fragment.
 *
 * C'est ce qui supprime le copier-coller : l'appareil photo sait ouvrir un
 * lien, il ne sait rien faire d'un `nsec1…`. Le fragment ne part jamais dans la
 * requête HTTP — mais il passe par l'historique du navigateur et par l'app
 * photo, là où la clé nue restait dans une seule presse-papier. C'est le prix,
 * et c'est pourquoi `swapQr()` existe.
 */
const qrText = computed(() => {
  if (!nsec.value) return ''
  if (qrMode.value === 'key') return nsec.value
  const origin = import.meta.client ? window.location.origin : ''
  return `${origin}/appareils${KEY_HASH}${nsec.value}`
})

function swapQr(): void {
  qrMode.value = qrMode.value === 'link' ? 'key' : 'link'
}

/** L'expiration ne protège de rien contre quelqu'un de présent — elle évite
    l'oubli, qui est le cas réel. */
function reveal(): void {
  revealed.value = true
  remaining.value = HOLD_S
  timer = setInterval(() => {
    remaining.value--
    if (remaining.value <= 0) hide()
  }, 1000)
}

function hide(): void {
  revealed.value = false
  if (timer) clearInterval(timer)
  timer = null
}

function copy(): void {
  const value = identity.exportNsec()
  if (value) void copyText(value)
}

async function doConnect(): Promise<void> {
  const res = await identity.connectBunker(bunkerDraft.value)
  if (res.ok) bunkerDraft.value = ''
}

function doNostrConnect(): void {
  void identity.startNostrConnect()
}

function copyInvite(): void {
  const uri = identity.connectUri
  if (uri) void copyInviteText(uri)
}

function doImport(): void {
  importError.value = null
  importedPubkey.value = null
  const res = identity.importKey(importDraft.value)
  if (res.ok) {
    importedPubkey.value = res.pubkey
    // La clé du QR a servi : ce qui reste à l'écran est un résultat, plus une
    // vérification à faire.
    arrivedByQr.value = false
    void profiles.fetchOne(res.pubkey)
    importDraft.value = ''
  } else {
    importError.value = res.error
  }
}

/**
 * Reprise arrivée par le QR.
 *
 * Le script de tête (`nuxt.config.ts`) a déjà sorti la clé de l'URL ; on la
 * ramasse et on l'oublie du global. Le repli par le fragment sert au cas où ce
 * script n'a pas tourné — le résultat compte plus que le chemin pris.
 *
 * Rien n'est importé sans un geste : un lien ouvert par erreur ne doit pas
 * remplacer une identité.
 */
onMounted(() => {
  const holder = window as unknown as { __foromeKey?: string }
  const fromHash = window.location.hash.startsWith(KEY_HASH)
    ? decodeURIComponent(window.location.hash.slice(KEY_HASH.length))
    : ''
  const raw = (holder.__foromeKey ?? fromHash).trim()
  delete holder.__foromeKey
  if (fromHash) history.replaceState(null, '', window.location.pathname + window.location.search)
  if (!raw || !decodeSecretInput(raw).ok) return
  importDraft.value = raw
  arrivedByQr.value = true
})

onUnmounted(() => {
  hide()
  // Une invitation laissée derrière soi garde un abonnement relais ouvert.
  identity.cancelNostrConnect()
})
</script>

<style scoped>
.pair {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Identité jamais servie = on est sur l'appareil NEUF : la carte de reprise
   passe en tête, sinon la première chose vue est le QR de la clé jetable du
   jour — exactement celle qu'il ne faut pas propager. Arriver par le QR de
   reprise (`--recu`) la met en tête pour une autre raison : c'est la seule
   chose qu'on soit venu faire. */
.pair--neuf .card--import,
.pair--recu .card--import {
  order: -1;
}

/* Panneau de la charte : blanc bordé, en-tête sur le gris de surface. */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-panel);
  overflow: hidden;
}
.card__head {
  padding: 9px 13px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
}
.card__title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--ink);
}
.card__lead {
  display: block;
  margin-top: 1px;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink-3);
}

.card__warn,
.card__note,
.card__error,
.card__ok {
  margin: 0;
  padding: 11px 13px 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-2);
}
.card__warn {
  color: var(--warn);
}
.card__warn strong {
  color: var(--warn);
}
/* Remplacer son identité est grave, mais réversible si la clé est sauvegardée :
   encre normale, le gras porte l'enjeu. */
.card__warn--soft {
  color: var(--ink-2);
}
.card__warn--soft strong {
  color: var(--ink);
}
.card__note {
  color: var(--ink-3);
  font-size: var(--fs-sm);
}
.card__error {
  color: var(--warn);
  font-weight: 600;
}
.card__ok {
  color: var(--ok);
}
.card__ok--flat {
  padding: 0;
}

.card__peek {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0 13px 13px;
  font-size: var(--fs-md);
  color: var(--ink-2);
}
.card__peek strong {
  color: var(--ink);
}
.card__disc {
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

.card__done {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 0 13px 13px;
}

.card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 11px 13px 13px;
}

/* ------------------------------------------------------------------- guide
   Le patron `.guide` vit dans `main.css` : il sert aussi au nom vérifié par un
   domaine. Ne reste ici que son placement dans cette carte. */

.guide {
  margin: 9px 13px 0;
}

.row {
  display: flex;
  gap: 7px;
  padding: 11px 13px 13px;
}
.row__input {
  flex: 1;
  min-width: 0;
}

/* QR à gauche, mode d'emploi et actions à droite : la colonne de texte donne au
   QR une échelle, et le compte à rebours reste dans l'œil pendant qu'on scanne. */
.reveal {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 12px 13px 13px;
}
.reveal__side {
  flex: 1;
  min-width: 0;
}
.reveal__count {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 700;
  color: var(--brand-ink);
}
.reveal__steps {
  margin: 5px 0 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-2);
}
.reveal .card__actions {
  padding: 11px 0 0;
}

/* Bascule discrète : le second QR n'existe que pour un cas de bord, il ne se
   présente donc pas comme un bouton. */
.reveal__swap {
  display: block;
  margin-top: 8px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--fs-sm);
  color: var(--ink-3);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.reveal__swap:hover {
  color: var(--ink);
}

/* Confirmation d'arrivée : c'est une bonne nouvelle, pas un avertissement. */
.card__got {
  margin: 0;
  padding: 11px 13px 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ok);
}

@media (max-width: 560px) {
  .reveal {
    flex-direction: column;
  }
  .row {
    flex-wrap: wrap;
  }
}
</style>
