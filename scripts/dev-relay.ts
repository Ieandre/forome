/**
 * Relais NIP-01 minimal, **pour le développement seulement**.
 *
 * Pourquoi il existe : sur Nostr, écrire est **irréversible** — un event publié
 * sur un relais public n'en sort plus (spec §2.5). Tester la publication contre
 * `relay.damus.io`
 * reviendrait donc à polluer définitivement un bien commun avec des events de
 * test. Ce relais-là est en mémoire, local, et disparaît avec le process.
 *
 * Ce n'est PAS strfry : pas de persistance, pas de policy d'écriture, pas de
 * negentropy, pas de NIP-42. Juste assez de NIP-01 pour vérifier la boucle
 * publier → stocker → souscrire → afficher.
 *
 * Il applique quand même deux règles, parce que ce sont celles qu'un
 * développement doit pouvoir observer :
 *   - vérification de signature (un event invalide est refusé)
 *   - PoW minimale optionnelle via MIN_POW, pour voir un refus légitime
 *
 * Usage : npx tsx scripts/dev-relay.ts    (PORT=7447, MIN_POW=0)
 */
import { WebSocketServer, type WebSocket } from 'ws'
import { matchFilter } from 'nostr-tools/filter'
import { getPow } from 'nostr-tools/nip13'
import type { Event } from 'nostr-tools/core'
import type { Filter } from 'nostr-tools/filter'
import {
  evaluate,
  isEphemeralKind,
  RateTracker,
  DEFAULT_POLICY,
  type PolicyConfig,
} from '@forome/relay-policy'
import {
  deriveState,
  blockedKeys,
  lockedThreads,
  purgedEvents,
  normalizePubkey,
  KIND_APP_DATA,
  STAFF_D_TAG,
  MODERATION_D_TAG,
} from '@forome/relay-policy/moderation'

const PORT = Number(process.env.PORT ?? 7447)
const MIN_POW = process.env.MIN_POW === undefined ? undefined : Number(process.env.MIN_POW)
const MAX_EVENTS = 20_000
/**
 * Clé racine du forum : sans elle, ce relais ne modère personne.
 *
 * Accepte la `npub…` autant que l'hexadécimal — c'est la npub que l'interface
 * donne à copier, et exiger une forme que l'app ne montre nulle part ne produit
 * qu'un silence inexplicable.
 */
const ADMIN_PUBKEY = normalizePubkey(process.env.ADMIN_PUBKEY) ?? ''
if (process.env.ADMIN_PUBKEY && !ADMIN_PUBKEY) {
  console.error(
    `ADMIN_PUBKEY non reconnue : « ${process.env.ADMIN_PUBKEY} » — attendu une npub… ou 64 caractères hexadécimaux.\nLe relais démarre SANS modération.`,
  )
}

/**
 * **La même policy que celle du plugin strfry** (`@forome/relay-policy`), pas une
 * réimplémentation : ce qui est testé unitairement est exactement ce qui tourne
 * ici. `MIN_POW` surcharge la difficulté pour tous les kinds, ce qui permet
 * d'observer un refus légitime sans toucher au reste.
 */
/**
 * État de modération, **muté en place**.
 *
 * `evaluate()` lit ces ensembles à travers la config à chaque event : les muter
 * suffit à faire entrer un bannissement en vigueur immédiatement, alors que les
 * remplacer exigerait de reconstruire la config.
 */
const blocked = new Set<string>()
const locked = new Set<string>()
/** Events que le relais cesse de servir (doc modération §5.2) — pas effacés, plus distribués. */
const purged = new Set<string>()

const POLICY: PolicyConfig = {
  ...DEFAULT_POLICY,
  ...(MIN_POW === undefined ? {} : { minPow: { default: MIN_POW } }),
  blocked,
  locked,
}

const rate = new RateTracker(POLICY.ratePerKey, POLICY.rateWindowS)

/** Stockage en mémoire, ordre d'insertion. */
const events: Event[] = []
const byId = new Set<string>()

/** abonnements par socket : subId → filtre */
const subs = new Map<WebSocket, Map<string, Filter>>()

function isReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)
}

/** NIP-01 : « adressable » — remplaçable par (pubkey, kind, tag `d`). */
function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000
}

function dTag(ev: Event): string {
  for (const t of ev.tags) if (t[0] === 'd') return t[1] ?? ''
  return ''
}

function store(ev: Event): void {
  // Le tick de l'indexeur est un kind 30078 : sans ce traitement, les ticks
  // s'accumulaient (8 exemplaires observés en test) au lieu de se remplacer.
  // Un vrai relais n'en garde qu'un — le dev relais doit se comporter pareil,
  // sinon il masque des bugs de client au lieu de les révéler.
  if (isReplaceable(ev.kind) || isAddressable(ev.kind)) {
    const d = isAddressable(ev.kind) ? dTag(ev) : null
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!
      if (e.kind !== ev.kind || e.pubkey !== ev.pubkey) continue
      if (d !== null && dTag(e) !== d) continue
      if (e.created_at >= ev.created_at) return
      events.splice(i, 1)
      byId.delete(e.id)
    }
  }
  events.push(ev)
  byId.add(ev.id)
  if (events.length > MAX_EVENTS) {
    const dropped = events.splice(0, events.length - MAX_EVENTS)
    for (const d of dropped) byId.delete(d.id)
  }
}

/**
 * Recalcule l'état de modération **à partir de ce que le relais stocke déjà**.
 *
 * C'est tout le point de la conception (doc modération §6) : pas de base
 * parallèle, pas d'API d'administration, pas de canal privé. Le relais reçoit
 * des events signés, il connaît la clé racine par configuration, il en déduit
 * qui modère et ce qu'il refuse. Le panneau publie, le relais applique, et
 * n'importe qui peut vérifier que les deux disent la même chose.
 */
