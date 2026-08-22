/**
 * Smoke test des **attributions de points**, contre un vrai relais (spec §16.8).
 *
 * Les tests unitaires couvrent la dérivation (`deriveState`) sur des events
 * fabriqués en mémoire. Ce que ce script vérifie, et qu'aucun test unitaire ne
 * peut prouver : **l'annulation passe par un remplacement réel.** Annuler une
 * attribution, c'est republier sa liste sans la ligne — donc ça repose
 * entièrement sur le fait que le relais remplace bien l'event adressable au lieu
 * de garder les deux versions.
 *
 * C'est exactement le piège que le smoke de modération a débusqué : deux versions
 * publiées dans la même seconde, le relais garde la première **et répond `OK`**.
 * Une attribution qu'on croirait annulée continuerait à compter, en silence, sur
 * le profil de quelqu'un.
 *
 * Usage : npx tsx scripts/smoke-points.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { WebSocket } from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Event } from 'nostr-tools/core'
import {
  GRANTS_D_TAG,
  KIND_APP_DATA,
  STAFF_D_TAG,
  deriveState,
  grantedPoints,
} from '@forome/relay-policy/moderation'
import { levelOf } from '@forome/points'

const PORT = 7451
const URL = `ws://localhost:${PORT}`

const rootSk = generateSecretKey()
const ROOT = getPublicKey(rootSk)
const modSk = generateSecretKey()
const MOD = getPublicKey(modSk)
const strangerSk = generateSecretKey()
const KHEY = getPublicKey(generateSecretKey())
/** Alias lisible : la même clé, vue comme « la personne visée ». */
const TARGET = KHEY

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  [${detail}]` : ''}`)
}

function nowS(): number {
  return Math.floor(Date.now() / 1000)
}

/** Horloge strictement croissante : un kind 30078 se remplace sur `created_at`. */
let clock = nowS()
function stamp(): number {
  return ++clock
}

function appData(sk: Uint8Array, dTag: string, payload: unknown): Event {
  return finalizeEvent(
    { kind: KIND_APP_DATA, created_at: stamp(), tags: [['d', dTag]], content: JSON.stringify(payload) },
    sk,
  )
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

/**
 * Relit ce que le relais SERT, et dérive l'état comme le client le ferait.
 *
 * C'est le cœur du script : on ne vérifie pas ce qu'on a envoyé, on vérifie ce
 * qu'un lecteur obtiendrait — listes remplacées comprises.
 */
function readState(ws: WebSocket): Promise<ReturnType<typeof deriveState>> {
  return new Promise((resolve) => {
    const subId = `p${clock}`
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
      resolve(deriveState(found, ROOT))
    }
    ws.on('message', onMessage)
    ws.send(
      JSON.stringify([
        'REQ',
        subId,
        { kinds: [KIND_APP_DATA], '#d': [STAFF_D_TAG, GRANTS_D_TAG] },
      ]),
    )
  })
}

function grantList(sk: Uint8Array, grants: { target: string; amount: number; reason: string }[]): Event {
  return appData(sk, GRANTS_D_TAG, {
    v: 1,
    at: clock,
    grants: grants.map((g) => ({ ...g, at: clock })),
  })
}

async function main(relay: ChildProcess): Promise<void> {
  const ws = new WebSocket(URL)
  await new Promise((r) => ws.once('open', r))

  console.log('\nLe roster, signé par la clé racine')
  check(
    (
      await publish(
        ws,
        appData(rootSk, STAFF_D_TAG, {
          v: 1,
          at: clock,
          staff: [{ pubkey: MOD, role: 'moderator', since: clock }],
        }),
      )
    ).accepted,
    'le relais accepte le roster',
  )

  console.log('\nUne liste hors roster ne donne rien')
  check(
    (await publish(ws, grantList(strangerSk, [{ target: KHEY, amount: 9999, reason: 'copinage' }])))
      .accepted,
    'le relais la stocke (rien ne l’interdit)',
  )
  check(grantedPoints(await readState(ws), KHEY) === 0, '…mais elle n’a AUCUN effet')

  console.log('\nLe modérateur récompense')
  check(
    (await publish(ws, grantList(modSk, [{ target: KHEY, amount: 500, reason: 'meilleur topic' }])))
      .accepted,
    'l’attribution est publiée',
  )
  let state = await readState(ws)
  check(grantedPoints(state, KHEY) === 500, '500 points attribués')
  check(state.grants.get(KHEY)?.[0]?.reason === 'meilleur topic', 'le motif voyage avec')
  check(state.grants.get(KHEY)?.[0]?.by === MOD, 'et la clé qui a donné, aussi')
  check(levelOf(500) === 6, 'ce que ça vaut : niveau 6', `niveau ${levelOf(500)}`)

  console.log('\nS’attribuer des points à soi-même est permis, et attribué')
  await publish(
    ws,
    grantList(modSk, [
      { target: TARGET, amount: 500, reason: 'meilleur topic' },
      { target: MOD, amount: 300, reason: 'je me récompense' },
    ]),
  )
  state = await readState(ws)
  check(grantedPoints(state, MOD) === 300, 'la clé de staff peut se servir elle-même')
  check(state.grants.get(MOD)?.[0]?.by === MOD, "…et la ligne dit que l'auteur est la cible")

  console.log('\nRetirer des points, dans la même liste')
  await publish(
    ws,
    grantList(modSk, [
      { target: TARGET, amount: 500, reason: 'meilleur topic' },
      { target: TARGET, amount: -200, reason: 'finalement à moitié volé' },
    ]),
  )
  state = await readState(ws)
  check(grantedPoints(state, TARGET) === 300, 'récompense et retrait se somment')
  check(state.grants.get(TARGET)?.length === 2, 'les deux lignes restent lisibles séparément')

  console.log('\nLe total attribué peut passer sous zéro — le plancher est côté client')
  await publish(ws, grantList(modSk, [{ target: TARGET, amount: -800, reason: 'sanction' }]))
  check(grantedPoints(await readState(ws), TARGET) === -800, 'la dérivation ne plancherise pas')

  console.log('\nAnnuler : republier la liste sans la ligne')
  await publish(ws, grantList(modSk, [{ target: KHEY, amount: 500, reason: 'meilleur topic' }]))
  check(grantedPoints(await readState(ws), KHEY) === 500, 'l’attribution est de nouveau là')
  check((await publish(ws, grantList(modSk, []))).accepted, 'la liste vide est publiée')
  // LE test du script : si le relais avait gardé les deux versions, on lirait
  // encore 500 ici — et l'interface aurait affiché « annulé » pour rien.
  check(grantedPoints(await readState(ws), KHEY) === 0, 'le relais a bien REMPLACÉ : plus rien')

  console.log('\nRévocation : ce qu’un modérateur a donné tombe avec lui')
  await publish(ws, grantList(modSk, [{ target: KHEY, amount: 300, reason: 'bon fil' }]))
  check(grantedPoints(await readState(ws), KHEY) === 300, '300 points attribués')
  await publish(ws, appData(rootSk, STAFF_D_TAG, { v: 1, at: clock, staff: [] }))
  check(grantedPoints(await readState(ws), KHEY) === 0, 'le roster vidé, l’attribution ne compte plus')

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
