/**
 * Résolution des profils kind 0 (spec §11.1), avec cache et regroupement.
 *
 * Règle produit : **un pseudo absent n'est pas un problème.** Le défaut
 * `khey_xxxxxxxx` est déjà une identité (§3.1), donc l'affichage ne dépend
 * jamais de l'arrivée d'un kind 0 — le profil enrichit, il ne débloque rien.
 *
 * Et comme le nom n'est pas unique sur Nostr (§3.5), `displayName` ne renvoie
 * jamais un pseudo choisi sans son discriminant de clé.
 */
import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { isValid as nip05IsValid, isNip05 } from 'nostr-tools/nip05'
import { KIND_PROFILE, type Profile } from '~/types/nostr'
import { kheyHandle, keyDiscriminator } from '~/utils/nostr'

/**
 * État de vérification NIP-05. `unreachable` est distinct de `invalid` : un
 * domaine qui ne répond pas (ou qui n'autorise pas CORS) ne prouve rien, ni
 * dans un sens ni dans l'autre. Les confondre afficherait une accusation.
 */
export type Nip05Status = 'pending' | 'valid' | 'invalid' | 'unreachable'

const BATCH_DELAY_MS = 250
const MAX_AUTHORS_PER_QUERY = 200

/** Le kind 0 tel qu'il a été signé, avant toute réduction à `Profile`. */
export interface RawProfile {
  content: string
  createdAt: number
}

