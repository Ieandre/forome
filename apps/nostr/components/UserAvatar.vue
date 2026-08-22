<template>
  <!-- Un masque n'a ni photo ni identicon : voir le script. -->
  <span v-if="masked" class="avatar avatar--mask" :class="{ 'avatar--round': round }" :style="box">
    <Glyph name="anon" />
    <span v-if="alt" class="visually-hidden">{{ alt }}</span>
  </span>
  <img
    v-else-if="src && !failed"
    class="avatar"
    :class="{ 'avatar--round': round }"
    :src="src"
    :width="size"
    :height="size"
    :alt="alt ?? ''"
    loading="lazy"
    decoding="async"
    @error="failed = true"
  />
  <IdenticonAvatar v-else :pubkey="pubkey" :size="size" :round="round" :alt="alt" />
</template>

<script setup lang="ts">
/**
 * L'avatar de quelqu'un : sa photo si elle est affichable, son identicon sinon,
 * et un masque si la voix est anonyme (§3.7).
 *
 * Un seul endroit porte cette règle, pour que le fil, la liste et les profils ne
 * puissent pas en avoir trois versions. La photo remplace l'identicon (et ne se
 * pose plus à côté) : sur un forum, la photo de profil est ce à quoi les gens
 * tiennent, et deux vignettes par message alourdissaient une liste dense.
 *
 * L'identicon reste le repli, donc une clé sans photo garde une image unique
 * dérivée d'elle — et il reste visible à côté de la clé publique sur la page de
 * profil, là où il sert à repérer une usurpation (§3.5).
 *
 * ## Le masque passe avant tout le reste
 *
 * Une clé jetable n'a **rien d'unique à montrer**, et c'est le propos : un
 * identicon dérivé d'elle lui donnerait le même genre de visage propre qu'à un
 * compte, dans un écran où l'on apprend justement à reconnaître les gens à leur
 * vignette. Le losange est le même pour tous les anonymes ; ce qui les distingue
 * est le suffixe du nom, stable dans un fil et seulement là.
 *
 * C'est aussi pour ça que le test est ici et non chez l'appelant : la liste des
 * topics, l'en-tête d'un fil, une notification et une rangée de message
 * affichent tous une vignette à partir d'une clé nue, et un seul de ces écrans
 * qui oublierait la règle donnerait un visage à quelqu'un qui a demandé à ne pas
 * en avoir.
 *
 * `@error` compte : une photo peut disparaître de son hôte après coup, et sans ce
 * repli la rangée afficherait un cadre vide au lieu d'une identité.
 */
import { ref, computed, watch } from 'vue'
import { avatarSrc } from '~/utils/media'

/**
 * Première image d'un avatar animé, par URL.
 *
 * Portée module : une vignette gelée sert la liste, le fil, les notifications et
 * la page de profil. Sans ce cache, la même image serait décodée une fois par
 * rangée — et ce fichier existe précisément pour ne pas faire chauffer un
 * téléphone (§16.9).
 */
const premiereImage = new Map<string, string>()

/** `prefers-reduced-motion`, une fois pour toute l'app. */
const mouvementReduit = ref(false)
let mrStarted = false

const props = withDefaults(
  defineProps<{
    pubkey: string
    size?: number
    round?: boolean
    alt?: string
    /**
     * Force le masque, pour la voix qu'on s'apprête à prendre — le composeur
     * l'annonce avant le premier envoi, donc avant que le moindre event ne
     * l'ait fait connaître au store.
     */
    mask?: boolean
  }>(),
  { size: 32, round: true },
)

const profiles = useProfileStore()
const apparence = useApparence()
const failed = ref(false)

if (import.meta.client && !mrStarted) {
  mrStarted = true
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mouvementReduit.value = mq.matches
  mq.addEventListener('change', (e) => (mouvementReduit.value = e.matches))
}

const masked = computed(() => props.mask || profiles.isAnonKey(props.pubkey))
const brut = computed(() => avatarSrc(profiles.get(props.pubkey)?.picture))

/**
 * Faut-il figer cette vignette ?
 *
 * Deux cas, et le second n'est pas négociable :
 *   - l'animation est **revendiquée sans être gagnée** (le kind 0 est signé par
 *     la personne, donc rien n'empêche de la déclarer — §16.9) ;
 *   - le lecteur a demandé à son système de **réduire les animations**. Pour
 *     certaines personnes une image qui clignote est un déclencheur, pas une
 *     décoration, et aucun palier ne passe devant ça.
 */
const aFiger = computed(() => {
  const revendique = profiles.get(props.pubkey)?.style.avatarAnim ?? false
  if (!revendique) return false
  return mouvementReduit.value || !apparence.styleOf(props.pubkey).avatarAnim
})

