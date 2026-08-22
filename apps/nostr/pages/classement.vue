<template>
  <div class="clt">
    <header class="clt__head">
      <h1 class="clt__title">Classement</h1>
      <p class="clt__lead">
        Les points récompensent ce que tes messages provoquent, pas le temps que tu passes ici :
        les gens qui te répondent, ceux que tes topics rassemblent. Écrire beaucoup rapporte peu.
      </p>
    </header>

    <!-- Sans clé d'indexeur épinglée, il n'y a rien à afficher et il faut le
         dire : un classement vide se lirait comme un forum vide. Même
         formulation que `/moderation` face au même cas. -->
    <section v-if="!topics.indexerPubkey" class="clt__panel">
      <p class="clt__empty">
        Ce client n'épingle aucune clé d'indexeur : il n'accepte le décompte de personne, donc il
        n'affiche aucun point. Un client sans indexeur reste un forum complet — il perd le
        classement, pas les messages.
      </p>
    </section>

    <section v-else-if="rows.length === 0" class="clt__panel">
      <p class="clt__empty">
        Personne n'a encore de points. Ouvre un topic : le premier message compte.
      </p>
    </section>

    <template v-else>
      <!-- Ta place d'abord : c'est ce qu'on vient chercher en ouvrant la page.
           Le bleu dit « où tu es » (charte), et c'est le seul aplat coloré de
           l'écran — un classement ne décrit que du passé, donc pas d'orange. -->
      <section v-if="mine" class="clt__mine">
        <p class="clt__mine-rank mono">{{ mine.rank }}<span class="clt__mine-ord">ᵉ</span></p>
        <div class="clt__mine-main">
          <p class="clt__mine-lvl mono">niveau {{ mine.level }}</p>
          <div
            class="clt__bar clt__bar--self"
            role="progressbar"
            :aria-valuenow="myProgress.into"
            :aria-valuemin="0"
            :aria-valuemax="myProgress.span"
            :aria-label="`progression vers le niveau ${mine.level + 1}`"
          >
            <span class="clt__bar-fill" :style="{ width: `${myPct}%` }" />
          </div>
          <p class="clt__mine-next">
            {{ fmt(mine.points) }} points · encore {{ fmt(myProgress.toNext) }} avant le niveau
            {{ mine.level + 1 }}
          </p>
        </div>
      </section>

      <section class="clt__panel clt__panel--table">
        <div class="clt__scroll">
          <table class="clt__table">
            <caption class="visually-hidden">
              Membres du forum classés par points, du plus élevé au plus bas
            </caption>
            <thead>
              <tr>
                <th scope="col" class="clt__num">Rang</th>
                <th scope="col">Membre</th>
                <th scope="col">Niveau</th>
                <th scope="col" class="clt__num">Points</th>
                <th scope="col" class="clt__num clt__col--wide">Topics</th>
                <th scope="col" class="clt__num clt__col--wide">Réponses</th>
                <th scope="col" class="clt__num clt__col--wide">Jours actifs</th>
                <th scope="col" class="clt__col--wide">Dernier message</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.pubkey"
                class="clt__row"
                :class="{ 'clt__row--self': row.pubkey === identity.pubkey }"
              >
                <td class="clt__num clt__rank mono">{{ row.rank }}</td>

                <td class="clt__member">
                  <UserAvatar
                    :pubkey="row.pubkey"
                    :size="24"
                    :alt="`avatar de ${profiles.displayName(row.pubkey)}`"
                  />
                  <NuxtLink :to="`/profil/${npubFor(row.pubkey)}`" class="clt__name">
                    {{ profiles.displayName(row.pubkey) }}
                  </NuxtLink>
                  <span class="clt__disc mono">·{{ profiles.discriminator(row.pubkey) }}</span>
                </td>

                <!-- La progression est DANS la cellule de niveau, pas en colonne
                     à part : elle ne décrit que lui, et une huitième colonne
                     aurait fait payer une donnée secondaire au prix d'une
                     principale. Le trait sous le nombre est la même idée que le
                     rail de chauffe — une quantité continue lue en périphérie. -->
                <td class="clt__lvl">
                  <span class="clt__lvl-n mono">{{ row.level }}</span>
                  <span class="clt__bar" aria-hidden="true">
                    <span class="clt__bar-fill" :style="{ width: `${pctOf(row.points)}%` }" />
                  </span>
                </td>

                <td class="clt__num clt__pts mono">{{ fmt(row.points) }}</td>
                <td class="clt__num clt__col--wide mono">{{ row.topics }}</td>
                <td class="clt__num clt__col--wide mono">{{ row.replies }}</td>
                <td class="clt__num clt__col--wide mono">{{ row.activeDays }}</td>
                <td class="clt__col--wide clt__seen mono">{{ seenLabel(row.lastDay) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="points.updatedAt" class="clt__stamp mono">
          calculé il y a {{ relativeTime(points.updatedAt) }}
        </p>
      </section>

      <!-- Le barème est public, et il est lu depuis le code qui compte : une
           page qui recopierait les valeurs à la main finirait par annoncer un
           barème que le forum n'applique plus. -->
      <section class="clt__panel">
        <h2 class="clt__h2">Comment on gagne des points</h2>
        <p class="clt__note">
          Deux blocs, volontairement déséquilibrés. Le premier est un plancher, le second est le
          score.
        </p>

        <dl class="clt__rules">
          <div v-for="r in RULES" :key="r.label" class="clt__rule" :class="`clt__rule--${r.bloc}`">
            <dt class="clt__rule-label">{{ r.label }}</dt>
            <dd class="clt__rule-val mono">+{{ r.pts }}</dd>
            <dd v-if="r.note" class="clt__rule-note">{{ r.note }}</dd>
          </div>
        </dl>

        <p class="clt__note clt__note--last">
          Au maximum {{ DAILY_CAP }} points par jour, quoi qu'il arrive : c'est ce qui fait qu'un
          niveau se paie en temps réel et pas en une nuit — le niveau 20 demande au moins
          {{ minDaysForLevel(20) }} jours. Passer du niveau <em>n</em> au suivant coûte
          {{ LEVEL_STEP }} × <em>n</em> points, sans plafond de niveau.
          Répondre ne crédite personne avant d'avoir {{ MIN_POINTS_TO_CREDIT }} points soi-même, et
          une même personne ne te crédite qu'une fois par message : sans ça, quelques clés neuves
          fabriqueraient n'importe quel score.
        </p>

        <p class="clt__caveat">
          C'est l'indexeur du forum qui compte, sur ce qu'il a vu passer : ce qui a été publié
          pendant un arrêt n'est pas compté. Un niveau ne donne aucun droit — ni pour écrire, ni
          pour voter, ni pour rien.
        </p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Le classement (spec §16).
 *
 * ## Ce que cette page est, et ce qu'elle n'est pas
 *
 * Un **registre**, pas un podium. Il n'y a ni or, ni argent, ni bronze : la
 * charte réserve la seule couleur chaude du site à ce qui arrive maintenant (le
 * rail de chauffe), et trois médailles y mettraient un second accent chaud qui
 * lui ferait concurrence pour dire quelque chose de bien plus tiède. Le tableau
 * est donc quasi monochrome, et le seul aplat coloré de l'écran est **ta**
 * place — le bleu dit « où tu es », c'est exactement son travail.
 *
 * Les nombres sont tous en mono à chasse tabulaire : c'est le registre de la
 * provenance dans tout le site (heure, nº de post, discriminant), et c'est ce
 * qui rend une colonne de chiffres comparable à l'œil sans la lire.
 *
 * ## Pourquoi le barème est affiché
 *
 * Un score dont la règle est cachée se lit comme un score arbitraire. Les
 * valeurs sont importées de `@forome/points` et non recopiées : une page qui les
 * réécrirait finirait par annoncer un barème que le forum n'applique plus.
 */
import {
  DAILY_CAP,
  LEVEL_STEP,
  MIN_POINTS_TO_CREDIT,
  WEIGHTS,
  levelProgress,
  minDaysForLevel,
} from '@forome/points'
import { npubFor } from '~/utils/nostr'
import { relativeTime } from '~/utils/format'

usePageTitle('Classement')

const points = useUserPointsStore()
const topics = useTopicStore()
const profiles = useProfileStore()
const identity = useIdentityStore()

const rows = computed(() => points.ranking)
const mine = computed(() =>
  identity.pubkey ? (rows.value.find((r) => r.pubkey === identity.pubkey) ?? null) : null,
)
const myProgress = computed(() => levelProgress(mine.value?.points ?? 0))
const myPct = computed(() => pctOf(mine.value?.points ?? 0))

/**
 * Les profils ne sont pas résolus tant que personne ne les a demandés : sans
 * ça, la page n'afficherait que des `khey_xxxx` là où un pseudo existe.
 */
watch(
  rows,
  (list) => {
    for (const r of list.slice(0, 200)) profiles.want(r.pubkey)
  },
  { immediate: true },
)

function pctOf(pts: number): number {
  const p = levelProgress(pts)
  return p.span > 0 ? Math.round((p.into / p.span) * 100) : 0
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR')
}

/**
 * Le jour, pas l'heure : le pli ne retient qu'un numéro de jour, et afficher
 * « il y a 3 h » à partir d'une donnée au jour promettrait une précision qui
 * n'existe pas.
 */
function seenLabel(day: number): string {
  if (!day) return '—'
  const today = Math.floor(Date.now() / 86_400_000)
  const diff = today - day
  if (diff <= 0) return "aujourd'hui"
  if (diff === 1) return 'hier'
  if (diff < 30) return `il y a ${diff} jours`
  return new Date(day * 86_400_000).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}

const RULES = [
  { bloc: 'fait', label: 'Tu ouvres un topic', pts: WEIGHTS.topic, note: null },
  { bloc: 'fait', label: 'Tu réponds', pts: WEIGHTS.reply, note: null },
  { bloc: 'fait', label: 'Tu as posté aujourd’hui', pts: WEIGHTS.activeDay, note: 'une fois par jour' },
  {
    bloc: 'recu',
    label: 'Quelqu’un répond à ton message',
    pts: WEIGHTS.replyReceived,
    note: 'une fois par personne',
  },
  {
    bloc: 'recu',
    label: 'Quelqu’un vient parler dans ton topic',
    pts: WEIGHTS.topicParticipant,
    note: 'une fois par personne',
  },
  {
    bloc: 'recu',
    label: 'Ton topic rassemble du monde',
    pts: WEIGHTS.hotTopic,
    note: 'une fois par topic',
  },
  { bloc: 'recu', label: 'Quelqu’un vote à ton sondage', pts: WEIGHTS.pollVote, note: 'une fois par personne' },
] as const
</script>

<style scoped>
.clt {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 16px 60px;
}
.clt__head {
  margin-bottom: 20px;
}
.clt__title {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: var(--fs-h);
  color: var(--ink);
}
.clt__lead {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: 1.65;
  color: var(--ink-2);
}

.clt__panel {
  margin-bottom: 16px;
  padding: 18px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-1);
}
/* Le tableau porte ses propres marges de cellule : le rembourrage du panneau
   couperait la première et la dernière colonne de leur filet. */
.clt__panel--table {
  padding: 6px 0 0;
}
.clt__h2 {
  margin: 0 0 4px;
  font-size: var(--fs-title);
  color: var(--ink);
}
.clt__note {
  margin: 0 0 14px;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-4);
}
.clt__note--last {
  margin: 14px 0 0;
}
.clt__caveat {
  margin: 10px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--ink-4);
}
.clt__empty {
  margin: 0;
  font-size: var(--fs-md);
  line-height: 1.6;
  color: var(--ink-4);
}

