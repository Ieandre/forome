<template>
  <form class="tm" @submit.prevent="apply">
    <div class="tm__row">
      <label class="tm__choice" :class="{ 'tm__choice--on': verb === 'lock' }">
        <input v-model="verb" type="radio" :value="locked ? 'unlock' : 'lock'" class="visually-hidden" />
        {{ locked ? 'déverrouiller' : 'verrouiller le topic' }}
      </label>
      <label class="tm__choice" :class="{ 'tm__choice--on': verb === 'pin' }">
        <input v-model="verb" type="radio" :value="pinned ? 'unpin' : 'pin'" class="visually-hidden" />
        {{ pinned ? 'désépingler' : 'épingler' }}
      </label>
    </div>

    <input
      v-model="reason"
      type="text"
      class="tm__input"
      maxlength="140"
      placeholder="motif — obligatoire, et lu par tout le monde"
      required
    />

    <p class="tm__note">
      Verrouiller ferme le composeur ici <strong>et</strong> fait refuser les réponses par nos
      relais. Les messages déjà publiés restent.
    </p>

    <p v-if="mod.lastError" class="tm__error">{{ mod.lastError }}</p>

    <div class="tm__actions">
      <button type="submit" class="btn btn--sm btn--primary" :disabled="mod.publishing">
        {{ mod.publishing ? 'publication…' : 'appliquer' }}
      </button>
      <button type="button" class="btn btn--sm btn--ghost" @click="emit('close')">annuler</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ topicId: string }>()
const emit = defineEmits<{ close: [] }>()

const mod = useModerationStore()

const locked = computed(() => mod.isLocked(props.topicId))
const pinned = computed(() => mod.isPinned(props.topicId))

const verb = ref<'lock' | 'unlock' | 'pin' | 'unpin'>(locked.value ? 'unlock' : 'lock')
const reason = ref('')

async function apply(): Promise<void> {
  const ok = await ({
    lock: () => mod.lock(props.topicId, reason.value),
    unlock: () => mod.unlock(props.topicId, reason.value),
    pin: () => mod.pin(props.topicId, reason.value),
    unpin: () => mod.unpin(props.topicId, reason.value),
  })[verb.value]()
  if (ok) emit('close')
}
</script>

<style scoped>
.tm {
  padding: 11px 14px;
  background: var(--surface-sunken);
  border-bottom: 1px solid var(--line-soft);
}
.tm__row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 9px;
}
.tm__choice {
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
.tm__choice--on {
  background: var(--link-soft);
  border-color: var(--link);
  color: var(--link);
}
.tm__input {
  width: 100%;
  padding: 7px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-family: inherit;
  font-size: var(--fs-md);
  color: var(--ink);
}
.tm__input:focus {
  outline: none;
  border-color: var(--link);
  box-shadow: var(--ring);
}
.tm__note {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink-4);
}
.tm__error {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  color: var(--warn);
}
.tm__actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
</style>
