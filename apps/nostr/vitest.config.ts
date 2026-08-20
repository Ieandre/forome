import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Vitest tourne hors de Nuxt, donc sans son résolveur : l'alias `~` doit être
 * redonné à la main. Sans lui, tout module testé qui importe un autre module de
 * l'app échoue au chargement — ce qui condamnait de fait les helpers à n'avoir
 * aucune dépendance interne pour rester testables.
 */
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
