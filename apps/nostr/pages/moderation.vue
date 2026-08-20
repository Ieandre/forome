<template>
  <div class="pub">
    <header class="pub__head">
      <h1 class="pub__title">Qui modère ici</h1>
      <p class="pub__lead">
        L'équipe de ce forum et les décisions en vigueur. Rien n'est secret : chaque décision est un
        message signé, publié sur les relais, lisible par n'importe quel client Nostr. Cette page ne
        les révèle pas — elle les rend lisibles.
      </p>
    </header>

    <section v-if="!mod.configured" class="pub__panel">
      <p class="pub__empty">
        Ce client n'a pas de clé racine épinglée : il n'accepte le roster de personne et n'applique
        aucune décision de modération.
      </p>
    </section>

    <template v-else>
      <section class="pub__panel">
        <h2 class="pub__h2">L'équipe</h2>
        <ul class="pub__team">
          <li v-for="[pubkey, role] in mod.state.staff" :key="pubkey" class="pub__member">
            <UserAvatar :pubkey="pubkey" :size="30" :alt="`avatar de ${profiles.displayName(pubkey)}`" />
            <div class="pub__member-main">
              <NuxtLink :to="`/profil/${npubFor(pubkey)}`" class="pub__member-name">
                {{ profiles.displayName(pubkey) }}
              </NuxtLink>
              <span class="pub__member-disc mono">·{{ profiles.discriminator(pubkey) }}</span>
            </div>
            <span class="tag tag--staff">{{ role === 'admin' ? 'admin' : 'modération' }}</span>
          </li>
        </ul>
      </section>

      <section class="pub__panel">
        <h2 class="pub__h2">Décisions en vigueur</h2>
        <p class="pub__note">
          Ce que la modération a masqué, banni ou verrouillé, et pourquoi. C'est l'état courant : une
          décision annulée n'y figure plus.
        </p>

        <p v-if="mod.journal.length === 0" class="pub__empty">Aucune décision en vigueur.</p>

        <ol v-else class="pub__log">
          <li v-for="a in mod.journal" :key="`${a.type}:${a.target}`" class="pub__entry">
            <span class="tag" :class="a.class === 'illegal' ? 'tag--warn' : 'tag--staff'">
              {{ verbLabel(a.type) }}
            </span>
            <span class="pub__entry-reason">{{ a.reason || 'sans motif' }}</span>
            <span class="pub__entry-by">{{ profiles.displayName(a.by) }}</span>
            <time class="pub__entry-when mono">{{ relativeTime(a.at) }}</time>
          </li>
        </ol>
      </section>

      <section class="pub__panel">
        <h2 class="pub__h2">Ce que la modération peut, et ce qu'elle ne peut pas</h2>
        <ul class="pub__facts">
          <li>
            <strong>Elle ne supprime rien.</strong> Un message masqué reste sur le réseau ; un autre
            client Nostr l'affichera. Ce forum choisit ce qu'il montre, pas ce qui existe.
          </li>
          <li>
            <strong>Elle ne peut pas agir en silence.</strong> Chaque décision est signée par la clé
            de son auteur, avec son motif. C'est ce que tu lis ici.
          </li>
          <li>
            <strong>Elle ne lit pas les messages privés.</strong> Ils sont chiffrés de bout en bout
            et leur expéditeur est masqué au relais : personne ne peut les modérer, nous compris.
          </li>
          <li>
            <strong>Tu gardes tes propres réglages.</strong> Bloquer quelqu'un pour toi seul reste
            possible, et n'a rien à voir avec les décisions ci-dessus.
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { relativeTime } from '~/utils/format'
import { npubFor } from '~/utils/nostr'
import type { ActionType } from '@forome/relay-policy/moderation'

usePageTitle('Modération')

const mod = useModerationStore()
const profiles = useProfileStore()

function verbLabel(type: ActionType): string {
  const labels: Partial<Record<ActionType, string>> = {
    hide: 'message masqué',
    ban: 'compte banni',
    lock: 'topic verrouillé',
    pin: 'topic épinglé',
  }
  return labels[type] ?? type
}
</script>

<style scoped>
.pub {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 16px 60px;
}
.pub__head {
  margin-bottom: 20px;
}
.pub__title {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: var(--fs-h);
  color: var(--ink);
}
.pub__lead {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: 1.65;
  color: var(--ink-2);
}

.pub__panel {
  margin-bottom: 16px;
  padding: 18px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-1);
}
.pub__h2 {
  margin: 0 0 4px;
  font-size: var(--fs-title);
  color: var(--ink);
}
.pub__note {
  margin: 0 0 14px;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--ink-4);
}
.pub__empty {
  margin: 12px 0 0;
  font-size: var(--fs-md);
  color: var(--ink-4);
}

/* ------------------------------------------------------------------ équipe */
.pub__team {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.pub__member {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-top: 1px solid var(--line-soft);
}
.pub__member-main {
  flex: 1;
  min-width: 0;
}
.pub__member-name {
  font-weight: 700;
  color: var(--link);
  text-decoration: none;
}
.pub__member-name:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.pub__member-disc {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
  margin-left: 4px;
}

/* ----------------------------------------------------------------- journal
 * Une liste de décisions, jamais un palmarès : pas de compteur par modérateur,
 * pas de classement. La page rend des comptes ; elle ne fabrique pas de cible
 * chiffrée pour ceux qui contestent une décision.
 */
.pub__log {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.pub__entry {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 9px 0;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-md);
}
.pub__entry-reason {
  flex: 1;
  min-width: 160px;
  color: var(--ink);
}
.pub__entry-by {
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.pub__entry-when {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
}

/* -------------------------------------------------------------------- faits */
.pub__facts {
  margin: 12px 0 0;
  padding-left: 18px;
}
.pub__facts li {
  margin-bottom: 9px;
  font-size: var(--fs-md);
  line-height: 1.6;
  color: var(--ink-2);
}
</style>
