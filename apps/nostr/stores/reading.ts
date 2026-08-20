/**
 * État de lecture par topic — « du neuf depuis ta dernière visite ».
 *
 * C'est le seul repère qu'un forum offre et qu'un fil de chat n'a pas, et il
 * manquait : la liste ne disposait que du `:visited` du navigateur, qui est
 * définitif. Un topic ouvert une fois y restait « lu » pour toujours, même avec
 * quarante messages de plus.
 *
 * Trois états, et non deux — c'est ce qui rend la liste lisible à froid. Un
 * topic jamais ouvert n'est PAS « non lu » : sinon la première visite mettrait
 * l'écran entier en gras, ce qui ne distingue plus rien. Il est neutre, et seul
 * un topic déjà ouvert peut basculer entre « à jour » et « du neuf ».
 *
 * Pas de clé d'identité dans le stockage, contrairement à `notifications.ts` :
 * les notifications parlent DE ta clé et doivent disparaître avec elle, alors
 * que ce qu'on a lu est un fait du navigateur. Un « new khey » change de
 * pseudonyme, il n'oublie pas ce qu'il a lu.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORE_KEY = 'forome.read.topics'
/** Borne du stockage : au-delà, les lectures les plus vieilles partent. */
const MAX_TRACKED = 400

interface Persisted {
  v: 1
  at: Record<string, number>
}

export const useReadingStore = defineStore('reading', () => {
  /** topicId → date du dernier message qu'on a eu sous les yeux (unix s). */
  const readAt = ref<Record<string, number>>({})

  /* ------------------------------------------------------------- stockage */

  // Chargé dans le corps du store, et non par un `load()` appelé au montage :
  // `markRead` part dès l'ouverture d'un topic, donc avant le montage de la
  // liste quand on arrive par permalien — un chargement différé écraserait
  // l'écriture juste après.
  if (import.meta.client) {
    try {
      const raw = localStorage.getItem(STORE_KEY)
      const data = raw ? (JSON.parse(raw) as Persisted) : null
      if (data?.v === 1 && data.at) {
        readAt.value = Object.fromEntries(
          Object.entries(data.at)
            .map(([id, at]) => [id, Number(at) || 0] as const)
            .filter(([, at]) => at > 0),
        )
      }
    } catch {
      // JSON corrompu : on repart à vide. Le forum a l'air neuf, rien de cassé.
    }
  }

  function save(): void {
    if (!import.meta.client) return
    const data: Persisted = { v: 1, at: readAt.value }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data))
    } catch {
      // Quota plein ou stockage refusé : l'état ne survivra pas au
      // rechargement, et c'est tout. Rien à dire au lecteur.
    }
  }

  function prune(): void {
    const ids = Object.keys(readAt.value)
    if (ids.length <= MAX_TRACKED) return
    const keep = ids
      .sort((a, b) => (readAt.value[b] ?? 0) - (readAt.value[a] ?? 0))
      .slice(0, MAX_TRACKED)
    readAt.value = Object.fromEntries(keep.map((id) => [id, readAt.value[id]!]))
  }

  /* ---------------------------------------------------------------- lecture */

  /**
   * `upTo` est la date du dernier message qu'on a eu sous les yeux, pas
   * l'instant présent : un message qui arrive pendant qu'on lit est affiché en
   * direct par le fil, donc il est lu, et un event daté du futur (horloge de
   * travers ou malice) ne doit pas rester en attente pour autant.
   */
  function markRead(topicId: string, upTo: number): void {
    if (!topicId || upTo <= 0) return
    if ((readAt.value[topicId] ?? 0) >= upTo) return
    readAt.value = { ...readAt.value, [topicId]: upTo }
    prune()
    save()
  }

  /** Déjà ouvert, et il s'est dit quelque chose depuis. */
  function hasFresh(topicId: string, lastAt: number): boolean {
    const seen = readAt.value[topicId]
    return seen !== undefined && lastAt > seen
  }

  /** Déjà ouvert et à jour. Un topic jamais ouvert n'est ni l'un ni l'autre. */
  function isCaughtUp(topicId: string, lastAt: number): boolean {
    const seen = readAt.value[topicId]
    return seen !== undefined && lastAt <= seen
  }

  return { readAt, markRead, hasFresh, isCaughtUp }
})
