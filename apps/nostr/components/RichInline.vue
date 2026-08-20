<template>
  <template v-for="(t, i) in tokens" :key="i">
    <!-- Chaque branche insère du TEXTE, jamais du HTML. C'est ce qui rend le
         rendu de contenu venu d'inconnus sûr par construction. -->
    <template v-if="t.type === 'text'">{{ t.value }}</template>

    <strong v-else-if="t.type === 'bold'"><RichInline :tokens="t.children" /></strong>
    <em v-else-if="t.type === 'italic'"><RichInline :tokens="t.children" /></em>
    <s v-else-if="t.type === 'strike'"><RichInline :tokens="t.children" /></s>
    <u v-else-if="t.type === 'underline'"><RichInline :tokens="t.children" /></u>

    <code v-else-if="t.type === 'code'" class="rt-code">{{ t.value }}</code>

    <!-- Spoiler : masqué jusqu'au clic. `aria-expanded` et le titre disent ce
         que c'est, sinon un lecteur d'écran lirait le contenu masqué sans
         prévenir — ce qui annule le spoiler pour lui seul. -->
    <button
      v-else-if="t.type === 'spoiler'"
      type="button"
      class="rt-spoiler"
      :class="{ 'rt-spoiler--open': revealed.has(i) }"
      :aria-expanded="revealed.has(i)"
      @click="toggle(i)"
    >
      <RichInline :tokens="t.children" />
    </button>

    <!-- Image. Le `src` passe par NOTRE origine (`postImageSrc`) : sans ça,
         afficher un fil ferait livrer l'IP de chaque lecteur à autant
         d'hébergeurs qu'il y a d'images (spec §8).

         Le lien, lui, pointe l'adresse d'origine : c'est celle que l'auteur a
         publiée, donc la seule qui veuille dire quelque chose une fois copiée.
         L'ouvrir est un geste délibéré — ce que le §8 refuse, c'est la fuite
         subie par le seul fait de lire. -->
    <a
      v-else-if="t.type === 'image' && !broken.has(i)"
      :href="t.href"
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      class="rt-media"
      :class="{
        'rt-media--pending': !loaded.has(i) && !dimsOf(t.href),
        'rt-media--sticker': isSticker(t.href),
        'rt-media--fixed': isSticker(t.href) && !dimsOf(t.href),
      }"
      :style="frameStyle(t.href)"
    >
      <img
        class="rt-media__img"
        :src="proxied(t.href)"
        :alt="t.alt || 'image jointe au message'"
        loading="lazy"
        decoding="async"
        @load="markLoaded(i)"
        @error="markBroken(i)"
      />
    </a>
    <!-- Repli : hôte muet, type refusé, empreinte qui ne correspond pas. On
         retombe sur l'adresse en clair plutôt que sur un cadre vide — c'est ce
         que l'auteur a écrit, et elle reste ouvrable. -->
    <a
      v-else-if="t.type === 'image'"
      :href="t.href"
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      class="rt-link"
      >{{ t.href }}</a
    >

    <!-- `noopener noreferrer` systématique : un lien vient d'un inconnu, il ne
         doit ni accéder à notre fenêtre ni révéler d'où vient le clic. -->
    <a
      v-else-if="t.type === 'link'"
      :href="t.href"
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      class="rt-link"
      >{{ t.label }}</a
    >
  </template>
</template>

<script setup lang="ts">
/**
 * Rendu du contenu en ligne.
 *
 * **Aucun `v-html`, nulle part.** Le parseur produit un arbre de données et ce
 * composant le mappe sur des éléments Vue : le HTML présent dans le texte source
 * n'est jamais interprété, il s'affiche littéralement. C'est la seule façon
 * défendable d'afficher du texte enrichi venu de relais tiers.
 *
 * Récursif par nécessité (le gras peut contenir de l'italique) ; la profondeur
 * est bornée en amont par le parseur.
 */
import { ref, inject, type ComputedRef } from 'vue'
import type { InlineToken } from '~/utils/richtext'
import { postImageSrc, type ImageMeta } from '~/utils/media'

defineProps<{ tokens: InlineToken[] }>()
defineOptions({ name: 'RichInline' })

/** Spoilers révélés, par position — l'état est local au message affiché. */
const revealed = ref(new Set<number>())
/** Images chargées / en échec, par position. Même portée : le message affiché. */
const loaded = ref(new Set<number>())
const broken = ref(new Set<number>())

