<template>
  <figure class="sr">
    <!-- Le schéma ne rétrécit pas indéfiniment : sous ~480 px ses libellés
         tombent à 6 px et la figure ne dit plus rien. Elle garde donc sa
         largeur minimale et défile ICI, dans son propre cadre — jamais la page,
         qui doit rester lisible au pouce. La légende, elle, reste en place. -->
    <div class="sr__scroll">
      <svg class="sr__svg" viewBox="0 0 620 252" role="img" aria-labelledby="sr-t">
        <title id="sr-t">
          Ton message est envoyé à plusieurs relais indépendants, qui le servent à qui le demande.
          Un relais injoignable ne reçoit rien et ne montre rien.
        </title>

        <rect class="sr__box sr__box--you" x="6" y="98" width="104" height="56" rx="10" />
        <text class="sr__t1" x="24" y="122">toi</text>
        <text class="sr__t2" x="24" y="140">un message</text>

        <!-- Cinq envois, pas un : c'est le geste que le diagramme doit rendre
             évident, donc cinq traits distincts et non un faisceau. -->
        <path class="sr__wire" d="M116 126 C160 126 168 30 214 30" />
        <path class="sr__wire" d="M116 126 C160 126 168 78 214 78" />
        <path class="sr__wire" d="M116 126 C160 126 168 126 214 126" />
        <path class="sr__wire sr__wire--dead" d="M116 126 C160 126 168 174 214 174" />
        <path class="sr__wire" d="M116 126 C160 126 168 222 214 222" />

        <g class="sr__relay">
          <rect class="sr__box" x="214" y="10" width="150" height="40" rx="10" />
          <text class="sr__mono" x="230" y="35">relais A</text>
          <rect class="sr__box" x="214" y="58" width="150" height="40" rx="10" />
          <text class="sr__mono" x="230" y="83">relais B</text>
          <rect class="sr__box" x="214" y="106" width="150" height="40" rx="10" />
          <text class="sr__mono" x="230" y="131">relais C</text>
          <rect class="sr__box sr__box--dead" x="214" y="154" width="150" height="40" rx="10" />
          <text class="sr__mono sr__mono--dead" x="230" y="179">relais D</text>
          <text class="sr__dead" x="352" y="179">injoignable</text>
          <rect class="sr__box" x="214" y="202" width="150" height="40" rx="10" />
          <text class="sr__mono" x="230" y="227">relais E</text>
        </g>

        <path class="sr__wire" d="M364 30 C420 30 424 96 470 96" />
        <path class="sr__wire" d="M364 78 C420 78 424 96 470 96" />
        <path class="sr__wire" d="M364 126 C420 126 424 158 470 158" />
        <path class="sr__wire" d="M364 222 C420 222 424 158 470 158" />

        <rect class="sr__box" x="470" y="68" width="144" height="56" rx="10" />
        <text class="sr__t1" x="488" y="92">quelqu’un</text>
        <text class="sr__t2" x="488" y="110">2 copies reçues</text>

        <rect class="sr__box" x="470" y="130" width="144" height="56" rx="10" />
        <text class="sr__t1" x="488" y="154">quelqu’un</text>
        <text class="sr__t2" x="488" y="172">2 copies reçues</text>

        <text class="sr__foot" x="470" y="212">même id ⇒</text>
        <text class="sr__foot sr__foot--strong" x="470" y="230">un seul message affiché</text>
      </svg>
    </div>

    <figcaption class="sr__cap">
      Personne n’a la liste complète. Ce que tu vois dépend des relais que ton navigateur
      interroge — et ce que tu écris n’existe que sur ceux qui l’ont accepté.
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
/**
 * La topologie, sans chiffres réels : ceux-ci sont affichés à côté par la page,
 * lus dans le store des relais. Un diagramme qui prétendrait à l'état courant
 * mentirait dès qu'un relais tombe.
 */
</script>

<style scoped>
.sr {
  margin: 0;
}
.sr__scroll {
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.sr__svg {
  display: block;
  width: 100%;
  height: auto;
  /* Plancher de lisibilité : le viewBox fait 620 unités, donc en dessous de
     480 px le texte du schéma passe sous ~8 px. */
  min-width: 480px;
}

.sr__box {
  fill: var(--surface-sunken);
  stroke: var(--line);
  stroke-width: 1;
}
.sr__box--you {
  fill: var(--link-soft);
  stroke: color-mix(in srgb, var(--link) 30%, transparent);
}
.sr__box--dead {
  fill: none;
  stroke: var(--line);
  stroke-dasharray: 5 4;
}

.sr__wire {
  fill: none;
  stroke: var(--line-strong);
  stroke-width: 1.3;
}
.sr__wire--dead {
  stroke: var(--warn);
  stroke-dasharray: 4 5;
  opacity: 0.7;
}

.sr__t1 {
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 700;
  fill: var(--ink);
}
.sr__t2 {
  font-family: var(--font-ui);
  font-size: 11px;
  fill: var(--ink-3);
}
.sr__mono {
  font-family: var(--font-mono);
  font-size: 13px;
  fill: var(--ink-2);
}
.sr__mono--dead {
  fill: var(--ink-4);
}
.sr__dead {
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
  fill: var(--warn);
}
.sr__foot {
  font-family: var(--font-ui);
  font-size: 12px;
  fill: var(--ink-3);
}
.sr__foot--strong {
  font-weight: 700;
  fill: var(--ink-2);
}

.sr__cap {
  margin: 10px 2px 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-3);
}
</style>
