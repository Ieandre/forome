<template>
  <figure class="ss">
    <!-- Le schéma ne rétrécit pas indéfiniment : sous ~480 px ses libellés
         tombent à 6 px et la figure ne dit plus rien. Elle garde donc sa
         largeur minimale et défile ICI, dans son propre cadre — jamais la page,
         qui doit rester lisible au pouce. La légende, elle, reste en place. -->
    <div class="ss__scroll">
      <svg class="ss__svg" viewBox="0 0 620 246" role="img" aria-labelledby="ss-t">
        <title id="ss-t">
          En haut, la fabrication : le message est mis en forme, haché en un identifiant, puis
          signé. En bas, la vérification, que n’importe qui refait en sens inverse avec la clé
          publique.
        </title>

        <!-- Rangée du haut : fabrication, de gauche à droite. -->
        <text class="ss__side" x="8" y="22">TOI, UNE FOIS</text>

        <rect class="ss__box" x="8" y="34" width="150" height="62" rx="10" />
        <text class="ss__t1" x="24" y="58">ton message</text>
        <text class="ss__t2" x="24" y="78">+ qui, + quand</text>

        <path class="ss__arrow" d="M166 65 h44" marker-end="url(#ss-h)" />

        <rect class="ss__box" x="218" y="34" width="150" height="62" rx="10" />
        <text class="ss__t1" x="234" y="58">sha256</text>
        <text class="ss__t2" x="234" y="78">une seule mise en forme</text>

        <path class="ss__arrow" d="M376 65 h44" marker-end="url(#ss-h)" />

        <rect class="ss__box ss__box--out" x="428" y="34" width="184" height="62" rx="10" />
        <text class="ss__k" x="444" y="56">id</text>
        <text class="ss__hash" x="444" y="80">4c1f…a903</text>

        <!-- La signature descend de la clé privée sur l'id : elle ne touche pas au
             contenu, elle scelle l'empreinte. -->
        <path class="ss__arrow" d="M520 104 v28" marker-end="url(#ss-h)" />
        <text class="ss__label" x="536" y="123" text-anchor="start">signé avec nsec</text>

        <rect class="ss__box ss__box--out" x="428" y="140" width="184" height="62" rx="10" />
        <text class="ss__k" x="444" y="162">sig</text>
        <text class="ss__hash" x="444" y="186">7e0b…1d55</text>

        <!-- Rangée du bas : vérification, de droite à gauche. -->
        <path class="ss__arrow ss__arrow--ok" d="M428 171 h-198" marker-end="url(#ss-h-ok)" />
        <rect class="ss__box ss__box--ok" x="72" y="140" width="158" height="62" rx="10" />
        <text class="ss__t1 ss__t1--ok" x="88" y="164">vrai ou faux</text>
        <text class="ss__t2" x="88" y="184">avec le npub seul</text>

        <text class="ss__side" x="8" y="232">N’IMPORTE QUI, AUTANT DE FOIS QU’IL VEUT</text>

        <defs>
          <marker id="ss-h" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="7" orient="auto">
            <path class="ss__head" d="M0 0 L10 4 L0 8 z" />
          </marker>
          <marker id="ss-h-ok" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="7" orient="auto">
            <path class="ss__head ss__head--ok" d="M0 0 L10 4 L0 8 z" />
          </marker>
        </defs>
      </svg>
    </div>

    <figcaption class="ss__cap">
      La vérification ne demande la permission de personne : elle se fait sur la copie qu’on a
      sous la main, hors ligne, sans nous.
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
/**
 * Deux rangées et deux sens, parce que c'est le fait contre-intuitif du système :
 * fabriquer demande le secret et se fait une fois, vérifier ne demande que le
 * public et se refait indéfiniment, chez n'importe qui.
 */
</script>

<style scoped>
.ss {
  margin: 0;
}
.ss__scroll {
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.ss__svg {
  display: block;
  width: 100%;
  height: auto;
  /* Plancher de lisibilité : le viewBox fait 620 unités, donc en dessous de
     480 px le texte du schéma passe sous ~8 px. */
  min-width: 480px;
}

.ss__box {
  fill: var(--surface-sunken);
  stroke: var(--line);
  stroke-width: 1;
}
.ss__box--out {
  fill: var(--surface);
  stroke: var(--line-strong);
}
.ss__box--ok {
  fill: var(--ok-soft);
  stroke: color-mix(in srgb, var(--ok) 30%, transparent);
}

.ss__side {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  fill: var(--ink-4);
}
.ss__t1 {
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 700;
  fill: var(--ink);
}
.ss__t1--ok {
  fill: var(--ok);
}
.ss__t2 {
  font-family: var(--font-ui);
  font-size: 12px;
  fill: var(--ink-3);
}
.ss__k {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  fill: var(--ink-3);
}
.ss__hash {
  font-family: var(--font-mono);
  font-size: 16px;
  fill: var(--ink);
}
.ss__label {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  fill: var(--ink-2);
}

.ss__arrow {
  fill: none;
  stroke: var(--ink-4);
  stroke-width: 1.4;
}
.ss__arrow--ok {
  stroke: var(--ok);
}
.ss__head {
  fill: var(--ink-4);
}
.ss__head--ok {
  fill: var(--ok);
}

.ss__cap {
  margin: 10px 2px 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-3);
}
</style>
