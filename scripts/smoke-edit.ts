/**
 * Smoke test des **corrections de message** (spec §2.5), contre un vrai relais.
 *
 * Les tests unitaires de `@forome/relay-policy` couvrent la résolution : quelle
 * version l'emporte, et pourquoi celle d'un tiers ne compte pas. Ce qu'ils ne
 * peuvent pas couvrir, et qui est **le pari du format**, c'est le trajet :
 *
 *   - une correction reprend les tags de fil de l'original, donc elle revient
 *     par la requête `#E` que le fil fait déjà. Si c'était faux, le client ne la
 *     verrait jamais et il faudrait une souscription de plus. C'est le pari, et
 *     c'est ce que la première vérification mesure.
 *   - la règle d'auteur tient sur des events venus du réseau, pas seulement sur
 *     des objets fabriqués en mémoire. C'est la seule barrière contre le message
 *     d'autrui réécrit, et le relais ne peut pas la poser à notre place.
 *   - une correction ne gonfle pas le nombre de réponses d'un fil, et corriger
 *     le message racine ne crée pas un second topic.
 *
 * ⚠️ Ce script ne vérifie PAS que `#edit` est inutilisable comme filtre. NIP-01
 * n'indexe que les tags à une lettre, donc `edit` ne l'est pas chez strfry —
 * mais le relais de dev, lui, indexe tout et répond à `#edit`. Le format ne
 * dépend d'aucun des deux comportements (la correction voyage avec le fil), et
 * l'écart est noté ici pour que personne ne construise sur le plus permissif des
 * deux en croyant l'avoir testé.
 *
 * Usage : npx tsx scripts/smoke-edit.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { WebSocket } from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { minePow } from 'nostr-tools/nip13'
import { communityTag } from '@forome/relay-policy'
import type { Event } from 'nostr-tools/core'
import { EDIT_TAG, latestRevision, isRevision } from '@forome/relay-policy/revisions'

const PORT = 7450
const URL = `ws://localhost:${PORT}`

const kheySk = generateSecretKey()
const KHEY = getPublicKey(kheySk)
const forgerSk = generateSecretKey()

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  [${detail}]` : ''}`)
}

function nowS(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Attend le changement de seconde.
 *
 * On ne peut PAS se donner une horloge à soi ici, contrairement à
 * `smoke-moderation` : `minePow` réécrit `created_at` avec l'heure courante à
 * chaque seconde qui tourne, sinon le nonce miné ne vaudrait plus pour l'id
 * final. Une date choisie est donc écrasée, et l'original et sa correction
 * atterrissent dans la même seconde — où c'est le départage par id qui décide,
 * c'est-à-dire le hasard. La première version de ce script tombait dedans.
 *
 * Attendre est fidèle au réel de toute façon : personne ne se corrige dans la
 * seconde où il publie.
 */
async function nextSecond(): Promise<void> {
  const start = nowS()
  while (nowS() === start) await new Promise((r) => setTimeout(r, 60))
}

/**
 * Post minable : la policy exige 14 bits sur les kind 11 / 1111, et la marque du
 * forum (`communityTag`) — sans elle elle refuse avant même de mesurer la PoW,
 * or ces smokes vérifient la modération et les révisions, pas le périmètre.
 */
function post(sk: Uint8Array, kind: number, content: string, extra: string[][] = []): Event {
  const tags = kind === 11 || kind === 1111 ? [...extra, communityTag()] : extra
  const pubkey = getPublicKey(sk)
  const mined = minePow({ kind, content, tags, created_at: nowS(), pubkey }, 14)
  return finalizeEvent({ kind, content, tags: mined.tags, created_at: mined.created_at }, sk)
}

/** Correction : les tags de fil de l'original, plus la cible. */
function revision(sk: Uint8Array, anchor: Event, content: string): Event {
  const threadTags = anchor.tags.filter((t) => ['E', 'K', 'P', 'e', 'k', 'p'].includes(t[0] ?? ''))
  return post(sk, 1111, content, [...threadTags, [EDIT_TAG, anchor.id]])
}

function publish(ws: WebSocket, ev: Event): Promise<{ accepted: boolean; reason: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ accepted: false, reason: 'aucune réponse' }), 4000)
    const onMessage = (raw: unknown): void => {
      const msg = JSON.parse(String(raw)) as [string, string, boolean, string]
      if (msg[0] !== 'OK' || msg[1] !== ev.id) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve({ accepted: msg[2], reason: msg[3] ?? '' })
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify(['EVENT', ev]))
  })
}

