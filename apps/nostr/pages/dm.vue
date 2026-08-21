<template>
  <section class="dm__thread">
    <template v-if="peer">
      <header class="dm__head">
        <BackButton label="retour aux conversations" @click="closeThread" />
        <UserAvatar :pubkey="peer" :size="26" />
        <div class="dm__who">
          <NuxtLink :to="`/profil/${peerNpub}`" class="dm__who-name">
            {{ profiles.displayName(peer) }}
          </NuxtLink>
          <Explain
            term="discriminant"
            :body="[
              'Les six premiers caractères de la clé publique, en hexadécimal.',
              'Sur Nostr le pseudo ne prouve rien : seule la clé est unique.',
            ]"
          >
            <span class="dm__who-disc mono">·{{ profiles.discriminator(peer) }}</span>
          </Explain>
        </div>

        <!-- Les fils connus n'ont qu'une action rare, donc discrète. La vraie
             décision d'un fil inconnu est prise dans le bandeau ci-dessous. -->
        <Hint v-if="isKnown" text="bloquer — ta liste de blocages est publique">
          <button type="button" class="dm__head-act" :disabled="social.publishing" @click="doMute">
            bloquer
          </button>
        </Hint>
      </header>

      <!-- Un fil hors web of trust pose une question, alors on la pose : le
           bandeau porte les deux réponses au lieu de deux boutons permanents
           posés là pour tous les fils. -->
      <div v-if="!isKnown" class="dm__unknown">
        <p class="dm__unknown-text">
          Tu ne suis pas cette clé, et personne que tu suis ne la suit.
        </p>
        <div class="dm__unknown-acts">
          <button
            type="button"
            class="btn btn--sm btn--primary"
            :disabled="social.publishing"
            @click="social.follow(peer)"
          >
            Suivre
          </button>
          <button
            type="button"
            class="btn btn--sm"
            :disabled="social.publishing"
            @click="doMute"
          >
            Bloquer
          </button>
        </div>
      </div>

      <div ref="scrollEl" class="dm__messages">
        <div class="dm__timeline">
          <template v-for="node in timeline" :key="node.key">
            <!-- Le filet fait les deux métiers : il ouvre le registre et il le
                 découpe. La bande de chiffrement permanente au-dessus de chaque
                 fil a disparu au profit de sa première occurrence. -->
            <p v-if="node.type === 'day'" class="dm__rule">
              <span class="dm__rule-label">
                <template v-if="node.first">
                  <Explain
                    term="chiffré"
                    placement="bottom"
                    :body="[
                      'Le contenu de ce fil est chiffré de bout en bout : les relais ne voient ni ce qui est dit, ni qui parle à qui.',
                      'Mais si ta clé fuite un jour, tout cet historique devient lisible. Rien ici n\'est effaçable.',
                    ]"
                    >fil chiffré</Explain
                  >
                  <span class="dm__rule-sep" aria-hidden="true">·</span>
                </template>
                {{ node.label }}
              </span>
            </p>

            <div v-else class="dmsg" :class="{ 'dmsg--mine': node.fromMe }">
              <div class="dmsg__meta">
                <span v-if="!node.fromMe" class="dmsg__who">{{ profiles.displayName(node.pubkey) }}</span>
                <Hint :text="absoluteTime(node.at)">
                  <time class="dmsg__at mono">{{ clockTime(node.at) }}</time>
                </Hint>
                <Explain
                  v-if="devTools"
                  term="pow"
                  placement="bottom"
                  body="Preuve de travail de l'emballage : le calcul qu'a coûté l'envoi. C'est l'anti-spam des MP."
                >
                  <span class="dmsg__pow mono">pow {{ node.items[0].wrapPow }}</span>
                </Explain>
              </div>

              <div v-for="m in node.items" :key="m.id" class="dmsg__bubble">
                <p v-if="!richOf(m.content)" class="dmsg__text">{{ m.content }}</p>
                <div v-else class="dmsg__text dmsg__text--rich">
                  <RichText :blocks="richOf(m.content)!" />
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <form class="dm__composer" @submit.prevent="send">
        <textarea
          v-model="draft"
          class="dm__input"
          rows="1"
          :placeholder="`Écris à ${profiles.displayName(peer)}`"
          :aria-label="`message à ${profiles.displayName(peer)}`"
          @input="autoGrow"
          @keydown.enter.exact.prevent="send"
        />
        <button type="submit" class="btn btn--primary dm__send" :disabled="!draft.trim() || dms.sending">
          {{ dms.sending ? '…' : 'Envoyer' }}
        </button>
      </form>
      <p v-if="dms.lastError" class="dm__error">{{ dms.lastError }}</p>
    </template>

    <div v-else class="dm__idle">
      <p class="dm__idle-title">Choisis une conversation</p>
      <p class="dm__idle-sub">
        Rien n'est stocké sur un serveur : ces fils sont reconstitués depuis tes relais, à chaque
        ouverture.
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * Messages privés (spec §10). Deux files délibérément : la boîte, et ce qui
 * vient de clés hors web of trust. Voir `stores/dms.ts` pour la chaîne de
 * chiffrement et pour ce que le gift wrap casse.
 *
 * Le fil assume les codes du chat — bulles qui épousent leur texte, alignement
 * à droite pour soi, groupement des messages consécutifs — là où le fil d'un
 * topic reste un registre de posts numérotés. Une conversation à deux et un
 * forum public ne se lisent pas pareil.
 */
