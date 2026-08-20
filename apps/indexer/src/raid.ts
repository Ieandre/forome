/**
 * Détection de raid (spec v2 §9.5) — **portée depuis `apps/server/src/services/
 * raid.ts`**. La combinaison pondérée est reprise telle quelle : chaque terme
 * seul ne suffit pas, et l'accélération est pondérée par la part de comptes
 * récents — des habitués qui s'emballent ne sont pas un raid, c'est un bon topic.
 *
 * ## L'adaptation, et le renforcement de l'étape 4
 *
 * La v1 disposait de `accountCreatedAt` : elle savait l'âge réel d'un compte.
 * **Nostr n'a pas ça** — une clé n'a pas de date de création, elle existe ou pas.
 *
 * Premier substitut (étape 3) : « clé jamais vue par cet indexeur ». Faiblesse
 * assumée et documentée : une clé vieille de trois ans mais que nous n'avions
 * jamais croisée comptait comme récente.
 *
 * **Renforcement (étape 4)** : l'indexeur ingère les kind 3, et une clé **citée
 * dans la liste de contacts de quelqu'un** cesse d'être « récente ». C'est le web
 * of trust de §12.3 appliqué à la détection : une ferme de clés neuves n'est
 * suivie par personne, alors qu'un habitué l'est. `noteFollowGraph()` alimente ça.
 *
 * Ce qui reste vrai : **le graphe est vide à trente utilisateurs.** D'où
 * `warmupS`, en dessous duquel aucune alerte n'est émise, et l'ordre de la spec :
 * PoW et policy de relais d'abord, web of trust quand il y a un graphe.
 */

export interface RaidSignal {
  topicId: string
  score: number
  details: {
    ratePerMin: number
    acceleration: number
    recentKeyShare: number
    correlatedArrivals: number
  }
}

interface TopicWindow {
  events: { at: number; pubkey: string; keyIsRecent: boolean; firstInTopic: boolean }[]
  seenKeys: Set<string>
  flaggedUntil: number
  lastAlertAt: number
}

const WINDOW_S = 10 * 60
const SHORT_S = 2 * 60
const ALERT_THRESHOLD = 3.0
const FLAG_DURATION_S = 15 * 60
const ALERT_COOLDOWN_S = 5 * 60
const MAX_EVENTS_PER_TOPIC = 2000

/** En topic signalé : une clé récente est limitée à N messages / minute. */
export const FLAGGED_RECENT_KEY_RATE = 2

export class RaidDetector {
  private readonly windows = new Map<string, TopicWindow>()
  /** première fois que l'indexeur a vu cette clé, en secondes */
  private readonly firstSeen = new Map<string, number>()
  /** clés citées dans au moins une liste de contacts (kind 3) */
  private readonly followed = new Set<string>()
  private readonly startedAt: number

  constructor(
    private readonly recentKeyS = 24 * 3600,
    /** Pas d'alerte avant ce délai : au démarrage, toutes les clés sont neuves. */
    private readonly warmupS = 10 * 60,
    startedAt = Math.floor(Date.now() / 1000),
  ) {
    this.startedAt = startedAt
  }

  /**
   * Enregistre les clés citées dans une liste de contacts. Une clé suivie par
   * quelqu'un n'est plus « récente », quel que soit le moment où nous l'avons
   * croisée pour la première fois.
   *
   * Volontairement sans pondération : un seul follow suffit à sortir du lot. Le
   * but n'est pas de mesurer la réputation, c'est de distinguer une ferme de
   * clés fraîches d'une communauté.
   */
  noteFollowGraph(pubkeys: Iterable<string>): void {
    for (const pk of pubkeys) {
      if (this.followed.size > 500_000) break
      this.followed.add(pk)
    }
  }

  get followGraphSize(): number {
    return this.followed.size
  }

