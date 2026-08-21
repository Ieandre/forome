/**
 * Policy d'écriture (spec §12.2).
 *
 * **Le seul endroit du système où on peut refuser un event avant stockage.** Sur
 * Nostr il n'y a pas de suppression (§2.5) : ce qui est accepté est définitif.
 * Donc la policy n'est pas un filtre de confort, c'est la seule barrière.
 *
 * Ce module est **partagé délibérément** entre deux consommateurs :
 *   - le plugin strfry (`./strfry`), qui parle JSON sur stdin/stdout
 *   - le relais de dev (`scripts/dev-relay.ts`), qui l'appelle en process
 *
 * Une seule implémentation, donc : ce qui est testé ici est exactement ce qui
 * tourne en production. Deux copies d'une règle de sécurité finissent toujours
 * par diverger.
 */
import { verifyEvent } from 'nostr-tools/pure'
import { getPow } from 'nostr-tools/nip13'
import type { Event } from 'nostr-tools/core'
import { EDIT_TAG } from './revisions.js'
import { KIND_POLL_VOTE, badPoll, badVote } from './polls.js'

/** Kinds que ce forum accepte. Tout le reste est hors sujet pour ce relais. */
export const KIND_PROFILE = 0
export const KIND_CONTACTS = 3
export const KIND_THREAD = 11
export const KIND_COMMENT = 1111
export const KIND_MUTE_LIST = 10000
export const KIND_RELAY_LIST = 10002
export const KIND_APP_DATA = 30078
export const KIND_GIFT_WRAP = 1059
/** NIP-56 : signalement d'un message ou d'une clé (doc modération §7). */
export const KIND_REPORT = 1984
/**
 * NIP-88 : le vote. Le sondage, lui, n'a pas de kind à lui — il est porté par
 * les tags du topic qu'il accompagne (voir `./polls`).
 */
export { KIND_POLL_VOTE } from './polls.js'
/**
 * NIP-46 : trafic du signeur distant. **Éphémère** (plage 20000–29999) : un
 * relais le diffuse et ne le stocke pas.
 */
export const KIND_NOSTR_CONNECT = 24133

/** true pour les kinds que le relais doit diffuser sans stocker (NIP-01). */
export function isEphemeralKind(kind: number): boolean {
  return kind >= 20000 && kind < 30000
}

/**
 * Le périmètre du forum : `["t", "forome"]` sur tout topic et tout message.
 *
 * ## Pourquoi il existe
 *
 * Un kind 11 est un kind 11 pour tout le monde. Sans marque, souscrire aux
 * topics sur un relais public revient à souscrire aux topics **de la Terre
 * entière** — les fils d'autres clients Nostr arrivaient dans la liste, et c'est
 * le comportement correct d'un filtre qui ne contraint que le kind. Ce tag est
 * ce qui distingue « un forum » d'« une fenêtre sur Nostr ».
 *
 * ## Pourquoi `t` et pas mieux
 *
 * NIP-01 n'indexe que les tags à **une lettre** : un `["community","forome"]`
 * serait invisible au filtrage côté relais, donc trié par le client après avoir
 * quand même tout téléchargé. `t` est le tag de sujet, indexé partout.
 *
 * NIP-72 (`a` vers un kind 34550) serait plus propre — la communauté y est
 * nommée par la clé de son admin, donc sans collision possible. Écarté ici parce
 * que `adminPubkey` est vide par défaut dans le client : le périmètre serait
 * inerte tant que personne n'a épinglé de clé racine, c'est-à-dire aujourd'hui.
 *
 * ## Ce que ce tag ne fait pas
 *
 * **Ce n'est pas un mur, c'est une adresse.** N'importe qui peut poster un kind
 * 11 marqué `forome` sur un relais public, et il apparaîtra. Le mur, c'est le
 * relais : la policy ci-dessous refuse ce qui n'est pas marqué, donc *notre*
 * relais ne stocke que le forum — et lire depuis lui seul rend le périmètre
 * étanche. Le tag borne ce qu'on demande ; le relais borne ce qui existe.
 */
export const COMMUNITY = 'forome'

