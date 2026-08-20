<template>
  <img
    v-if="src && !failed"
    class="avatar"
    :class="{ 'avatar--round': round }"
    :src="src"
    :width="size"
    :height="size"
    :alt="alt ?? ''"
    loading="lazy"
    decoding="async"
    @error="failed = true"
  />
  <IdenticonAvatar v-else :pubkey="pubkey" :size="size" :round="round" :alt="alt" />
</template>

<script setup lang="ts">
/**
 * L'avatar de quelqu'un : sa photo si elle est affichable, son identicon sinon.
 *
 * Un seul endroit porte cette règle, pour que le fil, la liste et les profils ne
 * puissent pas en avoir trois versions. La photo remplace l'identicon (et ne se
 * pose plus à côté) : sur un forum, la photo de profil est ce à quoi les gens
 * tiennent, et deux vignettes par message alourdissaient une liste dense.
 *
 * L'identicon reste le repli, donc une clé sans photo garde une image unique
 * dérivée d'elle — et il reste visible à côté de la clé publique sur la page de
 * profil, là où il sert à repérer une usurpation (§3.5).
 *
 * `@error` compte : une photo peut disparaître de son hôte après coup, et sans ce
 * repli la rangée afficherait un cadre vide au lieu d'une identité.
 */
import { ref, computed, watch } from 'vue'
import { avatarSrc } from '~/utils/media'

const props = withDefaults(
  defineProps<{
    pubkey: string
    size?: number
    round?: boolean
    alt?: string
  }>(),
  { size: 32, round: true },
)

const profiles = useProfileStore()
const failed = ref(false)

const src = computed(() => avatarSrc(profiles.get(props.pubkey)?.picture))

// Un kind 0 est remplaçable : si la photo change, l'échec précédent ne vaut plus.
watch(src, () => (failed.value = false))
</script>

<style scoped>
/* Mêmes bord et rayon que l'identicon, pour que les deux soient interchangeables
   dans une rangée. Pas de `image-rendering: pixelated` ici : c'est fait pour l'art
   pixel de l'identicon, une photo en ressortirait crénelée.
   `object-fit: cover` est un garde-fou — le recadrage à l'envoi rend l'image
   carrée, mais une photo déposée depuis un autre client ne l'est pas forcément, et
   sans ça elle s'étirerait. */
.avatar {
  display: block;
  flex-shrink: 0;
  aspect-ratio: 1;
  object-fit: cover;
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px rgba(13, 22, 44, 0.08);
}
.avatar--round {
  border-radius: var(--r-control);
}
</style>
