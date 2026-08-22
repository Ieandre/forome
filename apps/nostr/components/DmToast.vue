<template>
  <Transition name="dmt">
    <div v-if="shown && msg" class="dmt" role="status" aria-live="polite">
      <button type="button" class="dmt__open" @click="go">
        <UserAvatar :pubkey="msg.peer" :size="30" class="dmt__av" />
        <span class="dmt__who">{{ profiles.displayName(msg.peer) }}</span>
        <span class="dmt__text">{{ preview }}</span>
      </button>

      <button type="button" class="dmt__close" aria-label="masquer" @click="dismiss">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * L'annonce d'un MP qui arrive, montée par le LAYOUT.
 *
 * ## Pourquoi elle existe, alors que `PostItem` refuse les toasts
 *
 * Le commentaire de `.msg__flash` dit « un toast flottant sur un fil qui défile
 * se perd », et il a raison — pour ce dont il parle : la CONFIRMATION d'un
 * geste, qui a un ancrage naturel (la rangée où on vient de cliquer) et n'a donc
 * aucune raison de flotter. Ici il n'y a pas d'ancrage : le message annoncé
 * n'est pas à l'écran, et souvent l'écran entier parle d'autre chose.
 *
 * ## Le trou qu'elle bouche, et qui la justifie à elle seule
 *
 * Sous 820 px, `layouts/default.vue` masque `.app__col` dès qu'un panneau est
 * ouvert — donc la marque, la cloche, les onglets et TOUTES leurs pastilles.
 * Sur téléphone, en lisant un topic, un MP qui arrivait n'avait pas un pixel
 * pour se dire. C'est le seul canal qui survit à ça, parce qu'il est monté au
 * niveau du layout et posé en `fixed`.
 *
 * ## Trois canaux, une situation chacun
 *
 *   - onglet en arrière-plan → le compte dans le titre (`usePageTitle`) ;
 *   - écran occupé par autre chose → cette bulle ;
 *   - colonne visible → les pastilles, qui elles PERSISTENT.
 *
 * La bulle est donc délibérément transitoire et jamais la source de vérité : ce
 * qui attend est dans les pastilles, elle ne fait que le signaler au moment où
 * ça arrive. Conséquence assumée : deux correspondants qui écrivent à trois
 * secondes d'écart ne donnent qu'une bulle, la seconde remplaçant la première.
 * Rien n'est perdu — le compte, lui, sait compter.
 *
 * Ce qui a le droit d'apparaître ici est décidé par le store (`announce`) : ni
 * un inconnu, ni un bloqué ne peuvent faire surgir quoi que ce soit devant le
 * lecteur (§10.2).
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { npubFor, pubkeyFrom } from '~/utils/nostr'
import type { DmMessage } from '~/stores/dms'

/**
 * 7 s : le temps de lire un nom et six mots, et de décider. Assez court pour ne
 * pas devenir un meuble, assez long pour qu'on n'ait pas à courir après.
 */
const LIFE_MS = 7000

const dms = useDmStore()
const profiles = useProfileStore()
const route = useRoute()
const router = useRouter()

