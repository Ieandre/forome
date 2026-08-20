/**
 * Génération de l'identité au démarrage (spec v2 §3.1).
 *
 * « Pendant ce temps, en arrière-plan et sans rien lui demander, l'app génère sa
 * paire de clés. Il ne le sait même pas encore : il est déjà khey_a3f81b2c. »
 *
 * Client-only : la clé vit en localStorage, elle n'a aucun sens côté serveur.
 */
export default defineNuxtPlugin(() => {
  useIdentityStore().init()
})