/* --------------------------------------------------------------- ta place */
.clt__mine {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  padding: 14px 18px;
  background: var(--link-soft);
  border-radius: var(--r-panel);
}
.clt__mine-rank {
  margin: 0;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--link);
  font-variant-numeric: tabular-nums;
}
.clt__mine-ord {
  font-size: 15px;
  vertical-align: super;
}
.clt__mine-main {
  flex: 1;
  min-width: 0;
}
.clt__mine-lvl {
  margin: 0;
  font-size: var(--fs-title);
  font-weight: 600;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.clt__mine-next {
  margin: 6px 0 0;
  font-size: var(--fs-xs);
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

/* ---------------------------------------------------------------- tableau */
.clt__scroll {
  overflow-x: auto;
}
.clt__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-md);
}
.clt__table th {
  padding: 8px 12px;
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  text-align: left;
  color: var(--ink-4);
  white-space: nowrap;
}
.clt__table td {
  padding: 9px 12px;
  border-top: 1px solid var(--line-soft);
  color: var(--ink-2);
  vertical-align: middle;
}
.clt__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.clt__rank {
  width: 1%;
  color: var(--ink-4);
}
.clt__pts {
  font-weight: 600;
  color: var(--ink);
}
.clt__seen {
  font-size: var(--fs-sm);
  color: var(--ink-4);
  white-space: nowrap;
}

