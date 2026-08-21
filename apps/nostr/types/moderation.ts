/**
 * Modération, côté client (`docs/moderation-staff.md`).
 *
 * Le cœur du modèle — roster, actions, dérivation de l'état — vit dans
 * `@forome/relay-policy/moderation` et **n'est pas dupliqué ici** : le client
 * doit replier exactement ce que le relais refuse. Ce fichier n'ajoute que ce
 * qui n'a de sens qu'à l'écran.
 */
export * from '@forome/relay-policy/moderation'

// Le `export *` ci-dessus ne met rien dans la portée de ce fichier.
import type { Role } from '@forome/relay-policy/moderation'

/** NIP-56 : signalement. */
export const KIND_REPORT = 1984

/**
 * Motifs proposés au lecteur. Sous-ensemble de NIP-56 — le vocabulaire est
 * délibérément étroit : une liste de quinze motifs ne produit pas des
 * signalements plus précis, elle produit des signalements au hasard.
 *
 * Un motif inconnu reçu d'un autre client est conservé tel quel et affiché brut
 * dans le panneau, jamais réécrit.
 */
export type ReportType = 'spam' | 'illegal' | 'impersonation' | 'other'

export const REPORT_LABELS: Record<ReportType, string> = {
  spam: 'spam ou pub',
  illegal: 'illégal',
  impersonation: 'usurpation',
  other: 'autre',
}

/**
 * Le rôle tel qu'il s'affiche : bouclier plein pour l'admin, en contour pour la
 * modération. La distinction ne se devine pas — c'est pour ça que `body` est
 * obligatoire et que les trois endroits qui montrent un rôle (le fil, la page
 * publique, le panneau) l'enveloppent dans `Explain`.
 *
 * Ici et pas dans un composant : le badge apparaît dans `PostItem`,
 * `pages/moderation.vue` et `pages/admin.vue`, et trois copies des mêmes deux
 * phrases divergeraient à la première correction.
 */
export const ROLE_BADGES: Record<Role, { label: string; admin: boolean; body: string[] }> = {
  admin: {
    label: 'admin',
    admin: true,
    body: [
      'Cette clé administre le forum : elle nomme les modérateurs.',
      'Elle est désignée par le roster signé du forum, pas auto-proclamée.',
    ],
  },
  moderator: {
    label: 'modération',
    admin: false,
    body: [
      'Cette clé fait partie de l’équipe de modération de ce forum.',
      'Ses décisions sont des messages signés, publics et vérifiables.',
    ],
  },
}

/**
 * Les décisions qui passent en icône, et le mot qu'elles gardent au lecteur
 * d'écran. Le journal en fait une colonne de formes : quatre mots français de
 * même longueur et même casse (`masqué`/`banni`/`verrouillé`/`épinglé`) se
 * lisent un par un, quatre formes se trient à l'œil.
 *
 * Seules les décisions en vigueur y figurent — leurs inverses (`show`, `unban`,
 * `unlock`, `unpin`) ne s'affichent jamais en étiquette, ils font disparaître
 * la ligne.
 */
export const ACTION_BADGES: Record<
  'hide' | 'ban' | 'lock' | 'pin',
  { glyph: 'hidden' | 'banned' | 'lock' | 'pin'; label: string; object: string }
> = {
  hide: { glyph: 'hidden', label: 'masqué', object: 'message masqué' },
  ban: { glyph: 'banned', label: 'banni', object: 'compte banni' },
  lock: { glyph: 'lock', label: 'verrouillé', object: 'topic verrouillé' },
  pin: { glyph: 'pin', label: 'épinglé', object: 'topic épinglé' },
}

/** Ce que le lecteur voit à la place d'un message masqué. */
export interface HiddenNotice {
  reason: string
  /** clé du modérateur qui a décidé — le panneau et la page publique la nomment */
  by: string
  /** false pour la catégorie `illegal` : pas de bouton « afficher » (doc §5.2) */
  revealable: boolean
}

/** Un signalement regroupé par cible, tel que la file du panneau le traite. */
export interface ReportGroup {
  /** id d'event, ou clé publique si le signalement vise un compte */
  target: string
  targetKind: 'event' | 'pubkey'
  /** clés ayant signalé, dédoublonnées */
  reporters: Set<string>
  /** motif → nombre de fois invoqué */
  types: Map<string, number>
  /** commentaires libres, non vides */
  notes: string[]
  /** le plus récent des signalements du groupe */
  lastAt: number
  /**
   * Voix distinctes (spec §9.6) — **pas** le nombre de signalements. C'est
   * ce nombre qui trie la file.
   */
  voices: number
}
