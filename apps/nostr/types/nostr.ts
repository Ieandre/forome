/**
 * Les types du client. Un seul objet voyage — l'event NIP-01 (spec §2.1) ;
 * tout le reste est dérivé côté client.
 *
 * ⚠️ Unité de temps : Nostr compte en **secondes** (`created_at`). Toute cette
 * app est en secondes, jamais en millisecondes — mélanger les deux est le bug
 * classique de la couche qui touche au protocole.
 */
import type { Event } from 'nostr-tools/core'
import type { ImageMeta } from '~/utils/media'

export type NostrEvent = Event

/**
 * Format des révisions (spec §2.5), réexporté depuis le code partagé avec le
 * relais et l'indexeur. Comme le modèle de modération : une seule définition de
 * « qu'est-ce qu'une révision », sinon le fil, la liste et le tick pourraient
 * répondre différemment — et un désaccord se traduirait par des compteurs faux
 * sans que rien ne casse visiblement.
 */
export {
  EDIT_TAG,
  editTargetOf,
  isRevision,
  resolveRevisions,
  latestRevision,
} from '@forome/relay-policy/revisions'

/**
 * Périmètre du forum, réexporté depuis le code partagé pour la même raison que
 * les révisions : le client qui *pose* la marque et le relais qui l'*exige*
 * doivent lire la même constante. Deux valeurs qui divergent produiraient un
 * forum où l'on publie sans jamais se voir.
 */
export { COMMUNITY, communityTag, communityFilter, inCommunity } from '@forome/relay-policy'

/** Kinds utilisés (spec §2.3). */
export const KIND_PROFILE = 0
export const KIND_NOTE = 1
export const KIND_CONTACTS = 3
export const KIND_THREAD = 11
export const KIND_COMMENT = 1111
/** NIP-51 : liste de mute, remplaçable. */
export const KIND_MUTE_LIST = 10000
/** NIP-59 : emballage cadeau des MP. L'expéditeur réel est masqué. */
export const KIND_GIFT_WRAP = 1059

/**
 * Ligne de la liste de topics. Vient du tick de l'indexeur quand il y en a un,
 * sinon d'un calcul local : sans indexeur il n'y a pas de tick (spec §5.4), et
 * le client assume alors le coût et la vue partielle.
 */
export interface TopicRow {
  id: string
  title: string
  /** clé publique de l'auteur du topic */
  pubkey: string
  createdAt: number
  /** dernière activité connue (secondes) */
  lastAt: number
  lastPubkey: string
  lastText: string
  /** nombre de réponses vues par ce client */
  replies: number
  /** participants distincts vus */
  people: number
  /** vélocité calculée (§5.3) */
  vel: number
}

/**
 * Un post du fil. `index` est la **numérotation locale** : un numéro de
 * séquence n'a aucun fondement protocolaire sur Nostr (spec §6.4), donc le
 * permalien canonique est l'`nevent`, jamais ce numéro.
 */
export interface Post {
  /**
   * L'id de l'event **d'origine**, même quand une version corrigée est affichée
   * (§2.5). C'est lui que désignent le permalien, l'ancre `#msg-`, la citation
   * d'une réponse, un signalement et une décision de modération : tout ce qui
   * doit continuer à viser « ce message » quand son texte change.
   */
  id: string
  topicId: string
  pubkey: string
  /** Date de l'event d'origine — une correction ne déplace pas le message. */
  createdAt: number
  /** Texte de la version en vigueur. */
  content: string
  /** parent immédiat cité (tag `e` minuscule, NIP-22) */
  replyTo: string | null
  /** true si c'est l'event racine du topic (kind 11) */
  root: boolean
  index: number
  /**
   * Métadonnées des images du message (tags `imeta`, NIP-92), indexées par URL.
   * Sert à réserver leur place avant chargement — un fil qui défile en direct ne
   * doit pas sauter quand une image arrive.
   */
  imeta?: Record<string, ImageMeta>
  /**
   * Date de la version affichée, quand ce n'est pas l'originale. C'est ce qui
   * fait apparaître le marqueur « modifié » — absent le reste du temps, donc
   * aucune allocation pour l'immense majorité des messages.
   */
  editedAt?: number
  /**
   * Les versions successives, l'originale d'abord. Présent seulement s'il y en a
   * plus d'une.
   *
   * Ce ne sont pas des lignes d'un historique reconstitué : ce sont les events
   * eux-mêmes, chacun signé et vérifiable séparément. C'est ce que l'encart
   * d'historique montre, et c'est ce qui rend la correction publique plutôt que
   * déclarative — sur Nostr l'ancienne version ne peut pas être retirée.
   */
  versions?: NostrEvent[]
}

