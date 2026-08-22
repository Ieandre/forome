/**
 * Le format sur le fil : comment les points voyagent de l'indexeur au client.
 *
 * Partagé pour la raison habituelle (§CLAUDE.md, invariant 2) : celui qui écrit
 * et celui qui lit doivent lire la même définition, sinon les points existent
 * sans que personne sache les afficher — et sur Nostr, l'event mal formé reste.
 *
 * ## Pourquoi c'est découpé en seize morceaux
 *
 * La policy borne le contenu d'un event à 32 Ko (`maxContentBytes`). Une clé
 * pèse 64 caractères, sa ligne complète une centaine d'octets : un event unique
 * plafonnerait vers 300 membres, ce qui est en dessous de la taille d'un forum
 * qui marche. D'où **seize events remplaçables**, répartis par le premier
 * caractère hexadécimal de la clé (`forome.points.0` … `forome.points.f`) :
 *
 *   - la répartition est **stable** — une clé ne change jamais de morceau, donc
 *     un morceau republié n'invalide pas les autres
 *   - le client les prend tous en **une seule souscription** (`#d` accepte
 *     plusieurs valeurs), donc ça ne coûte pas seize allers-retours
 *   - seuls les morceaux qui ont changé sont republiés
 *
 * Plafond de fait : ~5 000 membres classés. Au-delà, il faudra couper plus fin
 * (deux caractères, 256 morceaux) — le format le permet sans rien casser, mais
 * il faudra une décision de produit sur qui reste au classement.
 *
 * ## Ce que le format n'essaie pas de faire
 *
 * Pas de niveau sur le fil : il se dérive des points chez le lecteur
 * (`./index.ts`). Pas de pseudo non plus — c'est le client qui résout les
 * profils (§11.1), exactement comme pour le tick.
 */

/** NIP-78 : données applicatives adressables par un tag `d`. */
export const KIND_APP_DATA = 30078
export const POINTS_D_PREFIX = 'forome.points.'
const SHARDS = '0123456789abcdef'

/** Budget par morceau, sous les 32 Ko de la policy avec de la marge. */
const MAX_SHARD_BYTES = 28 * 1024

/** Une ligne, telle qu'elle voyage : tableau positionnel, pas objet nommé. */
export type WireRow = [pubkey: string, points: number, topics: number, replies: number, activeDays: number, lastDay: number]

export interface PointsPayload {
  v: 1
  /** Date de calcul du morceau. */
  at: number
  r: WireRow[]
}

export interface PointsEntry {
  pubkey: string
  points: number
  topics: number
  replies: number
  activeDays: number
  lastDay: number
}

/** Les seize valeurs de tag `d` — la souscription du client les prend d'un coup. */
export function pointsShardTags(): string[] {
  return [...SHARDS].map((c) => `${POINTS_D_PREFIX}${c}`)
}

/** Le morceau où vit cette clé. `null` si ce n'est pas une clé hexadécimale. */
export function shardOf(pubkey: string): string | null {
  const c = pubkey[0]
  if (!c || !SHARDS.includes(c)) return null
  return `${POINTS_D_PREFIX}${c}`
}

/**
 * Répartit des lignes par morceau, **les plus hauts scores d'abord** à
 * l'intérieur de chaque morceau.
 *
 * L'ordre n'est pas cosmétique : c'est lui qui décide qui saute quand le budget
 * d'octets est atteint. Un classement qui perd sa tête serait absurde ; il perd
 * donc sa queue, et l'appelant sait combien de lignes sont tombées.
 */
export function splitIntoShards(entries: PointsEntry[]): Map<string, PointsEntry[]> {
  const out = new Map<string, PointsEntry[]>()
  for (const e of entries) {
    const shard = shardOf(e.pubkey)
    if (!shard) continue
    const list = out.get(shard)
    if (list) list.push(e)
    else out.set(shard, [e])
  }
  for (const list of out.values()) list.sort((a, b) => b.points - a.points)
  return out
}

export interface EncodedShard {
  json: string
  kept: number
  dropped: number
}

/** Sérialise un morceau en respectant le budget d'octets. */
export function encodeShard(entries: PointsEntry[], atS: number): EncodedShard {
  const rows: WireRow[] = entries.map((e) => [e.pubkey, e.points, e.topics, e.replies, e.activeDays, e.lastDay])
  let kept = rows.length
  let json = JSON.stringify({ v: 1, at: atS, r: rows } satisfies PointsPayload)
  while (kept > 0 && byteLength(json) > MAX_SHARD_BYTES) {
    // Retrait par dichotomie plutôt qu'une ligne à la fois : sérialiser des
    // milliers de fois un tableau de milliers de lignes coûte plus que le gain.
    kept = Math.floor(kept * 0.9)
    json = JSON.stringify({ v: 1, at: atS, r: rows.slice(0, kept) } satisfies PointsPayload)
  }
  return { json, kept, dropped: rows.length - kept }
}

function byteLength(s: string): number {
  return typeof TextEncoder === 'undefined' ? s.length : new TextEncoder().encode(s).length
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * Relit un morceau. Tolérant par choix : une ligne illisible est jetée, elle
 * n'emporte pas le morceau — et un morceau illisible n'emporte pas les autres.
 * Le classement dégrade, l'écran ne tombe pas.
 */
export function decodeShard(content: string): { at: number; entries: PointsEntry[] } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const data = parsed as Partial<PointsPayload>
  if (data.v !== 1 || !Array.isArray(data.r)) return null
  const entries: PointsEntry[] = []
  for (const row of data.r) {
    if (!Array.isArray(row)) continue
    const [pubkey, points, topics, replies, activeDays, lastDay] = row
    if (typeof pubkey !== 'string' || !HEX64.test(pubkey)) continue
    if (typeof points !== 'number' || !Number.isFinite(points) || points < 0) continue
    entries.push({
      pubkey,
      points: Math.floor(points),
      topics: num(topics),
      replies: num(replies),
      activeDays: num(activeDays),
      lastDay: num(lastDay),
    })
  }
  return { at: typeof data.at === 'number' ? data.at : 0, entries }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}
