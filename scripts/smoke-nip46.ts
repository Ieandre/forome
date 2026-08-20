/**
 * Smoke test du signeur distant NIP-46, de bout en bout.
 *
 * ## Ce qu'il prouve, et pourquoi c'est LE test de cette étape
 *
 * La spec (§3.2) affirme que NIP-46 restaure le modèle à deux étages de la v1 :
 * clé dans un seul endroit, autorisations révocables par client. Une
 * implémentation qui signe mais dont on ne peut pas retirer l'accès ne vaut
 * rien — elle donnerait l'illusion d'avoir résolu la perte d'appareil.
 *
 * Donc on vérifie les deux moitiés :
 *
 *   1. la signature distante **fonctionne** et l'event est accepté par le relais
 *   2. la PoW minée côté client **survit** à la signature distante (un bunker qui
 *      réécrit `created_at` la détruirait)
 *   3. la clé de signature est bien celle de l'utilisateur, **pas** celle de
 *      communication du bunker
 *   4. **la révocation coupe réellement** : après révocation, signer échoue
 *   5. un client révoqué **ne se réautorise pas** en rappelant `connect`
 *
 * Prérequis : npm run dev:relay   (dans un terminal)
 * Usage     : npx tsx scripts/smoke-nip46.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import { generateSecretKey, getPublicKey, getEventHash, verifyEvent } from 'nostr-tools/pure'
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46'
import { getPow } from 'nostr-tools/nip13'
import type { UnsignedEvent } from 'nostr-tools/core'
import WebSocket from 'ws'
import { communityTag } from '@forome/relay-policy'

useWebSocketImplementation(WebSocket)

const RELAY = process.argv[2] ?? 'ws://localhost:7447'
const POW = Number(process.env.POW ?? 16)
let failures = 0

function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`)
}

/** Minage à `created_at` figé, comme le worker du client. */
function mineFixed(unsigned: UnsignedEvent, difficulty: number): UnsignedEvent & { id: string } {
  const tags = [...unsigned.tags, ['nonce', '0', String(difficulty)]]
  const i = tags.length - 1
  let count = 0
  for (;;) {
    tags[i] = ['nonce', String(++count), String(difficulty)]
    const candidate = { ...unsigned, tags }
    const id = getEventHash(candidate)
    if (getPow(id) >= difficulty) return { ...candidate, id }
  }
}

/**
 * Accumule TOUT stdout depuis le spawn.
 *
 * Un listener attaché après coup ne voit pas ce qui est déjà sorti — piège
 * classique, et rencontré ici : la clé utilisateur s'affiche avant l'URI, donc
 * une seconde attente la manquait toujours et le contrôle se sautait en silence.
 */
function tail(child: ChildProcess): { text: () => string; waitFor: (re: RegExp, ms?: number) => Promise<string> } {
  let buf = ''
  child.stdout?.on('data', (d: Buffer) => (buf += d.toString()))
  return {
    text: () => buf,
    waitFor: (re, ms = 15000) =>
      new Promise((resolve, reject) => {
        const started = Date.now()
        const poll = (): void => {
          const m = buf.match(re)
          if (m) return resolve(m[1] ?? m[0])
          if (Date.now() - started > ms) return reject(new Error(`timeout en attendant ${re}`))
          setTimeout(poll, 100)
        }
        poll()
      }),
  }
}

