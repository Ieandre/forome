/**
 * Barème des points et courbe des niveaux (spec §16).
 *
 * ## Pourquoi ce module est partagé, et ce qu'il ne contient pas
 *
 * Deux programmes touchent aux points, et ils n'en font pas la même chose :
 * l'indexeur **compte** (il est le seul à voir tout le trafic, cf. §5.4), le
 * client **affiche**. Le barème est ce qu'ils doivent lire identique — sinon un
 * lecteur voit « niveau 8 » là où l'auteur en voit 7, et ni l'un ni l'autre ne
 * peut savoir qui a tort.
 *
 * La séparation retenue, et elle est délibérée : **l'indexeur ne publie qu'un
 * nombre de points ; le niveau est dérivé chez le lecteur.** Le tick fait déjà
 * ça (§5.2 : « le personnel se superpose côté client »). Le bénéfice est
 * concret — retoucher la courbe des niveaux ne demande pas de redéployer
 * l'indexeur, ni de recompter quoi que ce soit, et la clé de l'indexeur gagne
 * le pouvoir de compter mais pas celui de décider des paliers.
 *
 * ## Ce que les points récompensent
 *
 * Deux blocs volontairement déséquilibrés : ce qu'on **fait** est le plancher,
 * ce qu'on **provoque** est le score. Répondre deux cents fois dans la journée
 * rapporte moins qu'ouvrir un fil où douze personnes viennent parler. C'est le
 * seul moyen d'avoir un système qui récompense la contribution sans récompenser
 * le volume — et un système qui récompense le volume travaillerait contre le
 * tri par vélocité (§5.3) et contre la détection de raid (§9.5), qui existent
 * précisément pour que le débit ne soit pas une monnaie.
 *
 * Le forum n'a aucun signal de qualité à convertir : la policy n'autorise pas le
 * kind 7, donc il n'y a ni « j'aime » ni vote positif (§14). La réception se lit
 * dans les réponses reçues et dans les gens qu'un topic rassemble, ce qui est
 * plus coûteux à truquer qu'un bouton.
 *
 * ## Ce que les points ne débloquent pas
 *
 * Rien, et c'est une décision. Les points sont *ce que l'indexeur a vu* : une
 * nuit où il est tombé n'a jamais eu lieu. Mettre un droit d'écriture derrière
 * un nombre indémontrable, ce serait refuser un message pour une raison qu'on
 * ne peut pas opposer au lecteur — et ça mettrait l'indexeur sur le chemin
 * critique de l'écriture, alors qu'aujourd'hui le forum fonctionne sans lui
 * (classement recalculé localement). Filtrer reste le travail de la PoW, de la
 * policy et du web of trust (§12) ; les points rendent la contribution visible,
 * ce qui est une fonction culturelle. Les mélanger abîmerait les deux.
 */

/** Ce que rapporte chaque geste. Le détail du comptage est dans `./ledger`. */
export const WEIGHTS = {
  /** Ouvrir un topic — plus cher qu'une réponse : c'est l'acte qui crée le lieu. */
  topic: 5,
  /** Une réponse. Volontairement minuscule : c'est un plancher, pas un revenu. */
  reply: 1,
  /** Bonus du jour où l'on a posté, une fois par jour. */
  activeDay: 2,
  /** Une personne DISTINCTE répond à ton message (une fois par personne et par message). */
  replyReceived: 2,
  /** Une personne DISTINCTE vient parler dans ton topic (une fois par personne et par topic). */
  topicParticipant: 3,
  /** Ton topic est entré dans les topics chauds (une fois par topic). */
  hotTopic: 10,
  /** Quelqu'un vote à ton sondage (une fois par personne et par sondage). */
  pollVote: 1,
} as const

/**
 * Plafond de points gagnables en une journée.
 *
 * C'est la pièce anti-ferme du système, et elle fait bien plus que borner : elle
 * **transforme le niveau en durée minimale**. Aucune activité, aucun budget de
 * CPU et aucune collusion ne va plus vite que 40 points par jour, donc le
 * niveau 20 (4 750 points) réclame au moins 119 jours *quoi qu'on fasse*. C'est
 * ce qui rend un niveau élevé lisible : il ne s'achète pas en une nuit.
 *
 * Conséquence assumée : une journée exceptionnelle (un topic qui explose) tape
 * le plafond comme une journée de farming. On préfère perdre le surplus du bon
 * jour que rendre le mauvais jour rentable.
 */
