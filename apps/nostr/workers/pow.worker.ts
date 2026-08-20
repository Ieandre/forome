/**
 * Mineur de preuve de travail NIP-13, dans un worker (spec v2 §12.1).
 *
 * `minePow` est **synchrone** et la doc amont dit explicitement de la lancer
 * hors du thread principal : à difficulté 20 c'est ~1 M de hachages, donc un fil
 * de messages gelé pendant une demi-seconde si on la lance dans la page.
 *
 * Le worker fait aussi la calibration, parce qu'une difficulté fixe est un bug :
 * un mobile est 3 à 5 fois plus lent qu'un desktop, et une PoW qui fait chauffer
 * le téléphone d'un lecteur légitime est une régression, pas une protection.
 */
import { minePow, getPow } from 'nostr-tools/nip13'
import { getEventHash } from 'nostr-tools/pure'
import type { UnsignedEvent } from 'nostr-tools/pure'

type Incoming =
  | { type: 'calibrate'; probeDifficulty?: number; rounds?: number }
  | { type: 'mine'; id: number; unsigned: UnsignedEvent; difficulty: number }
  | { type: 'mineFixed'; id: number; unsigned: UnsignedEvent; difficulty: number }

/**
 * Minage à `created_at` **figé**.
 *
 * `minePow` de `nostr-tools` remet `created_at` à l'heure courante à chaque
 * seconde qui tourne (vérifié dans la source amont). C'est acceptable pour un
 * post — un horodatage frais est même souhaitable — mais **incompatible** avec
 * les emballages de MP, que NIP-59 antidate volontairement jusqu'à deux jours
 * pour empêcher un relais de corréler les copies d'une même conversation.
 *
 * D'où cette boucle : même principe, sans toucher à l'horloge.
 */
function mineFixedCreatedAt(unsigned: UnsignedEvent, difficulty: number): UnsignedEvent & { id: string } {
  const tags = [...unsigned.tags, ['nonce', '0', String(difficulty)]]
  const nonceIndex = tags.length - 1
  let count = 0
  for (;;) {
    tags[nonceIndex] = ['nonce', String(++count), String(difficulty)]
    const candidate = { ...unsigned, tags }
    const id = getEventHash(candidate)
    if (getPow(id) >= difficulty) return { ...candidate, id }
  }
}

type Outgoing =
  | { type: 'calibrated'; hashRate: number }
  | { type: 'mined'; id: number; event: Omit<UnsignedEvent, never> & { id: string }; difficulty: number; ms: number }
  | { type: 'error'; id: number; message: string }

function post(msg: Outgoing): void {
  ;(self as unknown as { postMessage: (m: Outgoing) => void }).postMessage(msg)
}

function probeTemplate(): UnsignedEvent {
  return {
    kind: 1,
    // clé factice : la calibration ne signe rien, elle ne mesure que le hachage
    pubkey: '0'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: 'calibration',
  }
}

/**
 * Mesure le débit de hachage. Le nombre d'essais suit une loi géométrique, donc
 * un échantillon unique est très bruité → médiane de plusieurs tours.
 */
function calibrate(probeDifficulty = 16, rounds = 3): number {
  const rates: number[] = []
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now()
    minePow({ ...probeTemplate(), content: `calibration-${i}` }, probeDifficulty)
    const elapsed = Math.max(1, performance.now() - t0)
    rates.push(2 ** probeDifficulty / (elapsed / 1000))
  }
  rates.sort((a, b) => a - b)
  return rates[Math.floor(rates.length / 2)] ?? 500_000
}

self.onmessage = (e: MessageEvent<Incoming>) => {
  const msg = e.data
  if (msg.type === 'calibrate') {
    try {
      post({ type: 'calibrated', hashRate: calibrate(msg.probeDifficulty, msg.rounds) })
    } catch {
      post({ type: 'calibrated', hashRate: 500_000 })
    }
    return
  }

  if (msg.type === 'mine' || msg.type === 'mineFixed') {
    const t0 = performance.now()
    try {
      const mined =
        msg.type === 'mineFixed'
          ? mineFixedCreatedAt(msg.unsigned, msg.difficulty)
          : minePow(msg.unsigned, msg.difficulty)
      post({
        type: 'mined',
        id: msg.id,
        event: mined as unknown as Omit<UnsignedEvent, never> & { id: string },
        difficulty: getPow(mined.id),
        ms: performance.now() - t0,
      })
    } catch (err) {
      post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
    }
  }
}