import { ref, computed, nextTick, watch } from 'vue'
import { decode } from 'nostr-tools/nip19'
import { absoluteTime, clockTime, dayKey, dayLabel } from '~/utils/format'
import { parseRichText, hasMarkup } from '~/utils/richtext'
import { npubFor } from '~/utils/nostr'
import type { DmMessage } from '~/stores/dms'

const dms = useDmStore()
const social = useSocialStore()
const profiles = useProfileStore()
const identity = useIdentityStore()
const devTools = useDevTools()
const route = useRoute()
const router = useRouter()

/**
 * La conversation ouverte vient de l'URL et non d'un `ref` local : la liste vit
 * désormais dans la colonne du layout (`DmList`), pas dans cette page. Les MP
 * rejoignent au passage ce que le forum fait déjà (§7.1, « le state du panneau
 * droit est dans l'URL ») — une conversation est partageable et survit à un
 * rechargement.
 */
const peer = computed(() => {
  const raw = Array.isArray(route.query.peer) ? route.query.peer[0] : route.query.peer
  if (!raw) return null
  const t = String(raw).trim()
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase()
  try {
    const d = decode(t)
    return d.type === 'npub' ? (d.data as string) : null
  } catch {
    return null
  }
})

function closeThread(): void {
  const { peer: _peer, ...query } = route.query
  void router.push({ path: '/dm', query })
}
const draft = ref('')
const scrollEl = ref<HTMLElement | null>(null)

const messages = computed(() => (peer.value ? dms.threadWith(peer.value)?.messages ?? [] : []))
const peerNpub = computed(() => (peer.value ? npubFor(peer.value) : ''))
const isKnown = computed(
  () => !!peer.value && ['followed', 'network', 'self'].includes(social.trustOf(peer.value)),
)

// Le nom du correspondant plutôt que « Messages privés » partout : deux
// conversations ouvertes dans deux onglets seraient sinon indiscernables.
usePageTitle(() =>
  peer.value ? `MP avec ${profiles.displayName(peer.value)}` : 'Messages privés',
)


/** Au-delà, deux messages du même auteur ne sont plus la même prise de parole. */
const GROUP_S = 300

interface DayNode {
  type: 'day'
  key: string
  label: string
  first: boolean
}
interface GroupNode {
  type: 'group'
  key: string
  fromMe: boolean
  pubkey: string
  at: number
  items: DmMessage[]
}

/**
 * Le fil en filets de jour et en prises de parole. Répéter le pseudo au-dessus
 * de chaque message donnait huit fois « marceau » sur un écran.
 */
