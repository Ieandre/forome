/**
 * Publication des points (spec §16).
 *
 * ## Ce que ce fichier ajoute à l'indexeur, et que l'indexeur n'avait pas
 *
 * Un **état persistant**. Jusqu'ici l'indexeur était intégralement en mémoire :
 * il redémarrait vide, se remplissait en quelques secondes, et personne ne
 * pouvait s'en apercevoir — un classement par vélocité ne parle que du présent.
 * Un score, lui, est cumulatif : le perdre, c'est le remettre à zéro pour tout
 * le monde.
 *
 * D'où un fichier sur le disque, et trois précautions qui vont avec :
 *
 *   1. **écriture atomique** (fichier temporaire puis `rename`) — une coupure
 *      pendant l'écriture laisserait sinon un JSON tronqué, donc un forum
 *      remis à zéro par un `kill -9`
 *   2. **il vit hors du dépôt** (`POINTS_STATE`, `~/forome-data` en
 *      production) : un `git reset --hard` de déploiement ne doit pas
 *      l'emporter
 *   3. **un état illisible ne bloque pas le démarrage** : les points repartent
 *      de zéro, le tick continue. Le tick est l'écran principal ; il n'a pas à
 *      tomber avec une fonctionnalité de confort.
 *
 * Ce fichier reste un **cache**, pas une source : tout est dérivable des events
 * que les relais détiennent. La reconstruction n'est pas automatisée ici parce
 * qu'elle ne redonnerait pas le même résultat — le pli n'est pas commutatif
 * (voir `@forome/points/ledger`), donc rejouer suppose de rejouer dans l'ordre.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { finalizeEvent } from 'nostr-tools/pure'
import type { SimplePool } from 'nostr-tools/pool'
import { PointsLedger } from '@forome/points/ledger'
import type { LedgerJson } from '@forome/points/ledger'
import { KIND_APP_DATA, encodeShard, splitIntoShards } from '@forome/points/payload'

interface StateFile {
  v: 1
  /** `created_at` du dernier event compté — borne du rattrapage au démarrage. */
  lastAt: number
  ledger: LedgerJson
}

export class PointsStore {
  readonly ledger: PointsLedger
  /** Dernier JSON publié par morceau : republier l'identique ne sert personne. */
  private readonly published = new Map<string, string>()
  private lastAt = 0
  private dirty = false

  private constructor(ledger: PointsLedger, lastAt: number) {
    this.ledger = ledger
    this.lastAt = lastAt
  }

  /** Relit l'état, ou repart de zéro en le disant. */
  static load(path: string): PointsStore {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<StateFile>
      const led = PointsLedger.fromJSON(raw.ledger)
      const lastAt = typeof raw.lastAt === 'number' ? raw.lastAt : 0
      console.log(`points : ${led.size} clés relues depuis ${path}`)
      return new PointsStore(led, lastAt)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'ENOENT') {
        console.warn(`⚠ points : état illisible (${String(err)}) — on repart de zéro.`)
      }
      return new PointsStore(new PointsLedger(), 0)
    }
  }

  /** Borne du rattrapage : on ne redemande pas ce qui a déjà été compté. */
  get resumeFrom(): number {
    return this.lastAt
  }

  /** À appeler après chaque event compté, pour avancer la borne. */
  noteProcessed(createdAt: number): void {
    if (createdAt > this.lastAt) this.lastAt = createdAt
    this.dirty = true
  }

  save(path: string): void {
    if (!this.dirty) return
    const payload: StateFile = { v: 1, lastAt: this.lastAt, ledger: this.ledger.toJSON() }
    try {
      mkdirSync(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      writeFileSync(tmp, JSON.stringify(payload), 'utf8')
      renameSync(tmp, path)
      this.dirty = false
    } catch (err) {
      // Ne pas tomber : l'indexeur sert d'abord le tick, et un disque plein ne
      // doit pas éteindre l'écran principal.
      console.warn(`⚠ points : échec d'écriture de ${path} — ${String(err)}`)
    }
  }

  /**
   * Publie les morceaux qui ont changé. Rend ce qui a été fait, pour le journal.
   *
   * Seize events remplaçables (voir `@forome/points/payload`), et **seuls ceux
   * dont le contenu bouge** partent : à cadence lente et sur un forum calme, la
   * plupart des tours ne publient rien.
   */
  async publish(
    pool: SimplePool,
    relays: string[],
    sk: Uint8Array,
    nowS: number,
  ): Promise<{ shards: number; keys: number; dropped: number; refused: number }> {
    const shards = splitIntoShards(this.ledger.rows())
    let published = 0
    let keys = 0
    let dropped = 0
    let refused = 0

    for (const [d, entries] of shards) {
      const { json, kept, dropped: lost } = encodeShard(entries, nowS)
      keys += kept
      dropped += lost
      // La date change à chaque tour : comparer sur les lignes seules, sinon
      // les seize morceaux seraient republiés en boucle sans rien de nouveau.
      const comparable = JSON.stringify(entries.slice(0, kept))
      if (this.published.get(d) === comparable) continue
      this.published.set(d, comparable)

      const ev = finalizeEvent(
        {
          kind: KIND_APP_DATA,
          created_at: nowS,
          tags: [
            ['d', d],
            ['alt', 'points des membres — Forome'],
          ],
          content: json,
        },
        sk,
      )
      const results = await Promise.allSettled(pool.publish(relays, ev, { maxWait: 6000 }))
      if (results.some((r) => r.status === 'fulfilled')) published++
      else {
        refused++
        // Oublier ce qu'on croyait publié : sinon le morceau refusé ne serait
        // jamais retenté, et ces clés resteraient invisibles jusqu'au prochain
        // changement de leur score.
        this.published.delete(d)
      }
    }
    return { shards: published, keys, dropped, refused }
  }
}
