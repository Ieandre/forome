<template>
  <Hint :text="label" placement="bottom">
    <button type="button" class="back">
      <svg
        class="back__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M19.4 12H5.2M11.6 5.4 4.8 12l6.8 6.6" />
      </svg>
      <span class="visually-hidden">{{ label }}</span>
    </button>
  </Hint>
</template>

<script setup lang="ts">
/**
 * Le retour de l'en-tête : fil, nouveau topic, conversation. Trois écrans qui
 * portaient le même bouton, chacun avec sa copie du style et un « ← » de police
 * — un caractère qui tombe sur une police de repli, donc d'un poids et d'une
 * taille qui ne sont ceux d'aucune autre icône de l'écran.
 *
 * Il porte sa bulle et sa propre visibilité, parce que la règle est la même
 * partout : il n'existe qu'en dessous de 820 px, là où la colonne de gauche a
 * disparu et où il devient le seul chemin vers la liste. Au-dessus, la liste est
 * déjà à l'écran.
 *
 * ⚠️ `label` sert deux fois : la bulle qui nomme, et le seul texte du bouton —
 * l'icône est `aria-hidden`, sans lui il n'a plus de nom accessible.
 */
defineProps<{
  /** Ce vers quoi on revient, au format « retour à … ». */
  label: string
}>()
</script>

<style scoped>
.back {
  display: none;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 28px;
  padding: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  color: var(--ink-2);
}
.back:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.back__icon {
  width: 17px;
  height: 17px;
}

@media (max-width: 820px) {
  .back {
    display: grid;
  }
}
</style>
