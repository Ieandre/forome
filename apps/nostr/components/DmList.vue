<template>
  <div class="dml">
    <!-- L'en-tête de la colonne, mêmes valeurs que celui des topics : les deux
         sections sont deux contenus du même volet, elles ne peuvent pas
         commencer à deux hauteurs différentes. -->
    <div class="dml__head">
      <SectionTabs />
    </div>
    <p v-if="!dms.available" class="dm__blocked">
      Les MP se déchiffrent avec la clé de cet appareil. La tienne est dans ton extension, où
      cette page n'a pas accès.
    </p>

    <template v-else>
      <div class="dm__scroll">
        <section v-if="dms.inbox.length" class="dm__section">
          <h2 class="dm__section-title">
            Boîte
            <span class="dm__section-n mono">{{ dms.inbox.length }}</span>
          </h2>
          <DmThreadRow
            v-for="t in dms.inbox"
            :key="t.peer"
            :thread="t"
            :active="t.peer === peer"
            @open="open(t.peer)"
          />
        </section>

        <section v-if="dms.requests.length" class="dm__section">
          <h2 class="dm__section-title">
            <Explain
              term="inconnus"
              placement="bottom"
              :body="[
                'Des gens que tu ne suis pas, et que personne de tes suivis ne suit non plus.',
                'Leurs messages restent ici et n\'entrent jamais dans ta boîte.',
              ]"
              >Inconnus</Explain
            >
            <span class="dm__section-n mono">{{ dms.requests.length }}</span>
          </h2>
          <DmThreadRow
            v-for="t in dms.requests"
            :key="t.peer"
            :thread="t"
            :active="t.peer === peer"
            @open="open(t.peer)"
          />
        </section>

        <section v-if="mutedList.length" class="dm__section">
          <h2 class="dm__section-title">
            Bloqués
            <span class="dm__section-n mono">{{ mutedList.length }}</span>
          </h2>
          <div v-for="pk in mutedList" :key="pk" class="dm__muted">
            <UserAvatar :pubkey="pk" :size="22" />
            <span class="dm__muted-name">{{ profiles.displayName(pk) }}</span>
            <Hint text="débloquer — ta liste de blocages est publique, comme tes suivis">
              <button
                type="button"
                class="dm__muted-act"
                :disabled="social.publishing"
                @click="social.unmute(pk)"
              >
                débloquer
              </button>
            </Hint>
          </div>
        </section>

        <!-- Rien du tout : l'écran ne dit pas « vide », il donne la seule
             action possible — on ne reçoit un MP qu'après avoir donné sa clé. -->
        <div v-if="!dms.inbox.length && !dms.requests.length" class="dm__none">
          <p class="dm__none-title">Aucune conversation</p>
          <p class="dm__none-sub">
            Donne ta clé publique pour qu'on puisse t'écrire, ou ouvre un fil toi-même.
          </p>
          <NuxtLink v-if="myNpub" :to="`/profil/${myNpub}`" class="btn btn--sm">Voir ma clé</NuxtLink>
        </div>
      </div>

      <form class="dm__open" @submit.prevent="openFromInput">
        <input
          v-model="peerDraft"
          class="dm__open-input mono"
          placeholder="npub1… ouvrir un fil"
          aria-label="ouvrir un fil avec une clé publique"
        />
        <button type="submit" class="dm__open-go" :disabled="!peerDraft.trim()">Ouvrir</button>
      </form>
      <p v-if="peerError" class="dm__open-err">{{ peerError }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * La colonne des conversations (spec §10.2). Extraite de `pages/dm.vue` : depuis
 * que le volet de gauche vit dans le layout, la liste doit exister sur toutes
 * les routes et la page ne rend plus que la conversation.
 *
 * ⚠️ La conversation ouverte est dans l'URL (`?peer=`) et non dans un `ref`
 * local, parce que la liste et le fil ne sont plus dans le même composant. Ça
 * aligne les MP sur ce que le forum fait déjà (§7.1, « le state du panneau droit
 * est dans l'URL ») : une conversation devient partageable et survit à un
 * rechargement.
 */
import { ref, computed } from 'vue'
import { npubFor, pubkeyFrom } from '~/utils/nostr'

const dms = useDmStore()
const social = useSocialStore()
const profiles = useProfileStore()
const identity = useIdentityStore()
const route = useRoute()
const router = useRouter()

const peerDraft = ref('')
const peerError = ref<string | null>(null)

const peer = computed(() => {
  const raw = Array.isArray(route.query.peer) ? route.query.peer[0] : route.query.peer
  return raw ? pubkeyFrom(String(raw)) : null
})

const myNpub = computed(() => (identity.pubkey ? npubFor(identity.pubkey) : ''))

/** Clés bloquées, triées pour que l'ordre ne saute pas d'un rendu à l'autre. */
const mutedList = computed(() => [...social.mutes].sort())

function open(pk: string): void {
  dms.markRead(pk)
  profiles.want(pk)
  void router.push({ path: '/dm', query: { ...route.query, peer: npubFor(pk) } })
}

function openFromInput(): void {
  peerError.value = null
  const pk = pubkeyFrom(peerDraft.value)
  if (!pk) {
    peerError.value = 'Format non reconnu. Attendu : npub1… ou 64 caractères hex.'
    return
  }
  open(pk)
  peerDraft.value = ''
}
</script>

<style scoped>
/* Comme `TopicList` : pas de surface propre, `SideColumn` est le panneau. */
.dml {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  min-width: 0;
}
.dml__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line-soft);
}
.dm__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 6px 6px;
}