let subCount = 0
function query(ws: WebSocket, filter: Record<string, unknown>): Promise<Event[]> {
  return new Promise((resolve) => {
    const subId = `s${++subCount}`
    const found: Event[] = []
    const timer = setTimeout(() => finish(), 3000)
    const onMessage = (raw: unknown): void => {
      const msg = JSON.parse(String(raw)) as [string, string, Event]
      if (msg[1] !== subId) return
      if (msg[0] === 'EVENT') found.push(msg[2])
      else if (msg[0] === 'EOSE') finish()
    }
    function finish(): void {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.send(JSON.stringify(['CLOSE', subId]))
      resolve(found)
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify(['REQ', subId, filter]))
  })
}

async function main(relay: ChildProcess): Promise<void> {
  const ws = new WebSocket(URL)
  await new Promise((r) => ws.once('open', r))

  console.log('\nUn topic et une réponse ordinaires')
  const topic = post(kheySk, 11, 'le topic', [['title', 'corrections']])
  check((await publish(ws, topic)).accepted, 'le topic passe')

  const reply = post(kheySk, 1111, 'jai fait une faute', [
    ['E', topic.id, '', KHEY],
    ['K', '11'],
    ['P', KHEY, ''],
  ])
  check((await publish(ws, reply)).accepted, 'la réponse passe')

  console.log('\nLa correction')
  await nextSecond()
  const fix = revision(kheySk, reply, "j'ai fait une faute")
  const fixResult = await publish(ws, fix)
  check(fixResult.accepted, 'le relais accepte la correction', fixResult.reason)

  // LE test de ce script : le fil ne demande rien de plus qu'avant.
  const thread = await query(ws, { kinds: [1111], '#E': [topic.id] })
  check(
    thread.some((e) => e.id === fix.id),
    'la correction revient par la requête `#E` du fil — aucune souscription de plus',
  )

  const revisions = thread.filter(isRevision)
  check(revisions.length === 1, 'et elle se reconnaît à son tag `edit`', `${revisions.length} trouvée(s)`)
  check(
    latestRevision(reply, revisions).content === "j'ai fait une faute",
    'la version en vigueur est la corrigée',
  )
  check(
    thread.filter((e) => !isRevision(e)).length === 1,
    'le fil ne compte toujours qu’UNE réponse — une correction n’est pas un message',
  )

  console.log('\nLa correction d’un tiers')
  await nextSecond()
  const forged = revision(forgerSk, reply, 'ce quon me fait dire')
  const forgedResult = await publish(ws, forged)
  // Le relais l'accepte : il est sans état, il ne détient pas `reply` et ne peut
  // pas savoir qui en est l'auteur. C'est écrit dans `revisions.ts`, et c'est ici
  // qu'on le constate plutôt que de le supposer.
  check(forgedResult.accepted, 'le relais l’accepte — il ne peut pas juger de l’autorité')

  const withForged = (await query(ws, { kinds: [1111], '#E': [topic.id] })).filter(isRevision)
  check(
    latestRevision(reply, withForged).content === "j'ai fait une faute",
    'mais le lecteur l’écarte : seul l’auteur corrige son message',
  )

  console.log('\nLe message racine se corrige aussi, sans devenir un topic')
  const rootFix = post(kheySk, 1111, 'le topic, corrigé', [
    ['E', topic.id, '', KHEY],
    ['K', '11'],
    ['P', KHEY, ''],
    [EDIT_TAG, topic.id],
  ])
  check((await publish(ws, rootFix)).accepted, 'la correction de la racine passe')
  const roots = await query(ws, { kinds: [11] })
  check(roots.length === 1, 'et la liste des topics en compte toujours un seul', `${roots.length}`)

  console.log('\nCe que la policy refuse')
  const twoTargets = post(kheySk, 1111, 'ambigu', [
    ['E', topic.id],
    [EDIT_TAG, reply.id],
    [EDIT_TAG, topic.id],
  ])
  check(!(await publish(ws, twoTargets)).accepted, 'deux tags `edit` : refusé avant stockage')

  const badTarget = post(kheySk, 1111, 'cible illisible', [['E', topic.id], [EDIT_TAG, 'pas-un-id']])
  check(!(await publish(ws, badTarget)).accepted, 'cible qui n’est pas un id : refusé')

  ws.close()
  relay.kill()
  console.log(failures === 0 ? '\nOK' : `\n${failures} échec(s)`)
  process.exit(failures === 0 ? 0 : 1)
}

const relay = spawn('npx', ['--no-install', 'tsx', 'scripts/dev-relay.ts'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
})
relay.stdout?.on('data', () => {})

setTimeout(() => {
  void main(relay).catch((err: unknown) => {
    console.error(err)
    relay.kill()
    process.exit(1)
  })
}, 1500)