/**
 * Le message cité par une réponse, **résolu** pour l'affichage.
 *
 * `Post.replyTo` seul est un id d'event : le montrer tel quel est un code de
 * chat (la référence de réponse Discord), et il n'apprend rien — on ne voit pas
 * à quoi l'auteur répond. Un forum cite, donc on résout l'id en auteur + texte +
 * numéro local avant de rendre.
 *
 * Les champs sont nullables séparément, et chaque cas est réel sur un réseau
 * décentralisé :
 *   - `pubkey`/`content` à null : l'event parent n'est sur aucun de nos relais
 *   - `index` à null : le parent est chargé mais sorti du cap DOM, donc il n'a
 *     pas de numéro affiché vers lequel sauter
 */
export interface QuotedPost {
  id: string
  pubkey: string | null
  content: string | null
  index: number | null
  /**
   * Le message cité a été corrigé depuis (§2.5).
   *
   * La citation montre la **dernière** version, et le dit. Un forum classique
   * fige le texte au moment de citer ; ici rien n'est stocké, donc figer
   * demanderait de garder une copie — et surtout ce serait mentir dans l'autre
   * sens, en affirmant que l'auteur a écrit ce qu'il n'écrit plus. Montrer la
   * version en vigueur en la signalant est la seule position tenable : le
   * lecteur voit le texte actuel, sait qu'il a bougé, et l'historique est à un
   * clic sur le message d'origine.
   */
  edited: boolean
}

/**
 * Profil kind 0, réduit à ce qu'on affiche.
 *
 * ⚠️ Ce n'est PAS le contenu complet de l'event : un kind 0 peut porter
 * n'importe quelle clé (`lud16`, `banner`, champs propres à un autre client).
 * Republier depuis cette structure les effacerait — le contenu brut est donc
 * conservé à côté dans le store (`rawOf`), et toute écriture passe par
 * `publishPatch`, qui fusionne. Même piège que les listes remplaçables du
 * store social, et même règle.
 */
export interface Profile {
  name: string | null
  picture: string | null
  nip05: string | null
  about: string | null
  website: string | null
  /**
   * Signature de forum : le pied de message, pas la signature schnorr de
   * l'event (`sig`). Aucun NIP ne la définit, d'où la clé namespacée
   * `forome_signature` dans le kind 0 — un `signature` nu se ferait
   * légitimement lire comme un champ cryptographique par un autre client.
   */
  signature: string | null
}

/**
 * Ce qu'il y a à signaler sur **ses propres** messages, et rien d'autre : reçu
 * d'un relais, un message est publié par définition.
 *
 * Le message et sa correction ont des états distincts parce que l'échec ne dit
 * pas la même chose. « non publié » signifie que le message n'est nulle part ;
 * « correction non publiée » signifie que le message est bien là, mais que tout
 * le monde lit encore la version d'avant. Les confondre ferait dire au marqueur
 * qu'un message publié ne l'est pas.
 */
export type OwnState = 'pending' | 'failed' | 'edit-pending' | 'edit-failed'

/**
 * Source d'events. `threads` est le modèle réel de la v2 ; `firehose` existe
 * uniquement pour valider le fil à haut débit (tampon, ambiance, cap DOM) —
 * les kind 11 publics sont trop rares pour stresser quoi que ce soit.
 */
export type SourceMode = 'threads' | 'firehose'

export const FIREHOSE_TOPIC_ID = 'firehose'

/** NIP-78 : données applicatives, adressables par un tag `d`. */
export const KIND_APP_DATA = 30078
export const TICK_D_TAG = 'forome.tick'

/**
 * Le tick publié par l'indexeur (spec §5.2) — un instantané calculé une fois,
 * signé, et reçu identique par tous les clients.
 *
 * Le client ne fait **jamais** confiance aveuglément : la signature dit qui l'a
 * produit, et l'ordre proposé n'est qu'un ordre d'affichage. Les messages
 * eux-mêmes restent vérifiables sans l'indexeur.
 */
export interface TickPayload {
  v: 1
  at: number
  topics: {
    id: string
    title: string
    pubkey: string
    lastAt: number
    lastPubkey: string
    lastText: string
    replies: number
    vel: number
    ppl: number
  }[]
  /** topics où un raid probable est en cours (§9.5) */
  flagged?: string[]
}

/** D'où vient le classement affiché. */
export type RankingSource = 'indexer' | 'local'
