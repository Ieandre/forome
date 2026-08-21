<template>
  <aside class="keyrail">
    <UserAvatar :pubkey="pubkey" :size="88" class="keyrail__av" :alt="`avatar de ${declaredName || handle}`" />

    <!-- Un seul nom à l'écran. Le handle `khey_` n'est pas une seconde identité,
         c'est le nom affiché tant que personne n'a choisi de pseudo (§3.1) : dès
         qu'un pseudo existe, il n'a plus rien à faire là. -->
    <p v-if="!declaredName" class="keyrail__handle mono">{{ handle }}</p>

    <Hint
      :text="
        copied
          ? 'copié'
          : 'copier la clé publique — c’est l’adresse à donner pour être retrouvé depuis n’importe quel client Nostr'
      "
    >
      <button type="button" class="keyrail__npub mono" @click="copyNpub">
        <span class="keyrail__npub-text">{{ npub }}</span>
        <span class="keyrail__npub-act">{{ copied ? 'copié' : 'copier' }}</span>
      </button>
    </Hint>

    <!-- L'identicon n'est plus l'avatar (la photo l'est), mais il reste la seule
         chose qui rende une usurpation de pseudo visible. Sa place est donc sur la
         ligne de la clé, dont il est la projection : ici il se lit comme « cette
         clé, en image », alors qu'en coin de la photo il ressemblerait à une
         seconde vignette. -->
    <Explain
      term="identicon"
      placement="bottom"
      :body="[
        'Ce petit dessin est calculé à partir de la clé publique ci-dessus, il n\'est pas choisi.',
        'Deux clés différentes ne peuvent pas produire le même : contrairement au pseudo et à la photo, il ne peut pas être copié.',
      ]"
    >
      <span class="keyrail__key">
        <IdenticonAvatar :pubkey="pubkey" :size="18" />
        <span class="keyrail__key-label">clé en image</span>
      </span>
    </Explain>

    <slot />
  </aside>
</template>

<script setup lang="ts">
/**
 * Colonne d'identité, partagée par la page de profil et la page de
 * modification : avatar, nom de repli s'il n'y a pas de pseudo, clé publique.
 *
 * Même composant des deux côtés pour que les deux pages soient la même page,
 * l'une en lecture et l'autre en écriture. Rien n'y est éditable — pas besoin de
 * l'écrire à l'écran, il n'y a aucun champ.
 *
 * Ce qui vaut explication est réparti selon la règle de l'app : l'avatar est du
 * vocabulaire (`Explain`, on l'ouvre et on lit), la npub est un bouton dont il
 * faut connaître le nom (`Hint`, une bulle qui passe).
 */
import { computed } from 'vue'
import { kheyHandle, npubFor } from '~/utils/nostr'

const props = defineProps<{
  pubkey: string
  /**
   * Le pseudo déclaré, s'il existe. Le rail ne l'affiche pas : il s'en sert pour
   * savoir s'il doit encore montrer le handle `khey_`, qui n'a de rôle que tant
   * qu'aucun pseudo n'a été choisi.
   */
  declaredName?: string | null
}>()

const { copied, copy } = useCopy()

const handle = computed(() => kheyHandle(props.pubkey))
const npub = computed(() => npubFor(props.pubkey))

function copyNpub(): void {
  void copy(npub.value)
}
</script>

<style scoped>
/* Le rail est sur `--surface-2`, la colonne déclarée sur `--surface` : c'est
   ce contraste de surface qui porte la scission, pas une étiquette par champ.
   Une étiquette « prouvé »/« déclaré » sur chaque ligne disait la même chose
   six fois. */
.keyrail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  padding: 22px 16px 24px;
  background: var(--surface-2);
  border-right: 1px solid var(--line-soft);
}

.keyrail__av {
  width: 88px;
  height: 88px;
  border-radius: var(--r-panel);
}

.keyrail__handle {
  margin: 4px 0 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--ink);
  word-break: break-all;
  text-align: center;
}

/* La npub complète, jamais tronquée : c'est l'adresse de quelqu'un, et une
   version raccourcie ne sert à rien puisqu'on ne peut pas la coller. */
.keyrail__npub {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 11px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-control);
  color: var(--ink-2);
  font-size: var(--fs-xs);
  text-align: left;
  box-shadow: var(--elev-1);
  transition: border-color 0.14s ease, color 0.14s ease;
}
.keyrail__npub:hover {
  border-color: var(--line-strong);
  color: var(--ink);
}
.keyrail__npub:active {
  transform: translateY(1px);
}
.keyrail__npub-text {
  flex: 1;
  min-width: 0;
  word-break: break-all;
  line-height: 1.4;
}
.keyrail__npub-act {
  flex-shrink: 0;
  color: var(--ink-3);
  text-transform: uppercase;
  font-size: 9.5px;
  letter-spacing: 0.04em;
}

/* Discret par construction : pas d'aplat, pas de bordure, l'encre la plus pâle.
   Il n'a rien à réclamer — il sert le jour où on vient vérifier une identité. */
.keyrail__key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
  font-size: var(--fs-xs);
  cursor: help;
}
.keyrail__key-label {
  letter-spacing: 0.02em;
}

@media (max-width: 720px) {
  .keyrail {
    border-right: none;
    border-bottom: 1px solid var(--line-soft);
  }
}
</style>