function refreshModeration(): void {
  if (!ADMIN_PUBKEY) return
  const state = deriveState(events, ADMIN_PUBKEY)
  const before = `${blocked.size}/${locked.size}/${purged.size}`

  blocked.clear()
  for (const k of blockedKeys(state)) blocked.add(k)
  locked.clear()
  for (const id of lockedThreads(state)) locked.add(id)
  purged.clear()
  for (const id of purgedEvents(state)) purged.add(id)

  const after = `${blocked.size}/${locked.size}/${purged.size}`
  if (before !== after) {
    console.log(
      `  ⚖ modération — ${state.staff.size} au roster · ${blocked.size} clés bannies · ${locked.size} topics verrouillés · ${purged.size} events non servis`,
    )
  }
}

/** true si cet event porte une pièce de la chaîne de modération. */
function touchesModeration(ev: Event): boolean {
  if (ev.kind !== KIND_APP_DATA) return false
  const d = dTag(ev)
  return d === STAFF_D_TAG || d === MODERATION_D_TAG
}

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function fanout(ev: Event): void {
  if (purged.has(ev.id)) return
  for (const [ws, filters] of subs) {
    for (const [subId, filter] of filters) {
      if (matchFilter(filter, ev)) send(ws, ['EVENT', subId, ev])
    }
  }
}

function handleEvent(ws: WebSocket, ev: Event): void {
  if (byId.has(ev.id)) {
    send(ws, ['OK', ev.id, true, 'duplicate:'])
    return
  }
  const verdict = evaluate(ev, { config: POLICY, rate })
  if (!verdict.accept) {
    send(ws, ['OK', ev.id, false, verdict.reason])
    console.log(`  ✗ kind ${ev.kind} de ${ev.pubkey.slice(0, 8)} refusé — ${verdict.reason}`)
    return
  }
  // NIP-01 : les kinds éphémères (20000–29999) se diffusent sans être stockés.
  // Ça compte ici : le trafic du signeur distant NIP-46 passe par le kind 24133,
  // et le stocker remplirait la base de RPC périmés.
  const ephemeral = isEphemeralKind(ev.kind)
  if (!ephemeral) store(ev)
  send(ws, ['OK', ev.id, true, ''])
  // Avant la diffusion : un event qui vient de bannir quelqu'un doit valoir pour
  // le message suivant, pas pour celui d'après.
  if (!ephemeral && touchesModeration(ev)) refreshModeration()
  fanout(ev)

  if (ephemeral) return // trop bavard pour être journalisé ligne par ligne
  const pow = getPow(ev.id)
  console.log(
    `  ← kind ${String(ev.kind).padStart(4)} de ${ev.pubkey.slice(0, 8)} · pow ${String(pow).padStart(2)} bits · ${
      ev.content.replace(/\s+/g, ' ').slice(0, 60)
    }`,
  )
}

function handleReq(ws: WebSocket, subId: string, filters: Filter[]): void {
  // Ce relais ne gère qu'un filtre par REQ — c'est tout ce que le client envoie.
  const filter = filters[0] ?? {}
  let map = subs.get(ws)
  if (!map) {
    map = new Map()
    subs.set(ws, map)
  }
  map.set(subId, filter)

  const limit = filter.limit ?? 500
  // Les events purgés ne sont plus servis. C'est la seule chose qui ressemble à
  // une suppression et qui soit vraie ici : on ne retire rien du réseau, on
  // cesse de le distribuer.
  const matched = events.filter((e) => !purged.has(e.id) && matchFilter(filter, e))
  // NIP-01 : les events historiques partent du plus récent
  matched.sort((a, b) => b.created_at - a.created_at)
  for (const ev of matched.slice(0, limit)) send(ws, ['EVENT', subId, ev])
  send(ws, ['EOSE', subId])
}

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws) => {
  subs.set(ws, new Map())

  ws.on('message', (raw) => {
    let msg: unknown
    try {
      msg = JSON.parse(String(raw))
    } catch {
      send(ws, ['NOTICE', 'json invalide'])
      return
    }
    if (!Array.isArray(msg) || typeof msg[0] !== 'string') {
      send(ws, ['NOTICE', 'message mal formé'])
      return
    }
    const [type, ...rest] = msg as [string, ...unknown[]]
    if (type === 'EVENT') handleEvent(ws, rest[0] as Event)
    else if (type === 'REQ') handleReq(ws, String(rest[0]), rest.slice(1) as Filter[])
    else if (type === 'CLOSE') subs.get(ws)?.delete(String(rest[0]))
    else send(ws, ['NOTICE', `type non supporté : ${type}`])
  })

  ws.on('close', () => subs.delete(ws))
  ws.on('error', () => subs.delete(ws))
})

console.log(`relais de dev sur ws://localhost:${PORT}`)
console.log(`  policy : @forome/relay-policy (la même que le plugin strfry)`)
console.log(`  kinds acceptés : ${POLICY.allowedKinds.join(', ')}`)
console.log(
  `  PoW minimale : ${
    MIN_POW === undefined
      ? `par kind (topics et posts : ${DEFAULT_POLICY.minPow[11]} bits)`
      : `${MIN_POW} bits pour tous les kinds (surcharge MIN_POW)`
  }`,
)
console.log(`  débit : ${POLICY.ratePerKey} events / ${POLICY.rateWindowS}s par clé`)
console.log(
  `  modération : ${
    ADMIN_PUBKEY
      ? `roster de ${ADMIN_PUBKEY.slice(0, 8)}… , appliqué depuis les events reçus`
      : 'aucune (fixer ADMIN_PUBKEY pour l’activer)'
  }`,
)
console.log(`  stockage : mémoire, perdu à l'arrêt\n`)