const msg = ref<DmMessage | null>(null)
const shown = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const preview = computed(() =>
  (msg.value?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'message vide',
)

/** La conversation déjà ouverte à l'écran, en hex. `?peer=` tolère npub ou hex. */
const openPeer = computed(() => {
  if (route.path !== '/dm') return null
  const raw = Array.isArray(route.query.peer) ? route.query.peer[0] : route.query.peer
  return raw ? pubkeyFrom(String(raw)) : null
})

function clear(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

function dismiss(): void {
  clear()
  shown.value = false
  dms.clearArrival()
}

/** La query est reportée : sans ça `?relays=` et `?indexer=` disparaissent. */
function go(): void {
  const pk = msg.value?.peer
  dismiss()
  if (!pk) return
  void router.push({ path: '/dm', query: { ...route.query, peer: npubFor(pk) } })
}

watch(
  () => dms.arrival,
  (a) => {
    if (!a) return
    // Le fil est déjà ouvert ET l'onglet est au premier plan : le message est
    // sous les yeux du lecteur, l'annoncer serait lui décrire ce qu'il lit.
    const looking = import.meta.client && document.visibilityState === 'visible'
    if (looking && a.peer === openPeer.value) {
      dms.clearArrival()
      return
    }
    // Onglet en arrière-plan : c'est le TITRE qui porte. Une bulle lancée ici
    // aurait expiré avant le retour du lecteur, et une bulle qui attend son
    // retour serait une bulle périmée qui parle d'un message déjà vieux.
    if (!looking) {
      dms.clearArrival()
      return
    }
    clear()
    msg.value = a
    shown.value = true
    profiles.want(a.peer)
    timer = setTimeout(dismiss, LIFE_MS)
  },
)

/** Ouvrir le fil concerné pendant que la bulle vit la rend redondante. */
watch(openPeer, (pk) => {
  if (pk && pk === msg.value?.peer) dismiss()
})

onBeforeUnmount(clear)
</script>

<style scoped>
/* ── PLACEMENT ────────────────────────────────────────────────────────────────
 * Deux ancrages, et le motif n'est pas cosmétique : c'est le composeur.
 *
 *   ≥ 821 px  en bas à GAUCHE, sur la colonne. Elle pointe vers là où vit la
 *             vérité (l'onglet MP et la cloche y sont), et elle ne couvre que le
 *             pied passif de la colonne — jamais le panneau de lecture.
 *   ≤ 820 px  en HAUT. En bas, elle se poserait sur le composeur du fil ou du
 *             topic et sur la barre d'accueil de l'iPhone : on masquerait le
 *             champ de saisie pour annoncer un message. En haut, c'est en plus
 *             d'où le téléphone fait déjà venir ses notifications.
 */
.dmt {
  position: fixed;
  z-index: 60;
  left: calc(var(--gutter) + 6px + env(safe-area-inset-left, 0px));
  bottom: calc(var(--gutter) + 6px + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: stretch;
  gap: 2px;
  width: min(340px, calc(100vw - 24px));
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-pop);
}

/* Toute la bulle est la cible, sauf la croix : viser un lien de 40 px de large
   au pouce pour ouvrir une conversation serait un piège. */
.dmt__open {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    'av who'
    'av text';
  align-items: center;
  column-gap: 10px;
  row-gap: 1px;
  flex: 1;
  min-width: 0;
  padding: 7px 4px 7px 7px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: calc(var(--r-panel) - 5px);
  transition: background 0.14s ease;
}
.dmt__open:hover {
  background: var(--surface-3);
}
.dmt__open:active {
  transform: translateY(1px);
}

.dmt__av {
  grid-area: av;
}

/* Pas de titre « Nouveau message » : la bulle n'apparaît que pour ça, et un
   libellé de catégorie prendrait la ligne dont le message a besoin. Le nom du
   correspondant EST l'annonce.

   L'orange est en revanche refusé ici. La bulle bouge, apparaît et se ferme
   toute seule : elle a déjà tout ce qu'il faut pour se faire voir, et l'orange
   est réservé à ce qui ATTEND (voir « LA THÈSE » de main.css). Ce qui attend,
   après qu'elle a disparu, c'est la pastille. */
.dmt__who {
  grid-area: who;
  min-width: 0;
  font-size: var(--fs-md);
  font-weight: 700;
  letter-spacing: -0.012em;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dmt__text {
  grid-area: text;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dmt__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  background: transparent;
  border: none;
  border-radius: calc(var(--r-panel) - 5px);
  color: var(--ink-4);
  transition: background 0.14s ease, color 0.14s ease;
}
.dmt__close svg {
  width: 15px;
  height: 15px;
}
.dmt__close:hover {
  background: var(--surface-3);
  color: var(--ink);
}

/* L'entrée vient du bord dont la bulle est ancrée : elle doit avoir l'air de
   glisser de sous l'écran, pas de tomber du milieu. Le bloc `prefers-reduced-
   motion` de main.css ramène ces durées à 0,01 ms — la bulle apparaît alors
   sans glisser, et c'est le comportement voulu. */
.dmt-enter-active,
.dmt-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.dmt-enter-from,
.dmt-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (max-width: 820px) {
  .dmt {
    left: calc(12px + env(safe-area-inset-left, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    bottom: auto;
    top: calc(8px + env(safe-area-inset-top, 0px));
    width: auto;
  }
  .dmt-enter-from,
  .dmt-leave-to {
    transform: translateY(-12px);
  }
}
</style>
