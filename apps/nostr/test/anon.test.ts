/**
 * Tests du mode anonyme (spec §3.7).
 *
 * Ce qui est vérifié ici est ce qui ne se rattrape pas. Sur Nostr rien ne
 * s'efface : une clé qui change sous les pieds d'un fil, un masque qui retombe
 * sur le compte, une correction signée par la mauvaise voix — chacun de ces bugs
 * publie quelque chose de définitif, et deux d'entre eux publient précisément le
 * lien que ce mode existe pour ne pas créer.
 *
 * Le stockage n'est pas de la partie : `import.meta.client` est faux hors du
 * navigateur, donc `load`/`persist` ne font rien et le store tourne en mémoire.
 * C'est exactement ce qu'on veut tester — la logique de clés, pas localStorage.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { verifyEvent } from 'nostr-tools/pure'
import { useAnonStore } from '../stores/anon.js'
import { ANON_TAG, anonName, isAnon } from '../types/nostr.js'

const TOPIC_A = 'a'.repeat(64)
const TOPIC_B = 'b'.repeat(64)

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('la marque', () => {
  it('se lit sur les tags, pas sur la clé', () => {
    expect(isAnon({ tags: [[ANON_TAG]] })).toBe(true)
    expect(isAnon({ tags: [['t', 'forome']] })).toBe(false)
  })

  it('ne porte aucune valeur — elle ne doit rien lier', () => {
    // Un fil ou une date dans le tag rapprocherait deux messages entre eux, ce
    // que le mode existe pour éviter. `isAnon` doit donc reconnaître le tag nu.
    expect(isAnon({ tags: [[ANON_TAG]] })).toBe(true)
  })

  it('nomme la voix avec son discriminant', () => {
    expect(anonName('a3f81b2c' + '0'.repeat(56))).toBe('Anonyme·a3f81b')
  })
})

describe('une clé par topic', () => {
  it('rend la même voix dans le même fil', () => {
    const anon = useAnonStore()
    expect(anon.pubkeyFor(TOPIC_A)).toBe(anon.pubkeyFor(TOPIC_A))
  })

  it('rend une voix différente dans un autre fil', () => {
    const anon = useAnonStore()
    expect(anon.pubkeyFor(TOPIC_A)).not.toBe(anon.pubkeyFor(TOPIC_B))
  })

  it('ne se confond avec aucune autre — c’est ce qui tue le samefag', () => {
    const anon = useAnonStore()
    const keys = Array.from({ length: 50 }, (_, i) => anon.pubkeyFor(`topic-${i}`))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('signer', () => {
  it('produit un event valide, sous la clé annoncée', async () => {
    const anon = useAnonStore()
    const voice = anon.voiceFor(TOPIC_A)
    const ev = await voice.sign({
      kind: 1111,
      created_at: 1_700_000_000,
      tags: [['t', 'forome'], [ANON_TAG]],
      content: 'je crois que je n’ai jamais osé le dire',
    })
    expect(verifyEvent(ev)).toBe(true)
    expect(ev.pubkey).toBe(voice.pubkey)
    expect(ev.pubkey).toBe(anon.pubkeyFor(TOPIC_A))
  })

  it('retrouve la voix d’un message pour pouvoir le corriger', async () => {
    const anon = useAnonStore()
    const pubkey = anon.pubkeyFor(TOPIC_A)
    // C'est `PostFeed.saveEdit` qui fait ça : il ne tient que l'event à corriger,
    // donc une clé publique. Sans ce chemin, une correction repartirait sous le
    // compte et tous les lecteurs l'écarteraient (§2.5).
    const back = anon.voiceOf(pubkey)
    expect(back).not.toBeNull()
    const ev = await back!.sign({ kind: 1111, created_at: 1, tags: [], content: '' })
    expect(ev.pubkey).toBe(pubkey)
  })

  it('ne reconnaît pas une clé qui n’est pas de cet appareil', () => {
    expect(useAnonStore().voiceOf('f'.repeat(64))).toBeNull()
  })
})

describe('« est-ce de moi ? »', () => {
  it('reconnaît ses propres masques et pas ceux des autres', () => {
    const anon = useAnonStore()
    const mine = anon.pubkeyFor(TOPIC_A)
    expect(anon.isMine(mine)).toBe(true)
    expect(anon.isMine('c'.repeat(64))).toBe(false)
  })
})

describe('le topic qu’on est en train d’ouvrir', () => {
  it('publie et répond sous la MÊME voix', () => {
    const anon = useAnonStore()
    anon.setDraftEnabled(true)
    const published = anon.draftVoice().pubkey

    anon.bindDraft(TOPIC_A)

    // Le piège : recréer une clé au lieu de ranger celle du brouillon ferait de
    // l'auteur d'un fil d'aveu un inconnu dans son propre fil, dès sa première
    // réponse — et son message racine deviendrait incorrigible.
    expect(anon.pubkeyFor(TOPIC_A)).toBe(published)
    expect(anon.isMine(published)).toBe(true)
  })

  it('arme le mode dans le fil qui vient de naître', () => {
    const anon = useAnonStore()
    anon.setDraftEnabled(true)
    anon.bindDraft(TOPIC_A)
    // Sinon l'auteur répondrait sous son pseudo dans le fil qu'il vient
    // justement d'ouvrir anonymement.
    expect(anon.isEnabled(TOPIC_A)).toBe(true)
  })

  it('ne laisse pas le mode armé pour le topic suivant', () => {
    const anon = useAnonStore()
    anon.setDraftEnabled(true)
    anon.bindDraft(TOPIC_A)
    expect(anon.isDraftEnabled()).toBe(false)
  })
})

describe('le mode, fil par fil', () => {
  it('est coupé par défaut — l’identité persistante reste la voix normale (§3.6)', () => {
    expect(useAnonStore().isEnabled(TOPIC_A)).toBe(false)
  })

  it('ne déborde pas d’un fil sur l’autre', () => {
    const anon = useAnonStore()
    anon.setEnabled(TOPIC_A, true)
    expect(anon.isEnabled(TOPIC_A)).toBe(true)
    expect(anon.isEnabled(TOPIC_B)).toBe(false)
  })

  it('se coupe sans jeter la clé — un vieux message reste corrigible', () => {
    const anon = useAnonStore()
    anon.setEnabled(TOPIC_A, true)
    const pubkey = anon.pubkeyFor(TOPIC_A)
    anon.setEnabled(TOPIC_A, false)
    expect(anon.isEnabled(TOPIC_A)).toBe(false)
    expect(anon.voiceOf(pubkey)).not.toBeNull()
  })
})

describe('« ↻ new khey »', () => {
  it('emporte les masques avec l’identité', () => {
    const anon = useAnonStore()
    anon.setEnabled(TOPIC_A, true)
    const pubkey = anon.pubkeyFor(TOPIC_A)

    anon.wipe()

    // Les garder laisserait, dans le seul endroit qui le détenait, le lien entre
    // l'identité qu'on abandonne et les messages qu'on en avait détachés.
    expect(anon.voiceOf(pubkey)).toBeNull()
    expect(anon.isMine(pubkey)).toBe(false)
    expect(anon.isEnabled(TOPIC_A)).toBe(false)
    expect(anon.pubkeyFor(TOPIC_A)).not.toBe(pubkey)
  })
})
