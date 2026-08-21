<template>
  <section v-if="polls.poll" class="poll" :class="{ 'poll--open': open }">
    <!-- L'en-tête ne répète PAS la question : c'est le titre du topic, il est
         juste au-dessus. Il ne porte donc que ce qui n'est écrit nulle part
         ailleurs — l'état du dépouillement, et le point orange si le sondage
         attend encore notre voix. -->
    <button
      type="button"
      class="poll__head"
      :aria-expanded="open"
      :aria-controls="bodyId"
      @click="open = !open"
    >
      <span class="poll__kind mono">sondage</span>
      <span class="poll__voters">{{ votersLabel }}</span>
      <span v-if="polls.awaitingMe" class="poll__dot" aria-hidden="true" />
      <span class="poll__spacer" />
      <svg class="poll__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 9.5l6 6 6-6" />
      </svg>
    </button>

    <div v-show="open" :id="bodyId" class="poll__body">
      <ul class="poll__opts" :role="single ? 'radiogroup' : 'group'" aria-label="réponses du sondage">
        <li v-for="o in polls.options" :key="o.id">
          <button
            type="button"
            class="opt"
            :class="{ 'opt--mine': picked.includes(o.id), 'opt--done': !live }"
            :role="single ? 'radio' : undefined"
            :aria-checked="single ? picked.includes(o.id) : undefined"
            :aria-pressed="single ? undefined : picked.includes(o.id)"
            :disabled="!live"
            @click="choose(o.id)"
          >
            <!-- La part est la rangée elle-même, pas une barre posée à côté :
                 rien ne se déplace au moment du vote, seule la largeur change. -->
            <span class="opt__fill" :style="{ width: share(o.id) + '%' }" aria-hidden="true" />
            <span class="opt__mark" :class="{ 'opt__mark--box': !single }" aria-hidden="true" />
            <span class="opt__label">{{ o.label }}</span>
            <!-- Rien à afficher tant que personne n'a voté : trois « 0 % — 0 »
                 alignés ne sont pas un résultat, juste des compteurs à vide. -->
            <template v-if="polls.tally.voters > 0">
              <span class="opt__share mono">{{ share(o.id) }}%</span>
              <span class="opt__n mono">{{ polls.tally.counts.get(o.id) ?? 0 }}</span>
            </template>
          </button>
        </li>
      </ul>

      <p v-if="polls.lastError" class="poll__error">{{ polls.lastError }}</p>

      <div class="poll__foot">
        <!-- Dit au moment où ça sert : juste avant de cliquer. Une fois la voix
             donnée, la phrase n'apprend plus rien et la place revient au fil. -->
        <p v-if="live && !polls.hasVoted" class="poll__note">
          Voter publie un message signé de ta clé : qui a voté quoi se lit publiquement. Tu peux
          changer d'avis, c'est le dernier vote qui compte.
        </p>
        <p v-else class="poll__note">{{ stateNote }}</p>

        <div class="poll__actions">
          <span v-if="!single && live" class="poll__multi">plusieurs réponses possibles</span>
          <button
            v-if="!single && live"
            type="button"
            class="btn btn--sm btn--primary"
            :disabled="!changed || polls.voting"
            @click="send"
          >
            {{ polls.voting ? 'envoi…' : polls.hasVoted ? 'mettre à jour' : 'voter' }}
          </button>
          <!-- Le retrait est le seul geste qui permet de se dédire : sur Nostr on
               ne supprime pas un vote, on en publie un vide. Il est donc offert
               explicitement plutôt que laissé à deviner. -->
          <button
            v-if="live && polls.hasVoted"
            type="button"
            class="btn btn--sm btn--ghost"
            :disabled="polls.voting"
            @click="withdraw"
          >
            retirer ma voix
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * Le bulletin d'un topic (NIP-88), sous la tête de fil.
 *
 * ## Trois décisions qui ne se déduisent pas du code
 *
 * **Les résultats sont visibles avant d'avoir voté.** Un forum les cache
 * d'ordinaire pour ne pas influencer, mais ici chaque voix est un event public
 * signé : n'importe qui les compte avec trois lignes de code. Les masquer ne les
 * cacherait qu'à la personne qui utilise *notre* client — c'est-à-dire à la
 * seule qu'on prétendait protéger.
 *
 * **La rangée EST la jauge.** La part remplit la rangée derrière son intitulé,
 * elle n'est pas une barre posée à côté. Deux raisons : rien ne se déplace au
 * moment du vote (la mise en page ne bouge pas d'un pixel), et c'est le même
 * langage que le rail de chauffe de la liste — un remplissage dont l'étendue est
 * la grandeur — au lieu d'un second vocabulaire graphique dans la même page.
 *
 * **Un seul orange, et il s'éteint.** Le point de l'en-tête ne dit qu'une chose :
 * ce sondage attend ta voix. Il disparaît dès qu'on a voté, comme la pilule
 * « +N nouveaux » — la charte ne tolère l'orange que sur ce qui s'éteint.
 *
 * ## Choix unique / choix multiple
 *
 * À choix unique, cliquer vote : un clic, un event. À choix multiple, on coche
 * puis on valide — publier à chaque case cochée laisserait une traînée de votes
 * définitifs sur le réseau pour une seule intention.
 */
import { ref, computed, watch, useId } from 'vue'
import { relativeTime } from '~/utils/format'

const polls = usePollStore()
const identity = useIdentityStore()
const bodyId = useId()

/**
 * Replié à l'arrivée sur un sondage déjà voté, ouvert sinon : le bulletin ne
 * prend la place du fil que tant qu'il attend quelque chose de nous.
 *
 * ⚠️ La règle ne s'applique qu'au **changement de topic**, jamais au fait de
 * voter. Branchée aussi sur `hasVoted`, elle refermait le bulletin dans la
 * seconde qui suit le clic — on ne voyait donc pas le résultat de son propre
 * vote, et le geste donnait l'impression d'avoir fait disparaître le sondage.
 */
const open = ref(!polls.hasVoted)
watch(
  () => polls.poll?.id,
  () => {
    open.value = !polls.hasVoted
  },
)

const single = computed(() => polls.type === 'singlechoice')
const identityReady = computed(() => identity.ready)
/** Le sondage accepte encore des voix, et on a de quoi en donner une. */
const live = computed(() => !polls.closed && identityReady.value)

/**
 * Sélection en cours. Semée depuis notre vote connu et resemée quand il change —
 * sinon le retrait de voix laisserait les cases cochées.
 *
 * ⚠️ La source surveillée est la **chaîne** des choix, pas le tableau. `mine`
 * sort d'un computed qui rend un tableau neuf à chaque dépouillement : surveiller
 * la référence rejouait cette remise à zéro à chaque voix reçue, et effaçait donc
 * les cases qu'on venait de cocher sur un sondage à choix multiple encore en
 * cours de saisie.
 */
const picked = ref<string[]>([...polls.mine])
watch(
  () => polls.mine.join(','),
  () => {
    picked.value = [...polls.mine]
  },
)

const changed = computed(
  () =>
    picked.value.length !== polls.mine.length ||
    picked.value.some((id) => !polls.mine.includes(id)),
)

function share(id: string): number {
  const total = polls.tally.voters
  if (total === 0) return 0
  return Math.round(((polls.tally.counts.get(id) ?? 0) / total) * 100)
}

const votersLabel = computed(() => {
  const n = polls.tally.voters
  if (n === 0) return polls.closed ? 'aucune voix' : 'personne n’a encore voté'
  return `${n} voix`
})

/** Ce qu'il reste à dire quand la phrase d'avertissement n'a plus lieu d'être. */
const stateNote = computed(() => {
  if (polls.closed) {
    const end = polls.endsAt
    return end ? `Sondage fermé depuis ${relativeTime(end)}.` : 'Sondage fermé.'
  }
  if (!identityReady.value) return 'Il faut une clé pour voter.'
  const end = polls.endsAt
  const closing = end ? ` Il ferme dans ${untilLabel(end)}.` : ''
  return `Ta voix est publique et modifiable.${closing}`
})

/** Durée restante, dans la même famille de formulations que `relativeTime`. */
function untilLabel(end: number): string {
  const s = Math.max(0, end - Math.floor(Date.now() / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} j`
}

function choose(id: string): void {
  if (!live.value) return
  if (single.value) {
    picked.value = [id]
    void polls.vote([id])
    return
  }
  picked.value = picked.value.includes(id)
    ? picked.value.filter((x) => x !== id)
    : [...picked.value, id]
}

function send(): void {
  void polls.vote(picked.value)
}

function withdraw(): void {
  void polls.vote([])
}
</script>

<style scoped>
/* Le bulletin est une pièce du topic, pas un outil posé dessus : il garde la
   surface de la tête de fil (`TopicModeration`, lui, s'enfonce parce qu'il est
   du chrome de modération). Seul un filet le sépare du fil qui défile dessous. */
.poll {
  flex-shrink: 0;
  background: var(--surface);
  border-bottom: 1px solid var(--line-soft);
}

/* ---------------------------------------------------------------- en-tête */
.poll__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: var(--topic-col, 880px);
  margin: 0 auto;
  padding: 10px 20px;
  background: none;
  border: none;
  text-align: left;
  color: inherit;
}
.poll__head:hover .poll__voters {
  color: var(--ink);
}

/* Le seul dispositif d'étiquetage du bloc : il dit ce que c'est, une fois. En
   mono comme tout ce qui relève de la provenance plutôt que du propos. */
.poll__kind {
  flex-shrink: 0;
  padding: 2px 7px;
  background: var(--surface-2);
  border-radius: var(--r-pastille);
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--ink-3);
}

/* Pousse le chevron au bout de la barre : le reste de l'en-tête se groupe à
   gauche, contre l'étiquette. */
.poll__spacer {
  flex: 1;
}

/* L'unique orange du bloc, et il s'éteint : « ce sondage attend ta voix ». */
.poll__dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  background: var(--brand);
  border-radius: 999px;
  box-shadow: var(--heat-glow);
}

.poll__voters {
  flex-shrink: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-2);
  transition: color 0.13s ease;
}

.poll__chev {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  color: var(--ink-4);
  transition: transform 0.16s ease;
}
.poll--open .poll__chev {
  transform: rotate(180deg);
}

/* ------------------------------------------------------------------ corps */
.poll__body {
  max-width: var(--topic-col, 880px);
  margin: 0 auto;
  padding: 0 20px 12px;
}

.poll__opts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* --------------------------------------------------------------- une option
   Rangée pleine largeur, remplissage derrière le texte. `overflow: hidden`
   borne le remplissage au rayon, `isolation` empêche l'ombre du survol de
   passer par-dessus lui. */
.opt {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 12px;
  background: var(--surface-2);
  border: 1px solid transparent;
  border-radius: var(--r-control);
  overflow: hidden;
  text-align: left;
  color: var(--ink-2);
  font-size: var(--fs-md);
  font-weight: 500;
  transition: border-color 0.13s ease, color 0.13s ease;
}
.opt:hover:not(:disabled) {
  border-color: var(--line-strong);
  color: var(--ink);
}
.opt:disabled {
  cursor: default;
}

/* Le remplissage : la part des votants, rien d'autre. Neutre par défaut — un
   résultat n'est pas un signal, il n'a donc aucune couleur de marque à porter. */
.opt__fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--surface-3);
  transition: width 0.35s cubic-bezier(0.22, 0.8, 0.3, 1);
}

/* Notre voix : bleu, comme tout ce qui dit « toi » dans la charte. */
.opt--mine {
  color: var(--ink);
  border-color: color-mix(in srgb, var(--link) 45%, transparent);
}
.opt--mine .opt__fill {
  background: var(--link-soft);
}

.opt__mark {
  position: relative;
  flex-shrink: 0;
  width: 13px;
  height: 13px;
  border: 1.5px solid var(--line-strong);
  border-radius: 999px;
  transition: border-color 0.13s ease, background 0.13s ease;
}
.opt__mark--box {
  border-radius: 3px;
}
.opt--mine .opt__mark {
  border-color: var(--link);
  background: var(--link);
  box-shadow: inset 0 0 0 2.5px var(--surface);
}
.opt--mine .opt__mark--box {
  box-shadow: inset 0 0 0 1.5px var(--surface);
}

.opt__label {
  position: relative;
  flex: 1;
  min-width: 0;
  line-height: 1.35;
}

/* Les deux colonnes de chiffres sont tabulaires et à largeur fixe : sans ça
   elles dansent d'une rangée à l'autre et à chaque voix qui arrive. */
.opt__share {
  position: relative;
  flex-shrink: 0;
  min-width: 38px;
  text-align: right;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink);
}
.opt__n {
  position: relative;
  flex-shrink: 0;
  min-width: 26px;
  text-align: right;
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

/* -------------------------------------------------------------------- pied */
.poll__foot {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-top: 9px;
}
.poll__note {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--ink-3);
}
.poll__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.poll__multi {
  font-size: var(--fs-xs);
  color: var(--ink-4);
}
.poll__error {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--warn);
}

@media (max-width: 700px) {
  .poll__head {
    padding-inline: 14px;
  }
  .poll__body {
    padding-inline: 14px;
  }
  /* La phrase passe au-dessus des boutons plutôt que de les écraser. */
  .poll__foot {
    flex-direction: column;
    align-items: stretch;
  }
  .poll__actions {
    justify-content: flex-end;
  }
}

@media (prefers-reduced-motion: reduce) {
  .opt__fill,
  .poll__chev {
    transition: none;
  }
}
</style>
