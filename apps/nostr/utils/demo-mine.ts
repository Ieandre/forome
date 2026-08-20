/**
 * Minage NIP-13 découpé sur les frames, pour les démonstrations de la page
 * « Comment ça marche ».
 *
 * Le minage réel de l'app vit dans `workers/pow.worker.ts`, et pour une raison
 * précise : un post ne doit rien geler. Ici on veut exactement l'inverse — que le
 * compteur d'essais soit **visible dans la page**, parce que c'est tout le
 * contenu de la démonstration. D'où un découpage en tranches plutôt qu'un worker,
 * et un jeton d'annulation pour ne pas laisser deux minages courir après un clic
 * sur « refabriquer ».
 *
 * ⚠️ Les tranches sont enchaînées par `setTimeout` et non par
 * `requestAnimationFrame` : un onglet qui ne compose pas (arrière-plan, fenêtre
 * masquée) ne reçoit plus de frames, et le minage resterait bloqué à zéro jusqu'au
 * retour du lecteur — vu en test. `setTimeout` est bridé en arrière-plan mais il
 * avance, donc la démonstration est terminée quand on revient.
 *
 * Le calcul, lui, est le vrai : `getEventHash` et `getPow` sont les fonctions que
 * le composeur utilise à chaque message.
 */
import { getEventHash } from 'nostr-tools/pure'
import type { UnsignedEvent } from 'nostr-tools/pure'
import { getPow } from 'nostr-tools/nip13'

export interface MineOutcome {
  event: UnsignedEvent & { id: string }
  /** nombre de hachages réellement effectués */
  tries: number
  ms: number
}

export interface MineOptions {
  /** Appelé à chaque tranche, avec le compte d'essais. */
  onTick?: (tries: number) => void
  /** false ⇒ le minage s'arrête et la promesse est rejetée. */
  alive?: () => boolean
  /** Hachages par tranche. Grand ⇒ moins de frames, compteur plus saccadé. */
  chunk?: number
}

/** Rejet levé quand `alive()` passe à false. Distinct d'une vraie erreur. */
export class MineAborted extends Error {
  constructor() {
    super('minage annulé')
    this.name = 'MineAborted'
  }
}

export function mineInFrames(
  unsigned: UnsignedEvent,
  difficulty: number,
  opts: MineOptions = {},
): Promise<MineOutcome> {
  const { onTick, alive, chunk = 2500 } = opts
  const started = performance.now()

  // Le nonce est un tag, donc il entre dans l'id : chaque essai est un hachage
  // complet de l'event, et non d'un compteur isolé. C'est ce qui rend le travail
  // impossible à précalculer pour un autre message.
  const tags = [...unsigned.tags, ['nonce', '0', String(difficulty)]]
  const nonceIndex = tags.length - 1
  let count = 0

  return new Promise<MineOutcome>((resolve, reject) => {
    const step = (): void => {
      if (alive && !alive()) {
        reject(new MineAborted())
        return
      }
      for (let i = 0; i < chunk; i++) {
        tags[nonceIndex] = ['nonce', String(++count), String(difficulty)]
        const candidate = { ...unsigned, tags }
        const id = getEventHash(candidate)
        if (getPow(id) >= difficulty) {
          onTick?.(count)
          resolve({
            event: { ...candidate, id },
            tries: count,
            ms: Math.round(performance.now() - started),
          })
          return
        }
      }
      onTick?.(count)
      setTimeout(step, 0)
    }
    step()
  })
}
