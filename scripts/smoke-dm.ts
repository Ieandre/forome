/**
 * Smoke test des MP NIP-17 de bout en bout, contre le relais de dev.
 *
 * Ce qu'il vérifie, et qui ne se voit pas dans un test unitaire :
 *
 *   1. la chaîne rumeur → sceau → emballage passe **la vraie policy** du relais
 *      (PoW 14 bits sur kind 1059, fenêtre `created_at` élargie pour NIP-59)
 *   2. le destinataire déchiffre et retrouve **le bon auteur**
 *   3. l'expéditeur relit son propre message (la seconde copie)
 *   4. un tiers ne voit **rien** — ni le contenu, ni qui parle à qui, et pas
 *      davantage en s'authentifiant
 *   5. le relais lui-même ne peut pas connaître l'expéditeur : la clé qui signe
 *      l'emballage est éphémère et n'est celle de personne
 *
 * ⚠️ **Chaque lecture s'authentifie en NIP-42**, et c'est le point que la
 * première version ratait. strfry exige une AUTH pour lire les kinds de MP
 * (`auth.restrictedReadKinds`, « 4, 1059 » par défaut) : sans elle il accepte
 * les emballages puis ferme la souscription avec `auth-required`. Le test
 * passait quand même, parce qu'on le lançait sur `dev-relay.ts` — qui n'a pas
 * cette règle. **Lancer les deux**, sinon ce test ne prouve rien de la prod :
 *
 *   npx tsx scripts/smoke-dm.ts ws://localhost:7447   # relais Node
 *   npx tsx scripts/smoke-dm.ts ws://localhost:7778   # strfry, celui de la prod
 *
 * Un pool par personne, et pas un pool partagé : l'AUTH vaut pour la connexion,
 * donc alice et bob ne peuvent pas s'authentifier sur la même socket.
 *
 * Prérequis : npm run dev:relay (ou npm run dev:strfry)
 * Usage    : npx tsx scripts/smoke-dm.ts [ws://localhost:7447]
 */
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey, getEventHash } from 'nostr-tools/pure'
import { createRumor, createSeal } from 'nostr-tools/nip59'
import { unwrapEvent } from 'nostr-tools/nip17'
import { encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44'
import { getPow } from 'nostr-tools/nip13'
import type { Event, EventTemplate, UnsignedEvent } from 'nostr-tools/core'
import WebSocket from 'ws'

useWebSocketImplementation(WebSocket)

const RELAY = process.argv[2] ?? 'ws://localhost:7447'
const POW = Number(process.env.POW ?? 16)
const KIND_GIFT_WRAP = 1059
const KIND_CHAT = 14
const TWO_DAYS_S = 2 * 24 * 3600

const pool = new SimplePool()
let failures = 0

function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`)
}

/** Minage à `created_at` figé : `minePow` réécrirait l'horloge et annulerait l'antidatage. */
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

function wrapWithPow(seal: Event, recipient: string, difficulty: number): Event {
  const ephSk = generateSecretKey()
  const ephPk = getPublicKey(ephSk)
  const unsigned: UnsignedEvent = {
    kind: KIND_GIFT_WRAP,
    pubkey: ephPk,
    created_at: Math.floor(Date.now() / 1000) - Math.round(Math.random() * TWO_DAYS_S),
    tags: [['p', recipient]],
    content: nip44Encrypt(JSON.stringify(seal), getConversationKey(ephSk, recipient)),
  }
  const mined = mineFixed(unsigned, difficulty)
  return finalizeEvent(
    { kind: mined.kind, created_at: mined.created_at, tags: mined.tags, content: mined.content },
    ephSk,
  )
}

/**
 * Signature du défi NIP-42. `nostr-tools` fabrique le gabarit (kind 22242, tags
 * `relay` et `challenge`) et re-souscrit après l'AUTH : on ne fournit que ça.
 */
function authAs(sk: Uint8Array) {
  return (evt: EventTemplate) => Promise.resolve(finalizeEvent(evt, sk))
}

/**
 * Lit les emballages adressés à `recipientPk`, sur une connexion à soi.
 *
 * `sk` à null = lecture anonyme, pour montrer ce que le relais refuse. Le pool
 * est local à l'appel parce que l'AUTH s'applique à la CONNEXION : sur un pool
 * partagé, le second à s'authentifier se ferait répondre « already
 * authenticated » et lirait avec l'identité du premier.
 */
async function collect(
  sk: Uint8Array | null,
  recipientPk: string,
  filter: Record<string, unknown> = { kinds: [KIND_GIFT_WRAP], '#p': [recipientPk] },
  ms = 2500,
): Promise<Event[]> {
  const own = new SimplePool()
  const got: Event[] = []
  let sub: { close: () => void } | null = null
  let retried = false

  const start = (): void => {
    sub = own.subscribe([RELAY], filter, {
      onevent: (ev) => got.push(ev),
      ...(sk ? { onauth: authAs(sk) } : {}),
      onclose(closes) {
        // ⚠️ La reprise est refaite ici, exactement comme dans le client, et
        // pour la même raison : celle de `nostr-tools` exige « auth-required: »
        // en tête de la raison, strfry envoie « ERROR: auth-required: … ». Un
        // test qui s'appuierait sur la reprise intégrée passerait sur le relais
        // Node et échouerait sur strfry — c'est le piège d'origine.
        if (!sk || retried) return
        if (!closes.some((c) => c.reason.includes('auth-required'))) return
        retried = true
        void own
          .ensureRelay(RELAY)
          .then((relay) => relay.auth(authAs(sk)))
          .then(start)
          .catch(() => {})
      },
    })
  }

  start()
  await new Promise((r) => setTimeout(r, ms))
  sub?.close()
  own.destroy()
  return got
}

async function main(): Promise<void> {
  const alice = { sk: generateSecretKey(), get pk() { return getPublicKey(this.sk) } }
  const bob = { sk: generateSecretKey(), get pk() { return getPublicKey(this.sk) } }
  const carol = { sk: generateSecretKey(), get pk() { return getPublicKey(this.sk) } }

  const secret = `message secret ${Math.floor(Date.now() / 1000)}`

  console.log(`MP NIP-17 contre ${RELAY} (PoW ${POW} bits)`)
  console.log(`  alice ${alice.pk.slice(0, 8)} → bob ${bob.pk.slice(0, 8)}`)
  console.log(`  carol ${carol.pk.slice(0, 8)} ne doit rien voir\n`)

  // Alice écrit à Bob : rumeur non signée → sceau signé → deux emballages.
  const rumor = createRumor({ kind: KIND_CHAT, content: secret, tags: [['p', bob.pk]] }, alice.sk)
  const wrapForBob = wrapWithPow(createSeal(rumor, alice.sk, bob.pk), bob.pk, POW)
  const wrapForSelf = wrapWithPow(createSeal(rumor, alice.sk, alice.pk), alice.pk, POW)

  check(getPow(wrapForBob.id) >= POW, `emballage miné à ${getPow(wrapForBob.id)} bits`)
  check(
    wrapForBob.pubkey !== alice.pk && wrapForBob.pubkey !== bob.pk,
    'la clé qui signe l’emballage est éphémère',
    `${wrapForBob.pubkey.slice(0, 8)} n’est ni alice ni bob`,
  )
  check(
    !JSON.stringify(wrapForBob).includes(secret),
    'le contenu en clair n’apparaît nulle part dans l’emballage',
  )
  check(
    !JSON.stringify(wrapForBob).includes(alice.pk),
    'la clé publique de l’expéditeur n’apparaît pas dans l’emballage',
  )

  const results = await Promise.all(
    [wrapForBob, wrapForSelf].map((w) => Promise.allSettled(pool.publish([RELAY], w, { maxWait: 5000 }))),
  )
  const accepted = results.filter((r) => r.some((x) => x.status === 'fulfilled')).length
  check(accepted === 2, 'les deux emballages passent la policy du relais', `${accepted}/2 acceptés`)
  if (accepted < 2) {
    const why = results.flat().find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    console.log(`     raison : ${String(why?.reason)}`)
  }

  // Bob relit — authentifié, sinon strfry ferme la souscription.
  const bobWraps = await collect(bob.sk, bob.pk)
  const bobMsgs = bobWraps
    .map((w) => {
      try {
        return unwrapEvent(w, bob.sk)
      } catch {
        return null
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
  const received = bobMsgs.find((m) => m.content === secret)
  check(!!received, 'bob déchiffre le message')
  check(received?.pubkey === alice.pk, 'bob retrouve le BON auteur', received ? received.pubkey.slice(0, 8) : '—')

  // Sans AUTH, informatif et non bloquant : les deux relais de dev diffèrent
  // légitimement là-dessus, et c'est justement la différence qui avait masqué
  // le bug. 0 = le relais applique NIP-42 comme la prod.
  const anon = await collect(null, bob.pk)
  console.log(
    `  · lecture anonyme : ${anon.length} emballage(s) — ${
      anon.length === 0 ? 'le relais exige NIP-42 (comme la prod)' : 'ce relais n’exige pas NIP-42'
    }`,
  )

  // Alice relit sa propre copie — sinon elle ne voit pas son historique.
  const aliceWraps = await collect(alice.sk, alice.pk)
  const aliceMsgs = aliceWraps
    .map((w) => {
      try {
        return unwrapEvent(w, alice.sk)
      } catch {
        return null
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
  check(
    aliceMsgs.some((m) => m.content === secret),
    'alice relit son propre message (seconde copie)',
  )

  // Carol ne doit rien recevoir : le filtre `#p` ne la cible pas, et même en
  // récupérant les emballages elle ne peut pas les déchiffrer.
  const carolWraps = await collect(carol.sk, carol.pk, undefined, 1500)
  check(carolWraps.length === 0, 'carol ne reçoit aucun emballage', `${carolWraps.length} reçu(s)`)

  // Authentifiée EN TANT QUE CAROL, et sans `#p` : le cas le plus favorable
  // pour elle. Un relais qui applique `restrictReadToInvolvedPubkey` ne rend
  // rien ; un relais qui ne l'applique pas rend tout, et le chiffrement doit
  // alors suffire — c'est ce que vérifie la ligne suivante.
  const allWraps = await collect(carol.sk, carol.pk, { kinds: [KIND_GIFT_WRAP] }, 1500)
  const carolCracked = allWraps.filter((w) => {
    try {
      unwrapEvent(w, carol.sk)
      return true
    } catch {
      return false
    }
  })
  check(
    carolCracked.length === 0,
    'même en récupérant TOUS les emballages, carol n’en déchiffre aucun',
    `${allWraps.length} emballages sur le relais`,
  )

  console.log(failures === 0 ? '\nOK' : `\n${failures} échec(s)`)
  pool.destroy()
  process.exit(failures === 0 ? 0 : 1)
}

void main()
