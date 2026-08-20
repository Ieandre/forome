<template>
  <div class="pl">
    <div class="pl__bar">
      <p class="pl__label">difficulté demandée</p>
      <div class="pl__stepper">
        <button
          type="button"
          class="tool"
          :disabled="busy || target <= MIN"
          aria-label="baisser la difficulté"
          @click="target--"
        >
          −
        </button>
        <span class="pl__value mono">{{ target }} bits</span>
        <button
          type="button"
          class="tool"
          :disabled="busy || target >= MAX"
          aria-label="monter la difficulté"
          @click="target++"
        >
          +
        </button>
      </div>
      <button v-if="!busy" type="button" class="btn btn--sm btn--primary pl__go" @click="run">
        miner
      </button>
      <button v-else type="button" class="btn btn--sm pl__go" @click="stop">arrêter</button>
    </div>

    <p v-if="busy" class="pl__live mono">
      {{ live.toLocaleString('fr-FR') }} essais…
      <!-- Le seuil est mesuré, pas deviné : au-delà de 18 bits, une machine de
           bureau passe la seconde et un téléphone bien davantage. Sans cette
           phrase, l'attente se lit comme une page bloquée. -->
      <span v-if="target >= 19" class="pl__patience">
        compte plusieurs secondes — « arrêter » reprend la main quand tu veux
      </span>
    </p>

    <!-- Chaque ligne est une mesure faite ici, pas une valeur de référence. La
         barre est proportionnelle au plus gros essai de la série : c'est le
         doublement par bit qu'on doit voir, pas un joli graphique. -->
    <ol v-if="results.length" class="pl__list">
      <li v-for="r in results" :key="r.difficulty" class="pl__row">
        <span class="pl__bits mono">{{ r.difficulty }} bits</span>
        <span class="pl__track">
          <span class="pl__fill" :style="{ width: width(r.tries) }" />
        </span>
        <span class="pl__num mono">{{ r.tries.toLocaleString('fr-FR') }} essais</span>
        <span class="pl__ms mono">{{ r.ms }} ms</span>
        <span v-if="r.difficulty === REAL" class="tag pl__here">ce forum</span>
      </li>
    </ol>

    <!-- Invitation, pas conclusion : l'argument du doublement est dans la prose
         du chapitre, le répéter ici le userait. -->
    <p class="pl__foot">
      Rien n’est mesuré d’avance : chaque ligne est minée ici, à l’instant. Monte de deux crans, puis
      de deux encore — le mur se voit tout seul.
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * Le mur exponentiel, mesuré sur la machine du lecteur.
 *
 * Deux fois rien à expliquer une fois qu'on l'a vu : la ligne à 14 bits est
 * invisible à côté de celle à 20, et c'est exactement l'argument. Aucune valeur
 * n'est écrite en dur — tout ce qui s'affiche a été haché ici.
 */
import { ref, computed } from 'vue'
import type { UnsignedEvent } from 'nostr-tools/pure'
import { KIND_THREAD } from '~/types/nostr'
import { mineInFrames } from '~/utils/demo-mine'

const MIN = 8
const MAX = 22
/** Ce que la policy exige réellement pour un topic ou une réponse. */
const REAL = 14

interface Result {
  difficulty: number
  tries: number
  ms: number
}

const target = ref(REAL)
const busy = ref(false)
const live = ref(0)
const results = ref<Result[]>([])
let token = 0

const max = computed(() => Math.max(...results.value.map((r) => r.tries), 1))

/** 1,5 % de plancher : une mesure réelle ne doit jamais disparaître de l'échelle. */
function width(tries: number): string {
  return `${Math.max(1.5, (tries / max.value) * 100)}%`
}

async function run(): Promise<void> {
  const mine_token = ++token
  busy.value = true
  live.value = 0

  const unsigned: UnsignedEvent = {
    kind: KIND_THREAD,
    // La clé ne change pas le coût du hachage : la calibration du vrai mineur
    // utilise la même clé factice (`workers/pow.worker.ts`).
    pubkey: '0'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    tags: [['title', 'mesure']],
    content: 'combien coûte un message ?',
  }

  try {
    const out = await mineInFrames(unsigned, target.value, {
      onTick: (n) => (live.value = n),
      alive: () => mine_token === token,
    })
    const row: Result = { difficulty: target.value, tries: out.tries, ms: out.ms }
    results.value = [...results.value.filter((r) => r.difficulty !== row.difficulty), row].sort(
      (a, b) => a.difficulty - b.difficulty,
    )
  } catch {
    // annulation : la série garde ce qu'elle avait déjà mesuré
  } finally {
    if (mine_token === token) busy.value = false
  }
}

function stop(): void {
  token++
  busy.value = false
}
</script>

<style scoped>
.pl {
  background: var(--surface-sunken);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  padding: 16px;
}

.pl__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.pl__label {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-2);
}
.pl__stepper {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
}
.pl__value {
  min-width: 62px;
  text-align: center;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--ink);
}
.pl__go {
  margin-left: auto;
}

.pl__live {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 12px 0 0;
  font-size: var(--fs-sm);
  color: var(--ink-2);
}
.pl__patience {
  font-family: var(--font-ui);
  color: var(--ink-4);
}

.pl__list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pl__row {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 10px;
}
.pl__bits {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-2);
}
.pl__track {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}
/* Bleu : c'est une mesure d'interface, pas une chaleur de forum. */
.pl__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--link);
  transition: width 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.pl__num,
.pl__ms {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  white-space: nowrap;
}
/* « tu es ici », donc bleu : cette ligne n'est pas une chaleur de forum, c'est le
   repère qui relie la mesure au produit. */
.pl__here {
  color: var(--link);
  background: var(--link-soft);
}

.pl__foot {
  margin: 14px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-3);
}

@media (max-width: 620px) {
  .pl__row {
    grid-template-columns: 58px minmax(0, 1fr) auto;
    row-gap: 4px;
  }
  /* Le temps passe sous la barre : garder cinq colonnes ici écraserait la barre,
     qui porte la comparaison. */
  .pl__ms,
  .pl__here {
    grid-column: 2 / -1;
  }
}
</style>