/**
 * Kinds dont le périmètre est vérifié : le contenu public du forum.
 *
 * Le vote (kind 1018) en fait partie, et ce n'est pas évident : il ne nomme
 * qu'un id de sondage, donc son périmètre se déduirait du bulletin qu'il vise.
 * Sauf que la policy est sans état — elle ne détient pas ce bulletin. Sans la
 * marque, ce relais accepterait donc les votes de tout Nostr pour des sondages
 * qu'il n'a jamais vus, et c'est le trou par lequel un relais de forum
 * redevient un relais généraliste.
 *
 * Contrepartie assumée : un client NIP-88 étranger ne pose pas cette marque,
 * donc son vote sur un de nos sondages n'entre pas chez nous. C'est la limite
 * déjà acceptée pour les réponses d'autres clients (voir `COMMUNITY`) — on lit
 * le forum sur nos relais, et le vote reste sur les siens.
 */
const SCOPED_KINDS = new Set([KIND_THREAD, KIND_COMMENT, KIND_POLL_VOTE])

/** Le tag à poser sur tout topic ou message publié par le forum. */
export function communityTag(community = COMMUNITY): string[] {
  return ['t', community]
}

/**
 * Fragment de filtre NIP-01 à ajouter à toute requête de contenu public.
 *
 * Une fonction et non une constante : le filtre est passé tel quel à
 * `nostr-tools`, qui le tient pour mutable — un objet de module partagé entre
 * toutes les souscriptions du client finirait par se faire modifier par l'une
 * d'elles.
 */
export function communityFilter(community = COMMUNITY): { '#t': string[] } {
  return { '#t': [community] }
}

/** true si l'event porte la marque du forum. */
export function inCommunity(ev: Pick<Event, 'tags'>, community = COMMUNITY): boolean {
  return ev.tags.some((t) => t[0] === 't' && t[1] === community)
}

export interface PolicyConfig {
  /** Kinds acceptés. */
  allowedKinds: number[]
  /** PoW minimale (bits de tête à zéro dans l'id) par kind ; `default` sinon. */
  minPow: Record<number | 'default', number>
  /** Tolérance sur `created_at`, en secondes, dans le futur. */
  maxFutureS: number
  /**
   * Tolérance sur `created_at` dans le passé, par kind ; `default` sinon.
   *
   * Pourquoi par kind et pas globale : **NIP-59 antidate délibérément les
   * emballages de MP** jusqu'à deux jours (`randomNow()` dans `nostr-tools`).
   * Ce n'est pas une négligence, c'est la fonctionnalité : si l'emballage
   * portait l'heure réelle, un relais pourrait corréler les deux copies
   * publiées simultanément (destinataire + soi-même) et en déduire la
   * conversation — ce que le gift wrap est précisément censé masquer.
   *
   * Une fenêtre unique et serrée rejetait donc tous les MP légitimes. Conflit
   * trouvé en testant, pas anticipé.
   */
  maxPastS: Record<number | 'default', number>
  /** Taille max du contenu, en octets UTF-8. */
  maxContentBytes: number
  /** Nombre max de tags. */
  maxTags: number
  /** Débit max par clé publique, sur la fenêtre ci-dessous. */
  ratePerKey: number
  rateWindowS: number
  /**
   * Clés bannies par l'équipe (`docs/moderation-staff.md` §6).
   *
   * **C'est le seul bannissement qui bannit quelque chose.** Le masquage décidé
   * dans le panneau ne vaut que pour notre client : le message reste sur le
   * réseau et un autre client le sert. Ici on refuse *avant* stockage, donc ce
   * relais-là ne le portera jamais — la partie dont l'opérateur répond, et donc
   * la seule qu'il peut tenir.
   *
   * ⚠️ N'agit que sur les écritures futures. Nostr n'a pas de suppression :
   * retirer ce qui est déjà stocké est une opération d'exploitation distincte.
   */
  blocked: ReadonlySet<string>
  /** Topics verrouillés : les réponses ne sont plus acceptées. */
  locked: ReadonlySet<string>
  /**
   * Périmètre exigé sur le contenu public (voir `COMMUNITY`), ou `null` pour
   * accepter tout kind 11 / 1111 — ce que fait un relais Nostr généraliste.
   *
   * C'est ce champ qui fait de ce relais **celui d'un forum** et pas un relais de
   * plus : sans lui il stocke les fils du réseau entier, et le périmètre ne tient
   * plus qu'à la bonne volonté du client qui lit.
   */
  community: string | null
}

