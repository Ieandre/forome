#!/usr/bin/env -S npx tsx
/**
 * Point d'entrée du plugin de policy strfry. C'est ce fichier que
 * `strfry.conf` pointe (via `run-strfry.sh`, qui fixe le cwd).
 *
 * `FOROME_MODERATION_STATE` désigne le fichier d'état de modération produit par
 * le panneau (`docs/moderation-staff.md` §6) :
 *
 *     { "blocked": ["<clé hex>", …], "locked": ["<id de topic>", …] }
 *
 * Il est **relu à chaud**, sans redémarrer le relais : le process du plugin vit
 * aussi longtemps que strfry, et un bannissement qui n'entrerait en vigueur
 * qu'au prochain redémarrage arriverait après le raid.
 */
import { readFileSync, watchFile } from 'node:fs'
import { runStrfryPlugin } from '../src/strfry-plugin.js'
import { DEFAULT_POLICY, type PolicyConfig } from '../src/index.js'

const statePath = process.env.FOROME_MODERATION_STATE

/**
 * Les deux ensembles sont mutés en place et non remplacés : `evaluate()` les lit
 * à chaque event à travers la config, donc muter suffit — réassigner exigerait
 * de reconstruire la config et de la repasser au plugin.
 */
const blocked = new Set<string>()
const locked = new Set<string>()

function reload(path: string): void {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { blocked?: unknown; locked?: unknown }
    const next = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)) : []
    blocked.clear()
    for (const k of next(raw.blocked)) blocked.add(k)
    locked.clear()
    for (const id of next(raw.locked)) locked.add(id)
    process.stderr.write(`relay-policy: état rechargé — ${blocked.size} clés bannies, ${locked.size} topics verrouillés\n`)
  } catch (err) {
    // On garde l'état précédent : un fichier tronqué pendant une écriture ne
    // doit pas déverrouiller le relais le temps d'un `cat`.
    process.stderr.write(`relay-policy: état illisible, état précédent conservé — ${String(err)}\n`)
  }
}

const config: PolicyConfig = { ...DEFAULT_POLICY, blocked, locked }

if (statePath) {
  reload(statePath)
  watchFile(statePath, { interval: 5000 }, () => reload(statePath))
}

runStrfryPlugin(config)