export const useProfileStore = defineStore('profiles', () => {
  const relayStore = useRelayStore()

  /**
   * `reactive(Map)` et non `ref(Map)` recopié à chaque écriture, parce que Vue
   * y suit chaque clé séparément : l'arrivée du profil d'UN auteur n'invalide
   * que les rangées qui l'affichent. L'ancien schéma remplaçait la Map entière,
   * donc chaque lot de profils (toutes les 250 ms pendant le chargement d'un
   * fil) re-rendait TOUS les messages et TOUTES les rangées de la liste.
   */
  const cache = reactive(new Map<string, Profile>())
  /** Contenu brut du kind 0, gardé pour pouvoir republier sans rien perdre. */
  const raw = reactive(new Map<string, RawProfile>())
  const nip05 = reactive(new Map<string, Nip05Status>())
  const wanted = new Set<string>()
  const requested = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function want(pubkey: string): void {
    if (!pubkey || requested.has(pubkey) || cache.has(pubkey)) return
    wanted.add(pubkey)
    if (timer) return
    timer = setTimeout(flush, BATCH_DELAY_MS)
  }

  async function flush(): Promise<void> {
    timer = null
    const authors = [...wanted].slice(0, MAX_AUTHORS_PER_QUERY)
    if (authors.length === 0) return
    for (const a of authors) {
      wanted.delete(a)
      requested.add(a)
    }
    try {
      const events = await relayStore.query({ kinds: [KIND_PROFILE], authors })
      // kind 0 est remplaçable : garder le plus récent par auteur.
      const newest = new Map<string, { at: number; profile: Profile; content: string }>()
      for (const ev of events) {
        const prev = newest.get(ev.pubkey)
        if (prev && prev.at >= ev.created_at) continue
        newest.set(ev.pubkey, { at: ev.created_at, profile: parse(ev.content), content: ev.content })
      }
      for (const [pubkey, { profile, content, at }] of newest) {
        cache.set(pubkey, profile)
        raw.set(pubkey, { content, createdAt: at })
      }
      for (const [pubkey, { profile }] of newest) {
        if (profile.nip05) void verifyNip05(pubkey, profile.nip05)
      }
    } catch {
      // pas grave : le handle par défaut suffit à afficher le fil
    }
    if (wanted.size > 0 && !timer) timer = setTimeout(flush, BATCH_DELAY_MS)
  }

  const EMPTY: Profile = {
    name: null,
    picture: null,
    nip05: null,
    about: null,
    website: null,
    signature: null,
  }

  function str(v: unknown, max: number): string | null {
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
  }

  function parse(content: string): Profile {
    try {
      const j = JSON.parse(content) as Record<string, unknown>
      const name = str(j.name, 40)
      const display = str(j.display_name, 40)
      return {
        name: display ?? name,
        picture: str(j.picture, 500),
        nip05: str(j.nip05, 200),
        // Borné à 1000 : `about` est du texte libre venu d'un relais tiers, et
        // rien n'oblige un autre client à l'avoir limité.
        about: str(j.about, 1000),
        website: str(j.website, 300),
        // 150 : la signature se répète sur chaque message d'un fil, donc sa
        // borne est un choix de mise en page, pas une précaution de parseur.
        signature: str(j.forome_signature, 150),
      }
    } catch {
      return { ...EMPTY }
    }
  }

  /**
   * Applique un kind 0 qu'on a sous la main, sans aller-retour réseau.
   *
   * Sert après avoir publié son propre profil : `want()` ignore une clé déjà
   * demandée, donc le pseudo qu'on venait de choisir ne s'affichait pas — il
   * fallait recharger la page. On vient de signer l'event, on connaît donc la
   * réponse : autant l'appliquer.
   */
  function ingest(ev: { pubkey: string; content: string; created_at: number }): void {
    const profile = parse(ev.content)
    cache.set(ev.pubkey, profile)
    raw.set(ev.pubkey, { content: ev.content, createdAt: ev.created_at })
    requested.add(ev.pubkey)
    if (profile.nip05) {
      // le nom a changé : la vérification précédente ne vaut plus
      nip05.delete(ev.pubkey)
      void verifyNip05(ev.pubkey, profile.nip05)
    }
  }

  /**
   * Vérification NIP-05 réelle (spec §3.5) : requête
   * `https://<domaine>/.well-known/nostr.json?name=<nom>` et comparaison à la
   * clé publique. C'est la seule unicité de pseudo disponible sur Nostr, et son
   * prix est que le domaine redevient autorité de nommage.
   *
   * Le résultat n'est **jamais** présenté comme une garantie d'identité : il dit
   * seulement « ce domaine reconnaît cette clé sous ce nom ».
   */
  async function verifyNip05(pubkey: string, address: string): Promise<void> {
    if (nip05.has(pubkey)) return
    if (!isNip05(address)) {
      setNip05(pubkey, 'invalid')
      return
    }
    setNip05(pubkey, 'pending')
    try {
      const ok = await nip05IsValid(pubkey, address)
      setNip05(pubkey, ok ? 'valid' : 'invalid')
    } catch {
      // Domaine injoignable, ou CORS refusé : ça ne prouve rien. Ne pas
      // confondre avec une usurpation.
      setNip05(pubkey, 'unreachable')
    }
  }

  function setNip05(pubkey: string, status: Nip05Status): void {
    nip05.set(pubkey, status)
  }

  function nip05StatusOf(pubkey: string): Nip05Status | null {
    return nip05.get(pubkey) ?? null
  }

  /** Pseudo affiché : celui du kind 0 s'il existe, sinon le défaut khey_. */
  function displayName(pubkey: string): string {
    want(pubkey)
    return cache.get(pubkey)?.name ?? kheyHandle(pubkey)
  }

  /**
   * true si le pseudo affiché vient d'un kind 0 (donc usurpable, donc à
   * accompagner du discriminant — §3.5). false pour un défaut khey_, qui
   * contient déjà la clé.
   */
  function isClaimedName(pubkey: string): boolean {
    return !!cache.get(pubkey)?.name
  }

  function discriminator(pubkey: string): string {
    return keyDiscriminator(pubkey)
  }

  function get(pubkey: string): Profile | null {
    want(pubkey)
    return cache.get(pubkey) ?? null
  }

  function rawOf(pubkey: string): RawProfile | null {
    return raw.get(pubkey) ?? null
  }

  /* -------------------------------------------------- lecture d'un profil */

  /**
   * Va chercher UN kind 0 et attend la réponse.
   *
   * `want()` ne convient pas ici : il est groupé, différé de 250 ms, et il
   * ignore une clé déjà demandée — trois propriétés faites pour peupler un fil,
   * et trois problèmes pour une page de profil, qui doit pouvoir dire « ce
   * profil n'existe pas » plutôt que rester vide indéfiniment.
   *
   * Les trois issues sont distinctes et le sont jusqu'à l'écran : `none` (la
   * clé n'a jamais publié de kind 0) est un état normal — le handle `khey_`
   * suffit à exister (§3.1) — alors que `error` veut dire qu'on ne sait pas.
   */
  async function fetchOne(pubkey: string): Promise<'ok' | 'none' | 'error'> {
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return 'error'
    try {
      const events = await relayStore.query({ kinds: [KIND_PROFILE], authors: [pubkey] })
      let newest: { content: string; created_at: number } | null = null
      for (const ev of events) {
        if (!newest || ev.created_at > newest.created_at) newest = ev
      }
      requested.add(pubkey)
      if (!newest) return 'none'
      ingest({ pubkey, content: newest.content, created_at: newest.created_at })
      return 'ok'
    } catch {
      return 'error'
    }
  }

  /* ------------------------------------------------------- écriture (§11.1) */

  /**
   * Modifie son propre profil.
   *
   * **kind 0 est remplaçable, donc republier écrase tout.** Un formulaire qui
   * n'envoie que les champs qu'il affiche efface donc silencieusement ceux
   * qu'il ignore — `lud16`, `banner`, ou n'importe quelle clé posée par un
   * autre client. C'est exactement le piège documenté pour les kind 3 dans le
   * store social, et il se termine ici de la même façon : **on relit avant
   * d'écrire, et on refuse d'écrire si la relecture a échoué.**
   *
   * Perdre une modification est un désagrément ; effacer la moitié du profil de
   * quelqu'un sans qu'il l'ait demandé n'est pas rattrapable — le kind 0
   * précédent n'est plus servi par les relais qui l'ont remplacé.
   *
   * Une valeur vide ou `null` dans `patch` **retire** la clé : c'est le seul
   * moyen d'effacer un champ, et c'est un geste explicite de l'utilisateur.
   */
  async function publishPatch(
    patch: Record<string, string | null>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const identity = useIdentityStore()
    const me = identity.pubkey
    if (!me) return { ok: false, error: 'aucune identité' }

    const status = await fetchOne(me)
    if (status === 'error') {
      return {
        ok: false,
        error: 'profil actuel illisible sur les relais — publication refusée pour ne pas l’écraser',
      }
    }

    let base: Record<string, unknown> = {}
    const current = raw.get(me)
    if (current) {
      try {
        const parsed = JSON.parse(current.content) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          base = parsed as Record<string, unknown>
        }
      } catch {
        // kind 0 illisible (JSON cassé) : le remplacer est une amélioration,
        // pas une perte — il n'y avait rien d'exploitable à préserver.
      }
    }

    const next: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(patch)) {
      const trimmed = value?.trim() ?? ''
      if (trimmed) next[key] = trimmed
      else delete next[key]
    }

    const publisher = usePublisher()
    const outcome = await publisher.publishProfile(next)
    if (!outcome || outcome.result.accepted.length === 0) {
      return { ok: false, error: publisher.lastError.value ?? 'aucun relais n’a accepté le profil' }
    }
    // On applique l'event qu'on vient de signer : sans ça le nouveau pseudo
    // n'apparaîtrait qu'au rechargement (`want()` ignore une clé déjà demandée).
    ingest(outcome.event)
    return { ok: true }
  }

  return {
    cache,
    raw,
    nip05,
    want,
    ingest,
    displayName,
    isClaimedName,
    discriminator,
    get,
    rawOf,
    fetchOne,
    publishPatch,
    nip05StatusOf,
  }
})
