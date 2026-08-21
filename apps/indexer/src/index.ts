/**
 * L'indexeur (spec §5.2, §5.4).
 *
 * ## Pourquoi il existe
 *
 * Nostr ne sait pas diffuser « un instantané calculé une fois, identique pour
 * tout le monde ». Chaque client a sa propre souscription, donc sans indexeur
 * chaque client doit souscrire large et classer ce qu'il a vu passer — vue
 * partielle, coût par client, et tri par vélocité impossible à faire
 * correctement (c'est exactement le piège décrit en §5.4).
 *
 * Réponse retenue : l'indexeur **publie le tick comme un event Nostr**
 * remplaçable et signé. Les clients souscrivent à un seul event et reçoivent
 * tous les mêmes octets. Le tri reste calculé une fois pour tous, et il devient
 * *vérifiable* : le tick est signé, donc attribuable.
 *
 * ## Ce que ça concède, et qu'il faut dire
 *
 * Cette clé a un **pouvoir d'affichage** : elle décide de l'ordre de la liste,
 * qui est l'écran principal. Elle ne peut ni retenir ni falsifier un message —
 * les events restent sur les relais, vérifiables sans elle — mais elle peut
 * mettre en avant ce qu'elle veut. C'est la « zone blanche » notée en §15.2, et
 * la réponse structurelle est que l'index est **remplaçable** : plusieurs
 * indexeurs concurrents peuvent publier le leur, et le client choisit.
 */
import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode, npubEncode, decode } from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/core'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import WebSocket from 'ws'
import { isRevision } from '@forome/relay-policy/revisions'
import { communityFilter } from '@forome/relay-policy'
import { HotList } from './hotlist.js'
import { RaidDetector } from './raid.js'

useWebSocketImplementation(WebSocket)

const KIND_CONTACTS = 3
const KIND_THREAD = 11
const KIND_COMMENT = 1111
/** NIP-78 : données applicatives, adressables par un tag `d`. */
const KIND_APP_DATA = 30078
const TICK_D_TAG = 'forome.tick'

const RELAYS = (process.env.RELAYS ?? 'wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 2000)
const PUBLISH = process.env.PUBLISH !== '0'
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT ?? 400)

/* ------------------------------------------------------------------ identité */

function loadSecretKey(): Uint8Array {
  const fromEnv = process.env.INDEXER_NSEC
  if (fromEnv) {
    try {
      const decoded = decode(fromEnv)
      if (decoded.type === 'nsec') return decoded.data
    } catch {
      console.error("INDEXER_NSEC illisible — génération d'une clé éphémère à la place")
    }
  }
  const sk = generateSecretKey()
  console.log('⚠ Aucune INDEXER_NSEC fournie : clé éphémère générée pour cette session.')
  console.log('  Les clients qui épinglent la clé de l\'indexeur ne verront pas ce tick.')
  console.log(`  Pour la conserver : INDEXER_NSEC=${nsecEncode(sk)}\n`)
  return sk
}

const sk = loadSecretKey()
const pk = getPublicKey(sk)

/* --------------------------------------------------------------------- état */

const hot = new HotList()
const raid = new RaidDetector()
const pool = new SimplePool()

/** Réponses vues avant leur racine — rejouées quand la racine arrive. */
const orphans = new Map<string, { eventId: string; pubkey: string; createdAt: number; text: string }[]>()
let lastTickJson = ''
let ticksPublished = 0
let eventsSeen = 0

function nowS(): number {
  return Math.floor(Date.now() / 1000)
}

function tagValue(ev: Event, name: string): string | null {
  for (const t of ev.tags) if (t[0] === name && t[1]) return t[1]
  return null
}

/** Racine du fil : `E` (NIP-22), sinon `e` marqué root, sinon premier `e`. */
function rootIdOf(ev: Event): string | null {
  if (ev.kind === KIND_THREAD) return ev.id
  const upper = tagValue(ev, 'E')
  if (upper) return upper
  for (const t of ev.tags) if (t[0] === 'e' && t[3] === 'root' && t[1]) return t[1]
  for (const t of ev.tags) if (t[0] === 'e' && t[1]) return t[1]
  return null
}

