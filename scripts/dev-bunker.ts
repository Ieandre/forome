/**
 * Signeur distant NIP-46 (« bunker »), **pour le développement seulement**.
 *
 * ## Pourquoi ce fichier existe
 *
 * NIP-46 est la seule réponse au trou le plus béant du modèle Nostr (spec v2
 * §3.2) : il n'y a ni délégation ni révocation, donc **perte d'appareil =
 * identité perdue**. Avec un bunker, la clé vit dans un seul endroit et les
 * clients obtiennent une *autorisation* — révocable indépendamment. C'est le
 * modèle à deux étages de la v1, reconstruit une couche plus haut.
 *
 * Écrire le client sans pouvoir le tester serait livrer du code non vérifié sur
 * la brique la plus sensible du projet. D'où ce bunker, même logique que
 * `dev-relay.ts` : le minimum pour exercer le vrai chemin.
 *
 * ## Ce qu'il fait, et ce qu'il n'est pas
 *
 * Il implémente `connect`, `get_public_key`, `sign_event`, `ping`,
 * `nip44_encrypt`, `nip44_decrypt`, `logout`, plus une **révocation** par client
 * (tapez `revoke` sur stdin). Ce n'est pas un bunker de production : la clé est
 * en mémoire, il n'y a pas de politique de permissions par méthode, pas de
 * `auth_url`, pas de persistance.
 *
 * ## Deux choix délibérés, qui exercent des chemins que les bunkers naïfs ratent
 *
 * 1. **La clé de communication est distincte de la clé de signature.** NIP-46
 *    l'autorise et `nostr-tools` avertit explicitement que le pubkey du bunker
 *    peut différer du pubkey signataire. Un bunker qui confond les deux laisse
 *    passer un client qui suppose l'égalité.
 * 2. **`sign_event` signe le gabarit tel quel**, sans réécrire `created_at` ni
 *    les tags. C'est indispensable : le nonce de la preuve de travail est dans
 *    les tags et l'horodatage entre dans l'id. Un bunker qui « rafraîchit »
 *    `created_at` **détruit la PoW** minée par le client, et l'event se fait
 *    refuser par la policy. Piège d'interopérabilité réel.
 *
 * Usage :
 *   npx tsx scripts/dev-bunker.ts [ws://localhost:7447]
 *   puis coller l'URI bunker:// affichée dans le client.
 */
import { createInterface } from 'node:readline'
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode, npubEncode, decode } from 'nostr-tools/nip19'
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44'
import { getPow } from 'nostr-tools/nip13'
import type { Event, EventTemplate } from 'nostr-tools/core'
import WebSocket from 'ws'

useWebSocketImplementation(WebSocket)

const KIND_NOSTR_CONNECT = 24133
const RELAY = process.argv[2] ?? 'ws://localhost:7447'

function loadKey(envVar: string, label: string): Uint8Array {
  const raw = process.env[envVar]
  if (raw) {
    try {
      const d = decode(raw)
      if (d.type === 'nsec') return d.data
    } catch {
      console.error(`${envVar} illisible — génération d'une clé éphémère (${label})`)
    }
  }
  return generateSecretKey()
}

/** Clé de l'utilisateur : celle qui signe réellement le contenu. */
const userSk = loadKey('BUNKER_USER_NSEC', 'utilisateur')
const userPk = getPublicKey(userSk)
/** Clé de communication du bunker : distincte, délibérément (voir l'en-tête). */
const bunkerSk = loadKey('BUNKER_COMM_NSEC', 'communication')
const bunkerPk = getPublicKey(bunkerSk)

const secret = process.env.BUNKER_SECRET ?? Math.random().toString(36).slice(2, 10)

/** Clients autorisés → révocables un par un. C'est tout l'intérêt de NIP-46. */
const authorized = new Set<string>()
const revoked = new Set<string>()
let signedCount = 0
let refusedCount = 0

const pool = new SimplePool()

interface RpcRequest {
  id: string
  method: string
  params: string[]
}

function respond(clientPk: string, payload: { id: string; result?: string; error?: string }): void {
  const conversationKey = getConversationKey(bunkerSk, clientPk)
  const ev = finalizeEvent(
    {
      kind: KIND_NOSTR_CONNECT,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', clientPk]],
      content: nip44Encrypt(JSON.stringify(payload), conversationKey),
    },
    bunkerSk,
  )
  void Promise.allSettled(pool.publish([RELAY], ev, { maxWait: 5000 }))
}