function toggle(i: number): void {
  const next = new Set(revealed.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  revealed.value = next
}

/**
 * Un `Set` réactif se remplace, il ne se mute pas : Vue ne suit pas `add()`.
 * Deux fonctions plutôt qu'une paramétrée par le `Ref` — dans un template, les
 * refs sont déjà déballées, donc on ne peut pas leur passer le `Ref` lui-même.
 */
function markLoaded(i: number): void {
  loaded.value = new Set(loaded.value).add(i)
}
function markBroken(i: number): void {
  broken.value = new Set(broken.value).add(i)
}

/**
 * Métadonnées `imeta` du message affiché, fournies par `PostItem`. Absentes
 * partout ailleurs (MP, message publié par un client qui ne les pose pas) —
 * d'où l'injection facultative.
 */
const imeta = inject<ComputedRef<Record<string, ImageMeta>> | null>('postImeta', null)

const proxied = postImageSrc

function dimsOf(href: string): ImageMeta | null {
  const m = imeta?.value?.[href]
  return m?.width && m.height ? m : null
}

function isSticker(href: string): boolean {
  return Boolean(imeta?.value?.[href]?.risibank)
}

/**
 * Dimensionne l'image à son `dim` ET réserve sa place avant le chargement —
 * sans ça, une image qui arrive pousse tout ce qui la suit, et dans un fil qui
 * défile en direct, le lecteur perd la ligne qu'il était en train de lire.
 *
 * `dim` est une taille d'AFFICHAGE, pas celle du fichier : c'est ce que
 * l'auteur a donné à voir, poignée de l'éditeur comprise. Les stickers suivent
 * la même règle depuis qu'ils sont redimensionnables — leur hauteur commune
 * est appliquée à l'insertion (`useStickerPicker`), plus au rendu ; seul un
 * sticker SANS dimensions retombe sur la hauteur fixe (`--fixed`).
 */
function frameStyle(href: string): Record<string, string> | undefined {
  const m = dimsOf(href)
  if (!m) return undefined
  return {
    aspectRatio: `${m.width} / ${m.height}`,
    width: `min(100%, ${m.width}px)`,
  }
}
</script>

<style scoped>
/*
 * Les styles vivent ici et non dans `RichText` : le scoped CSS ne traverse pas
 * la frontière de composant, et c'est ce composant qui émet ces éléments.
 *
 * Comme dans `RichText`, rien que du structurel — les couleurs viennent des
 * tokens, parce que le même rendu sert les posts du forum et les MP.
 */
.rt-link {
  color: var(--link, currentColor);
  text-decoration: underline;
  text-underline-offset: 2px;
  /* Une URL Blossom fait 80 caractères sans espace : sans ça, elle élargit la
     colonne du fil au lieu d'aller à la ligne. */
  overflow-wrap: anywhere;
}
.rt-link:hover {
  color: var(--link-hover, currentColor);
}

.rt-code {
  padding: 0 3px;
  background: var(--surface-sunken, var(--surface-3, transparent));
  border: 1px solid var(--line-soft, currentColor);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
}

/* Caviardé, pas juste marqué : c'est un spoiler chez le LECTEUR, contrairement
   à `.re-spoiler` du composeur qui reste lisible pour son auteur. L'encre passe
   en transparent au lieu de disparaître — le mot garde sa largeur, donc révéler
   ne fait pas sauter la ligne. */
.rt-spoiler {
  display: inline;
  padding: 0 3px;
  border: none;
  border-radius: 4px;
  font: inherit;
  white-space: inherit;
  background: var(--ink-2, currentColor);
  color: transparent;
  transition: background 0.13s ease, color 0.13s ease;
}
.rt-spoiler--open {
  background: var(--surface-3, transparent);
  color: inherit;
  border-bottom: 1px dashed var(--ink-4, currentColor);
}

/*
 * L'image est bornée en hauteur, pas seulement en largeur : une capture de
 * téléphone en 9:16 occuperait sinon deux écrans à elle seule et ferait du fil
 * une pile d'images séparées par du texte. 360 px la laissent lisible tout en
 * gardant le message autour d'elle — le clic ouvre l'originale en taille réelle.
 */
.rt-media {
  /* `inline-block` : l'image occupe la place que l'auteur lui a donnée dans le
     texte. C'est ce qui permet à un sticker de ponctuer une phrase — l'usage
     central sur ce genre de forum. Une photo, elle, est large : `frameStyle` lui
     donne `min(100%, Npx)`, donc elle remplit la colonne et se retrouve seule sur
     sa ligne sans qu'on ait à la distinguer d'un sticker. */
  display: inline-block;
  vertical-align: bottom;
  max-width: 100%;
  max-height: 360px;
  margin: 2px;
  border-radius: var(--r-control, 9px);
  overflow: hidden;
  /* Le lien porte l'image, pas du texte : le soulignement global de `a:hover`
     n'a rien à y faire. */
  text-decoration: none !important;
}
.rt-media__img {
  display: block;
  width: 100%;
  height: 100%;
  max-height: 360px;
  object-fit: contain;
  object-position: left top;
  border: 1px solid var(--line-soft, currentColor);
  border-radius: inherit;
  background: var(--surface-sunken, transparent);
}
.rt-media:hover .rt-media__img {
  border-color: var(--line-strong, currentColor);
}

/* Un sticker n'est pas une photo : pas de cadre, pas de fond — il est découpé,
   son contour EST sa forme. Sa taille, elle, vient du `dim` comme pour une
   photo : la hauteur commune est un défaut d'insertion, pas une règle de
   rendu (voir `frameStyle`). */
.rt-media--sticker {
  border-radius: 0;
}
.rt-media--sticker .rt-media__img {
  border: none;
  background: transparent;
}

/* Repli d'un sticker sans dimensions (posé par un client qui n'écrit pas de
   `dim`) : la hauteur commune d'insertion, faute de mieux. */
.rt-media--fixed,
.rt-media--fixed .rt-media__img {
  height: 160px;
  max-height: 160px;
}
.rt-media--fixed .rt-media__img {
  width: auto;
  max-width: 100%;
}

/* Sans `imeta`, la hauteur est inconnue jusqu'au chargement : on réserve un
   bloc modeste plutôt que rien, pour amortir le décalage. Il disparaît dès que
   l'image a ses dimensions réelles. */
.rt-media--pending {
  min-height: 120px;
  /* Une largeur est nécessaire depuis que le cadre est `inline-block` : sans
     dimensions `imeta` ET sans image chargée, il n'a rien pour se dimensionner et
     la réservation serait large de zéro, donc invisible. */
  width: min(100%, 240px);
  background: var(--surface-sunken, transparent);
}
</style>