export const DEFAULT_POLICY: PolicyConfig = {
  allowedKinds: [
    KIND_PROFILE,
    KIND_CONTACTS,
    KIND_THREAD,
    KIND_COMMENT,
    KIND_MUTE_LIST,
    KIND_RELAY_LIST,
    KIND_APP_DATA,
    KIND_GIFT_WRAP,
    KIND_NOSTR_CONNECT,
    KIND_REPORT,
    KIND_POLL_VOTE,
  ],
  minPow: {
    // Le contenu public est taxé ; le profil et les listes ne le sont pas —
    // un kind 0 par personne, remplaçable, n'offre aucun levier de spam.
    //
    // 14 bits ≈ 16 000 hachages, soit quelques dizaines de millisecondes même
    // sur un mobile lent. C'était 16, ce qui poussait la difficulté calibrée du
    // client au-delà du seuil de perception au pire moment — juste après l'appui
    // sur Entrée. Deux bits de moins, c'est quatre fois moins de travail pour un
    // spammeur : acceptable, parce que la PoW n'a jamais été la barrière
    // principale (§12.1 le dit) et que le débit par clé et le web of trust font
    // le vrai travail. Une lenteur au premier post, elle, coûte des utilisateurs.
    [KIND_THREAD]: 14,
    [KIND_COMMENT]: 14,
    [KIND_GIFT_WRAP]: 14, // MP : le gift wrap masque l'expéditeur, la PoW est
    // la seule barrière possible (§10.2)
    [KIND_PROFILE]: 0,
    [KIND_CONTACTS]: 0,
    [KIND_MUTE_LIST]: 0,
    [KIND_RELAY_LIST]: 0,
    [KIND_APP_DATA]: 0,
    // Aucune PoW sur le trafic du signeur distant : chaque signature demandée
    // coûterait alors deux minages (la requête + l'event), et signer deviendrait
    // insupportable. Le débit par clé suffit à borner l'abus.
    [KIND_NOSTR_CONNECT]: 0,
    // Un signalement est taxé comme le contenu, pas plus : au-delà, on
    // découragerait le geste qu'on veut encourager. En dessous, la file du
    // panneau se noie. Le tri par voix distinctes (doc §7) fait le reste du
    // travail contre le flood.
    [KIND_REPORT]: 14,
    // Un sondage est du contenu public, il est taxé comme tel. Le **vote** aussi,
    // et à la même hauteur, pour deux raisons : c'est l'écriture la plus facile à
    // produire en masse du forum (un tag, aucun texte), et son coût ne se voit
    // pas — l'écran marque le vote au clic et le minage se fait derrière
    // (`stores/polls.ts`). Un plancher plus bas ferait du vote la porte la moins
    // chère pour écrire chez nous, sans rien gagner de perceptible.
    [KIND_POLL_VOTE]: 14,
    default: 16,
  },
  // Fenêtre de tolérance sur l'horodatage (§2.4) : `created_at` est une
  // déclaration de l'auteur, donc mensongère par construction. On ne peut pas
  // la vérifier, seulement la borner.
  maxFutureS: 120,
  maxPastS: {
    // NIP-59 antidate jusqu'à 2 jours + marge d'horloge (voir le type).
    [KIND_GIFT_WRAP]: 2 * 24 * 3600 + 3600,
    default: 3600,
  },
  maxContentBytes: 32 * 1024,
  maxTags: 200,
  ratePerKey: 30,
  rateWindowS: 60,
  // Vides par défaut : un relais qui n'a pas reçu de roster ne modère personne.
  blocked: new Set(),
  locked: new Set(),
  community: COMMUNITY,
}

export type Verdict = { accept: true } | { accept: false; reason: string }

