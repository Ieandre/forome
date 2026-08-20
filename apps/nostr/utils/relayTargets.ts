/**
 * Qui l'on interroge, et à qui l'on écrit.
 *
 * Ce sont **deux ensembles différents**, et les confondre est le bug qui a envoyé
 * le premier message de Forome sur quatre relais publics depuis un serveur de
 * développement (2026-08-15). Le défaut visait le réseau public parce qu'il
 * datait de l'étape 1, où le client ne faisait que lire — lire chez les autres
 * est sans conséquence, écrire chez eux est définitif.
 *
 * La règle tient en deux lignes :
 *
 *   - **lire** chez nous. C'est le seul relais où la policy s'applique, donc le
 *     seul dont on répond de ce qu'il sert (spec §9.2).
 *   - **écrire** chez nous ET chez les autres. C'est ce qui rend vraie la
 *     promesse de §9.3 — « rien ne peut être retiré du réseau, et tu peux
 *     emporter ce que tu as écrit dans n'importe quel autre client ». Un forum
 *     qui n'écrirait que chez lui serait la v1 centralisée en costume Nostr.
 *
 * En développement, les deux ensembles se réduisent au relais local : ce qu'on
 * teste n'a rien à faire sur le réseau, et rien ne s'y efface.
 */

export interface RelayPlan {
  /** true en développement : le réseau public est alors hors de portée. */
  dev: boolean
  /** Notre relais (strfry). Vide tant qu'il n'est pas déployé. */
  homeRelay: string
  /** Relais local de développement. */
  devRelay: string
  /** Relais tiers : réplication et portabilité. */
  publicRelays: string[]
}

function clean(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of urls) {
    const trimmed = url.trim().replace(/\/$/, '')
    if (!/^wss?:\/\//.test(trimmed) || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/** true si l'adresse est sur la machine : un relais de test, jamais le réseau. */
export function isLocalRelay(url: string): boolean {
  return /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(url.trim())
}

/**
 * true pour un relais que **nous n'opérons pas**.
 *
 * Ni notre relais, ni la boucle locale. C'est la seule catégorie où écrire
 * engage quelqu'un d'autre que nous et ne peut pas être défait.
 */
export function isThirdPartyRelay(url: string, homeRelay = ''): boolean {
  if (isLocalRelay(url)) return false
  const norm = url.trim().replace(/\/$/, '')
  return norm !== homeRelay.trim().replace(/\/$/, '')
}

/**
 * Relais à interroger.
 *
 * On retombe sur les relais publics quand notre relais n'est pas déployé : c'est
 * l'état d'aujourd'hui, et un forum qui n'afficherait rien serait pire qu'un
 * forum qui affiche ce qui existe.
 */
export function readTargets(plan: RelayPlan): string[] {
  if (plan.dev) return clean([plan.devRelay])
  const home = clean([plan.homeRelay])
  return home.length > 0 ? home : clean(plan.publicRelays)
}

/**
 * Relais où diffuser.
 *
 * En développement, **strictement local** : c'est la garantie qu'aucun essai ne
 * part sur un réseau où rien ne s'efface.
 */
export function writeTargets(plan: RelayPlan): string[] {
  if (plan.dev) return clean([plan.devRelay])
  return clean([plan.homeRelay, ...plan.publicRelays])
}
