<template>
  <div class="pair">
    <!-- Trois actions à plat, pas trois onglets : ce ne sont pas trois vues d'un
         même objet mais trois conséquences distinctes (copier / remplacer /
         sortir la clé). Les cacher derrière des onglets obligeait à cliquer pour
         découvrir ce qui existe, et masquait la seule option qui protège
         vraiment — le signeur distant. -->

    <section class="card">
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
            {{ copied ? 'copié ✓' : 'Copier ma clé' }}
          </button>
        </div>

        <div v-else class="reveal">
          <QrCode :text="nsec" :size="200" />
          <div class="reveal__side">
            <p class="reveal__count mono">masqué dans {{ remaining }} s</p>
            <p class="reveal__steps">
              Sur l'autre appareil : ouvre Forome, puis « Importer une clé » sur cette même page.
            </p>
            <div class="card__actions">
              <button type="button" class="btn btn--sm" @click="hide">Masquer</button>
              <button type="button" class="btn btn--sm" @click="copy">
                {{ copied ? 'copié ✓' : 'Copier ma clé' }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <p v-else class="card__note">
        Ta clé est dans ton extension, et cette page n'y a pas accès. Installe la même extension sur
        l'autre appareil.
      </p>
    </section>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">Importer une clé</h2>
        <span class="card__lead">
          Reprends une identité créée ailleurs, en collant sa clé ou en scannant son QR.
        </span>
      </div>

      <p class="card__warn card__warn--soft">
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
        <button type="submit" class="btn" :disabled="!importDraft.trim()">Importer</button>
      </form>
      <p v-if="importError" class="card__error">{{ importError }}</p>
      <p v-else-if="importedAs" class="card__ok">Importé — tu es maintenant {{ importedAs }}.</p>
    </section>

    <section class="card">
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

        <!-- Replié : qui a déjà son URI la colle sans lire. La numérotation dit
             un ordre réel — on ne peut pas coller une URI avant d'avoir l'app. -->
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
                <strong>Colle l'adresse de connexion.</strong> L'app en affiche une qui commence par
                <code>bunker://</code> — c'est elle qui va dans le champ ci-dessous.
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
import { ref, computed, onUnmounted } from 'vue'
import { kheyHandle } from '~/utils/nostr'

const HOLD_S = 30

const identity = useIdentityStore()
const devTools = useDevTools()

const bunkerDraft = ref('')
const revealed = ref(false)
const remaining = ref(HOLD_S)
const copied = ref(false)
const importDraft = ref('')
const importError = ref<string | null>(null)
const importedAs = ref<string | null>(null)

let timer: ReturnType<typeof setInterval> | null = null

/** null quand la clé vit dans une extension : rien à exporter. */
const nsec = computed(() => identity.exportNsec())

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

async function copy(): Promise<void> {
  const value = identity.exportNsec()
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* presse-papier indisponible — le QR reste la porte de sortie */
  }
}

async function doConnect(): Promise<void> {
  const res = await identity.connectBunker(bunkerDraft.value)
  if (res.ok) bunkerDraft.value = ''
}

function doImport(): void {
  importError.value = null
  importedAs.value = null
  const res = identity.importKey(importDraft.value)
  if (res.ok) {
    importedAs.value = kheyHandle(res.pubkey)
    importDraft.value = ''
  } else {
    importError.value = res.error
  }
}

onUnmounted(hide)
</script>

<style scoped>
.pair {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

@media (max-width: 560px) {
  .reveal {
    flex-direction: column;
  }
  .row {
    flex-wrap: wrap;
  }
}
</style>
