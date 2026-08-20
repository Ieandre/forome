<template>
  <img
    class="identicon"
    :class="{ 'identicon--round': round }"
    :src="src"
    :width="size"
    :height="size"
    :alt="alt ?? ''"
    loading="lazy"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { identiconDataUri } from '~/utils/nostr'

const props = withDefaults(
  defineProps<{
    pubkey: string
    size?: number
    round?: boolean
    alt?: string
  }>(),
  { size: 32, round: true },
)

// Calculé localement depuis la clé publique — zéro upload, zéro requête
// réseau. L'identité EST la clé, l'avatar en est la projection, et c'est ce
// qui rend l'usurpation de pseudo visible (spec v2 §3.5).
const src = computed(() => identiconDataUri(props.pubkey))
</script>

<style scoped>
/* Plus de cadre de 1 px : l'identicon est un aplat de couleurs franches, il se
   détache tout seul du blanc, et à 20 px la bordure lui mangeait une case.
   L'ombre interne suffit à retenir son bord quand une case tombe très claire. */
.identicon {
  display: block;
  flex-shrink: 0;
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px rgba(13, 22, 44, 0.08);
  image-rendering: pixelated;
}
.identicon--round {
  border-radius: var(--r-control);
}
</style>
