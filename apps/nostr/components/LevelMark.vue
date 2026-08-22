<template>
  <Explain v-if="level !== null && level >= LEVEL_SHOWN_FROM" term="niveau" :body="body" :items="items">
    <span class="lvl mono">niv&nbsp;{{ level }}</span>
  </Explain>
</template>

<script setup lang="ts">
/**
 * La marque de niveau, telle qu'elle apparaît dans une bande d'auteur (§16).
 *
 * ## Pourquoi elle n'est pas une pastille
 *
 * Le style `.tag` est fait pour crier — 10 px, gras, majuscules, interlettrage
 * ouvert. Une marque de niveau posée là aurait exactement le poids visuel du
 * bouclier de modérateur, dans une bande qui peut déjà porter quatre pastilles.
 *
 * Elle est donc en mono, sans fond, dans le registre du discriminant et de
 * l'heure. Ce n'est pas seulement une question de bruit : **le niveau est un
 * fait sur l'identité, pas un statut accordé par le forum.** Sa place est le
 * groupe de provenance (pseudo, discriminant, heure, nº de post), pas le groupe
 * des pastilles, qui dit « cette personne a un rôle » ou « ce message a un état ».
 *
 * ## Ce qui ne s'affiche pas, et pourquoi
 *
 * - **Rien sous le niveau 2.** Une marque dont la seule information est « cette
 *   personne n'a encore rien fait » désigne le nouveau venu, ce qui est le
 *   contraire du but. Le niveau apparaît quand il dit quelque chose.
 * - **Rien sans indexeur épinglé** — le store rend `null`, pas 1 (§16,
 *   `stores/points.ts`). Un « niveau 1 » affiché faute de source serait un
 *   mensonge tranquille.
 * - **Aucun chiffre de points ici.** Quarante rangées affichant « 1 247 pts »
 *   feraient du fil un tableau de bord, et c'est le compteur devant le lecteur
 *   qu'on s'interdit. Le détail est dans le panneau, à la demande.
 *
 * Le mode anonyme est écarté par l'appelant : une clé par topic (§3.7) ne
 * capitalise pas, donc il n'y a rien à dire.
 */
import { LEVEL_SHOWN_FROM } from '@forome/points'

const props = defineProps<{ pubkey: string }>()

const points = useUserPointsStore()

const level = computed(() => points.levelOf(props.pubkey))
const entry = computed(() => points.entryOf(props.pubkey))
const progress = computed(() => points.progressOf(props.pubkey))

const body = computed(() => [
  'Les points viennent de ce que ses messages provoquent : les gens qui lui répondent, ceux que ses topics rassemblent. Poster rapporte peu, être lu rapporte.',
  "Ce n'est pas une durée de présence, et ce n'est pas un compte de messages. Le total est plafonné chaque jour, donc un niveau élevé demande du temps réel, pas une nuit d'activité.",
  "C'est l'indexeur du forum qui compte : ce qu'il n'a pas vu passer n'est pas compté, et aucun droit ne dépend de ce nombre.",
])

const items = computed(() => {
  const p = progress.value
  const e = entry.value
  const out = [
    `${p.points.toLocaleString('fr-FR')} points`,
    `encore ${p.toNext.toLocaleString('fr-FR')} avant le niveau ${p.level + 1}`,
  ]
  if (e) {
    out.push(
      `${e.topics} topic${e.topics > 1 ? 's' : ''} · ${e.replies} réponse${e.replies > 1 ? 's' : ''} · ` +
        `${e.activeDays} jour${e.activeDays > 1 ? 's' : ''} actif${e.activeDays > 1 ? 's' : ''}`,
    )
  }
  return out
})
</script>

<style scoped>
/* Le registre exact de `.msg__disc` : c'est le même groupe de provenance, et une
   taille propre l'en sortirait. */
.lvl {
  font-size: 10.5px;
  letter-spacing: -0.02em;
  color: var(--ink-4);
  flex-shrink: 0;
}
</style>
