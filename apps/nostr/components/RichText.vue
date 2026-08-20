<template>
  <div class="rt">
    <template v-for="(b, i) in blocks" :key="i">
      <p v-if="b.type === 'paragraph'" class="rt-p"><RichInline :tokens="b.children" /></p>

      <blockquote v-else-if="b.type === 'quote'" class="rt-quote">
        <RichText :blocks="b.children" />
      </blockquote>

      <ol v-else-if="b.type === 'list' && b.ordered" class="rt-list">
        <li v-for="(item, j) in b.items" :key="j"><RichInline :tokens="item" /></li>
      </ol>
      <ul v-else-if="b.type === 'list'" class="rt-list">
        <li v-for="(item, j) in b.items" :key="j"><RichInline :tokens="item" /></li>
      </ul>

      <pre v-else-if="b.type === 'codeblock'" class="rt-pre"><code>{{ b.value }}</code></pre>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Rendu des blocs. Voir `RichInline` pour la règle qui compte : jamais de
 * `v-html`, le contenu vient d'inconnus.
 *
 * Récursif pour les citations, dont la profondeur est bornée par le parseur.
 */
import type { Block } from '~/utils/richtext'

defineProps<{ blocks: Block[] }>()
defineOptions({ name: 'RichText' })
</script>

<style scoped>
/*
 * Styles minimaux et structurels seulement — espacements, filets, mesure de
 * lecture. Les couleurs et les corps viennent des tokens de la charte : ce
 * composant sert autant les posts du forum que les MP, il ne doit pas imposer
 * son apparence à l'un des deux.
 */
.rt {
  display: contents;
}
.rt-p {
  margin: 0 0 0.55em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.rt-p:last-child {
  margin-bottom: 0;
}

.rt-quote {
  margin: 0 0 0.55em;
  padding: 2px 0 2px 10px;
  border-left: 2px solid var(--line-strong, currentColor);
  border-radius: 0 var(--r-pastille, 6px) var(--r-pastille, 6px) 0;
  color: var(--ink-3, inherit);
}
.rt-quote:last-child {
  margin-bottom: 0;
}

.rt-list {
  margin: 0 0 0.55em;
  padding-left: 1.5em;
}
.rt-list:last-child {
  margin-bottom: 0;
}
.rt-list li {
  margin: 0.1em 0;
}

/* Le bloc de code défile horizontalement plutôt que d'élargir le message :
   une ligne de 400 caractères ne doit pas casser la colonne du fil. */
.rt-pre {
  margin: 0 0 0.55em;
  padding: 8px 10px;
  overflow-x: auto;
  background: var(--surface-sunken, var(--surface-2, transparent));
  border: 1px solid var(--line-soft, currentColor);
  border-radius: var(--r-control, 9px);
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
  line-height: 1.5;
}
.rt-pre:last-child {
  margin-bottom: 0;
}
.rt-pre code {
  white-space: pre;
}
</style>
