<template>
  <figure class="sk">
    <!-- Le schéma ne rétrécit pas indéfiniment : sous ~480 px ses libellés
         tombent à 6 px et la figure ne dit plus rien. Elle garde donc sa
         largeur minimale et défile ICI, dans son propre cadre — jamais la page,
         qui doit rester lisible au pouce. La légende, elle, reste en place. -->
    <div class="sk__scroll">
      <svg class="sk__svg" viewBox="0 0 600 208" role="img" aria-labelledby="sk-t">
        <title id="sk-t">
          La clé privée donne la clé publique par un calcul instantané ; le calcul inverse est
          inconnu.
        </title>

        <!-- Le secret. Encadré plein pour dire « objet à garder », le reste est vide. -->
        <rect class="sk__box sk__box--secret" x="8" y="30" width="212" height="86" rx="12" />
        <text class="sk__kind" x="26" y="56">CE QUE TU GARDES</text>
        <text class="sk__val" x="26" y="82">nsec1…q7v4</text>
        <text class="sk__note" x="26" y="103">32 octets tirés au hasard</text>

        <!-- L'aller : un calcul, gratuit, instantané. -->
        <path class="sk__arrow" d="M232 66 h124" marker-end="url(#sk-head)" />
        <text class="sk__label" x="294" y="52">une multiplication</text>
        <text class="sk__label sk__label--dim" x="294" y="88">secp256k1</text>

        <rect class="sk__box" x="368" y="30" width="224" height="86" rx="12" />
        <text class="sk__kind" x="386" y="56">CE QUE TU MONTRES</text>
        <text class="sk__val" x="386" y="82">npub1…8fha</text>
        <text class="sk__note" x="386" y="103">ton identité, partout</text>

        <!-- Le retour : barré, parce que c'est là que tient tout le système. -->
        <path class="sk__arrow sk__arrow--dead" d="M368 158 h-136" marker-end="url(#sk-head-dead)" />
        <path class="sk__cross" d="M292 146 l16 24 M308 146 l-16 24" />
        <text class="sk__label sk__label--dead" x="300" y="196">aucun chemin connu</text>

        <defs>
          <marker id="sk-head" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="7" orient="auto">
            <path class="sk__head" d="M0 0 L10 4 L0 8 z" />
          </marker>
          <marker id="sk-head-dead" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="7" orient="auto">
            <path class="sk__head sk__head--dead" d="M0 0 L10 4 L0 8 z" />
          </marker>
        </defs>
      </svg>
    </div>

    <figcaption class="sk__cap">
      Le sens unique est tout le système : on peut vérifier que tu as signé, on ne peut pas
      remonter à ta clé.
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
/**
 * La dérivation de la clé publique. Un seul fait à faire passer — le calcul va
 * dans un sens et pas dans l'autre — donc un seul geste graphique : la flèche
 * de retour est barrée.
 */
</script>

<style scoped>
.sk {
  margin: 0;
}
.sk__scroll {
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.sk__svg {
  display: block;
  width: 100%;
  height: auto;
  /* Plancher de lisibilité : le viewBox fait 600 unités, donc en dessous de
     480 px le texte du schéma passe sous ~8 px. */
  min-width: 480px;
}

.sk__box {
  fill: var(--surface-sunken);
  stroke: var(--line);
  stroke-width: 1;
}
/* La clé privée est le seul objet de la page qui se perd : elle porte le trait
   franc, tout le reste reste sourd. */
.sk__box--secret {
  stroke: var(--line-strong);
}

.sk__kind {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  fill: var(--ink-4);
}
.sk__val {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 500;
  fill: var(--ink);
}
.sk__note {
  font-family: var(--font-ui);
  font-size: 12px;
  fill: var(--ink-3);
}

.sk__arrow {
  fill: none;
  stroke: var(--ink-4);
  stroke-width: 1.4;
}
.sk__arrow--dead {
  stroke: var(--warn);
  stroke-dasharray: 5 4;
  opacity: 0.75;
}
.sk__head {
  fill: var(--ink-4);
}
.sk__head--dead {
  fill: var(--warn);
  opacity: 0.75;
}
.sk__cross {
  fill: none;
  stroke: var(--warn);
  stroke-width: 2;
  stroke-linecap: round;
}

.sk__label {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  fill: var(--ink-2);
  text-anchor: middle;
}
.sk__label--dim {
  font-family: var(--font-mono);
  font-weight: 400;
  fill: var(--ink-4);
}
.sk__label--dead {
  fill: var(--warn);
}

.sk__cap {
  margin: 10px 2px 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-3);
}
</style>