const timeline = computed<(DayNode | GroupNode)[]>(() => {
  const out: (DayNode | GroupNode)[] = []
  let day = ''
  let group: GroupNode | null = null

  for (const m of messages.value) {
    const k = dayKey(m.createdAt)
    if (k !== day) {
      out.push({ type: 'day', key: `d-${k}`, label: dayLabel(m.createdAt), first: day === '' })
      day = k
      group = null
    }
    const last = group?.items[group.items.length - 1]
    if (group && group.fromMe === m.fromMe && last && m.createdAt - last.createdAt < GROUP_S) {
      group.items.push(m)
    } else {
      group = { type: 'group', key: m.id, fromMe: m.fromMe, pubkey: m.pubkey, at: m.createdAt, items: [m] }
      out.push(group)
    }
  }
  return out
})

/** Analyse paresseuse, comme dans le fil : la plupart des MP sont du texte nu. */
const richCache = new Map<string, ReturnType<typeof parseRichText> | null>()
function richOf(content: string): ReturnType<typeof parseRichText> | null {
  if (!richCache.has(content)) {
    // borne : la clé est le contenu entier du message, une session qui ouvre
    // beaucoup de conversations ferait grossir la Map sans fin
    if (richCache.size > 1000) richCache.clear()
    richCache.set(content, hasMarkup(content) ? parseRichText(content) : null)
  }
  return richCache.get(content) ?? null
}

function toBottom(): void {
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
}


/** Le composeur pousse sur une ligne et grandit avec le message, jusqu'à un cap. */
function autoGrow(e: Event): void {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

/**
 * Ouvrir une conversation, d'où qu'elle vienne : un clic dans la colonne, un
 * « Envoyer un MP » depuis un profil, ou un lien collé. Les trois passent par
 * `?peer=`, donc par ici.
 */
watch(
  peer,
  (pk) => {
    if (!pk) return
    dms.markRead(pk)
    profiles.want(pk)
    void nextTick(toBottom)
  },
  { immediate: true },
)

/** Un message qui arrive dans le fil ouvert doit se voir sans faire défiler. */
watch(
  () => messages.value.length,
  () => void nextTick(toBottom),
)

/** hex ou npub → hex. Null si ce n'est ni l'un ni l'autre. */


async function send(): Promise<void> {
  if (!peer.value || !draft.value.trim()) return
  const ok = await dms.send(peer.value, draft.value)
  if (ok) {
    draft.value = ''
    await nextTick(toBottom)
  }
}

async function doMute(): Promise<void> {
  if (!peer.value) return
  const ok = await social.mute(peer.value)
  if (ok) closeThread()
}

watch(
  () => identity.pubkey,
  () => {
    if (identity.pubkey) {
      void social.load()
      social.watch()
      dms.watch()
    }
  },
  { immediate: true },
)

// Pas de `dms.stop()` au démontage : la souscription gift-wrap appartient au
// LAYOUT (elle alimente la pastille MP de la barre, sur tous les écrans). La
// couper ici la tuait pour le reste de la session après un simple passage sur
// cette page — la pastille se figeait, et revenir refaisait tout le déballage.
// Le `onMounted` qui doublait le watch `immediate` ci-dessus est parti avec.
</script>

<style scoped>
/* `height: 100%` explicite : ce panneau tirait sa hauteur de la grille `.dm`,
   partie dans le layout avec la colonne. Sans elle il se réduisait à son
   contenu — « Choisis une conversation » se collait en haut dans une carte de
   110 px au lieu d'occuper le volet. Même règle que `.shell__topic`. */
.dm__thread {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--elev-2);
  overflow: hidden;
}

.dm__head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--surface);
}
.dm__who {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.dm__who-name {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm__who-name:hover {
  color: var(--link);
}
.dm__who-disc {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
}
.dm__head-act {
  margin-left: auto;
  flex-shrink: 0;
  background: none;
  border: none;
  padding: 5px 10px;
  border-radius: var(--r-pastille);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-3);
  transition: background 0.14s ease, color 0.14s ease;
}
.dm__head-act:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--ink);
}