/* La rangée du lecteur : teinte + rail à gauche. Même geste que la rangée
   ouverte de la colonne de topics — « où tu es » se marque toujours pareil. */
.clt__row--self td {
  background: var(--link-soft);
}
.clt__row--self td:first-child {
  box-shadow: inset 3px 0 0 var(--link);
}

.clt__member {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.clt__name {
  font-weight: 700;
  color: var(--link);
  text-decoration: none !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clt__name:hover {
  text-decoration: underline !important;
}
.clt__disc {
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
  flex-shrink: 0;
}

.clt__lvl {
  width: 62px;
}
.clt__lvl-n {
  display: block;
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
/* 38 px et pas la largeur de la cellule : au-delà, le trait sous le nombre se
   lit comme un soulignement de texte. Et la piste s'efface (`--line-soft`)
   pendant que le remplissage monte à `--ink-3` — à contraste égal, une jauge
   pleine et une jauge vide se ressemblaient. */
.clt__bar {
  display: block;
  position: relative;
  width: 38px;
  height: 2px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--line-soft);
  overflow: hidden;
}
/* Bornée : pleine largeur, elle se lisait comme un filet séparateur de page et
   non comme une jauge — un trait de 700 px ne se compare à rien. */
.clt__bar--self {
  width: auto;
  height: 3px;
  max-width: 280px;
  margin-top: 7px;
  background: color-mix(in srgb, var(--link) 22%, transparent);
}
.clt__bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--ink-3);
}
.clt__bar--self .clt__bar-fill,
.clt__row--self .clt__bar-fill {
  background: var(--link);
}

