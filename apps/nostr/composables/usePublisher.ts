/**
 * Publication (spec §2.3, §6.3, §12.1).
 *
 * Chaîne complète : construire → **miner** → signer → afficher (optimiste) →
 * diffuser. L'ordre compte : le nonce de la PoW est dans les tags, donc dans
 * l'id, donc dans ce qui est signé — miner après signature invaliderait la
 * signature.
 *
 * L'affichage optimiste est **avant** la diffusion, délibérément : c'est ce qui
 * rend l'écriture instantanée. Et le message de l'auteur ne passe jamais par le
 * tampon de lissage (§6.3) — sinon écrire donne l'impression que le site est
 * cassé, ce qui est le bug le plus fréquent de ce pattern.
 *
 * ## Avant la diffusion ne suffisait pas
 *
 * « Optimiste » voulait dire *après signature* : le fil n'affichait rien tant
 * que la PoW n'était pas minée (~120 ms en moyenne, mais loi géométrique, donc
 * régulièrement le triple) et que le signeur n'avait pas rendu (une extension
 * NIP-07 met des centaines de ms, un bunker NIP-46 fait un aller-retour réseau).
 * Le clic sur « Poster » restait donc suivi d'un temps mort, et c'est ce temps
 * mort qui fait douter que le message soit parti.
 *
 * D'où `onSending` : le fil reçoit le message **au clic**, sous un id provisoire
 * (`provisionalId`), et le minage comme la signature se font derrière. Quand
 * l'event réel existe, `onOptimistic` le donne avec l'id provisoire à remplacer
 * — le même mécanisme que le renvoi après refus de PoW, qui change lui aussi
 * l'id d'un message déjà à l'écran.
 */
import { ref } from 'vue'
import { verifyEvent } from 'nostr-tools/pure'
import { getPow } from 'nostr-tools/nip13'
import type { UnsignedEvent } from 'nostr-tools/pure'
import {
  EDIT_TAG,
  KIND_APP_DATA,
  KIND_COMMENT,
  KIND_PROFILE,
  KIND_THREAD,
  communityTag,
  inCommunity,
  provisionalId,
  type NostrEvent,
} from '~/types/nostr'
import { KIND_REPORT } from '~/types/moderation'
import { mentionTags } from '~/utils/mentions'
import type { PublishResult } from '~/stores/relays'

export interface PublishOutcome {
  event: NostrEvent
  result: PublishResult
  /** difficulté réellement atteinte par l'id publié */
  pow: number
  /** verdict complet, encore en vol quand `result` est provisoire */
  settled?: Promise<PublishResult>
}

