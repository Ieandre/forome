/**
 * Le comptage des points (spec §16).
 *
 * ## Ce que le protocole impose, et qui dicte tout le fichier
 *
 * Personne, sur Nostr, ne tient de compteur par clé : il n'y a ni inscription,
 * ni total de messages, ni serveur qui aurait vu passer une identité. Un score
 * ne peut donc être qu'un **pli sur les events**, tenu par le seul programme qui
 * voit tout le trafic — l'indexeur (§5.4). D'où trois conséquences qu'on ne
 * choisit pas :
 *
 *   1. **Un event arrive plusieurs fois et dans le désordre.** Le
 *      dédoublonnage est ici, comme dans `HotList`, et pour la même raison : la
 *      structure est la seule à savoir ce qu'elle a déjà compté.
 *   2. **Les points sont *ce que l'indexeur a vu*.** Une nuit où il est tombé
 *      n'a jamais eu lieu. Le rattrapage au démarrage (`since`) limite les
 *      dégâts sans les annuler, et c'est pourquoi aucun droit ne dépend d'un
 *      niveau (§16, `../index.ts`).
 *   3. **Le pli n'est pas commutatif**, et c'est voulu : le seuil de
 *      `MIN_POINTS_TO_CREDIT` se lit sur le total *courant* de celui qui
 *      crédite. Rejouer l'historique dans un autre ordre donne donc un autre
 *      résultat. Un rebuild reproductible doit rejouer par `created_at`
 *      croissant — c'est la seule contrainte, et elle est notée là où le
 *      rattrapage se fait.
 *
 * ## Les garde-fous, et pourquoi chacun existe
 *
 * Un système de points sans ces quatre règles est mort en une nuit :
 *
 *   - **plafond quotidien** (`DAILY_CAP`) — un habitué l'atteint sans y penser,
 *     une ferme n'accélère pas. C'est aussi ce qui fait qu'un niveau vaut une
 *     durée minimale.
 *   - **crédit unique par couple** (celui qui crédite, ce qui est crédité) —
 *     ton pote qui te répond cinquante fois compte une fois.
 *   - **seuil pour créditer** (`MIN_POINTS_TO_CREDIT`) — une clé neuve ne
 *     fabrique pas de valeur, donc une ferme de clés neuves non plus.
 *   - **jamais de crédit à soi-même** — sinon se répondre est le meilleur
 *     placement du forum.
 *
 * Le crédit est marqué **avant** l'attribution, et pas après : si le plafond du
 * jour est atteint, le couple est quand même consommé. Sans ça, il suffirait
 * d'attendre demain pour rejouer le même crédit, et le plafond deviendrait un
 * simple étalement.
 *
 * Ce qui ne rapporte rien, sans avoir besoin d'une règle : le mode anonyme
 * (§3.7) utilise une clé par topic, qui ne capitalise donc jamais ; et les
 * révisions (§2.5) sont filtrées par l'appelant, avec la même fonction partagée
 * que le tick — un désaccord sur « qu'est-ce qu'une réponse » fausserait les
 * points sans rien casser de visible.
 */
import { DAILY_CAP, MIN_POINTS_TO_CREDIT, WEIGHTS } from './index.js'

const DAY_S = 86400
/** Jours de plafond conservés par clé — assez pour les events qui arrivent en retard. */
const DAYS_KEPT = 7
/** Bornes mémoire. Dépassées, on oublie le plus ancien : le pli reste borné. */
const MAX_CREDITS = 200_000
const MAX_AUTHORS = 100_000

export function dayOf(atS: number): number {
  return Math.floor(atS / DAY_S)
}

/** 16 hexa suffisent à distinguer deux clés ou deux events dans une clé de crédit. */
function short(hex: string): string {
  return hex.slice(0, 16)
}

/**
 * L'état d'une clé : son score, et les **faits** qui l'ont produit.
 *
 * Les faits ne sont pas des points : ils échappent au plafond quotidien, parce
 * qu'ils ne récompensent rien — ils décrivent. C'est ce que la page de classement
 * met en colonnes (§16), et c'est aussi ce qui permet de lire un score : « 1 200
 * points en 14 jours actifs » et « 1 200 points en 300 jours » ne racontent pas
 * la même personne, alors que le nombre est le même.
 */
interface KeyState {
  pts: number
  /** jour → points déjà gagnés ce jour-là. Borné à `DAYS_KEPT`. */
  days: Map<number, number>
  /** Topics ouverts. */
  topics: number
  /** Réponses écrites, révisions exclues (l'appelant les a filtrées). */
  replies: number
  /** Jours distincts où cette clé a posté. */
  activeDays: number
  /** Dernier jour où elle a posté. */
  lastDay: number
}

/** Une ligne de classement : le score, et les faits qui l'expliquent. */
export interface PointsRow {
  pubkey: string
  points: number
  topics: number
  replies: number
  activeDays: number
  /** Jour (unix / 86400) du dernier message vu. */
  lastDay: number
}

