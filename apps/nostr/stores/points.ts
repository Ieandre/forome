/**
 * Les points et les niveaux, tels que le client les lit (spec §16).
 *
 * ## Pourquoi rien n'est calculé ici
 *
 * Compter des points demande de voir **tout** le trafic : qui répond à qui,
 * combien de personnes distinctes sont venues dans un topic, quel jour. Un
 * client ne voit que ce qui est passé devant lui depuis qu'il est ouvert. S'il
 * calculait, deux lecteurs afficheraient deux scores différents pour la même
 * personne, et aucun des deux ne pourrait savoir lequel est faux — c'est
 * exactement le piège du §5.4, appliqué à un nombre cumulatif au lieu d'un
 * classement.
 *
 * Donc l'indexeur compte et publie (seize events remplaçables, voir
 * `@forome/points/payload`), et ce store **lit**. La seule chose calculée ici est
 * le **niveau**, dérivé des points par le barème partagé : ça évite de
 * transporter une valeur qui se recalcule, et ça laisse la courbe retouchable
 * sans recompter quoi que ce soit.
 *
 * ## Sans clé d'indexeur épinglée, il n'y a pas de points
 *
 * Même règle que le tick (invariant 4) et même raison : accepter le score du
 * premier venu donnerait à un inconnu le pouvoir de décider qui est ancien ici.
 * Mais le repli n'est pas le même — un classement, le client sait le recalculer
 * localement ; un score, non (voir plus haut). Donc pas de score du tout, et
 * l'interface n'affiche simplement rien. C'est aussi ce qui rend acceptable que
 * les points ne débloquent aucun droit.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { levelOf as levelForPoints, levelProgress } from '@forome/points'
import { decodeShard, pointsShardTags } from '@forome/points/payload'
import type { PointsEntry } from '@forome/points/payload'
import { KIND_APP_DATA } from '~/types/nostr'
import { tagValue } from '~/utils/nostr'
import type { NostrEvent } from '~/types/nostr'
import { useRelayStore } from '~/stores/relays'
import { useTopicStore } from '~/stores/topics'

export interface RankedEntry extends PointsEntry {
  /** Rang dans le classement, 1 en tête. Les ex æquo partagent leur rang. */
  rank: number
  level: number
}

export const useUserPointsStore = defineStore('points', () => {
  const relayStore = useRelayStore()
  const topics = useTopicStore()

  /**
   * Un morceau par tag `d`, gardé tel qu'il est arrivé.
   *
   * Stocker les morceaux plutôt que les clés fusionnées n'est pas un détail : un
   * morceau est un **remplacement complet** de sa tranche du classement. Fusionner
   * clé par clé laisserait éternellement en place quelqu'un que l'indexeur a
   * cessé de publier.
   */
  const shards = shallowRef(new Map<string, { at: number; entries: PointsEntry[] }>())
  const rev = ref(0)
  const subs: { close: () => void }[] = []

  /** Date du morceau le plus récent — « à jour il y a … » sur la page de classement. */
  const updatedAt = computed(() => {
    void rev.value
    let max = 0
    for (const s of shards.value.values()) if (s.at > max) max = s.at
    return max
  })

  const byKey = computed(() => {
    void rev.value
    const out = new Map<string, PointsEntry>()
    for (const s of shards.value.values()) for (const e of s.entries) out.set(e.pubkey, e)
    return out
  })

  /**
   * true quand on a de quoi afficher quelque chose. L'interface s'y accroche
   * plutôt qu'à `points === 0` : « personne n'a de score » et « le score n'est
   * pas branché » ne se ressemblent pas, et un « niveau 1 » affiché faute
   * d'indexeur serait un mensonge tranquille.
   */
  const available = computed(() => Boolean(topics.indexerPubkey) && byKey.value.size > 0)

  /** Le classement complet, rangs calculés. Les ex æquo partagent leur rang. */
  const ranking = computed<RankedEntry[]>(() => {
    const rows = [...byKey.value.values()].sort(
      // Départage stable : à score égal, l'activité réelle passe devant, et la
      // clé tranche en dernier — sinon deux lecteurs verraient deux ordres.
      (a, b) =>
        b.points - a.points ||
        b.activeDays - a.activeDays ||
        b.topics - a.topics ||
        a.pubkey.localeCompare(b.pubkey),
    )
    const out: RankedEntry[] = []
    let rank = 0
    let last = -1
    rows.forEach((e, i) => {
      if (e.points !== last) {
        rank = i + 1
        last = e.points
      }
      out.push({ ...e, rank, level: levelForPoints(e.points) })
    })
    return out
  })

  function entryOf(pubkey: string): PointsEntry | null {
    return byKey.value.get(pubkey) ?? null
  }

  function pointsOf(pubkey: string): number {
    return byKey.value.get(pubkey)?.points ?? 0
  }

  /** `null` quand on ne sait pas — jamais 1 par défaut (voir `available`). */
  function levelOf(pubkey: string): number | null {
    if (!available.value) return null
    return levelForPoints(pointsOf(pubkey))
  }

  function progressOf(pubkey: string) {
    return levelProgress(pointsOf(pubkey))
  }

  function rankOf(pubkey: string): number | null {
    return ranking.value.find((r) => r.pubkey === pubkey)?.rank ?? null
  }

  function ingest(ev: NostrEvent): void {
    const d = tagValue(ev, 'd')
    if (!d) return
    const known = shards.value.get(d)
    // Un morceau plus ancien que celui qu'on a : les relais renvoient les
    // versions précédentes d'un event remplaçable, et l'accepter ferait
    // clignoter le classement entre deux états.
    if (known && ev.created_at <= known.at) return
    const decoded = decodeShard(ev.content)
    if (!decoded) return
    shards.value.set(d, { at: ev.created_at, entries: decoded.entries })
    rev.value++
  }

  function start(): void {
    if (subs.length > 0) return
    const author = topics.indexerPubkey
    if (!author) return
    subs.push(
      relayStore.subscribe(
        { kinds: [KIND_APP_DATA], authors: [author], '#d': pointsShardTags() },
        { onevent: ingest },
        'points',
      ),
    )
  }

  function stop(): void {
    for (const s of subs.splice(0)) s.close()
  }

  return {
    updatedAt,
    available,
    ranking,
    entryOf,
    pointsOf,
    levelOf,
    progressOf,
    rankOf,
    start,
    stop,
  }
})