export function usePublisher() {
  const relayStore = useRelayStore()
  const identity = useIdentityStore()
  const miner = usePowMiner()

  const publishing = ref(false)
  const lastError = ref<string | null>(null)
  /** Verdict complet du dernier envoi, rempli en arrière-plan. */
  const lastResult = ref<PublishResult | null>(null)

  function nowS(): number {
    return Math.floor(Date.now() / 1000)
  }

  /**
   * Tags NIP-22 d'une réponse : **majuscules pour la racine**, minuscules pour
   * le parent immédiat. C'est cette distinction qui permet un fil plat à
   * l'affichage tout en gardant le lien sémantique de la citation (§6.5).
   */
  function replyTags(root: NostrEvent | null, rootId: string, parent: NostrEvent | null): string[][] {
    const hint = relayStore.relays[0] ?? ''
    const tags: string[][] = [
      ['E', rootId, hint, root?.pubkey ?? ''],
      ['K', String(root?.kind ?? KIND_THREAD)],
    ]
    if (root?.pubkey) tags.push(['P', root.pubkey, hint])

    const target = parent ?? root
    if (target && target.id !== rootId) {
      tags.push(['e', target.id, hint, target.pubkey])
      tags.push(['k', String(target.kind)])
      tags.push(['p', target.pubkey, hint])
    } else if (root) {
      tags.push(['e', rootId, hint, root.pubkey])
      tags.push(['k', String(root.kind)])
      tags.push(['p', root.pubkey, hint])
    }
    return tags
  }

  /**
   * La marque du périmètre est posée **ici**, au point de passage unique de
   * toute publication, et pas dans chaque brouillon : un topic, une réponse et
   * une révision doivent la porter, et un seul oubli produirait un message
   * définitivement invisible dans le forum où il a été écrit (`COMMUNITY`).
   *
   * Avant le minage, donc dans l'id signé — un tag ajouté après invaliderait la
   * PoW comme la signature.
   */
  function buildUnsigned(kind: number, content: string, tags: string[][], createdAt = nowS()): UnsignedEvent | null {
    if (!identity.pubkey) return null
    if (kind !== KIND_THREAD && kind !== KIND_COMMENT) {
      return { kind, pubkey: identity.pubkey, created_at: createdAt, tags, content }
    }

    let out = inCommunity({ tags }) ? tags : [...tags, communityTag()]

    /*
     * Les mentions du texte deviennent des tags `p` — c'est ce qui fait qu'une
     * mention **prévient** quelqu'un plutôt que d'être un lien décoratif : le
     * canal personnel souscrit `{"#p": [ma clé]}` (`stores/notifications.ts`).
     *
     * Ici et pas dans chaque brouillon, pour la même raison que la marque de
     * périmètre juste au-dessus : c'est le point de passage unique de toute
     * publication (topic, réponse, révision), et un oubli produirait une mention
     * visible que le mentionné ne verrait jamais. Avant le minage, donc dans
     * l'id signé — un tag ajouté après invaliderait PoW et signature.
     */
    const already = out.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]!)
    const mentions = mentionTags(content, already)
    if (mentions.length) out = [...out, ...mentions]

    return { kind, pubkey: identity.pubkey, created_at: createdAt, tags: out, content }
  }

  /**
   * Brouillon de réponse, pour le minage spéculatif pendant la frappe.
   *
   * ⚠️ `extraTags` (les `imeta` des images jointes) doit être passé ici AUSSI, pas
   * seulement à la publication : les tags sont dans l'id, donc un nonce miné sans
   * eux ne vaudrait plus rien une fois l'event complet — le minage spéculatif
   * serait à refaire, silencieusement.
   */
  function draftReply(
    content: string,
    rootId: string,
    root: NostrEvent | null,
    parent: NostrEvent | null,
    extraTags: string[][] = [],
    createdAt = nowS(),
  ): UnsignedEvent | null {
    return buildUnsigned(KIND_COMMENT, content, [...replyTags(root, rootId, parent), ...extraTags], createdAt)
  }

  function draftTopic(
    title: string,
    content: string,
    extraTags: string[][] = [],
    createdAt = nowS(),
  ): UnsignedEvent | null {
    return buildUnsigned(KIND_THREAD, content, [['title', title.trim()], ...extraTags], createdAt)
  }

  /**
   * Tags de fil d'une révision (spec §2.5).
   *
   * **Recopiés de l'original plutôt que reconstruits.** `replyTags()` a besoin de
   * l'event parent, qui n'est pas forcément chargé au moment où l'on corrige un
   * vieux message — et le reconstruire à partir de ce qu'on a produirait des tags
   * différents de ceux de l'original, donc une révision qui ne se range pas au
   * même endroit du fil que ce qu'elle corrige.
   *
   * Trois familles sont écartées à la copie, et chacune pour une raison propre :
   *   - `nonce` : la révision mine le sien, deux nonces feraient un event douteux
   *   - `imeta` : elle porte les images de sa propre version, pas de l'ancienne
   *   - `edit`  : réviser une révision vise l'original, jamais le maillon d'avant
   *   - `title` : le titre d'un topic ne se corrige pas ici (voir `publishEdit`)
   */
  const THREAD_TAGS = new Set(['E', 'K', 'P', 'e', 'k', 'p'])

  function revisionTags(anchor: NostrEvent): string[][] {
    // Le message racine n'a pas de tag `E` — il EST la racine. Sa révision, elle,
    // est un kind 1111 et doit le porter, sans quoi elle n'arriverait pas par la
    // requête du fil (`#E`) et ne serait jamais vue.
    if (anchor.kind === KIND_THREAD) {
      const hint = relayStore.relays[0] ?? ''
      return [
        ['E', anchor.id, hint, anchor.pubkey],
        ['K', String(KIND_THREAD)],
        ['P', anchor.pubkey, hint],
      ]
    }
    /*
     * Un seul tag `p` est recopié : le premier, celui de l'auteur du parent
     * (NIP-22). Les suivants sont les **mentions de l'ancienne version**, et
     * `buildUnsigned` les recalcule sur le nouveau texte. Les recopier ferait
     * qu'une mention retirée en corrigeant continuerait de notifier son porteur,
     * pour un message où son nom n'apparaît plus.
     */
    let keptP = false
    return anchor.tags.filter((t) => {
      if (!t[0] || !THREAD_TAGS.has(t[0])) return false
      if (t[0] !== 'p') return true
      if (keptP) return false
      keptP = true
      return true
    })
  }

  function draftEdit(
    content: string,
    anchor: NostrEvent,
    extraTags: string[][] = [],
    createdAt = nowS(),
  ): UnsignedEvent | null {
    return buildUnsigned(
      KIND_COMMENT,
      content,
      [...revisionTags(anchor), [EDIT_TAG, anchor.id], ...extraTags],
      createdAt,
    )
  }

  /**
   * Corrige un message déjà publié — c'est-à-dire en publie une nouvelle version
   * (§2.5). L'ancien event n'est pas touché : il ne peut pas l'être, et c'est
   * précisément ce qui rend l'historique consultable sans qu'on ait à le stocker.
   *
   * ⚠️ Le garde-fou d'auteur est ici ET à la résolution, volontairement. À la
   * lecture il protège du message réécrit par un tiers ; ici il évite de publier
   * sur un réseau sans suppression une révision que **personne** n'affichera —
   * un déchet définitif, produit par un bug d'appelant.
   */
  async function publishEdit(args: {
    content: string
    anchor: NostrEvent
    /** Tags à ajouter (`imeta` des images de cette version, NIP-92). */
    tags?: string[][]
    onOptimistic?: (ev: NostrEvent, replacedId?: string) => void
  }): Promise<PublishOutcome | null> {
    if (args.anchor.pubkey !== identity.pubkey) {
      lastError.value = 'on ne peut corriger que ses propres messages'
      return null
    }
    const unsigned = draftEdit(args.content, args.anchor, args.tags ?? [])
    if (!unsigned) {
      lastError.value = 'aucune identité'
      return null
    }
    // `countsAsPost: false` : le compteur de §3.1 déclenche l'encart d'identité et
    // le rappel de sauvegarde de clé. Se relire n'est pas prendre la parole.
    return run(unsigned, args.onOptimistic, { countsAsPost: false })
  }

  /** Mine, signe, vérifie, diffuse. Ne fait AUCUN affichage — c'est l'appelant. */
  async function finalizeAndPublish(
    unsigned: UnsignedEvent,
    withPow = true,
  ): Promise<{
    event: NostrEvent
    firstAck: Promise<boolean>
    settled: Promise<PublishResult>
    pow: number
  }> {
    const mined = withPow ? await miner.mineFor(unsigned) : { ...unsigned, id: '' }
    const signed = (await identity.sign({
      kind: mined.kind,
      created_at: mined.created_at,
      tags: mined.tags,
      content: mined.content,
      pubkey: mined.pubkey,
    })) as NostrEvent

    // Garde-fou : une signature invalide ici signifierait un bug de signeur (ou
    // une extension NIP-07 qui a réécrit l'event). Mieux vaut le voir tout de
    // suite que publier de l'invérifiable.
    if (!verifyEvent(signed)) throw new Error('signature invalide après signature — publication annulée')

    const { firstAck, settled } = relayStore.publishSplit(signed)
    return { event: signed, firstAck, settled, pow: getPow(signed.id) }
  }

  /**
   * Réponse dans un topic. `onOptimistic` est appelé dès la signature, avant la
   * diffusion — c'est le point de la publication optimiste.
   */
  async function publishReply(args: {
    content: string
    rootId: string
    root: NostrEvent | null
    parent?: NostrEvent | null
    /** Tags à ajouter (`imeta` des images jointes, NIP-92). */
    tags?: string[][]
    /**
     * Appelé **synchroniquement**, avant tout minage et toute signature : le
     * message tel qu'il sera, sous un id provisoire. C'est ce qui rend l'envoi
     * instantané à l'écran. L'appelant garde l'id : il en aura besoin pour
     * retirer la rangée si `publishReply` rend `null`.
     */
    onSending?: (provisional: NostrEvent) => void
    onOptimistic?: (ev: NostrEvent, replacedId?: string) => void
  }): Promise<PublishOutcome | null> {
    const unsigned = draftReply(args.content, args.rootId, args.root, args.parent ?? null, args.tags ?? [])
    if (!unsigned) {
      lastError.value = 'aucune identité'
      return null
    }
    let replaces: string | undefined
    if (args.onSending) {
      const echo = { ...unsigned, id: provisionalId(), sig: '' } as NostrEvent
      replaces = echo.id
      args.onSending(echo)
    }
    return run(unsigned, args.onOptimistic, { replaces })
  }

  async function publishTopic(args: {
    title: string
    content: string
    /** Tags à ajouter (`imeta` des images jointes, NIP-92). */
    tags?: string[][]
    onOptimistic?: (ev: NostrEvent, replacedId?: string) => void
  }): Promise<PublishOutcome | null> {
    const unsigned = draftTopic(args.title, args.content, args.tags ?? [])
    if (!unsigned) {
      lastError.value = 'aucune identité'
      return null
    }
    return run(unsigned, args.onOptimistic)
  }

  /**
   * Publie le profil kind 0 (§11.1). Rien d'autre ne change : l'identité reste
   * la clé, le profil n'est qu'une étiquette — et elle n'est pas unique (§3.5),
   * d'où le discriminant affiché partout ailleurs.
   *
   * ⚠️ `fields` part **tel quel**, et kind 0 est remplaçable : ce qui n'est pas
   * dans l'objet est effacé du réseau. La fusion avec le profil existant
   * appartient à l'appelant — `useProfileStore().publishPatch()`, qui relit
   * avant d'écrire. Ne pas brancher un formulaire ici directement.
   */
  async function publishProfile(fields: Record<string, unknown>): Promise<PublishOutcome | null> {
    const unsigned = buildUnsigned(KIND_PROFILE, JSON.stringify(fields), [])
    if (!unsigned) {
      lastError.value = 'aucune identité'
      return null
    }
    // Pas de PoW sur le profil : un kind 0 par personne, remplaçable, aucun
    // levier de spam. La taxer ne protégerait rien.
    return run(unsigned, undefined, { pow: false, countsAsPost: false })
  }

  /**
   * Publie une liste remplaçable (kind 3 contacts, kind 10000 mute).
   *
   * Pas de PoW : une liste par personne, remplaçable, sans levier de spam — la
   * taxer ne protégerait rien et ralentirait un clic sur « suivre ».
   */
  async function publishList(kind: number, tags: string[][]): Promise<PublishOutcome | null> {
    const unsigned = buildUnsigned(kind, '', tags)
    if (!unsigned) {
      lastError.value = 'aucune identité'
      return null
    }
    return run(unsigned, undefined, { pow: false, countsAsPost: false })
  }

  /**
   * Publie une donnée applicative NIP-78 (kind 30078), adressable par son tag
   * `d` — le roster et les listes de modération en sont (`docs/moderation-staff.md`).
   *
   * ⚠️ **Adressable, donc remplaçable par (clé, kind, `d`)** : ce qui n'est pas
   * dans `payload` disparaît. Le piège des listes du store social, à l'identique.
   * L'appelant republie l'état complet ou détruit le reste.
   *
   * Pas de PoW : un document par clé et par `d`, remplaçable, sans levier de
   * spam — la taxer ralentirait un clic de modération sans rien protéger.
   */
  async function publishAppData(
    dTag: string,
    payload: unknown,
    createdAt = nowS(),
  ): Promise<PublishOutcome | null> {
    const unsigned = buildUnsigned(KIND_APP_DATA, JSON.stringify(payload), [['d', dTag]], createdAt)
    if (!unsigned) {
      lastError.value = 'aucune identité'
      return null
    }
    return run(unsigned, undefined, { pow: false, countsAsPost: false })
  }

  /**
   * Signalement NIP-56 (kind 1984). Le motif va en **3e position du tag**, le
   * commentaire libre dans le contenu.
   *
   * Miné comme un message : un signalement est du contenu public que quelqu'un
   * peut vouloir produire en masse, et la file du panneau ne doit pas se noyer.
   */
  async function publishReport(args: {
    target: string
    targetKind: 'event' | 'pubkey'
    /** auteur du message visé — NIP-56 veut les deux tags quand on vise un event */
    author?: string | null
    type: string
    note?: string
  }): Promise<PublishOutcome | null> {
    const tags: string[][] =
      args.targetKind === 'event'
        ? [['e', args.target, args.type]]
        : [['p', args.target, args.type]]
    if (args.targetKind === 'event' && args.author) tags.push(['p', args.author, args.type])

    const unsigned = buildUnsigned(KIND_REPORT, args.note?.trim() ?? '', tags)
    if (!unsigned) {
      lastError.value = 'aucune identité'
      return null
    }
    return run(unsigned, undefined, { countsAsPost: false })
  }

  async function run(
    unsigned: UnsignedEvent,
    onOptimistic?: (ev: NostrEvent, replacedId?: string) => void,
    /**
     * `replaces` : id déjà à l'écran que cet envoi supplante. Deux origines, un
     * seul mécanisme — l'écho provisoire posé au clic (`onSending`), et le
     * renvoi après refus de PoW, dont le nouveau nonce donne un nouvel id.
     */
    opts: { pow?: boolean; countsAsPost?: boolean; noRetry?: boolean; replaces?: string } = {},
  ): Promise<PublishOutcome | null> {
    publishing.value = true
    lastError.value = null
    try {
      const { event, firstAck, settled, pow } = await finalizeAndPublish(unsigned, opts.pow !== false)
      // L'id définitif n'apparaît qu'ici : on signale celui qu'il remplace pour
      // que l'affichage échange la rangée au lieu d'en garder deux.
      onOptimistic?.(event, opts.replaces)
      miner.reset()

      // On rend la main **au premier accusé de réception**, pas au verdict
      // complet : attendre `settled` faisait payer à l'utilisateur le timeout du
      // relais le plus lent (jusqu'à 3 s) alors que son message était déjà
      // accepté ailleurs. Le compte exact des relais arrive après, en tâche de
      // fond, et met à jour l'affichage quand il est connu.
      const ok = await firstAck

      if (!ok) {
        const result = await settled

        // Refus pour PoW insuffisante : on apprend l'exigence du relais et on
        // renvoie une fois, au lieu de laisser l'utilisateur devant un message
        // d'erreur qu'il ne peut pas corriger lui-même.
        const powRefusal = result.rejected.find((r) => /pow:/i.test(r.reason))
        if (powRefusal && !opts.noRetry && miner.raiseFloorFromRejection(powRefusal.reason)) {
          lastError.value = null
          return run(unsigned, onOptimistic, { ...opts, noRetry: true, replaces: event.id })
        }

        lastError.value =
          result.rejected.length > 0
            ? `refusé par tous les relais : ${result.rejected[0]!.reason}`
            : 'aucun relais joignable'
        return { event, result, pow }
      }

      // Le compteur ne s'incrémente qu'après acceptation par au moins un relais
      // (§3.1) : compter une tentative refusée pousserait l'utilisateur à
      // sauvegarder une clé avec laquelle il n'a jamais rien publié.
      if (opts.countsAsPost !== false) identity.notePost()

      // Verdict complet en arrière-plan, pour l'affichage « accepté par N/M ».
      void settled.then((result) => {
        lastResult.value = result
      })

      return { event, result: { accepted: ['(en cours)'], rejected: [] }, pow, settled }
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      publishing.value = false
    }
  }

  return {
    publishing,
    lastError,
    lastResult,
    miner,
    draftReply,
    draftTopic,
    draftEdit,
    publishReply,
    publishTopic,
    publishEdit,
    publishProfile,
    publishList,
    publishAppData,
    publishReport,
  }
}
