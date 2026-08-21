<template>
  <fieldset class="pd">
    <!-- Le titre du topic EST la question : la légende le dit une fois, et le
         formulaire ne redemande donc pas la même phrase deux fois. -->
    <legend class="pd__legend">
      <span class="pd__kind mono">sondage</span>
      <span class="pd__hint">le titre du topic sert de question</span>
    </legend>

    <ul class="pd__opts">
      <li v-for="(o, i) in options" :key="o.key" class="pd__opt">
        <span class="pd__rank mono">{{ i + 1 }}</span>
        <input
          v-model="o.label"
          type="text"
          class="pd__input"
          :maxlength="MAX_OPTION_LABEL"
          :placeholder="i < MIN_OPTIONS ? 'une réponse possible' : 'une autre'"
          :aria-label="`Réponse ${i + 1}`"
          autocomplete="off"
          @input="growIfLast(i)"
        />
        <button
          v-if="options.length > MIN_OPTIONS"
          type="button"
          class="tool pd__drop"
          :aria-label="`Retirer la réponse ${i + 1}`"
          @click="options.splice(i, 1)"
        >
          ×
        </button>
      </li>
    </ul>

    <div class="pd__row">
      <button
        v-if="options.length < MAX_OPTIONS"
        type="button"
        class="btn btn--sm btn--ghost pd__add"
        @click="addOption"
      >
        + une réponse
      </button>

      <label class="pd__chip" :class="{ 'pd__chip--on': type === 'multiplechoice' }">
        <input v-model="multiple" type="checkbox" class="visually-hidden" />
        plusieurs réponses
      </label>

      <label v-for="d in DURATIONS" :key="d.label" class="pd__chip" :class="{ 'pd__chip--on': hours === d.hours }">
        <input v-model="hours" type="radio" :value="d.hours" class="visually-hidden" />
        {{ d.label }}
      </label>
    </div>

    <!-- La propriété qu'on ne peut pas défaire, et qui n'est pas évidente : le
         vote n'est pas secret. Dite ici plutôt qu'au moment de voter, parce que
         c'est celui qui pose la question qui choisit ce régime pour les autres. -->
    <p class="pd__note">
      Les réponses ne pourront plus être réécrites, comme le titre. Chaque voix sera un message
      signé : qui a voté quoi se lira publiquement.
    </p>
  </fieldset>
</template>

<script setup lang="ts">
/**
 * La partie sondage du formulaire de nouveau topic.
 *
 * Ce composant ne publie rien : il rend des **tags**, que `NewTopicPanel` ajoute
 * au kind 11. C'est tout le sujet du format retenu — le sondage n'est pas un
 * event à part, donc il n'y a pas de seconde publication qui puisse échouer
 * seule, et rien ici n'a besoin de connaître l'id du topic (qui n'existe pas
 * encore au moment où on remplit ce formulaire).
 *
 * Voir `@forome/relay-policy/polls` pour le format et la raison du choix.
 */
import { ref, computed, watch } from 'vue'
import { MIN_OPTIONS, MAX_OPTIONS, MAX_OPTION_LABEL, pollTags } from '~/types/nostr'

const emit = defineEmits<{
  /** Les tags à poser sur le topic, ou `null` tant que le sondage est incomplet. */
  'update:tags': [tags: string[][] | null]
}>()

const DURATIONS = [
  { label: 'sans limite', hours: 0 },
  { label: '1 jour', hours: 24 },
  { label: '3 jours', hours: 72 },
  { label: '1 semaine', hours: 168 },
]

let seq = 0
function blank(): { key: number; label: string } {
  return { key: ++seq, label: '' }
}

const options = ref(Array.from({ length: MIN_OPTIONS }, blank))
const multiple = ref(false)
const hours = ref(0)

const type = computed(() => (multiple.value ? 'multiplechoice' : 'singlechoice'))

function addOption(): void {
  if (options.value.length < MAX_OPTIONS) options.value.push(blank())
}