.dm__unknown {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--warn-soft);
}
.dm__unknown-text {
  margin: 0;
  flex: 1;
  min-width: 15ch;
  font-size: var(--fs-md);
  color: var(--ink-2);
}
.dm__unknown-acts {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* Ancrage bas : une conversation courte se tient au-dessus du composeur, elle
   ne flotte pas en haut d'une page vide. */
.dm__messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  /* Même sol enfoncé que le fil du forum : ce sont les bulles qui doivent
     exister, pas le fond sur lequel elles se posent. */
  background: var(--surface-2);
}
/* Aligné en haut, pas collé au composeur : l'ancrage bas des applis de chat sert
   à tenir le fil au-dessus du clavier qui monte. Sur une colonne de bureau il
   laissait 800 px de vide au-dessus de trois messages. Un fil long est de toute
   façon défilé jusqu'en bas à l'ouverture. */
.dm__timeline {
  padding: 14px 16px 18px;
}

/* ------------------------------------------------------- le filet de jour
   L'objet signature de l'écran : il ouvre le registre chiffré, puis le découpe
   en journées. Un seul dispositif pour les deux, au lieu d'un bandeau permanent
   plus des pastilles de date. */
.dm__rule {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 16px 0 10px;
  color: var(--ink-4);
}
.dm__rule::before,
.dm__rule::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.dm__rule-label {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.dm__rule-sep {
  margin: 0 3px;
  color: var(--ink-4);
}
/* Le premier filet n'a pas 16 px de respiration à prendre : il est déjà en tête. */
.dm__timeline > .dm__rule:first-child {
  padding-top: 0;
}

/* ------------------------------------------------------------- les messages */
.dmsg {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 10px;
}
.dmsg--mine {
  align-items: flex-end;
}

.dmsg__meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 3px;
  padding: 0 2px;
  font-size: var(--fs-xs);
  color: var(--ink-4);
}
.dmsg__who {
  font-weight: 600;
  color: var(--ink-3);
}
.dmsg__at,
.dmsg__pow {
  color: var(--ink-4);
}

/* La bulle épouse son texte. En pleine largeur, « bah voilà » occupait la même
   place qu'un paragraphe et le fil ne se lisait plus comme un dialogue. */
.dmsg__bubble {
  width: fit-content;
  max-width: min(68%, 46rem);
  padding: 9px 13px;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  background: var(--surface);
  box-shadow: var(--elev-1);
}
.dmsg__bubble + .dmsg__bubble {
  margin-top: 3px;
}
/* Les siennes en bleu : « toi », comme le liseré des messages du forum et la
   rangée sélectionnée. L'orange dirait « ça chauffe », ce qui n'a aucun sens
   dans une conversation à deux. */
.dmsg--mine .dmsg__bubble {
  border-color: color-mix(in srgb, var(--link) 24%, transparent);
  background: var(--link-soft);
}

.dmsg__text {
  margin: 0;
  font-size: var(--fs-base);
  line-height: 1.5;
  color: var(--ink);
  /* Les MP contiennent des clés et des URL, qui n'ont pas d'espace où se couper. */
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.dmsg__text--rich {
  white-space: normal;
}

/* ---------------------------------------------------------------- composeur */
.dm__composer {
  display: flex;
  align-items: flex-end;
  gap: 9px;
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--line-soft);
  background: var(--surface);
}
.dm__input {
  flex: 1;
  min-width: 0;
  max-height: 160px;
  padding: 10px 13px;
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-size: var(--fs-base);
  line-height: 1.5;
  color: var(--ink);
  resize: none;
  transition: background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
}
.dm__input:focus {
  outline: none;
  background: var(--surface);
  border-color: var(--link);
  box-shadow: var(--ring);
}
.dm__send {
  flex-shrink: 0;
}

.dm__error {
  flex-shrink: 0;
  margin: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--line-soft);
  background: var(--warn-soft);
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--warn);
}

.dm__idle {
  margin: auto;
  max-width: 34ch;
  text-align: center;
}
.dm__idle-title {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: var(--fs-title);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.dm__idle-sub {
  margin: 0;
  font-size: var(--fs-md);
  line-height: 1.6;
  color: var(--ink-3);
}

/* Le retour n'existe qu'en colonne unique : au large, la liste est là. */

@media (max-width: 820px) {
  .dmsg__bubble {
    max-width: 84%;
  }
  .dm__timeline {
    padding: 12px 10px 16px;
  }
}

@media (max-width: 700px) {
  .dm__thread {
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
}
</style>