async function main(): Promise<void> {
  console.log(`NIP-46 contre ${RELAY} (PoW ${POW} bits)\n`)

  const bunker = spawn('npx', ['--no-install', 'tsx', 'scripts/dev-bunker.ts', RELAY], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  const out = tail(bunker)
  const uri = (await out.waitFor(/bunker:\/\/\S+/)).trim()
  const expectedUserPk = (await out.waitFor(/^\s+([0-9a-f]{64})\s*$/m, 3000).catch(() => '')).trim()
  console.log(`  bunker démarré, URI récupérée`)

  const pointer = await parseBunkerInput(uri)
  if (!pointer) {
    console.log('  ✗ URI bunker illisible')
    bunker.kill()
    process.exit(1)
  }

  const clientSk = generateSecretKey()
  const clientPk = getPublicKey(clientSk)
  const pool = new SimplePool()
  const signer = BunkerSigner.fromBunker(clientSk, pointer, { pool })

  await signer.connect()
  const userPk = await signer.getPublicKey()
  check(/^[0-9a-f]{64}$/.test(userPk), 'connexion et get_public_key')
  check(
    userPk !== pointer.pubkey,
    'la clé signataire est distincte de la clé de comm du bunker',
    `${userPk.slice(0, 8)} ≠ ${pointer.pubkey.slice(0, 8)}`,
  )
  if (expectedUserPk) {
    check(userPk === expectedUserPk, 'la clé renvoyée est bien celle annoncée par le bunker')
  } else {
    // Un contrôle sauté en silence ressemble à un contrôle passé. On le dit.
    console.log("  ⊘ ignoré : clé utilisateur non lue dans la sortie du bunker (format changé ?)")
  }
  check(userPk !== clientPk, 'la clé cliente n’est pas l’identité', `client ${clientPk.slice(0, 8)}`)

  // Un topic miné localement, signé à distance.
  const draft: UnsignedEvent = {
    kind: 11,
    pubkey: userPk,
    created_at: Math.floor(Date.now() / 1000),
    // La marque du périmètre est minée avec le reste : le relais la refuserait
    // sinon, et ce test vérifie la signature distante, pas le périmètre.
    tags: [['title', 'Topic signé à distance'], communityTag()],
    content: 'Miné en local, signé par le bunker, accepté par le relais.',
  }
  const mined = mineFixed(draft, POW)
  const minedPow = getPow(mined.id)

  const signed = await signer.signEvent({
    kind: mined.kind,
    created_at: mined.created_at,
    tags: mined.tags,
    content: mined.content,
  })

  check(verifyEvent(signed), 'la signature distante est valide')
  check(signed.pubkey === userPk, 'l’event est signé par la clé de l’utilisateur')
  check(
    getPow(signed.id) === minedPow,
    'la PoW survit à la signature distante',
    `${getPow(signed.id)} bits (miné : ${minedPow})`,
  )
  check(signed.created_at === mined.created_at, 'le bunker n’a pas réécrit created_at')

  const results = await Promise.allSettled(pool.publish([RELAY], signed, { maxWait: 5000 }))
  const accepted = results.some((r) => r.status === 'fulfilled')
  check(accepted, 'le relais accepte l’event signé à distance')
  if (!accepted) {
    const why = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    console.log(`     raison : ${String(why?.reason)}`)
  }

  // ---- Révocation : la moitié qui compte ----------------------------------
  console.log('\n  révocation du client par le bunker…')
  bunker.stdin?.write('revoke\n')
  await new Promise((r) => setTimeout(r, 1200))

  let refused = false
  let refusalReason = ''
  try {
    await signer.signEvent({
      kind: 11,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['title', 'ne doit jamais être signé']],
      content: 'après révocation',
    })
  } catch (err) {
    refused = true
    refusalReason = err instanceof Error ? err.message : String(err)
  }
  check(refused, 'signer après révocation ÉCHOUE', refusalReason.slice(0, 60))

  // Un client révoqué ne doit pas se réautoriser en rappelant `connect`.
  let reconnectBlocked = false
  try {
    await signer.connect()
    await signer.signEvent({
      kind: 11,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['title', 'reconnexion interdite']],
      content: 'après reconnect',
    })
  } catch {
    reconnectBlocked = true
  }
  check(reconnectBlocked, 'un client révoqué ne se réautorise pas via connect')

  await signer.close().catch(() => {})
  pool.destroy()
  bunker.stdin?.write('status\n')
  await new Promise((r) => setTimeout(r, 400))
  bunker.kill()

  console.log(failures === 0 ? '\nOK' : `\n${failures} échec(s)`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