export interface LedgerJson {
  v: 1
  /** [clé, points, topics, réponses, jours actifs, dernier jour, [[jour, gagné]]] */
  keys: [string, number, number, number, number, number, [number, number][]][]
  credited: string[]
  /** [id d'event, auteur] — sert à créditer l'auteur d'un message auquel on répond. */
  authors: [string, string][]
}

export interface ReplyInput {
  eventId: string
  pubkey: string
  createdAt: number
  /** Racine du fil (§2.3, tag `E`). */
  rootId: string
  /** Message auquel cette réponse répond, s'il n'est pas la racine. */
  parentId?: string | undefined
}

export class PointsLedger {
  private readonly keys = new Map<string, KeyState>()
  /** Couples déjà crédités. Insertion ordonnée : le plus ancien sort en premier. */
  private readonly credited = new Set<string>()
  /** Auteur d'un event vu passer — sans lui, « quelqu'un t'a répondu » est incalculable. */
  private readonly authors = new Map<string, string>()

  get size(): number {
    return this.keys.size
  }

  points(pubkey: string): number {
    return this.keys.get(pubkey)?.pts ?? 0
  }

  /** Toutes les clés qui ont au moins un point, faits compris. */
  rows(): PointsRow[] {
    const out: PointsRow[] = []
    for (const [pubkey, st] of this.keys) {
      if (st.pts <= 0) continue
      out.push({
        pubkey,
        points: st.pts,
        topics: st.topics,
        replies: st.replies,
        activeDays: st.activeDays,
        lastDay: st.lastDay,
      })
    }
    return out
  }

  /* ------------------------------------------------------------- ingestion */

  /** Un topic (kind 11). Son auteur est retenu : il sera crédité par ses lecteurs. */
  onTopic(input: { eventId: string; pubkey: string; createdAt: number }): void {
    if (!this.noteAuthor(input.eventId, input.pubkey)) return
    this.state(input.pubkey).topics++
    this.award(input.pubkey, WEIGHTS.topic, input.createdAt)
    this.awardActiveDay(input.pubkey, input.createdAt)
  }

  /**
   * Une réponse (kind 1111), déjà filtrée des révisions par l'appelant.
   *
   * Elle rapporte trois choses différentes à trois personnes, et l'ordre compte :
   * l'auteur encaisse son plancher, l'auteur du topic encaisse un participant
   * distinct, l'auteur du message visé encaisse une réponse reçue. Les deux
   * derniers passent par le seuil de crédit — donc une réponse d'une clé neuve
   * ne rapporte qu'à elle-même.
   */
  onReply(input: ReplyInput): void {
    if (!this.noteAuthor(input.eventId, input.pubkey)) return
    this.state(input.pubkey).replies++
    this.award(input.pubkey, WEIGHTS.reply, input.createdAt)
    this.awardActiveDay(input.pubkey, input.createdAt)

    if (!this.canCredit(input.pubkey)) return

    // Venir parler dans le topic de quelqu'un : une fois par personne et par topic.
    this.credit(
      `t:${short(input.pubkey)}:${short(input.rootId)}`,
      this.authors.get(input.rootId),
      input.pubkey,
      WEIGHTS.topicParticipant,
      input.createdAt,
    )

    // Répondre au message de quelqu'un : une fois par personne et par message.
    // La racine est exclue — elle est déjà payée par la règle du dessus, et une
    // réponse de premier niveau créditerait deux fois le même geste.
    if (input.parentId && input.parentId !== input.rootId) {
      this.credit(
        `r:${short(input.pubkey)}:${short(input.parentId)}`,
        this.authors.get(input.parentId),
        input.pubkey,
        WEIGHTS.replyReceived,
        input.createdAt,
      )
    }
  }

  /** Un vote de sondage (kind 1018) : le sondage est porté par le topic (§polls). */
  onPollVote(input: { eventId: string; pubkey: string; createdAt: number; topicId: string }): void {
    if (this.authors.has(input.eventId)) return
    this.noteAuthor(input.eventId, input.pubkey)
    if (!this.canCredit(input.pubkey)) return
    this.credit(
      `v:${short(input.pubkey)}:${short(input.topicId)}`,
      this.authors.get(input.topicId),
      input.pubkey,
      WEIGHTS.pollVote,
      input.createdAt,
    )
  }

  /**
   * Ce topic est entré dans les topics chauds. Une fois par topic, et sans
   * personne à créditer en face : c'est le forum qui constate, pas quelqu'un
   * qui donne — donc pas de seuil de crédit à franchir.
   */
  onHotTopic(topicId: string, atS: number): void {
    const author = this.authors.get(topicId)
    if (!author) return
    const key = `h:${short(topicId)}`
    if (this.credited.has(key)) return
    this.remember(key)
    this.award(author, WEIGHTS.hotTopic, atS)
  }

  /* ----------------------------------------------------------------- règles */

  private canCredit(pubkey: string): boolean {
    return this.points(pubkey) >= MIN_POINTS_TO_CREDIT
  }

