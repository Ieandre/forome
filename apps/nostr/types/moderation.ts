/**
 * Modération, côté client (`docs/moderation-staff.md`).
 *
 * Le cœur du modèle — roster, actions, dérivation de l'état — vit dans
 * `@forome/relay-policy/moderation` et **n'est pas dupliqué ici** : le client
 * doit replier exactement ce que le relais refuse. Ce fichier n'ajoute que ce
 * qui n'a de sens qu'à l'écran.
 */
export * from '@forome/relay-policy/moderation'

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
   * Voix distinctes (spec v2 §9.6) — **pas** le nombre de signalements. C'est
   * ce nombre qui trie la file.
   */
  voices: number
}
