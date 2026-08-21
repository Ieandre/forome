/**
 * Liste chaude (spec §5.2, §5.3) : le classement des topics par vélocité.
 *
 * Ce que le protocole impose, et qui dicte tout le fichier :
 *   - l'entrée n'est pas un message ingéré par un serveur à nous mais un event
 *     arrivé d'un relais, donc **possiblement en double et dans le désordre**
 *   - il n'y a plus de `seq` ni de `rts` : on n'a que `created_at`, déclaré par
 *     l'auteur (§2.4). Le classement s'appuie donc sur une horloge qui peut
 *     mentir — atténué par la fenêtre de tolérance de la policy de relais.
 *   - `by` n'est plus un handle mais une clé publique ; c'est le client qui
 *     résout le pseudo (§11.1), pas l'indexeur
 *
 * Ce qui ne change pas, et qui est l'intérêt du portage : **un instantané
 * calculé une fois, identique pour tous.** Le personnel (non-lu, suivis,
 * filtres) se superpose côté client.
 */

const WINDOW_S = 10 * 60 // fenêtre de vélocité
const RECENT_S = 2 * 60 // fenêtre courte (accélération)
const EVICT_AFTER_S = 6 * 3600 // topic sans activité → sort de la structure
const MAX_TRACKED = 5000
const MAX_EVENTS_PER_TOPIC = 600

interface TopicActivity {
  id: string
  title: string
  /** Clé publique du créateur du topic. */
  pubkey: string
  lastAt: number
  lastPubkey: string
  lastText: string
  createdAt: number
  /** Événements (heure, auteur) dans la fenêtre — anneau borné. */
  events: { at: number; pubkey: string }[]
  /** Ids déjà comptés — les relais renvoient les mêmes events plusieurs fois. */
  seen: Set<string>
}

export interface TickTopic {
  id: string
  title: string
  pubkey: string
  lastAt: number
  lastPubkey: string
  lastText: string
  replies: number
  /** Vélocité — score continu ; n'alimente plus que le rail des topics chauds. */
  vel: number
  /** Participants distincts sur la fenêtre. */
  ppl: number
}

export interface TickSnapshot {
  v: 1
  at: number
  topics: TickTopic[]
}

export class HotList {
  private readonly topics = new Map<string, TopicActivity>()

  get size(): number {
    return this.topics.size
  }

  has(id: string): boolean {
    return this.topics.has(id)
  }

  addTopic(input: { id: string; title: string; createdAt: number; pubkey: string; text: string }): void {
    if (this.topics.has(input.id)) return
    this.topics.set(input.id, {
      id: input.id,
      title: input.title,
      pubkey: input.pubkey,
      lastAt: input.createdAt,
      lastPubkey: input.pubkey,
      lastText: input.text.replace(/\s+/g, ' ').trim().slice(0, 140),
      createdAt: input.createdAt,
      events: [],
      seen: new Set(),
    })
    this.evictIfNeeded()
  }

  /**
   * Mise à jour incrémentale. Renvoie false si l'event était déjà compté — le
   * dédoublonnage est ici et pas chez l'appelant, parce que la structure est la
   * seule à savoir ce qu'elle a déjà vu.
   */
  onReply(input: {
    topicId: string
    eventId: string
    pubkey: string
    createdAt: number
    text: string
  }): boolean {
    const t = this.topics.get(input.topicId)
    if (!t) return false
    if (t.seen.has(input.eventId)) return false
    t.seen.add(input.eventId)
    if (t.seen.size > MAX_EVENTS_PER_TOPIC * 2) {
      // borne mémoire : on ne garde pas l'historique complet des ids
      t.seen.clear()
    }

    t.events.push({ at: input.createdAt, pubkey: input.pubkey })
    if (t.events.length > MAX_EVENTS_PER_TOPIC) {
      t.events.splice(0, t.events.length - MAX_EVENTS_PER_TOPIC)
    }
    // l'ordre d'arrivée n'est pas l'ordre chronologique : on ne met à jour le
    // « dernier message » que si l'event est réellement plus récent
    if (input.createdAt >= t.lastAt) {
      t.lastAt = input.createdAt
      t.lastPubkey = input.pubkey
      t.lastText = input.text.replace(/\s+/g, ' ').trim().slice(0, 140)
    }
    return true
  }

  /**
   * Vélocité : **les participants pèsent plus que le volume**, sinon trois
   * squatteurs suffisent à tenir le haut de la liste.
   */
  velocity(t: TopicActivity, nowS: number): { vel: number; ppl: number } {
    const winStart = nowS - WINDOW_S
    const recentStart = nowS - RECENT_S
    let inWindow = 0
    let inRecent = 0
    const people = new Set<string>()
    for (let i = t.events.length - 1; i >= 0; i--) {
      const e = t.events[i]!
      // `continue`, pas `break` : l'anneau est en ordre d'ARRIVÉE, qui n'a rien
      // à voir avec `created_at`. S'arrêter au premier event hors fenêtre
      // demanderait un ordre chronologique garanti, que personne ne garantit
      // ici — et sous-compterait le topic.
      if (e.at < winStart) continue
      inWindow++
      people.add(e.pubkey)
      if (e.at >= recentStart) inRecent++
    }
    if (inWindow === 0) return { vel: 0, ppl: 0 }
    const ratePerMin = inWindow / (WINDOW_S / 60)
    const recentRate = inRecent / (RECENT_S / 60)
    const acceleration = recentRate / Math.max(ratePerMin, 0.1)
    const vel = people.size * 2 + ratePerMin + Math.min(acceleration, 4)
    return { vel: Math.round(vel * 100) / 100, ppl: people.size }
  }

  /** L'instantané du tick — calculé une fois, identique pour tous. */
  snapshot(nowS = Math.floor(Date.now() / 1000), limit = 60): TickSnapshot {
    const out: TickTopic[] = []
    for (const t of this.topics.values()) {
      const { vel, ppl } = this.velocity(t, nowS)
      out.push({
        id: t.id,
        title: t.title,
        pubkey: t.pubkey,
        lastAt: t.lastAt,
        lastPubkey: t.lastPubkey,
        lastText: t.lastText,
        replies: t.events.length,
        vel,
        ppl,
      })
    }
    // Même règle que la colonne du client (`compareTopicRows`) : le dernier
    // message remonte le topic, le volume ne départage que les ex æquo à la
    // seconde. Les deux DOIVENT trancher pareil — sinon la liste se réordonne
    // toute seule à l'apparition puis à la péremption du tick, sans cause visible.
    out.sort((a, b) => b.lastAt - a.lastAt || b.replies - a.replies)
    return { v: 1, at: nowS, topics: out.slice(0, limit) }
  }

  private evictIfNeeded(): void {
    if (this.topics.size <= MAX_TRACKED) return
    const cutoff = Math.floor(Date.now() / 1000) - EVICT_AFTER_S
    for (const [id, t] of this.topics) {
      if (t.lastAt < cutoff) this.topics.delete(id)
      if (this.topics.size <= MAX_TRACKED) return
    }
  }
}
