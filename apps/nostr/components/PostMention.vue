<template>
  <NuxtLink :to="`/profil/${npub}`" class="rt-mention" :class="{ 'rt-mention--me': isMe }">
    @{{ name }}<!--
      Le discriminant colle au pseudo, sans espace : c'est un seul mot à l'œil,
      et une mention coupée en deux au bout d'une ligne se lirait comme deux
      personnes.
    --><span v-if="disc" class="rt-mention__disc mono">·{{ disc }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
/**
 * Une mention rendue (NIP-27).
 *
 * Le message ne porte que la clé (voir `utils/mentions.ts`) : le pseudo est
 * résolu ici, à l'affichage. C'est ce qui fait qu'un changement de pseudo se
 * propage aux mentions déjà publiées — et que la mention reste juste sur un
 * réseau où rien ne se corrige.
 *
 * Le lien mène au profil du forum, comme le pseudo de la barre d'auteur : cliquer
 * une mention ne doit pas sortir du site.
 */
import { computed } from 'vue'
import { npubFor } from '~/utils/nostr'

const props = defineProps<{ pubkey: string }>()

const profiles = useProfileStore()
const identity = useIdentityStore()

const npub = computed(() => npubFor(props.pubkey))
const name = computed(() => profiles.displayName(props.pubkey))
/** Pseudo déclaré donc usurpable : le discriminant de clé est obligatoire (§3.5). */
const disc = computed(() =>
  profiles.isClaimedName(props.pubkey) ? profiles.discriminator(props.pubkey) : null,
)
const isMe = computed(() => props.pubkey === identity.pubkey)
</script>

<style scoped>
/*
 * Bleu, comme tout ce qui est de l'interface — un lien vers quelqu'un. L'orange
 * est réservé au forum (chaleur, arrivées), et une mention n'est pas un signal :
 * elle est permanente dans le message.
 */
.rt-mention {
  color: var(--link, currentColor);
  font-weight: 600;
  text-decoration: none;
  /* Une mention ne se coupe pas en deux : `@khey_a3f81b2c` scindé en bout de
     ligne se lit comme deux pseudos. */
  white-space: nowrap;
}
.rt-mention:hover {
  color: var(--link-hover, currentColor);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* Être mentionné est la seule chose qui mérite un aplat : c'est ce qu'on cherche
   des yeux en rouvrant un fil de trois cents messages. */
.rt-mention--me {
  padding: 0 4px;
  border-radius: var(--r-pastille, 6px);
  background: var(--link-soft, transparent);
}

.rt-mention__disc {
  font-size: 0.85em;
  font-weight: 400;
  color: var(--ink-3, inherit);
}
</style>