/** Suivi de débit par clé, en mémoire. Borné. */
export class RateTracker {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowS: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** true si la clé dépasse son quota (et enregistre le coup). */
  overLimit(pubkey: string, nowS: number): boolean {
    let arr = this.hits.get(pubkey)
    if (!arr) {
      if (this.hits.size >= this.maxKeys) this.prune(nowS)
      arr = []
      this.hits.set(pubkey, arr)
    }
    const cutoff = nowS - this.windowS
    while (arr.length > 0 && arr[0]! < cutoff) arr.shift()
    if (arr.length >= this.limit) return true
    arr.push(nowS)
    return false
  }

  private prune(nowS: number): void {
    const cutoff = nowS - this.windowS
    for (const [k, arr] of this.hits) {
      if (arr.length === 0 || arr[arr.length - 1]! < cutoff) this.hits.delete(k)
    }
  }
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length
}

/**
 * Réduit un event à ses 7 champs canoniques. Tout le reste — propriétés
 * ajoutées, marqueurs de vérification en cache — est jeté.
 */
function canonical(ev: Event): Event {
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    kind: ev.kind,
    tags: ev.tags,
    content: ev.content,
    sig: ev.sig,
  } as Event
}

/**
 * Racine du fil (NIP-22 : `E` majuscule, ou le vieux style NIP-10 `e` marqué
 * "root"). Dupliqué depuis le client à dessein : ce module ne doit dépendre que
 * de `nostr-tools`, un relais n'a pas à charger le code d'une application.
 */
function rootOf(ev: Event): string | null {
  for (const t of ev.tags) if (t[0] === 'E' && t[1]) return t[1]
  for (const t of ev.tags) if (t[0] === 'e' && t[3] === 'root' && t[1]) return t[1]
  for (const t of ev.tags) if (t[0] === 'e' && t[1]) return t[1]
  return null
}

/**
 * Tag `edit` mal formé (voir `./revisions`).
 *
 * On ne valide que la **forme** : un seul tag, un id de 64 hexa, jamais soi-même.
 * L'autorité — « seul l'auteur révise son message » — ne peut pas être vérifiée
 * ici : la policy est sans état, elle ne détient pas l'event visé et ignore donc
 * qui l'a écrit. C'est le lecteur qui tranche, à la résolution.
 *
 * Le refus est quand même utile : un tag `edit` illisible produirait un event
 * qui n'est ni un message ordinaire ni une révision, et sur Nostr il resterait
 * là pour toujours.
 */
function badEditTag(ev: Event): boolean {
  const tags = ev.tags.filter((t) => t[0] === EDIT_TAG)
  if (tags.length === 0) return false
  if (tags.length > 1) return true
  const target = tags[0]![1] ?? ''
  return !/^[0-9a-f]{64}$/.test(target) || target === ev.id
}

function requiredPow(cfg: PolicyConfig, kind: number): number {
  const perKind = cfg.minPow[kind]
  return perKind !== undefined ? perKind : cfg.minPow.default
}

function maxPastFor(cfg: PolicyConfig, kind: number): number {
  const perKind = cfg.maxPastS[kind]
  return perKind !== undefined ? perKind : cfg.maxPastS.default
}

/**
 * Évalue un event. Ordre des contrôles délibéré : du moins cher au plus cher, et
 * la signature **avant** tout le reste de la sémantique — un event non signé n'a
 * aucune propriété sur laquelle raisonner.
 */
