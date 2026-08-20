/**
 * Teste la joignabilité des relais par défaut.
 *
 * Pourquoi ça existe : la liste par défaut de `apps/nostr/nuxt.config.ts` est la
 * première impression du produit. Un relais mort dedans coûte à chaque
 * démarrage — le client l'exclut désormais après échec (voir `activeRelays()`
 * dans `stores/relays.ts`), mais il paie quand même la tentative.
 *
 * Un relais peut être injoignable **ou** joignable mais refuser d'écrire (relais
 * payant, allowlist). On distingue les deux : un relais en lecture seule reste
 * utile pour lire, inutile pour publier.
 *
 * ## ⚠️ Ce que ce script ne dit PAS
 *
 * Il mesure depuis **Node**, et un navigateur obtient parfois un autre résultat :
 * origine de la requête, limitation de débit par IP, préflight CORS. Observé
 * pendant la mise au point — `relay.damus.io` répondait ici en 576 ms et était
 * simultanément injoignable dans le navigateur, à quelques minutes d'écart.
 *
 * Donc : ce script est un **signal**, pas un verdict. Pour un doute sur la liste
 * par défaut, croiser avec `relayStore.deadRelays` lu dans le navigateur, qui
 * mesure ce que vivent réellement les utilisateurs. Et un relais public peut
 * fermer, devenir payant ou se remettre à répondre sans préavis : un résultat
 * n'est vrai qu'au moment où il est pris.
 *
 * Usage : npx tsx scripts/check-relays.ts [wss://a,wss://b]
 */
import { Relay } from 'nostr-tools/relay'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { minePow } from 'nostr-tools/nip13'
import WebSocket from 'ws'

useWebSocketImplementation(WebSocket)

const DEFAULTS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://nostr.wine',
]

const targets = (process.argv[2]?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULTS) as string[]
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 6000)

interface Result {
  url: string
  connect: 'ok' | 'timeout' | 'erreur'
  detail?: string
  readMs?: number
  events?: number
}

async function check(url: string): Promise<Result> {
  const t0 = Date.now()
  let relay: Relay | null = null
  try {
    relay = await Promise.race([
      Relay.connect(url),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { url, connect: msg === 'timeout' ? 'timeout' : 'erreur', detail: msg.slice(0, 60) }
  }

  // Lecture : un relais qui accepte la connexion mais ne répond jamais à un REQ
  // est aussi inutile qu'un relais fermé.
  let events = 0
  await new Promise<void>((resolve) => {
    const done = setTimeout(resolve, TIMEOUT_MS)
    const sub = relay!.subscribe([{ kinds: [1], limit: 3 }], {
      onevent: () => events++,
      oneose: () => {
        clearTimeout(done)
        sub.close()
        resolve()
      },
    })
  })

  relay.close()
  return { url, connect: 'ok', readMs: Date.now() - t0, events }
}

async function main(): Promise<void> {
  console.log(`joignabilité de ${targets.length} relais (timeout ${TIMEOUT_MS} ms)\n`)
  const results = await Promise.all(targets.map(check))

  let alive = 0
  for (const r of results) {
    if (r.connect === 'ok') {
      alive++
      console.log(`  ✓ ${r.url.padEnd(30)} ${String(r.readMs).padStart(5)} ms · ${r.events} events lus`)
    } else {
      console.log(`  ✗ ${r.url.padEnd(30)} ${r.connect}${r.detail ? ` — ${r.detail}` : ''}`)
    }
  }

  console.log(`\n${alive}/${results.length} joignables.`)
  const dead = results.filter((r) => r.connect !== 'ok').map((r) => r.url)
  if (dead.length > 0) {
    console.log(`À retirer ou remplacer dans apps/nostr/nuxt.config.ts :`)
    for (const url of dead) console.log(`  ${url}`)
  }
  process.exit(0)
}

void main()
