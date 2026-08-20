/**
 * Peuple le relais de dev avec des topics et des réponses signés, PoW comprise.
 *
 * À quoi ça sert : l'indexeur classe par vélocité (participants distincts,
 * rythme, accélération). Sans plusieurs clés qui parlent dans plusieurs topics à
 * des rythmes différents, il n'y a rien à classer et le tri n'est pas vérifiable.
 *
 * Le peuplement passe par la **vraie policy** du relais (PoW 16 bits sur les
 * kinds 11 et 1111), donc il exerce aussi ce chemin.
 *
 * Usage : npx tsx scripts/seed-dev-relay.ts [ws://localhost:7447]
 */
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { minePow } from 'nostr-tools/nip13'
import type { Event } from 'nostr-tools/core'
import WebSocket from 'ws'
import { communityTag } from '@forome/relay-policy'

useWebSocketImplementation(WebSocket)

const RELAY = process.argv[2] ?? 'ws://localhost:7447'
const POW = Number(process.env.POW ?? 16)
const pool = new SimplePool()

/** Un khey = une paire de clés. */
function khey(): { sk: Uint8Array; pk: string } {
  const sk = generateSecretKey()
  return { sk, pk: getPublicKey(sk) }
}

/**
 * La marque de périmètre est posée ici plutôt qu'à chaque appel : sans elle, la
 * policy refuse tout ce script, et un seed accepté mais non marqué serait pire —
 * un relais peuplé pour un forum qui n'y voit rien.
 */
function sign(sk: Uint8Array, pk: string, kind: number, content: string, tags: string[][]): Event {
  const all = kind === 11 || kind === 1111 ? [...tags, communityTag()] : tags
  const m = minePow({ kind, content, tags: all, created_at: Math.floor(Date.now() / 1000), pubkey: pk }, POW)
  return finalizeEvent({ kind, content, tags: m.tags, created_at: m.created_at }, sk)
}

async function publish(ev: Event, label: string): Promise<boolean> {
  const results = await Promise.allSettled(pool.publish([RELAY], ev, { maxWait: 5000 }))
  const ok = results.some((r) => r.status === 'fulfilled')
  if (!ok) {
    const why = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    console.log(`  ✗ ${label} refusé — ${String(why?.reason)}`)
  }
  return ok
}

async function main(): Promise<void> {
  console.log(`peuplement de ${RELAY} (PoW ${POW} bits)\n`)

  const kheys = Array.from({ length: 12 }, khey)
  let accepted = 0

  // Trois topics avec des profils d'activité délibérément différents, pour que
  // le classement par vélocité ait quelque chose à distinguer.
  const plan = [
    { title: 'Le topic qui vit — plein de kheys', authors: 10, messages: 24 },
    { title: 'Le topic squatté — 2 kheys qui up', authors: 2, messages: 24 },
    { title: 'Le topic mort — une seule réponse', authors: 1, messages: 1 },
  ]

  for (const [i, p] of plan.entries()) {
    const author = kheys[i]!
    const root = sign(author.sk, author.pk, 11, `Ouverture : ${p.title}`, [['title', p.title]])
    if (await publish(root, `topic « ${p.title} »`)) accepted++
    console.log(`  topic « ${p.title} » → ${root.id.slice(0, 12)}…`)

    for (let m = 0; m < p.messages; m++) {
      const speaker = kheys[m % p.authors]!
      const reply = sign(speaker.sk, speaker.pk, 1111, `message ${m + 1} dans « ${p.title} »`, [
        ['E', root.id, RELAY, author.pk],
        ['K', '11'],
        ['P', author.pk],
        ['e', root.id, RELAY, author.pk],
        ['k', '11'],
        ['p', author.pk],
      ])
      if (await publish(reply, `réponse ${m + 1}`)) accepted++
    }
    console.log(`    ${p.messages} réponses de ${p.authors} khey(s)`)
  }

  console.log(`\n${accepted} events acceptés par le relais.`)
  console.log('Attendu du classement : « vit » > « squatté » > « mort ».')
  console.log('  (les participants pèsent plus que le volume — le squat a autant')
  console.log('   de messages que le topic vivant, mais 2 personnes au lieu de 10)')
  pool.destroy()
  process.exit(0)
}

void main()
