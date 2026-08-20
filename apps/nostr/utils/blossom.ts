/**
 * Dépôt d'un fichier sur l'hôte Blossom, pour le compte du navigateur.
 *
 * L'autorisation est un event **kind 24242** (Blossom BUD-02) signé par la clé de
 * l'utilisateur, que notre serveur se contente de relayer : il ne détient aucune
 * clé et ne peut donc pas déposer à la place de quelqu'un.
 *
 * Le passage par le serveur (plutôt qu'un `fetch` direct vers l'hôte) suit la
 * spec §8 : les tiers restent derrière un proxy, et ça supprime la dépendance aux
 * en-têtes CORS d'un hôte qu'on ne maîtrise pas.
 */
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'

const KIND_BLOSSOM_AUTH = 24242

/** Fenêtre de validité de l'autorisation. Courte : elle ne sert qu'à cet envoi. */
const AUTH_TTL_S = 60

export type Signer = (unsigned: EventTemplate & { pubkey?: string; tags: string[][] }) => Promise<VerifiedEvent>

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface BlossomUpload {
  /** URL canonique de l'hôte — celle qui part dans l'event, lisible par les autres clients. */
  url: string
  sha256: string
}

/**
 * Dépose `blob` et renvoie son adresse canonique. Lève avec le motif de l'hôte
 * (quota, clé non autorisée, type refusé) : il est utile à l'utilisateur, on ne
 * le remplace pas par un message générique.
 */
export async function uploadToBlossom(
  blob: Blob,
  type: string,
  sign: Signer,
  note: string,
): Promise<BlossomUpload> {
  const sha = await sha256Hex(blob)
  const now = Math.floor(Date.now() / 1000)
  const auth = await sign({
    kind: KIND_BLOSSOM_AUTH,
    created_at: now,
    content: note,
    tags: [
      ['t', 'upload'],
      ['x', sha],
      ['expiration', String(now + AUTH_TTL_S)],
    ],
  })

  const res = await fetch('/api/media', {
    method: 'POST',
    headers: {
      'content-type': type,
      // base64 d'un JSON : `btoa` casse sur du non-ASCII, et le contenu de
      // l'event peut en porter.
      'x-nostr-auth': btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(auth)))),
    },
    body: blob,
  })

  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { statusMessage?: string } | null
    throw new Error(detail?.statusMessage ?? 'le dépôt a échoué')
  }

  const out = (await res.json()) as { url?: string; sha256?: string }
  if (!out.url) throw new Error("l'hôte n'a pas renvoyé d'adresse")
  return { url: out.url, sha256: out.sha256 ?? sha }
}
