/**
 * Smoke test de la **boucle de modération complète**, contre un vrai relais.
 *
 * Les tests unitaires couvrent la dérivation de l'état (`deriveState`) et la
 * policy (`evaluate`) séparément. Ce que ce script vérifie, et qui est la
 * promesse centrale du document de conception : **le panneau publie, le relais
 * applique**. Autrement dit, qu'un modérateur nommé par le roster et une clé
 * bannie par ce modérateur produisent un refus d'écriture réel, sans qu'aucun
 * canal privé n'existe entre les deux — le relais l'apprend des events signés
 * qu'il reçoit, comme n'importe quel autre client.
 *
 * Un bouton « bannir » qui masque sans bloquer serait un mensonge d'interface ;
 * c'est ici qu'on vérifie qu'il n'en est pas un.
 *
 * Usage : npx tsx scripts/smoke-moderation.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { WebSocket } from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { minePow } from 'nostr-tools/nip13'
import { communityTag } from '@forome/relay-policy'
import type { Event } from 'nostr-tools/core'
import { STAFF_D_TAG, MODERATION_D_TAG, KIND_APP_DATA } from '@forome/relay-policy/moderation'

const PORT = 7449
const URL = `ws://localhost:${PORT}`

const rootSk = generateSecretKey()
const ROOT = getPublicKey(rootSk)
const modSk = generateSecretKey()
const MOD = getPublicKey(modSk)
const spammerSk = generateSecretKey()
const SPAMMER = getPublicKey(spammerSk)
const kheySk = generateSecretKey()

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  [${detail}]` : ''}`)
}

function nowS(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Horloge strictement croissante pour les events adressables.
 *
 * Un kind 30078 est remplacé sur `created_at` : deux versions publiées dans la
 * même seconde et le relais garde la première, tout en répondant `OK`. Ce script
 * enchaîne roster et décisions bien plus vite qu'une seconde — sans ça, il
 * testerait un état qui n'a jamais changé. C'est le bug que le client avait, et
 * que ce script a révélé.
 */
let clock = nowS()
function stamp(): number {
  return ++clock
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

function appData(sk: Uint8Array, dTag: string, payload: unknown): Event {
  return finalizeEvent(
    {
      kind: KIND_APP_DATA,
      created_at: stamp(),
      tags: [['d', dTag]],
      content: JSON.stringify(payload),
    },
    sk,
  )
}

/** Publie et rend le verdict du relais (`OK` de NIP-01). */
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

/** Demande un event par son id. Vide = le relais ne le sert plus. */
function fetchById(ws: WebSocket, id: string): Promise<Event[]> {
  return new Promise((resolve) => {
    const subId = `s${Math.floor(nowS())}${id.slice(0, 4)}`
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
    ws.send(JSON.stringify(['REQ', subId, { ids: [id] }]))
  })
}

async function main(relay: ChildProcess): Promise<void> {
  const ws = new WebSocket(URL)
  await new Promise((r) => ws.once('open', r))

  console.log('\nAvant toute modération')
  const topic = post(kheySk, 11, 'un topic ordinaire', [['title', 'topic']])
  check((await publish(ws, topic)).accepted, 'un topic passe')
  const spam = post(spammerSk, 1111, 'premier message du spammeur', [['E', topic.id]])
  check((await publish(ws, spam)).accepted, 'le futur banni passe, lui aussi')

  console.log('\nLe roster, signé par la clé racine')
  const roster = await publish(
    ws,
    appData(rootSk, STAFF_D_TAG, {
      v: 1,
      at: clock,
      staff: [{ pubkey: MOD, role: 'moderator', since: clock }],
    }),
  )
  check(roster.accepted, 'le relais accepte le roster')

  // Une clé hors roster qui publierait des décisions ne doit rien produire :
  // c'est toute la valeur de la chaîne de confiance.
  const usurper = await publish(
    ws,
    appData(spammerSk, MODERATION_D_TAG, {
      v: 1,
      at: clock,
      actions: [{ type: 'ban', target: getPublicKey(kheySk), reason: 'usurpation', at: clock }],
    }),
  )
  check(usurper.accepted, 'une liste d’actions hors roster est stockée (rien ne l’interdit)')
  const stillFine = post(kheySk, 1111, 'je publie toujours', [['E', topic.id]])
  check(
    (await publish(ws, stillFine)).accepted,
    '…mais elle n’a AUCUN effet : la clé visée écrit encore',
  )

  console.log('\nLe modérateur banni le spammeur, et verrouille le topic')
  const decision = await publish(
    ws,
    appData(modSk, MODERATION_D_TAG, {
      v: 1,
      at: clock,
      actions: [
        { type: 'ban', target: SPAMMER, reason: 'raid', at: clock },
        { type: 'lock', target: topic.id, reason: 'raid en cours', at: clock },
      ],
    }),
  )
  check(decision.accepted, 'la décision est publiée')

  const afterBan = await publish(ws, post(spammerSk, 1111, 'je continue', [['E', topic.id]]))
  check(!afterBan.accepted, 'la clé bannie est refusée à l’écriture', afterBan.reason)

  const afterLock = await publish(ws, post(kheySk, 1111, 'et moi ?', [['E', topic.id]]))
  check(!afterLock.accepted, 'le topic verrouillé refuse les réponses', afterLock.reason)

  const elsewhere = post(kheySk, 11, 'ailleurs', [['title', 'autre topic']])
  check((await publish(ws, elsewhere)).accepted, 'les autres topics ne sont pas verrouillés')

  console.log('\nLe passé reste : bannir agit sur la suite, pas sur ce qui est stocké')
  check((await fetchById(ws, spam.id)).length === 1, 'le message déjà publié du banni est toujours servi')

  console.log('\nClassement en illégal, par un admin — le relais cesse de servir')
  await publish(
    ws,
    appData(rootSk, STAFF_D_TAG, {
      v: 1,
      at: clock,
      staff: [{ pubkey: MOD, role: 'admin', since: clock }],
    }),
  )
  await publish(
    ws,
    appData(modSk, MODERATION_D_TAG, {
      v: 1,
      at: clock,
      actions: [{ type: 'hide', target: spam.id, reason: 'illégal', at: clock, class: 'illegal' }],
    }),
  )
  check((await fetchById(ws, spam.id)).length === 0, 'l’event classé illégal n’est plus servi')

  console.log('\nRévocation : les décisions du modérateur tombent avec lui')
  await publish(ws, appData(rootSk, STAFF_D_TAG, { v: 1, at: clock, staff: [] }))
  const afterRevoke = await publish(ws, post(spammerSk, 1111, 'de retour', [['E', elsewhere.id]]))
  check(afterRevoke.accepted, 'la clé bannie par le modérateur révoqué réécrit', afterRevoke.reason)
  check((await fetchById(ws, spam.id)).length === 1, 'et l’event purgé est de nouveau servi')

  ws.close()
  relay.kill()
  console.log(failures === 0 ? '\nOK' : `\n${failures} échec(s)`)
  process.exit(failures === 0 ? 0 : 1)
}

const relay = spawn('npx', ['--no-install', 'tsx', 'scripts/dev-relay.ts'], {
  env: { ...process.env, PORT: String(PORT), ADMIN_PUBKEY: ROOT },
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
