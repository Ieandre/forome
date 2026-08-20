/**
 * Vérifie la policy d'écriture **à travers le vrai strfry**, pas en l'appelant
 * directement.
 *
 * Pourquoi ce script existe alors que `smoke:policy` teste déjà la même policy :
 * `smoke:policy` parle au plugin par un pipe, en simulant strfry. Il ne peut donc
 * pas voir ce qui casse *entre* strfry et le plugin — et le premier lancement
 * réel a justement échoué là : `run-strfry.sh` n'avait pas le bit exécutable,
 * strfry n'a jamais réussi à démarrer le plugin, et **tout était refusé** avec
 * « internal error ». Aucun test unitaire ne pouvait attraper ça.
 *
 * Au passage, ce comportement de strfry mérite d'être noté : quand le plugin ne
 * répond pas, il **refuse** l'event. C'est le bon sens du défaut — un relais qui
 * accepterait tout dès que sa policy tombe serait une porte ouverte silencieuse.
 *
 * Prérequis : `npm run dev:strfry` dans un autre terminal.
 * Usage : npm run smoke:strfry [ws://localhost:7778]
 */
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { minePow } from 'nostr-tools/nip13'
import type { Event } from 'nostr-tools/core'
import WebSocket from 'ws'
import { communityTag } from '@forome/relay-policy'

useWebSocketImplementation(WebSocket)

const RELAY = process.argv[2] ?? 'ws://localhost:7778'
const pool = new SimplePool()
const sk = generateSecretKey()
const pk = getPublicKey(sk)

function nowS(): number {
  return Math.floor(Date.now() / 1000)
}

function make(kind: number, content: string, tags: string[][], pow = 0): Event {
  if (pow > 0) {
    const m = minePow({ kind, content, tags, created_at: nowS(), pubkey: pk }, pow)
    return finalizeEvent({ kind, content, tags: m.tags, created_at: m.created_at }, sk)
  }
  return finalizeEvent({ kind, content, tags, created_at: nowS() }, sk)
}

const results: boolean[] = []

async function expect(label: string, ev: Event, want: 'accept' | 'reject'): Promise<void> {
  const settled = await Promise.allSettled(pool.publish([RELAY], ev, { maxWait: 5000 }))
  const accepted = settled.some((r) => r.status === 'fulfilled')
  const why = (settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason
  const got = accepted ? 'accept' : 'reject'
  const ok = got === want
  results.push(ok)
  const detail = accepted ? '' : `  [${String(why).replace(/^Error: /, '')}]`
  console.log(`  ${ok ? '✓' : '✗'} ${label} → ${got}${detail}`)
}

async function main(): Promise<void> {
  console.log(`\npolicy appliquée par strfry (${RELAY})\n`)

  console.log('Périmètre du forum')
  await expect('topic marqué forome, PoW 16', make(11, 'topic légitime', [communityTag()], 16), 'accept')
  await expect('topic SANS la marque du forum', make(11, 'fil venu d’ailleurs', [], 16), 'reject')
  await expect(
    'topic marqué pour une autre communauté',
    make(11, 'fil d’un autre forum', [['t', 'ailleurs']], 16),
    'reject',
  )

  console.log('\nLe reste de la policy, vu depuis strfry')
  await expect('topic marqué mais sans PoW', make(11, 'spam', [communityTag()]), 'reject')
  await expect('kind 1 (hors sujet pour ce relais)', make(1, 'note sociale', []), 'reject')
  await expect('profil kind 0, non taxé', make(0, '{"name":"khey"}', []), 'accept')
  await expect(
    'created_at 1 h dans le futur',
    finalizeEvent({ kind: 0, content: '{}', tags: [], created_at: nowS() + 3600 }, sk),
    'reject',
  )

  const failed = results.filter((r) => !r).length
  console.log(`\n${failed === 0 ? 'OK' : `${failed} échec(s)`}`)
  pool.destroy()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(`\nimpossible de joindre ${RELAY} — « npm run dev:strfry » tourne ?\n${String(err)}`)
  process.exit(1)
})