const gelee = ref<string | null>(null)

/**
 * Peint la première image sur un canevas.
 *
 * `createImageBitmap` d'un GIF ne rend que sa première image — c'est la même
 * propriété qui interdit de recadrer un GIF sans le tuer (`utils/image.ts`), et
 * ici elle sert. Aucun décodage côté serveur, aucune bibliothèque.
 *
 * L'échec est silencieux et sans conséquence : on retombe sur l'image animée,
 * c'est-à-dire sur ce que le navigateur aurait affiché de toute façon.
 */
async function figer(url: string): Promise<void> {
  const connu = premiereImage.get(url)
  if (connu) {
    gelee.value = connu
    return
  }
  try {
    const blob = await fetch(url).then((r) => r.blob())
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const data = canvas.toDataURL('image/webp', 0.9)
    if (premiereImage.size > 300) premiereImage.clear()
    premiereImage.set(url, data)
    gelee.value = data
  } catch {
    // tant pis : l'image animée reste, et elle est lisible
  }
}

watch(
  [brut, aFiger],
  ([url, fige]) => {
    gelee.value = null
    if (url && fige && import.meta.client) void figer(url)
  },
  { immediate: true },
)

const src = computed(() => (aFiger.value ? (gelee.value ?? brut.value) : brut.value))
const box = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))

// Un kind 0 est remplaçable : si la photo change, l'échec précédent ne vaut plus.
watch(brut, () => (failed.value = false))
</script>

<style scoped>
/* Mêmes bord et rayon que l'identicon, pour que les deux soient interchangeables
   dans une rangée. Pas de `image-rendering: pixelated` ici : c'est fait pour l'art
   pixel de l'identicon, une photo en ressortirait crénelée.
   `object-fit: cover` est un garde-fou — le recadrage à l'envoi rend l'image
   carrée, mais une photo déposée depuis un autre client ne l'est pas forcément, et
   sans ça elle s'étirerait. */
.avatar {
  display: block;
  flex-shrink: 0;
  aspect-ratio: 1;
  object-fit: cover;
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px rgba(13, 22, 44, 0.08);
}
.avatar--round {
  border-radius: var(--r-control);
}

/* ------------------------------------------------------------------- cadre
 * Le cadre gagné (spec §16.9). C'est le seul axe d'apparence visible dans le fil
 * qu'une photo de profil n'efface pas — d'où sa place au milieu de l'échelle des
 * paliers, et d'où sa place ICI : la vignette est le seul objet qui connaisse sa
 * propre géométrie.
 *
 * Le remplissage est **inset** (`box-sizing: border-box`) : l'empreinte reste
 * exactement celle d'une vignette nue, donc le rythme d'une liste dense ne bouge
 * pas selon que ses rangées portent un cadre ou non. Un anneau posé à l'extérieur
 * (`box-shadow`) aurait décalé chaque rangée qui en porte un — et se serait fait
 * rogner par le premier parent en `overflow: hidden`.
 *
 * Le fond est peint sous le rembourrage (`background-clip: border-box`, le
 * défaut) et le contenu remplacé de l'image ne couvre que la boîte de contenu :
 * l'anneau apparaît, sans élément supplémentaire ni pseudo-élément — dont un
 * `<img>` n'a pas.
 *
 * Les sélecteurs sont volontairement à une seule classe, et posés APRÈS
 * `.avatar` : la vignette d'un identicon porte `.identicon` et non `.avatar`, et
 * un sélecteur composé n'aurait attrapé que la moitié des cas.
 */
.cadre--couleur,
.cadre--degrade {
  box-sizing: border-box;
  padding: 2px;
}
.cadre--couleur {
  background-image: none;
  background-color: var(--cadre-actif);
}
.cadre--degrade {
  background-color: transparent;
  background-image: linear-gradient(135deg, var(--grad-actif));
}
/* Tireté, comme le composeur en mode anonyme : le même trait aux deux moments,
   écrire et relire. Gris, là où le pseudo d'un compte est bleu et l'auteur d'un
   topic orange — une clé jetable n'a rien accumulé et ne mène nulle part, et la
   teinte est ce qui le dit sans un mot.
   Le glyphe est dimensionné en fraction de la boîte : cette vignette est
   demandée de 18 px (composeur) à 88 px (profil). */
.avatar--mask {
  display: grid;
  place-items: center;
  border: 1px dashed color-mix(in srgb, var(--ink-4) 55%, transparent);
  background: var(--surface-2);
  color: var(--ink-4);
  box-shadow: none;
}
.avatar--mask :deep(.glyph) {
  width: 48%;
  height: 48%;
  margin-top: 0;
}
</style>