export function evaluate(
  ev: Event,
  opts: { config?: PolicyConfig; nowS?: number; rate?: RateTracker } = {},
): Verdict {
  const cfg = opts.config ?? DEFAULT_POLICY
  const nowS = opts.nowS ?? Math.floor(Date.now() / 1000)

  if (!cfg.allowedKinds.includes(ev.kind)) {
    return { accept: false, reason: `blocked: kind ${ev.kind} non accepté sur ce relais` }
  }

  // Modération avant tout le reste : inutile de mesurer la PoW d'une clé bannie.
  //
  // Contrôlé ici alors que la signature ne l'est qu'à la fin, et c'est sûr :
  // le seul effet d'un `pubkey` non encore vérifié est le refus de l'event qui
  // le revendique. Forger au nom d'un tiers échoue de toute façon à la
  // signature, et personne ne peut faire refuser les events d'autrui.
  if (cfg.blocked.has(ev.pubkey)) {
    return { accept: false, reason: 'blocked: clé bannie de ce relais' }
  }
  // Le périmètre avant les contrôles coûteux : un fil qui n'est pas le nôtre
  // n'a pas à nous faire mesurer une PoW ni vérifier une signature.
  if (cfg.community && SCOPED_KINDS.has(ev.kind) && !inCommunity(ev, cfg.community)) {
    return { accept: false, reason: `blocked: hors périmètre, tag t=${cfg.community} requis` }
  }
  if (cfg.locked.size > 0 && ev.kind === KIND_COMMENT) {
    const root = rootOf(ev)
    if (root && cfg.locked.has(root)) {
      return { accept: false, reason: 'blocked: topic verrouillé' }
    }
  }
  if (ev.tags.length > cfg.maxTags) {
    return { accept: false, reason: `blocked: ${ev.tags.length} tags > ${cfg.maxTags}` }
  }
  if (badEditTag(ev)) {
    return { accept: false, reason: 'invalid: tag edit mal formé' }
  }
  /*
   * Forme des sondages (voir `./polls`). Comme le tag `edit`, on ne refuse ici
   * que ce qui serait **définitivement illisible** : un bulletin sans réponse ou
   * un vote qui ne nomme aucun topic ne peut pas être corrigé après coup, il
   * resterait en tête du fil pour toujours.
   *
   * Le sondage se valide sur le **topic** parce qu'il n'a pas d'event à lui : ce
   * sont des tags du kind 11. `badPoll` rend donc `null` pour les topics qui n'en
   * portent pas, c'est-à-dire presque tous.
   *
   * Ce qui n'est pas vérifiable ici : voter sur un topic verrouillé. Un topic
   * verrouillé ferme son composeur et fait refuser les réponses, mais la policy
   * est sans état — elle ne peut pas savoir si le `e` d'un vote désigne un topic
   * verrouillé sans le détenir.
   */
  if (ev.kind === KIND_THREAD) {
    const why = badPoll(ev)
    if (why) return { accept: false, reason: `invalid: ${why}` }
  }
  if (ev.kind === KIND_POLL_VOTE) {
    const why = badVote(ev)
    if (why) return { accept: false, reason: `invalid: ${why}` }
  }
  const size = utf8Length(ev.content)
  if (size > cfg.maxContentBytes) {
    return { accept: false, reason: `blocked: contenu de ${size} octets > ${cfg.maxContentBytes}` }
  }
  if (ev.created_at > nowS + cfg.maxFutureS) {
    return {
      accept: false,
      reason: `invalid: created_at ${ev.created_at - nowS}s dans le futur > ${cfg.maxFutureS}s`,
    }
  }
  const maxPast = maxPastFor(cfg, ev.kind)
  if (ev.created_at < nowS - maxPast) {
    return {
      accept: false,
      reason: `invalid: created_at ${nowS - ev.created_at}s dans le passé > ${maxPast}s`,
    }
  }

  const need = requiredPow(cfg, ev.kind)
  if (need > 0) {
    const pow = getPow(ev.id)
    if (pow < need) return { accept: false, reason: `pow: ${pow} bits < ${need} requis` }
  }

  // La signature en dernier parce que c'est le contrôle le plus coûteux
  // (Schnorr secp256k1, ordre du milliseconde) : inutile de la payer pour un
  // event qu'on rejette de toute façon.
  //
  // ⚠️ On vérifie une COPIE réduite aux 7 champs canoniques, jamais l'objet reçu.
  // Raison concrète : `nostr-tools` met en cache le résultat de la vérification
  // dans une propriété à clé Symbol de l'event, et `verifyEvent` court-circuite
  // dessus. Or le spread d'objet copie les propriétés Symbol — donc
  // `{...eventVérifié, content: 'autre chose'}` passerait la vérification.
  // Ici c'est une frontière de sécurité : elle ne fait confiance à aucun
  // marqueur venu de l'appelant, seulement aux octets.
  if (!verifyEvent(canonical(ev))) {
    return { accept: false, reason: 'invalid: signature ou id incorrect' }
  }

  if (opts.rate?.overLimit(ev.pubkey, nowS)) {
    return { accept: false, reason: `rate-limited: > ${cfg.ratePerKey} events / ${cfg.rateWindowS}s` }
  }

  return { accept: true }
}