function handle(req: RpcRequest, clientPk: string): void {
  const short = clientPk.slice(0, 8)

  // La révocation prime sur tout : un client révoqué ne récupère pas l'accès en
  // rappelant `connect`, sinon la révocation ne vaudrait rien.
  if (revoked.has(clientPk) && req.method !== 'ping') {
    refusedCount++
    console.log(`  ⊘ ${short} · ${req.method} REFUSÉ (client révoqué)`)
    respond(clientPk, { id: req.id, error: 'client révoqué' })
    return
  }

  switch (req.method) {
    case 'connect': {
      // params[0] = pubkey visé, params[1] = secret
      const given = req.params[1]
      if (secret && given !== secret) {
        refusedCount++
        console.log(`  ⊘ ${short} · connect REFUSÉ (mauvais secret)`)
        respond(clientPk, { id: req.id, error: 'secret invalide' })
        return
      }
      authorized.add(clientPk)
      console.log(`  ✓ ${short} · connecté (${authorized.size} client(s) autorisé(s))`)
      respond(clientPk, { id: req.id, result: 'ack' })
      return
    }

    case 'ping':
      respond(clientPk, { id: req.id, result: 'pong' })
      return

    case 'get_public_key':
      if (!authorized.has(clientPk)) {
        refusedCount++
        respond(clientPk, { id: req.id, error: 'non autorisé' })
        return
      }
      // La clé RENVOYÉE est celle de l'utilisateur, pas celle du bunker.
      console.log(`  → ${short} · get_public_key → ${userPk.slice(0, 8)}`)
      respond(clientPk, { id: req.id, result: userPk })
      return

    case 'sign_event': {
      if (!authorized.has(clientPk)) {
        refusedCount++
        console.log(`  ⊘ ${short} · sign_event REFUSÉ (non autorisé)`)
        respond(clientPk, { id: req.id, error: 'non autorisé' })
        return
      }
      try {
        const template = JSON.parse(req.params[0] ?? '{}') as EventTemplate
        // Signature du gabarit TEL QUEL : ne rien réécrire, surtout pas
        // `created_at` — ça détruirait la PoW minée par le client.
        const signed = finalizeEvent(
          {
            kind: template.kind,
            created_at: template.created_at,
            tags: template.tags,
            content: template.content,
          },
          userSk,
        )
        signedCount++
        const pow = getPow(signed.id)
        console.log(
          `  ✍ ${short} · sign_event kind ${template.kind}${pow > 0 ? ` · pow ${pow} bits préservée` : ''}`,
        )
        respond(clientPk, { id: req.id, result: JSON.stringify(signed) })
      } catch (err) {
        respond(clientPk, { id: req.id, error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    case 'nip44_encrypt': {
      if (!authorized.has(clientPk)) {
        respond(clientPk, { id: req.id, error: 'non autorisé' })
        return
      }
      const [third, plaintext] = req.params
      respond(clientPk, {
        id: req.id,
        result: nip44Encrypt(plaintext ?? '', getConversationKey(userSk, third ?? '')),
      })
      return
    }

    case 'nip44_decrypt': {
      if (!authorized.has(clientPk)) {
        respond(clientPk, { id: req.id, error: 'non autorisé' })
        return
      }
      const [third, ciphertext] = req.params
      try {
        respond(clientPk, {
          id: req.id,
          result: nip44Decrypt(ciphertext ?? '', getConversationKey(userSk, third ?? '')),
        })
      } catch (err) {
        respond(clientPk, { id: req.id, error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    case 'logout':
      authorized.delete(clientPk)
      console.log(`  ← ${short} · déconnecté`)
      respond(clientPk, { id: req.id, result: 'ack' })
      return

    default:
      respond(clientPk, { id: req.id, error: `méthode non supportée : ${req.method}` })
  }
}

function onEvent(ev: Event): void {
  const clientPk = ev.pubkey
  try {
    const plain = nip44Decrypt(ev.content, getConversationKey(bunkerSk, clientPk))
    const req = JSON.parse(plain) as RpcRequest
    if (!req?.id || !req.method) return
    handle(req, clientPk)
  } catch {
    // Requête illisible : soit elle ne nous est pas destinée, soit elle est
    // chiffrée pour quelqu'un d'autre. Normal, on ne bruite pas.
  }
}

const bunkerUri = `bunker://${bunkerPk}?relay=${encodeURIComponent(RELAY)}&secret=${secret}`

console.log('bunker de dev NIP-46')
console.log(`  relais           : ${RELAY}`)
console.log(`  clé utilisateur  : ${npubEncode(userPk)}`)
console.log(`                     ${userPk}`)
console.log(`  clé de comm      : ${bunkerPk.slice(0, 16)}… (DISTINCTE de la clé utilisateur)`)
console.log(`  secret           : ${secret}`)
console.log('')
console.log('  URI à coller dans le client :')
console.log(`  ${bunkerUri}`)
console.log('')
console.log('  Pour conserver la clé utilisateur entre deux runs :')
console.log(`  BUNKER_USER_NSEC=${nsecEncode(userSk)}`)
console.log('')
console.log('  Commandes sur stdin : revoke | restore | status | quit')
console.log('')

pool.subscribe(RELAY ? [RELAY] : [], { kinds: [KIND_NOSTR_CONNECT], '#p': [bunkerPk] }, { onevent: onEvent })

/**
 * Console de contrôle. `revoke` est la démonstration qui compte : c'est ce que
 * Nostr ne sait pas faire sans bunker (§3.2).
 */
const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  const cmd = line.trim()
  if (cmd === 'revoke') {
    for (const pk of authorized) revoked.add(pk)
    const n = authorized.size
    authorized.clear()
    console.log(`  ⊘ ${n} client(s) révoqué(s) — leurs prochaines signatures seront refusées`)
  } else if (cmd === 'restore') {
    for (const pk of revoked) authorized.add(pk)
    revoked.clear()
    console.log(`  ✓ ${authorized.size} client(s) réautorisé(s)`)
  } else if (cmd === 'status') {
    console.log(
      `  autorisés ${authorized.size} · révoqués ${revoked.size} · signés ${signedCount} · refusés ${refusedCount}`,
    )
  } else if (cmd === 'quit') {
    pool.destroy()
    process.exit(0)
  }
})

process.on('SIGINT', () => {
  console.log('\narrêt.')
  pool.destroy()
  process.exit(0)
})
