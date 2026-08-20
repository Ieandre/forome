<template>
  <button
    type="button"
    class="dmrow"
    :class="{ 'dmrow--active': active, 'dmrow--unread': thread.unread > 0 }"
    :aria-current="active ? 'true' : undefined"
    @click="emit('open')"
  >
    <UserAvatar
      :pubkey="thread.peer"
      :size="26"
      class="dmrow__av"
      :alt="`avatar de ${profiles.displayName(thread.peer)}`"
    />

    <span class="dmrow__name">{{ profiles.displayName(thread.peer) }}</span>
    <span class="dmrow__when mono">{{ relativeTime(thread.lastAt) }}</span>

    <span class="dmrow__snippet">
      <!-- « Toi : » dit qui a parlé en dernier, donc si la balle est dans ton
           camp. C'est la seule chose qu'on cherche en survolant une liste. -->
      <span v-if="last?.fromMe" class="dmrow__mine">Toi :</span>
      {{ preview }}
    </span>
    <span v-if="thread.unread" class="dmrow__unread mono">{{ thread.unread }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { relativeTime } from '~/utils/format'
import type { DmThread } from '~/stores/dms'

const props = defineProps<{ thread: DmThread; active: boolean }>()
const emit = defineEmits<{ open: [] }>()

const profiles = useProfileStore()

const last = computed(() => props.thread.messages[props.thread.messages.length - 1] ?? null)

/** Une ligne d'aperçu : les retours à la ligne d'un message casseraient la rangée. */
const preview = computed(() =>
  (last.value?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Fil vide',
)
</script>

<style scoped>
/* Même anatomie que la rangée de topic : identicon en colonne, titre et heure
   sur la première ligne, extrait en seconde. Les deux listes de l'app se lisent
   donc de la même façon. */
/* Même anatomie que la rangée de topic, refonte comprise : pas de zébrage, pas
   de filet, l'espace et le survol séparent. Sans rail de chauffe en revanche —
   un fil de MP n'a pas de vélocité publique à montrer. */
.dmrow {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-areas:
    'av name    when'
    'av snippet unread';
  align-items: center;
  column-gap: 11px;
  row-gap: 2px;
  width: 100%;
  padding: 9px 10px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--r-control);
  transition: background 0.14s ease;
}
.dmrow:hover {
  background: var(--surface-3);
}
.dmrow--active,
.dmrow--active:hover {
  background: var(--link-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--link) 26%, transparent);
}

.dmrow__av {
  grid-area: av;
}

.dmrow__name {
  grid-area: name;
  min-width: 0;
  font-size: var(--fs-base);
  font-weight: 600;
  letter-spacing: -0.012em;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dmrow--active .dmrow__name {
  color: var(--link);
  font-weight: 700;
}

.dmrow__when {
  grid-area: when;
  justify-self: end;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
  white-space: nowrap;
}

.dmrow__snippet {
  grid-area: snippet;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--ink-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dmrow__mine {
  color: var(--ink-4);
}

/* Non lu : le compteur en aplat orange, et le nom qui reprend du poids. Deux
   canaux pour un seul fait, parce qu'une pastille seule se rate en survolant.
   Orange et non bleu : un message qui attend est ce qui bouge, pas où on est. */
.dmrow__unread {
  grid-area: unread;
  justify-self: end;
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
.dmrow--unread .dmrow__name {
  font-weight: 700;
}
.dmrow--unread .dmrow__snippet {
  color: var(--ink-2);
}
</style>