function topicTitle(ev: Event): string {
  const t = tagValue(ev, 'title') ?? tagValue(ev, 'subject')
  if (t) return t.trim().slice(0, 180)
  const first = ev.content.trim().split('\n')[0] ?? ''
  return (first.length > 90 ? `${first.slice(0, 90)}…` : first) || '(sans titre)'
}

/* ---------------------------------------------------------------- ingestion */

/**
 * Date déclarée, plafonnée à maintenant (§2.4). C'est elle qui décide l'ordre du
 * tick : sans plafond, un event daté dans le futur tiendrait la tête de la liste
 * de tous les clients pour toujours. La policy borne déjà l'écriture sur nos
 * relais, mais l'indexeur lit aussi ailleurs.
 */
function stampOf(ev: Event): number {
  return Math.min(ev.created_at, Math.floor(Date.now() / 1000))
}

function onThread(ev: Event): void {
  eventsSeen++
  hot.addTopic({
    id: ev.id,
    title: topicTitle(ev),
    createdAt: stampOf(ev),
    pubkey: ev.pubkey,
    text: ev.content,
  })
  // rejouer les réponses arrivées avant leur racine
  const waiting = orphans.get(ev.id)
  if (waiting) {
    orphans.delete(ev.id)
    for (const r of waiting) {
      hot.onReply({ topicId: ev.id, ...r })
      raid.onEvent({ topicId: ev.id, pubkey: r.pubkey, at: r.createdAt })
    }
  }
}

function onComment(ev: Event): void {
  eventsSeen++
  // Une révision n'est pas une réponse (§2.5). Elle est ignorée du tick tout
  // entier : sinon corriger une faute ferait remonter le topic en tête de la
  // liste **de tous les clients**, gonflerait son compteur de réponses, et
  // alimenterait la détection de raid avec des events qui ne sont pas du trafic.
  //
  // ⚠️ La règle est importée du code partagé, pas redérivée ici : si l'indexeur
  // et le client n'étaient pas d'accord sur ce qu'est une révision, les
  // compteurs seraient faux sans que rien ne casse visiblement.
  if (isRevision(ev)) return
  const rootId = rootIdOf(ev)
  if (!rootId) return
  const payload = { eventId: ev.id, pubkey: ev.pubkey, createdAt: stampOf(ev), text: ev.content }

  if (!hot.has(rootId)) {
    // Les topics les plus actifs sont souvent plus anciens que la fenêtre de
    // souscription : on garde la réponse de côté plutôt que de la perdre.
    const list = orphans.get(rootId) ?? []
    if (list.length < 200) list.push(payload)
    orphans.set(rootId, list)
    if (orphans.size > 5000) orphans.clear()
    return
  }

  if (!hot.onReply({ topicId: rootId, ...payload })) return
  const signal = raid.onEvent({ topicId: rootId, pubkey: ev.pubkey, at: payload.createdAt })
  if (signal) {
    console.warn(
      `⚠ raid probable sur ${signal.topicId.slice(0, 12)} — score ${signal.score} ` +
        `(débit ${signal.details.ratePerMin}/min, accél. ${signal.details.acceleration}, ` +
        `clés récentes ${Math.round(signal.details.recentKeyShare * 100)}%, ` +
        `arrivées corrélées ${signal.details.correlatedArrivals})`,
    )
  }
}

/**
 * Ingère une liste de contacts (spec §12.3). Sert **uniquement** à la
 * détection de raid : une clé suivie par quelqu'un cesse d'être traitée comme
 * fraîche. L'indexeur ne construit pas de score de réputation et n'utilise pas
 * ce graphe pour classer — le tri reste la vélocité, point.
 */
function onContacts(ev: Event): void {
  eventsSeen++
  const pubkeys: string[] = []
  for (const t of ev.tags) {
    if (t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/.test(t[1])) pubkeys.push(t[1])
  }
  if (pubkeys.length > 0) raid.noteFollowGraph(pubkeys)
}

