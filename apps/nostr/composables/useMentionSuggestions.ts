/**
 * Qui proposer quand on tape `@…` dans un composeur.
 *
 * ## L'ordre est la fonctionnalité
 *
 * Les gens **du fil ouvert** d'abord, les suivis ensuite. Mentionner sert
 * d'abord à s'adresser à quelqu'un dans la conversation en cours : c'est le
 * premier de la liste qu'Entrée insère, donc l'ordre décide de la justesse du
 * geste plus que le filtrage lui-même.
 *
 * ## Aucune requête réseau pendant la frappe
 *
 * Les pseudos sont lus dans le cache des profils **sans le remplir** — une
 * résolution par `displayName()` déclencherait une requête kind 0 par candidat,
 * à chaque caractère tapé. La lecture des profils manquants est faite une fois,
 * à l'ouverture du menu, et le store la groupe (voir `stores/profiles.ts`).
 * Tant qu'ils n'arrivent pas, le handle `khey_` suffit à choisir : il contient
 * le début de la clé, donc il est déjà une identité (§3.1).
 */
import { computed, watch, type Ref } from 'vue'
import { rankMentions, type MentionCandidate } from '~/utils/mentions'
import { kheyHandle, keyDiscriminator } from '~/utils/nostr'

/** Candidats affichés au plus. Six tiennent à l'écran sans défilement. */
const SHOWN = 6

/**
 * Profils lus à l'ouverture du menu. Borné : une liste de suivis peut être
 * longue, et personne ne fait défiler un menu de complétion jusqu'au 200ᵉ.
 */
const RESOLVE = 40

export function useMentionSuggestions(
  query: Ref<string | null>,
  people: () => string[] = () => [],
) {
  const profiles = useProfileStore()
  const social = useSocialStore()
  const identity = useIdentityStore()

  /** Le vivier, dans l'ordre de pertinence, sans doublon. */
  function pool(): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (k: string): void => {
      // Soi-même : se mentionner n'a pas de sens, et ça se notifierait.
      // Quelqu'un qu'on a mis en sourdine : on ne le propose pas à la frappe.
      if (!k || seen.has(k) || k === identity.pubkey || social.isMuted(k)) return
      seen.add(k)
      out.push(k)
    }
    for (const k of people()) add(k)
    for (const k of social.follows) add(k)
    return out
  }

  function toCandidate(pubkey: string): MentionCandidate {
    const name = profiles.cache.get(pubkey)?.name ?? null
    return {
      pubkey,
      name: name ?? kheyHandle(pubkey),
      // Pseudo déclaré, donc usurpable : jamais sans son discriminant (§3.5).
      disc: name ? keyDiscriminator(pubkey) : null,
    }
  }

  watch(query, (q, prev) => {
    if (q === null || prev !== null) return
    for (const k of pool().slice(0, RESOLVE)) profiles.want(k)
  })

  return computed<MentionCandidate[]>(() => {
    const q = query.value
    if (q === null) return []
    return rankMentions(q, pool().map(toCandidate), SHOWN)
  })
}
