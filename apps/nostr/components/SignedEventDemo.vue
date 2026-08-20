<template>
  <div class="sed">
    <div class="sed__head">
      <p class="sed__title">
        Un message, fabriqué <span class="sed__now">à l’instant</span>, dans cet onglet.
      </p>
      <p class="sed__sub">
        Avec une clé créée pour l’occasion, et une preuve de travail réellement minée. Aucun
        relais ne l’a vu.
      </p>
    </div>

    <!-- Les champs paraissent dans l'ordre où ils se fabriquent, et non dans
         l'ordre du JSON : c'est cet ordre-là que la page suit ensuite. -->
    <ol class="sed__rows">
      <li
        v-for="row in rows"
        :key="row.key"
        class="sed__row"
        :class="{ 'sed__row--pending': stage < row.stage }"
      >
        <a class="sed__link" :href="`#${row.anchor}`" @click.prevent="emit('goto', row.anchor)">
          <span class="sed__key mono">{{ row.key }}</span>
          <span class="sed__val mono">{{ stage >= row.stage ? row.value : '·····' }}</span>
          <span class="sed__gloss">
            {{ row.gloss }}
            <svg class="sed__caret" viewBox="0 0 8 12" aria-hidden="true">
              <path d="M2 1 L7 6 L2 11" fill="none" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </span>
        </a>
        <p v-if="row.note && stage >= row.stage" class="sed__note">{{ row.note }}</p>
      </li>
    </ol>

    <div class="sed__foot">
      <p class="sed__state" :class="{ 'sed__state--done': stage >= 5 }">
        <template v-if="stage < 3">fabrication…</template>
        <template v-else-if="stage === 3">
          minage : {{ tries.toLocaleString('fr-FR') }} essais
        </template>
        <template v-else-if="stage < 5">signature…</template>
        <template v-else-if="verified">
          <span class="sed__check" aria-hidden="true" />
          signature vérifiée · empreinte trouvée en
          {{ tries.toLocaleString('fr-FR') }} essais, {{ ms }} ms
        </template>
        <template v-else>la vérification a échoué — ceci est un bug, dis-le</template>
      </p>
      <button type="button" class="btn btn--sm btn--ghost sed__again" @click="start">
        refabriquer
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * L'objet dont parle toute la page, construit pour de vrai devant le lecteur :
 * clé neuve, minage NIP-13, signature schnorr, vérification. Rien n'est simulé et
 * rien n'est publié — c'est précisément ce que la page a besoin de démontrer, et
 * une capture d'écran d'un event ne le démontrerait pas.
 *
 * Pourquoi une clé jetable plutôt que celle du lecteur : signer avec son identité
 * réclamerait son extension ou son signeur distant (une fenêtre qui s'ouvre au
 * chargement d'une page de doc), et créer une clé sous ses yeux illustre au
 * passage le chapitre « ta clé est ton compte » — une clé ne coûte rien.
 *
 * Le minage tourne ici et non dans `usePowMiner` : ce mineur-là est un singleton
 * qui appartient au composeur, et la démonstration a besoin de voir le compteur
 * d'essais monter — c'est le seul contenu de la scène.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import type { UnsignedEvent } from 'nostr-tools/pure'
import { KIND_THREAD } from '~/types/nostr'
import { mineInFrames, type MineOutcome } from '~/utils/demo-mine'

const emit = defineEmits<{ goto: [anchor: string] }>()

/** La vraie valeur exigée par la policy pour un topic (`packages/relay-policy`). */
const DIFFICULTY = 14
const TITLE = 'Le forum tourne sans serveur'
const CONTENT = 'Personne ne peut effacer ce message, moi compris.'

interface Row {
  key: string
  value: string
  gloss: string
  anchor: string
  /** étape à partir de laquelle le champ existe */
  stage: number
  note?: string
}

const stage = ref(0)
const tries = ref(0)
const ms = ref(0)
const verified = ref(false)
const rows = ref<Row[]>(skeleton())

function skeleton(): Row[] {
  return [
    { key: '"pubkey"', value: '', gloss: 'qui', anchor: 'cle', stage: 1 },
    { key: '"kind"', value: '', gloss: 'quel genre', anchor: 'genre', stage: 2 },
    { key: '"content"', value: '', gloss: 'quoi', anchor: 'genre', stage: 2 },
    { key: '"created_at"', value: '', gloss: 'quand, d’après toi', anchor: 'heure', stage: 2 },
    { key: '"tags"', value: '', gloss: 'le péage', anchor: 'peage', stage: 3 },
    { key: '"id"', value: '', gloss: 'l’empreinte', anchor: 'empreinte', stage: 4 },
    { key: '"sig"', value: '', gloss: 'la preuve', anchor: 'signature', stage: 5 },
  ]
}

function set(key: string, value: string, note?: string): void {
  const row = rows.value.find((r) => r.key === key)
  if (!row) return
  row.value = value
  if (note) row.note = note
}

/** Milieu élidé : les deux bouts sont ce qui sert à comparer deux clés à l'œil. */
function short(hex: string, head = 8, tail = 6): string {
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`
}

const reduced = () =>
  import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches

let token = 0

function pause(delay: number): Promise<void> {
  if (reduced()) return Promise.resolve()
  return new Promise((r) => setTimeout(r, delay))
}

async function start(): Promise<void> {
  const mine_token = ++token
  stage.value = 0
  tries.value = 0
  ms.value = 0
  verified.value = false
  rows.value = skeleton()

  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  set('"pubkey"', short(pubkey))
  await pause(260)
  if (mine_token !== token) return
  stage.value = 1

  const createdAt = Math.floor(Date.now() / 1000)
  const unsigned: UnsignedEvent = {
    kind: KIND_THREAD,
    pubkey,
    created_at: createdAt,
    tags: [['title', TITLE]],
    content: CONTENT,
  }
  set('"kind"', '11', 'un topic ; une réponse serait 1111')
  set('"content"', `« ${CONTENT} »`)
  set(
    '"created_at"',
    `${createdAt} · ${new Date(createdAt * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
  )
  await pause(320)
  if (mine_token !== token) return
  stage.value = 2

  await pause(200)
  if (mine_token !== token) return
  stage.value = 3

  let mined: MineOutcome
  try {
    mined = await mineInFrames(unsigned, DIFFICULTY, {
      onTick: (n) => (tries.value = n),
      alive: () => mine_token === token,
      // Sans mouvement, le compteur n'a pas à être observable : une seule tranche.
      chunk: reduced() ? 2_000_000 : 2500,
    })
  } catch {
    return
  }
  ms.value = mined.ms
  const nonce = mined.event.tags.find((t) => t[0] === 'nonce')?.[1] ?? '0'
  set('"tags"', `["nonce","${nonce}","${DIFFICULTY}"]`, 'l’autre tag porte le titre du topic')
  set('"id"', short(mined.event.id, 10, 6))
  await pause(280)
  if (mine_token !== token) return
  stage.value = 4

  const signed = finalizeEvent(unsigned, sk)
  set('"sig"', short(signed.sig, 10, 6))
  await pause(280)
  if (mine_token !== token) return
  verified.value = verifyEvent(signed)
  stage.value = 5
}

onMounted(() => void start())
onBeforeUnmount(() => {
  token++
})
</script>

<style scoped>
/* Bloc enfoncé et non panneau flottant : c'est une pièce à conviction posée dans
   la page, pas une carte de plus. */
.sed {
  background: var(--surface-sunken);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  padding: 18px 18px 14px;
}

.sed__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ink);
}
/* Le seul mot souligné du bloc : c'est lui qui dit que la scène est vivante. */
.sed__now {
  text-decoration: underline;
  text-decoration-color: var(--link);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}
