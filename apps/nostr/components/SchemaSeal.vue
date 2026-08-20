<template>
  <figure class="sl">
    <svg class="sl__svg" viewBox="0 0 620 270" role="img" aria-labelledby="sl-t">
      <title id="sl-t">
        Un message privé est emboîté trois fois : l’emballage public que voit le relais, le
        sceau que tu signes, et le texte non signé à l’intérieur.
      </title>

      <rect class="sl__box sl__box--wrap" x="6" y="24" width="352" height="232" rx="14" />
      <text class="sl__kind" x="26" y="50">kind 1059 · emballage</text>
      <text class="sl__sub" x="26" y="70">signé par une clé jetable</text>

      <rect class="sl__box sl__box--seal" x="30" y="84" width="304" height="148" rx="12" />
      <text class="sl__kind" x="50" y="110">kind 13 · sceau</text>
      <text class="sl__sub" x="50" y="130">chiffré pour lui, signé par toi</text>

      <rect class="sl__box sl__box--rumor" x="54" y="144" width="256" height="70" rx="10" />
      <text class="sl__kind" x="74" y="170">kind 14 · rumeur</text>
      <text class="sl__text" x="74" y="196">« on se voit demain »</text>

      <!-- Trois pointeurs, un par couche : chacun répond à « qui voit quoi ». -->
      <path class="sl__tie" d="M358 46 h30" />
      <text class="sl__ann sl__ann--cold" x="396" y="42">le relais ne voit</text>
      <text class="sl__ann sl__ann--cold" x="396" y="58">que l’enveloppe</text>

      <path class="sl__tie" d="M334 108 h54" />
      <text class="sl__ann" x="396" y="104">lui seul l’ouvre,</text>
      <text class="sl__ann" x="396" y="120">et sait que c’est toi</text>

      <path class="sl__tie" d="M310 172 h78" />
      <text class="sl__ann" x="396" y="168">non signée : il ne</text>
      <text class="sl__ann" x="396" y="184">peut pas la brandir</text>
      <text class="sl__ann" x="396" y="200">comme une preuve</text>
    </svg>

    <figcaption class="sl__cap">
      Chaque couche retire une information à quelqu’un. L’emballage cache aux relais qui parle à
      qui ; la rumeur non signée empêche ton destinataire de prouver au monde que tu as écrit ça.
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
/**
 * L'emboîtement est le fait à montrer : trois couches, trois retraits
 * d'information. Des boîtes concentriques disent cela sans une phrase, là où une
 * chaîne de flèches donnerait « trois étapes » — ce qui n'est pas la même idée.
 */
</script>

<style scoped>
.sl {
  margin: 0;
}
.sl__svg {
  display: block;
  width: 100%;
  height: auto;
}

.sl__box {
  stroke-width: 1;
}
/* Une surface par couche, et le trait le plus franc au centre : c'est le trait,
   et non la teinte, qui dit « voilà le message » — une rampe de teintes ne peut
   pas monter dans le même sens en clair et en sombre. */
.sl__box--wrap {
  fill: var(--surface-sunken);
  stroke: var(--line);
}
.sl__box--seal {
  fill: var(--surface-2);
  stroke: var(--line);
}
.sl__box--rumor {
  fill: var(--surface);
  stroke: var(--line-strong);
}

.sl__kind {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  fill: var(--ink-2);
}
.sl__sub {
  font-family: var(--font-ui);
  font-size: 12px;
  fill: var(--ink-3);
}
.sl__text {
  font-family: var(--font-ui);
  font-size: 15px;
  font-weight: 600;
  fill: var(--ink);
}

.sl__tie {
  fill: none;
  stroke: var(--line-strong);
  stroke-width: 1;
}
.sl__ann {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  fill: var(--ink-2);
}
.sl__ann--cold {
  font-weight: 400;
  fill: var(--ink-3);
}

.sl__cap {
  margin: 10px 2px 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-3);
}
</style>