/** Taper dans la dernière case en ouvre une nouvelle : on ne clique qu'au besoin. */
function growIfLast(i: number): void {
  if (i === options.value.length - 1 && options.value[i]!.label.trim()) addOption()
}

const filled = computed(() => options.value.map((o) => o.label.trim()).filter(Boolean))

/**
 * Ce qui manque, pour que le parent puisse le dire au bon moment sans réinventer
 * la règle. `null` quand le sondage est prêt.
 */
const missing = computed<string | null>(() => {
  if (filled.value.length < MIN_OPTIONS) return `Le sondage attend ${MIN_OPTIONS} réponses.`
  if (new Set(filled.value).size !== filled.value.length) return 'Deux réponses du sondage sont identiques.'
  return null
})

/**
 * Les tags remontent à chaque frappe, `null` tant que le sondage n'est pas
 * valide. C'est ce qui permet au parent de garder « Publier » actif quand le
 * sondage est vide (il est facultatif) et de le bloquer quand il est à moitié
 * rempli — sans quoi on publierait un topic avec une seule réponse, définitive.
 *
 * ⚠️ La date de fermeture n'est PAS calculée ici : elle le serait à chaque
 * frappe, donc l'horodatage glisserait pendant la saisie et le minage spéculatif
 * repartirait de zéro à chaque fois (les tags sont dans l'id). Le parent la pose
 * à l'envoi — voir `endsInHours`.
 */
watch(
  [filled, type, missing],
  () => {
    emit('update:tags', missing.value ? null : pollTags({ options: filled.value, type: type.value }))
  },
  { immediate: true, deep: true },
)

defineExpose({
  /** Ce qui manque au sondage, pour l'affichage du parent. */
  missing,
  /** Durée de vie choisie, en heures ; 0 pour un sondage sans limite. */
  endsInHours: hours,
  /** true dès qu'une réponse est écrite : le parent sait qu'il y a un brouillon. */
  started: computed(() => filled.value.length > 0),
})
</script>

<style scoped>
/* Enfoncé dans le formulaire : c'est une pièce jointe au topic, pas une seconde
   moitié à égalité avec le titre et le message. */
.pd {
  margin: 0;
  padding: 11px 13px 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-panel);
}

.pd__legend {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  margin-bottom: 9px;
}
.pd__kind {
  padding: 2px 7px;
  background: var(--surface-2);
  border-radius: var(--r-pastille);
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--ink-3);
}
.pd__hint {
  font-size: var(--fs-sm);
  color: var(--ink-3);
}

.pd__opts {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pd__opt {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Le rang numérote les réponses parce que l'ordre EST celui du bulletin publié :
   c'est l'ordre dans lequel tout le monde les lira, et il ne se retriera pas. */
.pd__rank {
  flex-shrink: 0;
  width: 14px;
  text-align: right;
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

.pd__input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-size: var(--fs-md);
  color: var(--ink);
}
.pd__input:focus {
  outline: none;
  border-color: var(--link);
  box-shadow: var(--ring);
}
.pd__drop {
  flex-shrink: 0;
  font-size: var(--fs-base);
}

.pd__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 9px;
}
.pd__add {
  margin-right: auto;
  padding-inline: 8px;
}
.pd__chip {
  padding: 4px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-3);
  cursor: pointer;
}
.pd__chip:hover {
  border-color: var(--line-strong);
  color: var(--ink-2);
}
.pd__chip--on {
  background: var(--link-soft);
  border-color: var(--link);
  color: var(--link);
}
.pd__chip:focus-within {
  box-shadow: var(--ring);
}

.pd__note {
  margin: 10px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--ink-3);
}

@media (max-width: 700px) {
  /* Le bouton d'ajout reprend sa ligne : coincé avec cinq pilules, il se
     retrouvait seul au bout d'une rangée cassée. */
  .pd__add {
    margin-right: 0;
    flex-basis: 100%;
  }
}
</style>