.dm__section + .dm__section {
  margin-top: 6px;
}
/* Même libellé que la tête de la colonne de topics : les deux listes de l'app
   se lisent avec la même grammaire. La barre grise à filet est tombée des deux
   côtés — le libellé se suffit, collé en haut pendant le défilement. */
.dm__section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 12px 8px 8px;
  background: var(--surface);
  font-size: var(--fs-sm);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.dm__section-n {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  letter-spacing: -0.02em;
  color: var(--ink-4);
}

.dm__muted {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  opacity: 0.6;
}
.dm__muted-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm__muted-act {
  flex-shrink: 0;
  background: none;
  border: none;
  padding: 0;
  font-size: var(--fs-sm);
  color: var(--link);
}
.dm__muted-act:hover:not(:disabled) {
  text-decoration: underline;
}

.dm__blocked,
.dm__none,
.dm__idle {
  padding: 22px 16px;
}
.dm__blocked {
  margin: 6px;
  padding: 14px;
  border-radius: var(--r-control);
  font-size: var(--fs-md);
  line-height: 1.6;
  color: var(--ink-2);
  background: var(--warn-soft);
}
.dm__none {
  text-align: center;
}
.dm__none-title {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: var(--fs-title);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.dm__none-sub {
  margin: 0 auto 12px;
  max-width: 30ch;
  font-size: var(--fs-md);
  line-height: 1.6;
  color: var(--ink-3);
}

/* Ouvrir un fil est une saisie, pas une destination : elle reste au pied de la
   liste, disponible sans écraser ce qu'on est venu lire. */
.dm__open {
  display: flex;
  flex-shrink: 0;
  gap: 7px;
  padding: 10px;
  border-top: 1px solid var(--line-soft);
}
.dm__open-input {
  flex: 1;
  min-width: 0;
  padding: 7px 11px;
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-size: var(--fs-sm);
  color: var(--ink);
  transition: border-color 0.14s ease, box-shadow 0.14s ease, background 0.14s ease;
}
.dm__open-input:focus {
  outline: none;
  background: var(--surface);
  border-color: var(--link);
  box-shadow: var(--ring);
}
.dm__open-go {
  flex-shrink: 0;
  padding: 0 13px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-2);
  transition: background 0.14s ease;
}
.dm__open-go:hover:not(:disabled) {
  background: var(--surface-3);
}
.dm__open-go:disabled {
  opacity: 0.5;
}
.dm__open-err {
  flex-shrink: 0;
  margin: 0 10px 10px;
  padding: 8px 12px;
  border-radius: var(--r-control);
  background: var(--warn-soft);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--warn);
}

</style>
