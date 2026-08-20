<template>
  <div class="pm">
    <!-- Signaler : ouvert à tout le monde. Le motif est une liste courte —
         quinze motifs ne produisent pas des signalements plus précis, ils en
         produisent au hasard. -->
    <form v-if="mode === 'report'" class="pm__form" @submit.prevent="sendReport">
      <p class="pm__lead">Signaler ce message à la modération</p>
      <div class="pm__row">
        <label
          v-for="(label, value) in REPORT_LABELS"
          :key="value"
          class="pm__choice"
          :class="{ 'pm__choice--on': reportType === value }"
        >
          <input v-model="reportType" type="radio" :value="value" class="visually-hidden" />
          {{ label }}
        </label>
      </div>
      <input
        v-model="note"
        type="text"
        class="pm__input"
        maxlength="140"
        placeholder="précision (facultatif)"
      />
      <p class="pm__note">
        Ton signalement est un message signé et public : la modération voit quelle clé l'a envoyé.
      </p>
      <div class="pm__actions">
        <button type="submit" class="btn btn--sm btn--primary" :disabled="busy">
          {{ busy ? 'envoi…' : 'signaler' }}
        </button>
        <button type="button" class="btn btn--sm btn--ghost" @click="close">annuler</button>
      </div>
    </form>

    <!-- Modérer : réservé au staff. Le motif est obligatoire — une action sans
         motif est une censure silencieuse avec une signature dessus. -->
    <form v-else-if="mode === 'moderate'" class="pm__form" @submit.prevent="apply">
      <p class="pm__lead">
        Modérer le message de <strong>{{ profiles.displayName(post.pubkey) }}</strong>
      </p>

      <div class="pm__row">
        <label class="pm__choice" :class="{ 'pm__choice--on': verb === 'hide' }">
          <input v-model="verb" type="radio" value="hide" class="visually-hidden" />
          masquer le message
        </label>
        <label v-if="hidden" class="pm__choice" :class="{ 'pm__choice--on': verb === 'show' }">
          <input v-model="verb" type="radio" value="show" class="visually-hidden" />
          rétablir
        </label>
        <label class="pm__choice" :class="{ 'pm__choice--on': verb === 'ban' }">
          <input v-model="verb" type="radio" value="ban" class="visually-hidden" />
          bannir l'auteur
        </label>
      </div>

      <!-- Le classement en illégal n'est pas une variante de « masquer » : il
           engage l'opérateur et déclenche une purge côté relais. Admins seuls. -->
      <label v-if="verb === 'hide' && mod.amAdmin" class="pm__illegal">
        <input v-model="illegal" type="checkbox" />
        <span>
          contenu illégal — retiré sans possibilité d'affichage, et le relais cesse de le servir
        </span>
      </label>

      <input
        v-model="reason"
        type="text"
        class="pm__input"
        maxlength="140"
        placeholder="motif — obligatoire, et lu par tout le monde"
        required
      />

      <p class="pm__note">
        <template v-if="verb === 'ban'">
          Le bannissement vaut pour ce forum et ses relais : les messages déjà publiés restent sur le
          réseau, et un autre client Nostr les affichera.
        </template>
        <template v-else-if="illegal">
          Le message n'est plus servi par nos relais. Il existe toujours ailleurs sur le réseau —
          personne ne peut l'en retirer.
        </template>
        <template v-else>
          Le message est replié, pas supprimé : son auteur, son numéro et ton motif restent visibles,
          et n'importe qui peut le déplier.
        </template>
      </p>

      <p v-if="mod.lastError" class="pm__error">{{ mod.lastError }}</p>

      <div class="pm__actions">
        <button type="submit" class="btn btn--sm" :class="danger ? 'btn--danger' : 'btn--primary'" :disabled="busy">
          {{ busy ? 'publication…' : confirmLabel }}
        </button>
        <button type="button" class="btn btn--sm btn--ghost" @click="close">annuler</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { REPORT_LABELS, type ReportType } from '~/types/moderation'
import type { Post } from '~/types/nostr'

const props = defineProps<{ post: Post; mode: 'report' | 'moderate' }>()
const emit = defineEmits<{ close: []; done: [string] }>()

const mod = useModerationStore()
const profiles = useProfileStore()

const busy = ref(false)
const reportType = ref<ReportType>('spam')
const note = ref('')
const reason = ref('')
const illegal = ref(false)

const hidden = computed(() => !!mod.hiddenNotice(props.post.id))
const verb = ref<'hide' | 'show' | 'ban'>(hidden.value ? 'show' : 'hide')

const danger = computed(() => verb.value === 'ban' || illegal.value)
const confirmLabel = computed(() => {
  if (verb.value === 'ban') return 'bannir'
  if (verb.value === 'show') return 'rétablir'
  return illegal.value ? 'retirer' : 'masquer'
})

function close(): void {
  emit('close')
}

async function sendReport(): Promise<void> {
  busy.value = true
  try {
    const ok = await mod.report({
      target: props.post.id,
      targetKind: 'event',
      author: props.post.pubkey,
      type: reportType.value,
      note: note.value,
    })
    emit('done', ok ? 'signalement envoyé' : 'signalement refusé par les relais')
    if (ok) close()
  } finally {
    busy.value = false
  }
}

async function apply(): Promise<void> {
  busy.value = true
  try {
    let ok = false
    if (verb.value === 'hide') ok = await mod.hide(props.post.id, reason.value, illegal.value ? 'illegal' : 'editorial')
    else if (verb.value === 'show') ok = await mod.show(props.post.id, reason.value)
    else ok = await mod.ban(props.post.pubkey, reason.value)

    if (ok) {
      emit('done', 'décision publiée')
      close()
    }
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
/* Encart posé sous la rangée d'actions du message. Fond creusé plutôt que
   carte : c'est un tiroir du message, pas un objet à côté de lui. */
.pm__form {
  margin: 8px 0 0;
  padding: 11px 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-control);
}

.pm__lead {
  margin: 0 0 9px;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--ink-2);
}

.pm__row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 9px;
}

/* Puces de choix, pas un menu déroulant : trois options se lisent d'un coup,
   et le geste de modération doit être rapide pendant un raid. */
.pm__choice {
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-3);
  cursor: pointer;
  transition: border-color 0.13s ease, color 0.13s ease, background 0.13s ease;
}
.pm__choice:hover {
  border-color: var(--line-strong);
  color: var(--ink);
}
.pm__choice--on {
  background: var(--link-soft);
  border-color: var(--link);
  color: var(--link);
}

.pm__illegal {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-bottom: 9px;
  padding: 8px 10px;
  background: var(--warn-soft);
  border-radius: var(--r-pastille);
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--ink-2);
}

.pm__input {
  width: 100%;
  padding: 7px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-family: inherit;
  font-size: var(--fs-md);
  color: var(--ink);
}
.pm__input:focus {
  outline: none;
  border-color: var(--link);
  box-shadow: var(--ring);
}

.pm__note {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink-4);
}

.pm__error {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  color: var(--warn);
}

.pm__actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
</style>