export const DAILY_CAP = 40

/**
 * Points qu'il faut avoir pour que ses propres réponses créditent quelqu'un.
 *
 * Sans ce seuil, cinquante clés neuves fabriquent de la valeur à la demande : on
 * en génère autant qu'on veut, elles répondent à la clé qu'on veut promouvoir,
 * et le score suit. Avec lui, créditer demande d'avoir soi-même gagné des
 * points — donc d'avoir posté sous le plafond quotidien, donc du temps réel.
 *
 * Le système s'amorce quand même : poster rapporte (`topic`, `reply`,
 * `activeDay`), donc une clé franchit ce seuil en quelques messages sans avoir
 * besoin que personne l'ait créditée. À forum vide, personne ne crédite
 * personne pendant les premiers messages, puis tout se débloque.
 */
export const MIN_POINTS_TO_CREDIT = 10

/**
 * Pas de la courbe : passer du niveau `n` au niveau `n+1` coûte `25 × n`.
 *
 * Donc les niveaux sont **infinis** et se paient de plus en plus cher, sans
 * jamais devenir inatteignables. Une courbe linéaire ferait arriver le niveau 40
 * en trois mois et le rendrait muet ; une exponentielle bloquerait tout le monde
 * au même palier. L'incrément arithmétique se dit aussi en une phrase — « le
 * niveau 5 coûte 100 points de plus que le niveau 4 » — ce qui rend une barre
 * de progression explicable au lecteur.
 */
export const LEVEL_STEP = 25

/** Le niveau à partir duquel on l'affiche — voir `LEVEL_SHOWN_FROM`. */
export const LEVEL_SHOWN_FROM = 2

/**
 * Points cumulés qu'il faut pour atteindre `level`. Le niveau 1 est gratuit.
 *
 * `level × (level - 1)` est toujours pair, donc le résultat est entier : les
 * seuils sont des nombres ronds, pas des flottants qu'on comparerait de travers.
 */
export function pointsForLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 1) return 0
  const n = Math.floor(level)
  return (LEVEL_STEP * n * (n - 1)) / 2
}

/**
 * Le niveau que valent ces points.
 *
 * Inversion du trinôme, puis **correction par comparaison entière** : `sqrt`
 * peut rendre 4,999999 pour un seuil atteint exactement, et un lecteur bloqué à
 * 74 points sur un seuil de 75 pendant qu'un autre passe est le genre de bug
 * qu'on ne reproduit jamais.
 */
export function levelOf(points: number): number {
  if (!Number.isFinite(points) || points < LEVEL_STEP) return 1
  const p = Math.floor(points)
  let n = Math.floor((1 + Math.sqrt(1 + (8 * p) / LEVEL_STEP)) / 2)
  if (n < 1) n = 1
  while (n > 1 && pointsForLevel(n) > p) n--
  while (pointsForLevel(n + 1) <= p) n++
  return n
}

export interface LevelProgress {
  points: number
  level: number
  /** Points acquis dans le niveau courant. */
  into: number
  /** Largeur du niveau courant, en points. */
  span: number
  /** Points restants avant le niveau suivant. */
  toNext: number
  /** Seuil du niveau suivant, en points cumulés. */
  nextAt: number
}

/** Tout ce qu'il faut pour dessiner une barre de progression et l'expliquer. */
export function levelProgress(points: number): LevelProgress {
  const p = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0
  const level = levelOf(p)
  const floor = pointsForLevel(level)
  const nextAt = pointsForLevel(level + 1)
  return {
    points: p,
    level,
    into: p - floor,
    span: nextAt - floor,
    toNext: nextAt - p,
    nextAt,
  }
}

/**
 * Nombre minimal de jours pour atteindre ce niveau, plafond quotidien compris.
 *
 * Sert à l'explication affichée : « le niveau 12 demande au moins 41 jours » dit
 * mieux ce que vaut un niveau que le nombre de points qui le paie.
 */
export function minDaysForLevel(level: number): number {
  return Math.ceil(pointsForLevel(level) / DAILY_CAP)
}
