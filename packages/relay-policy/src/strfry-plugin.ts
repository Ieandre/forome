/**
 * Plugin de policy d'écriture pour strfry (spec v2 §12.2, §13).
 *
 * Protocole strfry : une requête JSON par ligne sur stdin, une réponse JSON par
 * ligne sur stdout. Le process reste vivant entre les events — d'où le suivi de
 * débit en mémoire, qui n'aurait aucun sens dans un process par event.
 *
 * Installation côté strfry.conf :
 *
 *     relay {
 *         writePolicy {
 *             plugin = "/chemin/vers/forome/packages/relay-policy/run-strfry.sh"
 *         }
 *     }
 *
 * **Vérifié contre un vrai strfry** depuis le 2026-08-15 (`npm run smoke:strfry`,
 * voir `docs/strfry.md`). Ce que ça a rapporté et qu'aucun test unitaire ne
 * pouvait donner : `run-strfry.sh` n'avait pas le bit exécutable, donc strfry
 * n'arrivait pas à lancer le plugin — et **refusait tout** en « internal error ».
 * Le sens du défaut est le bon (une policy tombée ne doit pas ouvrir la porte),
 * mais le symptôme ne ressemble en rien à sa cause : penser au bit `+x` avant de
 * chercher le bug dans ce fichier.
 */
import { createInterface } from 'node:readline'
import { evaluate, RateTracker, DEFAULT_POLICY, type PolicyConfig } from './index.js'
import type { Event } from 'nostr-tools/core'

interface StrfryRequest {
  type: string
  event: Event
  receivedAt?: number
  sourceType?: string
  sourceInfo?: string
}

interface StrfryResponse {
  id: string
  action: 'accept' | 'reject' | 'shadowReject'
  msg?: string
}

export function runStrfryPlugin(config: PolicyConfig = DEFAULT_POLICY): void {
  const rate = new RateTracker(config.ratePerKey, config.rateWindowS)
  const rl = createInterface({ input: process.stdin, terminal: false })

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    let req: StrfryRequest
    try {
      req = JSON.parse(trimmed) as StrfryRequest
    } catch {
      // Pas d'id à qui répondre : on ne peut que se taire. Écrire sur stdout un
      // objet sans id ferait planter strfry.
      process.stderr.write('relay-policy: ligne JSON invalide ignorée\n')
      return
    }

    // strfry n'envoie que `type: "new"` aujourd'hui ; tout autre type est
    // accepté par défaut plutôt que rejeté — refuser un type qu'on ne comprend
    // pas casserait le relais à la prochaine version de strfry.
    if (req.type !== 'new' || !req.event?.id) {
      if (req.event?.id) respond({ id: req.event.id, action: 'accept' })
      return
    }

    const verdict = evaluate(req.event, { config, rate })
    respond(
      verdict.accept
        ? { id: req.event.id, action: 'accept' }
        : { id: req.event.id, action: 'reject', msg: verdict.reason },
    )
  })

  function respond(res: StrfryResponse): void {
    process.stdout.write(`${JSON.stringify(res)}\n`)
  }
}