  /**
   * Un crédit d'une personne vers une autre. Le couple est consommé même si le
   * plafond du jour absorbe le gain (voir l'en-tête du fichier).
   */
  private credit(
    creditKey: string,
    target: string | undefined,
    from: string,
    amount: number,
    atS: number,
  ): void {
    if (!target || target === from) return
    if (this.credited.has(creditKey)) return
    this.remember(creditKey)
    this.award(target, amount, atS)
  }

  private awardActiveDay(pubkey: string, atS: number): void {
    const day = dayOf(atS)
    const st = this.state(pubkey)
    // `lastDay` suit l'event le plus récent, pas le dernier arrivé : l'ordre
    // d'arrivée n'a rien de chronologique (même piège que `HotList.lastAt`).
    if (day > st.lastDay) st.lastDay = day
    const key = `d:${short(pubkey)}:${day}`
    if (this.credited.has(key)) return
    this.remember(key)
    st.activeDays++
    this.award(pubkey, WEIGHTS.activeDay, atS)
  }

  /** Attribution effective, sous plafond quotidien. Rend ce qui a été donné. */
  private award(pubkey: string, amount: number, atS: number): number {
    if (amount <= 0) return 0
    const day = dayOf(atS)
    const st = this.state(pubkey)
    const already = st.days.get(day) ?? 0
    const room = DAILY_CAP - already
    if (room <= 0) return 0
    const given = Math.min(amount, room)
    st.days.set(day, already + given)
    st.pts += given
    if (st.days.size > DAYS_KEPT) {
      // Le plafond ne se tient que sur les jours récents : un event très en
      // retard retombe sur une journée oubliée, donc sur un plafond neuf. C'est
      // le prix de la borne mémoire, et il est petit devant la fenêtre de
      // tolérance de la policy (§2.4) qui empêche d'antidater librement.
      const oldest = st.days.keys().next().value
      if (oldest !== undefined) st.days.delete(oldest)
    }
    return given
  }

  private state(pubkey: string): KeyState {
    let st = this.keys.get(pubkey)
    if (!st) {
      st = { pts: 0, days: new Map(), topics: 0, replies: 0, activeDays: 0, lastDay: 0 }
      this.keys.set(pubkey, st)
    }
    return st
  }

  /** Retient l'auteur d'un event. false si l'event était déjà compté. */
  private noteAuthor(eventId: string, pubkey: string): boolean {
    if (this.authors.has(eventId)) return false
    this.authors.set(eventId, pubkey)
    if (this.authors.size > MAX_AUTHORS) {
      const oldest = this.authors.keys().next().value
      if (oldest !== undefined) this.authors.delete(oldest)
    }
    return true
  }

  private remember(creditKey: string): void {
    this.credited.add(creditKey)
    if (this.credited.size > MAX_CREDITS) {
      const oldest = this.credited.values().next().value
      if (oldest !== undefined) this.credited.delete(oldest)
    }
  }

  /* ------------------------------------------------------------ persistance */

  toJSON(): LedgerJson {
    const keys: LedgerJson['keys'] = []
    for (const [pk, st] of this.keys) {
      keys.push([pk, st.pts, st.topics, st.replies, st.activeDays, st.lastDay, [...st.days]])
    }
    return { v: 1, keys, credited: [...this.credited], authors: [...this.authors] }
  }

  /**
   * Relit un état sauvegardé. Tolérant par choix : un fichier tronqué doit
   * dégrader le score, pas empêcher l'indexeur de démarrer — le tick, lui, n'a
   * aucun rapport avec les points et n'a pas à tomber avec eux.
   */
  static fromJSON(raw: unknown): PointsLedger {
    const led = new PointsLedger()
    if (!raw || typeof raw !== 'object') return led
    const data = raw as Partial<LedgerJson>
    if (data.v !== 1) return led
    for (const row of data.keys ?? []) {
      if (!Array.isArray(row)) continue
      const [pk, pts, topics, replies, activeDays, lastDay, days] = row
      if (typeof pk !== 'string' || typeof pts !== 'number') continue
      const st: KeyState = {
        pts,
        days: new Map(),
        topics: typeof topics === 'number' ? topics : 0,
        replies: typeof replies === 'number' ? replies : 0,
        activeDays: typeof activeDays === 'number' ? activeDays : 0,
        lastDay: typeof lastDay === 'number' ? lastDay : 0,
      }
      for (const d of days ?? []) {
        if (Array.isArray(d) && typeof d[0] === 'number' && typeof d[1] === 'number') st.days.set(d[0], d[1])
      }
      led.keys.set(pk, st)
    }
    for (const c of data.credited ?? []) if (typeof c === 'string') led.credited.add(c)
    for (const a of data.authors ?? []) {
      if (Array.isArray(a) && typeof a[0] === 'string' && typeof a[1] === 'string') led.authors.set(a[0], a[1])
    }
    return led
  }
}
