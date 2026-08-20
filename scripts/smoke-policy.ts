/**
 * Smoke test du **protocole** du plugin de policy strfry.
 *
 * Les règles de la policy sont couvertes par les tests unitaires de
 * `@forome/relay-policy`. Ce qu'ils ne couvrent pas, et que ce script vérifie,
 * c'est le contrat d'intégration avec strfry :
 *
 *   - une réponse JSON par ligne sur stdout, dans le bon format
 *   - le process survit à une ligne d'entrée illisible
 *   - **stdout reste propre** : une seule ligne de bruit ferait fermer le plugin
 *     par strfry, donc rien d'autre que des réponses ne doit y passer
 *
 * Ça ne remplace pas un essai avec un vrai strfry (C++, à compiler) — voir
 * l'avertissement en tête de `strfry-plugin.ts`.
 *
 * Usage : npx tsx scripts/smoke-policy.ts
 */
import { spawn } from 'node:child_process'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { minePow } from 'nostr-tools/nip13'
import type { Event } from 'nostr-tools/core'
import { communityTag } from '@forome/relay-policy'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const now = Math.floor(Date.now() / 1000)

/**
 * Le contenu public porte la marque du forum, comme ce que publie le client.
 * Sans elle, tous ces cas seraient refusés pour hors-périmètre et ne diraient
 * plus rien de la PoW ni des kinds — le cas du périmètre est testé à part.
 */
function scoped(kind: number, tags: string[][]): string[][] {
  return kind === 11 || kind === 1111 ? [...tags, communityTag()] : tags
}

function withPow(kind: number, content: string, difficulty: number): Event {
  const tags = scoped(kind, [])
  const m = minePow({ kind, content, tags, created_at: now, pubkey: pk }, difficulty)
  return finalizeEvent({ kind, content, tags: m.tags, created_at: m.created_at }, sk)
}

function plain(kind: number, content: string, tags: string[][] = []): Event {
  return finalizeEvent({ kind, content, tags: scoped(kind, tags), created_at: now }, sk)
}

interface Case {
  label: string
  event: Event
  expect: 'accept' | 'reject'
}

const cases: Case[] = [
  { label: 'kind 11 avec PoW 16', event: withPow(11, 'topic légitime', 16), expect: 'accept' },
  { label: 'kind 1111 avec PoW 16', event: withPow(1111, 'réponse légitime', 16), expect: 'accept' },
  { label: 'kind 0 sans PoW (profil non taxé)', event: plain(0, '{"name":"khey"}'), expect: 'accept' },
  { label: 'kind 1 (hors sujet pour ce relais)', event: plain(1, 'note sociale'), expect: 'reject' },
  { label: 'kind 1111 sans PoW', event: plain(1111, 'spam'), expect: 'reject' },
  {
    // Le périmètre : ce qui sépare le relais d'un forum d'un relais généraliste.
    label: 'kind 11 sans la marque du forum',
    event: finalizeEvent({ kind: 11, content: 'fil venu d’ailleurs', tags: [], created_at: now }, sk),
    expect: 'reject',
  },
  {
    label: 'kind 11 marqué pour une autre communauté',
    event: finalizeEvent(
      { kind: 11, content: 'fil d’un autre forum', tags: [['t', 'un-autre-forum']], created_at: now },
      sk,
    ),
    expect: 'reject',
  },
  {
    label: 'created_at 1 h dans le futur',
    event: finalizeEvent({ kind: 0, content: '{}', tags: [], created_at: now + 3600 }, sk),
    expect: 'reject',
  },
]

const child = spawn('npx', ['--no-install', 'tsx', 'packages/relay-policy/bin/strfry.ts'], {
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))

for (const c of cases) {
  child.stdin.write(`${JSON.stringify({ type: 'new', event: c.event, sourceType: 'IP4' })}\n`)
}
// Ligne illisible : le plugin doit survivre et NE RIEN écrire sur stdout (il n'a
// aucun id à qui répondre).
child.stdin.write('{ ceci n est pas du json\n')
// Type inconnu d'une future version de strfry : accepté par défaut plutôt que
// rejeté — refuser ce qu'on ne comprend pas casserait le relais à la mise à jour.
child.stdin.write(`${JSON.stringify({ type: 'lookup', event: cases[0]!.event })}\n`)

setTimeout(() => {
  child.stdin.end()
  setTimeout(() => {
    child.kill()

    const lines = stdout.trim().split('\n').filter(Boolean)
    let parsed: { id: string; action: string; msg?: string }[]
    try {
      parsed = lines.map((l) => JSON.parse(l))
    } catch (err) {
      console.error(`✗ stdout n'est pas du JSON ligne à ligne — strfry fermerait le plugin`)
      console.error(stdout)
      process.exit(1)
    }

    let failures = 0
    console.log(`stdout : ${parsed.length} réponses, toutes en JSON valide\n`)

    for (const c of cases) {
      const res = parsed.find((p) => p.id === c.event.id)
      const got = res?.action ?? 'aucune réponse'
      const ok = got === c.expect
      if (!ok) failures++
      console.log(`  ${ok ? '✓' : '✗'} ${c.label} → ${got}${res?.msg ? `  [${res.msg}]` : ''}`)
    }

    // Le premier event apparaît deux fois : une fois pour `new`, une fois pour
    // le `lookup` accepté par défaut. La ligne cassée n'ajoute rien.
    const expected = cases.length + 1
    if (parsed.length !== expected) {
      failures++
      console.log(`\n  ✗ ${parsed.length} réponses au lieu de ${expected} attendues`)
    } else {
      console.log(`\n  ✓ la ligne JSON illisible n'a produit aucune réponse et n'a pas tué le plugin`)
    }

    if (stderr.trim()) console.log(`\n  stderr (attendu, hors stdout) : ${stderr.trim()}`)

    console.log(failures === 0 ? '\nOK' : `\n${failures} échec(s)`)
    process.exit(failures === 0 ? 0 : 1)
  }, 500)
}, 4000)