.sed__sub {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-3);
}

.sed__rows {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
}
.sed__row + .sed__row {
  margin-top: 1px;
}

.sed__link {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 12px;
  padding: 7px 10px;
  border-radius: var(--r-pastille);
  color: inherit;
  text-decoration: none !important;
  transition: background 0.13s ease;
}
.sed__link:hover {
  background: var(--surface-3);
}

.sed__key {
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.sed__val {
  font-size: var(--fs-base);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sed__gloss {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--link);
  white-space: nowrap;
}
.sed__caret {
  width: 6px;
  height: 9px;
}
.sed__note {
  margin: 0 0 4px;
  padding: 0 10px 0 114px;
  font-size: var(--fs-sm);
  color: var(--ink-4);
}

/* Champ pas encore fabriqué : la ligne existe, sa valeur non. Le lien reste
   cliquable — le chapitre, lui, est déjà là. */
.sed__row--pending .sed__val {
  color: var(--ink-4);
  letter-spacing: 0.1em;
}
.sed__row--pending .sed__gloss {
  color: var(--ink-4);
}

.sed__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
}
.sed__state {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.sed__state--done {
  color: var(--ok);
}
.sed__check {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent);
}
.sed__again {
  margin-left: auto;
}

@media (max-width: 560px) {
  .sed {
    padding: 14px 12px 12px;
  }
  .sed__link {
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: 2px;
  }
  /* Le nom du champ passe au-dessus de sa valeur : à cette largeur, une colonne
     de 92 px ne laisse plus rien à la valeur, qui est le contenu. */
  .sed__key {
    grid-column: 1 / -1;
  }
  .sed__note {
    padding-left: 10px;
  }
}
</style>
