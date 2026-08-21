<template>
  <div class="mtb" role="toolbar" aria-label="mise en forme">
    <!-- Les groupes de balisage sont dans un conteneur à part parce que sur
         téléphone ils défilent horizontalement, et que `stickers` doit rester
         hors du défilement (voir le bloc `pointer: coarse`). -->
    <div class="mtb__flow">
      <div class="mtb__group">
        <Hint v-for="b in inlineButtons" :key="b.kind" :text="b.title" placement="bottom">
          <button
            type="button"
            class="mtb__btn"
            :class="[`mtb__btn--${b.kind}`, { 'mtb__btn--wide': b.wide }]"
            :aria-label="b.title"
            @click="emit('inline', b.kind)"
          >
            {{ b.label }}
          </button>
        </Hint>
      </div>

      <div class="mtb__group">
        <Hint v-for="b in blockButtons" :key="b.kind" :text="b.title" placement="bottom">
          <button type="button" class="mtb__btn" :aria-label="b.title" @click="emit('block', b.kind)">
            {{ b.label }}
          </button>
        </Hint>
        <Hint text="Lien (Ctrl+K)" placement="bottom">
          <button type="button" class="mtb__btn" aria-label="Lien" @click="emit('link')">lien</button>
        </Hint>
        <!-- L'image se dépose aussi par collage et par glisser-déposer : le bouton
             est la porte visible, pas la seule. Il s'annonce occupé pendant le
             dépôt parce que c'est la seule action de la barre qui parle au réseau. -->
        <Hint :text="uploading ? 'dépôt en cours…' : 'Image — ou colle-la directement (Ctrl+V)'" placement="bottom">
          <button
            type="button"
            class="mtb__btn mtb__btn--wide"
            aria-label="Ajouter une image"
            :disabled="uploading"
            @click="emit('image')"
          >
            {{ uploading ? 'dépôt…' : 'image' }}
          </button>
        </Hint>
      </div>
    </div>

    <!-- Groupe à lui seul, et une surface au repos là où les autres sont du texte
         nu : sur un forum de cette lignée, le tiroir de stickers est l'outil le
         plus utilisé de la barre — plus que le gras et l'italique réunis. Ni
         orange (la charte ne l'accorde jamais à un bouton) ni bleu plein (c'est
         déjà l'état « tiroir ouvert », juste en dessous). -->
    <div class="mtb__group">
      <Hint text="Stickers RisiBank" placement="bottom">
        <button
          type="button"
          class="mtb__btn mtb__btn--wide mtb__btn--sticker"
          :class="{ 'mtb__btn--on': stickerOpen }"
          aria-label="Ajouter un sticker"
          :aria-expanded="stickerOpen === true"
          @click="emit('sticker')"
        >
          stickers
        </button>
      </Hint>
    </div>

  </div>
</template>

<script setup lang="ts">
/**
 * Barre de mise en forme.
 *
 * Purement présentationnelle : elle émet, elle n'édite pas. Les commandes sont
 * exécutées par `RichEditor`, qui possède la sélection — une barre qui
 * manipulerait le DOM d'un autre composant serait un couplage inutile.
 *
 * Libellés en lettres et non en pictogrammes : « G » et « I » sont la convention
 * des forums francophones, ils se lisent sans légende et passent au lecteur
 * d'écran. Les titres portent le raccourci quand il existe.
 */
import type { MarkupKind, BlockKind } from '~/utils/serialize'

defineProps<{ uploading?: boolean; stickerOpen?: boolean }>()

const emit = defineEmits<{
  inline: [kind: MarkupKind]
  block: [kind: BlockKind]
  link: []
  image: []
  sticker: []
}>()

const inlineButtons: { kind: MarkupKind; label: string; title: string; wide?: boolean }[] = [
  { kind: 'bold', label: 'G', title: 'Gras (Ctrl+B)' },
  { kind: 'italic', label: 'I', title: 'Italique (Ctrl+I)' },
  { kind: 'underline', label: 'S', title: 'Souligné (Ctrl+U)' },
  { kind: 'strike', label: 'B', title: 'Barré' },
  { kind: 'spoiler', label: 'spoil', title: 'Spoiler — masqué jusqu’au clic', wide: true },
  { kind: 'code', label: 'code', title: 'Code en ligne', wide: true },
]

const blockButtons: { kind: BlockKind; label: string; title: string }[] = [
  { kind: 'quote', label: 'cite', title: 'Citation' },
  { kind: 'ul', label: 'liste', title: 'Liste à puces' },
  { kind: 'ol', label: '1.', title: 'Liste numérotée' },
  { kind: 'codeblock', label: 'bloc', title: 'Bloc de code' },
]
</script>

<style scoped>
/*
 * Structure seulement : la charte visuelle appartient à main.css. Les tokens
 * sont utilisés avec repli pour que ce composant reste rendable si un token
 * manque, plutôt que de devenir invisible.
 */
.mtb {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.mtb__flow {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}
/* Les groupes sont séparés par du vide, pas par un filet : une barre d'outils
   de six traits verticaux pèse plus lourd que ce qu'elle contient. */
.mtb__group {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 1px;
}
.mtb__btn {
  min-width: 26px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: var(--r-pastille, 6px);
  color: var(--ink-4, inherit);
  font-size: var(--fs-sm, 12px);
  font-weight: 600;
  line-height: 1.4;
  transition: background 0.13s ease, color 0.13s ease;
}
.mtb__btn:hover {
  background: var(--surface-3, rgba(0, 0, 0, 0.06));
  color: var(--ink, inherit);
}
/* Le seul bouton de la barre qui porte une surface au repos : il se lit comme un
   bouton, pas comme un libellé, sans avoir à crier. */
.mtb__btn--sticker {
  padding: 4px 11px;
  background: var(--surface-3, rgba(0, 0, 0, 0.06));
  border: 1px solid var(--line, currentColor);
  color: var(--ink-2, inherit);
}
.mtb__btn--sticker:hover {
  border-color: var(--line-strong, currentColor);
  color: var(--ink, inherit);
}

/* Actif : aplat bleu franc. C'est un état de l'outil (« ce que tu tapes est en
   gras »), donc bleu — l'orange dit « agis », pas « tu es dedans ». */
.mtb__btn--on {
  background: var(--link, currentColor);
  color: #fff;
}
.mtb__btn--on:hover {
  background: var(--link-hover, currentColor);
  color: #fff;
}
/* Tiroir ouvert : le filet gris du repos jurerait sur l'aplat bleu. */
.mtb__btn--sticker.mtb__btn--on {
  border-color: var(--link, currentColor);
}
.mtb__btn--wide {
  min-width: 0;
}

/* Les trois premiers boutons montrent l'effet qu'ils produisent — c'est ce qui
   rend une barre lisible sans infobulle. */
.mtb__btn--bold {
  font-weight: 800;
}
.mtb__btn--italic {
  font-style: italic;
}
.mtb__btn--underline {
  text-decoration: underline;
}
.mtb__btn--strike {
  text-decoration: line-through;
}

/* Au doigt, la barre est le premier objet qu'on touche en écrivant : 26 px de
   haut y sont un pari. On rend la boîte, pas le corps du texte — le dessin de
   la barre est le même, ses cibles font 34 px. */
@media (pointer: coarse) {
  .mtb {
    gap: 10px;
  }
  .mtb__btn {
    min-width: 30px;
    min-height: 34px;
    padding: 4px 9px;
  }
}

/* Treize boutons ne tiennent pas sur 390 px : la barre repliait sur deux
   rangées — trois au doigt, où les cibles font 34 px — soit jusqu'à 90 px pris
   au fil chaque fois qu'on écrit. Elle défile donc horizontalement.

   Seuil en LARGEUR et non en `pointer: coarse` : c'est la place disponible qui
   fait déborder la barre, et une fenêtre étroite à la souris déborde pareil.

   `stickers` reste hors du défilement — c'est le bouton le plus utilisé de la
   barre, il tomberait sinon tout au bout, invisible sans avoir poussé le
   reste. */
@media (max-width: 700px), (max-height: 560px) {
  .mtb {
    flex-wrap: nowrap;
  }
  .mtb__flow {
    flex: 1;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    /* Le dégradé du bord droit est ce qui dit qu'il y a une suite : sans lui la
       barre a l'air de s'arrêter pile où l'écran la coupe. Masque fixe et non
       piloté par le défilement (`scroll-timeline` n'est pas partout) : il ment
       de vingt pixels une fois arrivé au bout, et de rien le reste du temps. */
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
  }
  .mtb__flow::-webkit-scrollbar {
    display: none;
  }
}
</style>