  /** Renvoie true si la clé est « récente » au sens de l'indexeur. */
  private noteKey(pubkey: string, nowS: number): boolean {
    // Suivie par quelqu'un → jamais traitée comme récente. C'est le signal le
    // plus fort et le moins cher dont on dispose.
    if (this.followed.has(pubkey)) {
      if (!this.firstSeen.has(pubkey)) this.firstSeen.set(pubkey, 0)
      return false
    }
    const seen = this.firstSeen.get(pubkey)
    if (seen === undefined) {
      this.firstSeen.set(pubkey, nowS)
      if (this.firstSeen.size > 200_000) this.firstSeen.clear()
      return true
    }
    return nowS - seen < this.recentKeyS
  }

  onEvent(input: { topicId: string; pubkey: string; at: number; nowS?: number }): RaidSignal | null {
    const nowS = input.nowS ?? Math.floor(Date.now() / 1000)
    let w = this.windows.get(input.topicId)
    if (!w) {
      w = { events: [], seenKeys: new Set(), flaggedUntil: 0, lastAlertAt: 0 }
      this.windows.set(input.topicId, w)
    }

    const keyIsRecent = this.noteKey(input.pubkey, nowS)
    const firstInTopic = !w.seenKeys.has(input.pubkey)
    w.seenKeys.add(input.pubkey)
    w.events.push({ at: input.at, pubkey: input.pubkey, keyIsRecent, firstInTopic })

    const cutoff = nowS - WINDOW_S
    // filtrage, pas shift() en boucle : l'ordre d'arrivée n'est pas
    // chronologique sur Nostr, donc le plus vieux n'est pas forcément en tête
    if (w.events.length > MAX_EVENTS_PER_TOPIC || w.events[0]!.at < cutoff) {
      w.events = w.events.filter((e) => e.at >= cutoff).slice(-MAX_EVENTS_PER_TOPIC)
    }

    if (nowS - this.startedAt < this.warmupS) return null

    const scored = this.score(w, nowS)
    if (scored.score >= ALERT_THRESHOLD) {
      w.flaggedUntil = nowS + FLAG_DURATION_S
      if (nowS - w.lastAlertAt > ALERT_COOLDOWN_S) {
        w.lastAlertAt = nowS
        return { topicId: input.topicId, ...scored }
      }
    }
    return null
  }

  private score(w: TopicWindow, nowS: number): Omit<RaidSignal, 'topicId'> {
    const shortStart = nowS - SHORT_S
    let total = 0
    let short = 0
    let recentKeys = 0
    let correlatedArrivals = 0
    for (const e of w.events) {
      total++
      if (e.at >= shortStart) {
        short++
        if (e.firstInTopic && e.keyIsRecent) correlatedArrivals++
      }
      if (e.keyIsRecent) recentKeys++
    }
    const ratePerMin = total / (WINDOW_S / 60)
    const shortRate = short / (SHORT_S / 60)
    const acceleration = total >= 10 ? shortRate / Math.max(ratePerMin, 0.2) : 0
    const recentKeyShare = total > 0 ? recentKeys / total : 0

    let score = 0
    if (total >= 15) {
      score =
        Math.min(acceleration, 5) * 0.8 * Math.min(recentKeyShare * 2, 1) +
        recentKeyShare * 3 +
        Math.min(correlatedArrivals / 5, 2) * 1.5 +
        Math.min(shortRate / 20, 1)
    }
    return {
      score: Math.round(score * 100) / 100,
      details: {
        ratePerMin: Math.round(ratePerMin * 10) / 10,
        acceleration: Math.round(acceleration * 100) / 100,
        recentKeyShare: Math.round(recentKeyShare * 100) / 100,
        correlatedArrivals,
      },
    }
  }

  isFlagged(topicId: string, nowS = Math.floor(Date.now() / 1000)): boolean {
    return (this.windows.get(topicId)?.flaggedUntil ?? 0) > nowS
  }

  flaggedTopics(nowS = Math.floor(Date.now() / 1000)): string[] {
    const out: string[] = []
    for (const [id, w] of this.windows) if (w.flaggedUntil > nowS) out.push(id)
    return out
  }
}
