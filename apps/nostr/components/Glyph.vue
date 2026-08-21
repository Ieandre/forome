<template>
  <svg
    class="glyph"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    stroke="currentColor"
    stroke-width="2.1"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'lock'">
      <rect x="4.4" y="10.4" width="15.2" height="10.2" rx="2.3" />
      <path d="M8 10.4V7.7a4 4 0 0 1 8 0v2.7" />
    </template>

    <template v-else-if="name === 'pin'">
      <path d="M12 17.2V21.5" />
      <path
        d="M5.6 17.2h12.8v-1.9a2.1 2.1 0 0 0-1.16-1.88l-1.87-.95a2.1 2.1 0 0 1-1.15-1.87V5.9h1.05a2.1 2.1 0 0 0 0-4.2H8.73a2.1 2.1 0 0 0 0 4.2h1.05v4.7a2.1 2.1 0 0 1-1.15 1.87l-1.87.95A2.1 2.1 0 0 0 5.6 15.3Z"
      />
    </template>

    <template v-else-if="name === 'shield'">
      <path d="M12 2.8 4.9 5.6v5.6c0 4.3 2.9 7.4 7.1 8.9 4.2-1.5 7.1-4.6 7.1-8.9V5.6Z" />
    </template>

    <template v-else-if="name === 'hidden'">
      <path d="M2.6 12S6.3 6.2 12 6.2s9.4 5.8 9.4 5.8-3.7 5.8-9.4 5.8S2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="2.7" />
      <path d="M4.2 19.8 19.8 4.2" />
    </template>

    <template v-else-if="name === 'banned'">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M6.2 17.8 17.8 6.2" />
    </template>
  </svg>
</template>

<script setup lang="ts">
/**
 * Les états que le forum répète : verrouillé, épinglé, rôle, masqué, banni.
 *
 * Ils ne passent en icône QUE parce qu'ils sont conventionnels — cadenas,
 * épingle, bouclier s'apprennent ailleurs. « raid », « toi », « auteur du
 * topic » restent des mots : aucune icône ne les désigne, et une icône devinée
 * est une information perdue. La règle en tête de `.tag` dans `main.css` dit
 * laquelle est laquelle.
 *
 * ⚠️ Toujours `aria-hidden`, jamais seule : le mot reste dans le DOM, en
 * `.visually-hidden`, sinon l'état disparaît au lecteur d'écran. Il sert aussi
 * à `Hint.nameChild()`, qui ne nomme un déclencheur que s'il est vide de texte.
 */
defineProps<{
  name: 'lock' | 'pin' | 'shield' | 'hidden' | 'banned'
  /** Le bouclier plein distingue l'admin du modérateur. Lui seul s'en sert. */
  filled?: boolean
}>()
</script>

<style scoped>
/*
 * Dimensionnée en `em` : l'icône suit le corps de l'étiquette qui la porte
 * (10 px dans `.tag`) au lieu de la figer en pixels, donc elle reste alignée si
 * la charte bouge la taille du texte.
 *
 * Le trait est à 2.1 et non aux 1.7-1.9 du reste des SVG du projet : à 12 px de
 * côté sur un viewBox de 24, 1.8 donne moins d'un pixel effectif et le tracé
 * bave hors écran retina.
 */
.glyph {
  width: 1.25em;
  height: 1.25em;
  flex-shrink: 0;
  /* Le centre optique de l'icône tombe plus haut que la ligne de base du texte
     en petites capitales qui l'entoure. */
  margin-top: -0.05em;
}
</style>
