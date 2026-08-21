<template>
  <!-- Un masque n'a ni photo ni identicon : voir le script. -->
  <span v-if="masked" class="avatar avatar--mask" :class="{ 'avatar--round': round }" :style="box">
    <Glyph name="anon" />
    <span v-if="alt" class="visually-hidden">{{ alt }}</span>
  </span>
  <img
    v-else-if="src && !failed"
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
 * L'avatar de quelqu'un : sa photo si elle est affichable, son identicon sinon,
 * et un masque si la voix est anonyme (§3.7).
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
 * ## Le masque passe avant tout le reste
 *
 * Une clé jetable n'a **rien d'unique à montrer**, et c'est le propos : un
 * identicon dérivé d'elle lui donnerait le même genre de visage propre qu'à un
 * compte, dans un écran où l'on apprend justement à reconnaître les gens à leur
 * vignette. Le losange est le même pour tous les anonymes ; ce qui les distingue
 * est le suffixe du nom, stable dans un fil et seulement là.
 *
 * C'est aussi pour ça que le test est ici et non chez l'appelant : la liste des
 * topics, l'en-tête d'un fil, une notification et une rangée de message
 * affichent tous une vignette à partir d'une clé nue, et un seul de ces écrans
 * qui oublierait la règle donnerait un visage à quelqu'un qui a demandé à ne pas
 * en avoir.
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
    /**
     * Force le masque, pour la voix qu'on s'apprête à prendre — le composeur
     * l'annonce avant le premier envoi, donc avant que le moindre event ne
     * l'ait fait connaître au store.
     */
    mask?: boolean
  }>(),
  { size: 32, round: true },
)

const profiles = useProfileStore()
const failed = ref(false)

const masked = computed(() => props.mask || profiles.isAnonKey(props.pubkey))
const src = computed(() => avatarSrc(profiles.get(props.pubkey)?.picture))
const box = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))

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
/* Tireté, comme le composeur en mode anonyme : le même trait aux deux moments,
   écrire et relire. Gris, là où le pseudo d'un compte est bleu et l'auteur d'un
   topic orange — une clé jetable n'a rien accumulé et ne mène nulle part, et la
   teinte est ce qui le dit sans un mot.
   Le glyphe est dimensionné en fraction de la boîte : cette vignette est
   demandée de 18 px (composeur) à 88 px (profil). */
.avatar--mask {
  display: grid;
  place-items: center;
  border: 1px dashed color-mix(in srgb, var(--ink-4) 55%, transparent);
  background: var(--surface-2);
  color: var(--ink-4);
  box-shadow: none;
}
.avatar--mask :deep(.glyph) {
  width: 48%;
  height: 48%;
  margin-top: 0;
}
</style>
