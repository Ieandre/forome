<template>
  <div class="appareils">
    <!-- La question qu'on se pose en arrivant ici n'est pas « quelle action ? »
         mais « où est ma clé, et qu'est-ce que je risque ? ». Elle passe donc
         avant les actions, et c'est le seul endroit de la page où une couleur
         porte une donnée. -->
    <section class="panel state" :class="`state--${level}`">
      <IdenticonAvatar v-if="identity.pubkey" :pubkey="identity.pubkey" :size="44" class="state__av" />
      <div class="state__main">
        <p class="state__who">
          <strong>{{ identity.displayName }}</strong>
          <span class="state__disc mono">·{{ identity.discriminator }}</span>
        </p>
        <p class="state__line">
          <span class="state__dot" />
          {{ where }}
        </p>
        <p class="state__risk">{{ risk }}</p>
      </div>
    </section>

    <DevicePairing />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

usePageTitle('Mes appareils')

const identity = useIdentityStore()

/** `warn` seulement quand la perte est réellement possible : clé sur ce seul
    navigateur, sans copie ailleurs. */
const level = computed(() => {
  if (identity.signerMode === 'local' && !identity.keySaved) return 'warn'
  return 'ok'
})

const where = computed(() => {
  switch (identity.signerMode) {
    case 'nip46':
      return 'Ta clé est gardée par une autre app, qui signe à ta place.'
    case 'nip07':
      return 'Ta clé est dans ton extension. Ce site ne la voit jamais.'
    default:
      return 'Ta clé est sur cet appareil, dans ce navigateur.'
  }
})

const risk = computed(() => {
  switch (identity.signerMode) {
    case 'nip46':
      return 'Tu peux lui retirer l’autorisation quand tu veux, sans changer d’identité.'
    case 'nip07':
      return 'Pour écrire depuis un autre appareil, installes-y la même extension.'
    default:
      return identity.keySaved
        ? 'Tu en as une copie ailleurs : vider ce navigateur ne te la fait pas perdre.'
        : 'Aucune copie ailleurs. Vider ce navigateur effacerait cette identité, et personne ne peut te la redonner.'
  }
})
</script>

<style scoped>
.appareils {
  height: 100%;
  overflow-y: auto;
  padding: 20px 12px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 680px;
  margin: 0 auto;
}

.state {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px;
}
.state--warn {
  background: var(--warn-soft);
  border-color: color-mix(in srgb, var(--warn) 24%, transparent);
}

.state__av {
  flex-shrink: 0;
}
.state__main {
  min-width: 0;
}
.state__who {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-title);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.state__disc {
  margin-left: 3px;
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

/* Pastille carrée d'état : le marqueur de la charte, ici sur une donnée réelle
   (où vit la clé) et pas en décoration. */
.state__line {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 4px 0 0;
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--ink);
}
.state__dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent);
}
.state--warn .state__dot {
  background: var(--warn);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 20%, transparent);
}

.state__risk {
  margin: 3px 0 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-2);
}

@media (max-width: 560px) {
  .appareils {
    padding: 8px;
  }
}
</style>