.clt__stamp {
  margin: 0;
  padding: 10px 12px 12px;
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

/* ----------------------------------------------------------------- barème */
.clt__rules {
  margin: 0;
  display: grid;
  gap: 1px;
  background: var(--line-soft);
  border-radius: var(--r-control);
  overflow: hidden;
}
.clt__rule {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 4px 12px;
  padding: 9px 12px;
  background: var(--surface);
}
/* Le déséquilibre du barème se voit : le bloc « ce que tu provoques » est sur
   fond creusé, donc lu comme le corps du système et non comme un supplément. */
.clt__rule--recu {
  background: var(--surface-sunken);
}
.clt__rule-label {
  font-size: var(--fs-md);
  color: var(--ink);
}
.clt__rule-val {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.clt__rule-note {
  grid-column: 1 / -1;
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--ink-4);
}

/* Sous 700 px on RETIRE des colonnes au lieu de les comprimer : quatre chiffres
   illisibles valent moins que deux lisibles. Le détail reste sur le profil. */
@media (max-width: 700px) {
  .clt__col--wide {
    display: none;
  }
  .clt__table th,
  .clt__table td {
    padding-left: 9px;
    padding-right: 9px;
  }
  /* Retirer quatre colonnes ne suffisait pas : « points » sortait encore du
     cadre, parce que le nom et le discriminant sont tous deux insécables. C'est
     le NOM qui cède — le discriminant, lui, est ce qui identifie (§3.5), et un
     pseudo tronqué reste attribuable quand un pseudo seul ne l'est pas. */
  .clt__member {
    max-width: 40vw;
  }
  .clt__lvl {
    width: 44px;
  }
  .clt__bar {
    width: 26px;
  }
}
</style>