/** Va chercher les racines manquantes des réponses orphelines. */
async function resolveOrphans(): Promise<void> {
  const ids = [...orphans.keys()].filter((id) => !hot.has(id)).slice(0, 100)
  if (ids.length === 0) return
  try {
    const found = await pool.querySync(RELAYS, { ids, kinds: [KIND_THREAD] }, { maxWait: 5000 })
    for (const ev of found) onThread(ev)
  } catch {
    // sans racine, l'activité n'est pas classable : on réessaiera au tour suivant
  }
  for (const id of ids) if (!hot.has(id)) orphans.delete(id)
}

/* --------------------------------------------------------------------- tick */

async function publishTick(): Promise<void> {
  const snapshot = hot.snapshot(nowS())
  const flagged = raid.flaggedTopics()
  const payload = JSON.stringify({ ...snapshot, flagged })

  // Ne republier que si le classement a changé : un tick identique republié
  // toutes les 2 s ne ferait que gaspiller la bande passante de tout le monde.
  const comparable = JSON.stringify({ topics: snapshot.topics, flagged })
  if (comparable === lastTickJson) return
  lastTickJson = comparable

  if (!PUBLISH) {
    console.log(`[tick sec] ${snapshot.topics.length} topics — publication désactivée (PUBLISH=0)`)
    return
  }

  const ev = finalizeEvent(
    {
      kind: KIND_APP_DATA,
      created_at: nowS(),
      tags: [
        ['d', TICK_D_TAG],
        ['alt', 'classement des topics par vélocité — tick Forome'],
      ],
      content: payload,
    },
    sk,
  )

  const results = await Promise.allSettled(pool.publish(RELAYS, ev, { maxWait: 6000 }))
  const ok = results.filter((r) => r.status === 'fulfilled').length
  ticksPublished++
  if (ticksPublished % 10 === 1 || ok === 0) {
    console.log(
      `tick #${ticksPublished} · ${snapshot.topics.length} topics · ${hot.size} suivis · ` +
        `${eventsSeen} events vus · ${raid.followGraphSize} clés dans le graphe · ` +
        `accepté par ${ok}/${RELAYS.length} relais` +
        (flagged.length > 0 ? ` · ${flagged.length} signalé(s)` : ''),
    )
    if (ok === 0) {
      const reason = results.find((r) => r.status === 'rejected')
      console.warn(`  ✗ aucun relais n'a accepté le tick : ${String((reason as PromiseRejectedResult)?.reason)}`)
    }
  }
}

/* --------------------------------------------------------------------- boot */

async function main(): Promise<void> {
  console.log('indexeur Forome')
  console.log(`  clé : ${npubEncode(pk)}`)
  console.log(`  (hex : ${pk})`)
  console.log(`  relais : ${RELAYS.join(', ')}`)
  console.log(`  tick : kind ${KIND_APP_DATA}, d="${TICK_D_TAG}", toutes les ${TICK_INTERVAL_MS} ms`)
  console.log(`  publication : ${PUBLISH ? 'active' : 'désactivée (PUBLISH=0)'}\n`)

  // Même périmètre que le client, et ce n'est pas cosmétique : l'indexeur classe
  // ce qu'il voit, donc un indexeur qui voit tout Nostr publierait un tick où les
  // topics du forum se font sortir du classement par des fils étrangers.
  pool.subscribe(
    RELAYS,
    { kinds: [KIND_THREAD], ...communityFilter(), limit: HISTORY_LIMIT },
    { onevent: onThread, label: 'threads' },
  )
  pool.subscribe(
    RELAYS,
    { kinds: [KIND_COMMENT], ...communityFilter(), limit: HISTORY_LIMIT },
    { onevent: onComment, label: 'comments' },
  )
  // Graphe de follows : alimente la détection de raid (§12.3), rien d'autre.
  pool.subscribe(
    RELAYS,
    { kinds: [KIND_CONTACTS], limit: HISTORY_LIMIT },
    { onevent: onContacts, label: 'contacts' },
  )

  setInterval(() => void publishTick(), TICK_INTERVAL_MS)
  setInterval(() => void resolveOrphans(), 5000)

  const shutdown = (): void => {
    console.log('\narrêt.')
    pool.destroy()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main()
