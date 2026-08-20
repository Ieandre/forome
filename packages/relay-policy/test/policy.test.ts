/**
 * Tests de la policy d'écriture.
 *
 * Enjeu : sur Nostr rien ne se supprime, donc ce que la policy accepte est
 * définitif. Un faux positif ici est irréversible — c'est le seul endroit du
 * projet où ça mérite des tests de cas limites.
 */
import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { minePow } from 'nostr-tools/nip13'
import type { Event } from 'nostr-tools/core'
import {
  evaluate,
  RateTracker,
  DEFAULT_POLICY,
  KIND_THREAD,
  KIND_COMMENT,
  KIND_PROFILE,
  KIND_GIFT_WRAP,
  KIND_REPORT,
  COMMUNITY,
  communityTag,
  inCommunity,
  type PolicyConfig,
} from '../src/index.js'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const NOW = 1_800_000_000

/**
 * Fabrique un event signé, avec PoW optionnelle.
 *
 * La marque de périmètre est posée d'office sur le contenu public, comme le fait
 * le client : sans elle, tous les tests de kind 11 / 1111 échoueraient sur le
 * périmètre au lieu de vérifier la règle qu'ils visent. Les tests du périmètre
 * lui-même passent leurs tags explicitement.
 */
function make(
  over: Partial<{ kind: number; content: string; tags: string[][]; created_at: number }> = {},
  pow = 0,
): Event {
  const kind = over.kind ?? KIND_COMMENT
  const tags = over.tags ?? []
  const base = {
    kind,
    content: over.content ?? 'coucou',
    tags:
      (kind === KIND_THREAD || kind === KIND_COMMENT) && !inCommunity({ tags })
        ? [...tags, communityTag()]
        : tags,
    created_at: over.created_at ?? NOW,
  }
  if (pow > 0) {
    const mined = minePow({ ...base, pubkey: pk }, pow)
    // `minePow` réécrit `created_at` avec l'heure courante à chaque seconde qui
    // tourne (vérifié dans la source amont) : reprendre `base.created_at` ici
    // produirait un id différent de celui qui a été miné, donc une PoW perdue.
    return finalizeEvent({ ...base, created_at: mined.created_at, tags: mined.tags }, sk)
  }
  return finalizeEvent(base, sk)
}

/** Policy sans PoW, pour tester les autres règles isolément. */
const noPow: PolicyConfig = { ...DEFAULT_POLICY, minPow: { default: 0 } }

describe('périmètre du forum', () => {
  it('refuse un topic sans la marque, avec la raison', () => {
    const v = evaluate(finalizeEvent({ kind: KIND_THREAD, content: 'x', tags: [], created_at: NOW }, sk), {
      config: noPow,
      nowS: NOW,
    })
    expect(v.accept).toBe(false)
    expect(v.accept === false && v.reason).toContain('hors périmètre')
  })

  it('refuse un message sans la marque', () => {
    const ev = finalizeEvent({ kind: KIND_COMMENT, content: 'x', tags: [], created_at: NOW }, sk)
    expect(evaluate(ev, { config: noPow, nowS: NOW }).accept).toBe(false)
  })

  it('refuse la marque d’une autre communauté', () => {
    const ev = finalizeEvent(
      { kind: KIND_THREAD, content: 'x', tags: [['t', 'un-autre-forum']], created_at: NOW },
      sk,
    )
    expect(evaluate(ev, { config: noPow, nowS: NOW }).accept).toBe(false)
  })

  it('accepte quand la marque accompagne d’autres sujets', () => {
    const ev = finalizeEvent(
      { kind: KIND_THREAD, content: 'x', tags: [['t', 'nostr'], communityTag()], created_at: NOW },
      sk,
    )
    expect(evaluate(ev, { config: noPow, nowS: NOW }).accept).toBe(true)
  })

  // Le profil et les listes n'appartiennent à aucun forum : les marquer
  // reviendrait à demander une identité par communauté, ce qui est l'inverse de
  // ce que Nostr apporte.
  it('ne l’exige pas des kinds qui ne sont pas du contenu public', () => {
    expect(evaluate(make({ kind: KIND_PROFILE }), { config: noPow, nowS: NOW }).accept).toBe(true)
    expect(evaluate(make({ kind: KIND_GIFT_WRAP }), { config: noPow, nowS: NOW }).accept).toBe(true)
  })

  it('laisse passer tout le monde quand aucun périmètre n’est configuré', () => {
    const open: PolicyConfig = { ...noPow, community: null }
    const ev = finalizeEvent({ kind: KIND_THREAD, content: 'x', tags: [], created_at: NOW }, sk)
    expect(evaluate(ev, { config: open, nowS: NOW }).accept).toBe(true)
  })

  it('inCommunity lit la même marque que celle qu’on pose', () => {
    expect(communityTag()).toEqual(['t', COMMUNITY])
    expect(inCommunity({ tags: [communityTag()] })).toBe(true)
    expect(inCommunity({ tags: [['t', 'autre']] })).toBe(false)
    expect(inCommunity({ tags: [] })).toBe(false)
  })
})

describe('kinds', () => {
  it('accepte les kinds du forum', () => {
    expect(evaluate(make({ kind: KIND_PROFILE }), { config: noPow, nowS: NOW }).accept).toBe(true)
    expect(evaluate(make({ kind: KIND_THREAD }), { config: noPow, nowS: NOW }).accept).toBe(true)
  })

  it('refuse un kind hors sujet, avec la raison', () => {
    const v = evaluate(make({ kind: 1 }), { config: noPow, nowS: NOW })
    expect(v.accept).toBe(false)
    expect(v.accept === false && v.reason).toContain('kind 1 non accepté')
  })
})

describe('fenêtre created_at', () => {
  it('accepte un horodatage plausible', () => {
    expect(evaluate(make({ created_at: NOW - 30 }), { config: noPow, nowS: NOW }).accept).toBe(true)
  })

  it('refuse trop loin dans le futur', () => {
    const v = evaluate(make({ created_at: NOW + 600 }), { config: noPow, nowS: NOW })
    expect(v.accept).toBe(false)
    expect(v.accept === false && v.reason).toContain('futur')
  })

  it('refuse trop loin dans le passé', () => {
    const v = evaluate(make({ created_at: NOW - 7200 }), { config: noPow, nowS: NOW })
    expect(v.accept).toBe(false)
    expect(v.accept === false && v.reason).toContain('passé')
  })

  it('accepte pile aux bornes — la tolérance est inclusive', () => {
    expect(
      evaluate(make({ created_at: NOW + DEFAULT_POLICY.maxFutureS }), { config: noPow, nowS: NOW }).accept,
    ).toBe(true)
    expect(
      evaluate(make({ created_at: NOW - DEFAULT_POLICY.maxPastS.default }), { config: noPow, nowS: NOW })
        .accept,
    ).toBe(true)
  })

  it('tolère un emballage de MP antidaté de deux jours', () => {
    // NIP-59 antidate les emballages jusqu'à 2 jours, délibérément (sinon un
    // relais corrélerait les copies d'une même conversation). La fenêtre du
    // contenu public, elle, reste serrée — d'où une tolérance PAR KIND.
    const twoDaysAgo = NOW - 2 * 24 * 3600
    expect(evaluate(make({ kind: KIND_GIFT_WRAP, created_at: twoDaysAgo }), { config: noPow, nowS: NOW }).accept).toBe(
      true,
    )
    // le même antidatage sur un post public est refusé
    const v = evaluate(make({ kind: KIND_COMMENT, created_at: twoDaysAgo }), { config: noPow, nowS: NOW })
    expect(v.accept).toBe(false)
    expect(v.accept === false && v.reason).toContain('passé')
  })

  it("refuse un emballage antidaté au-delà de ce que NIP-59 permet", () => {
    const tenDaysAgo = NOW - 10 * 24 * 3600
    expect(
      evaluate(make({ kind: KIND_GIFT_WRAP, created_at: tenDaysAgo }), { config: noPow, nowS: NOW }).accept,
    ).toBe(false)
  })
})

describe('preuve de travail', () => {
  it('refuse un post sans PoW quand elle est exigée', () => {
    const v = evaluate(make({ kind: KIND_COMMENT }), { nowS: NOW })
    expect(v.accept).toBe(false)
    // Le seuil est lu dans la config, pas figé dans le test : le baisser pour la
    // réactivité perçue ne doit pas casser un test qui vérifie le *mécanisme*.
    expect(v.accept === false && v.reason).toMatch(
      new RegExp(`^pow: \\d+ bits < ${DEFAULT_POLICY.minPow[KIND_COMMENT]} requis$`),
    )
  })

  it('accepte un post dont la PoW atteint le seuil', () => {
    const cfg: PolicyConfig = { ...DEFAULT_POLICY, minPow: { default: 8 } }
    const ev = make({ kind: KIND_COMMENT }, 8)
    // `nowS` est pris sur l'event : le minage impose son propre `created_at`
    // (heure réelle), qui n'a rien à voir avec la constante NOW des autres tests.
    expect(evaluate(ev, { config: cfg, nowS: ev.created_at }).accept).toBe(true)
  })

  it("n'exige aucune PoW sur le profil — un kind 0 n'est pas un levier de spam", () => {
    expect(evaluate(make({ kind: KIND_PROFILE }), { nowS: NOW }).accept).toBe(true)
  })
})

describe('taille', () => {
  it('refuse un contenu trop gros', () => {
    const v = evaluate(make({ content: 'a'.repeat(40_000) }), { config: noPow, nowS: NOW })
    expect(v.accept).toBe(false)
    expect(v.accept === false && v.reason).toContain('octets')
  })

  it('mesure en octets UTF-8, pas en caractères', () => {
    // 20 000 caractères hors BMP = 80 000 octets : refusé alors que
    // `content.length` (40 000 unités UTF-16) passerait sous une limite naïve.
    const v = evaluate(make({ content: '𝄞'.repeat(20_000) }), { config: noPow, nowS: NOW })
    expect(v.accept).toBe(false)
  })

  it('refuse trop de tags', () => {
    const tags = Array.from({ length: 300 }, (_, i) => ['t', String(i)])
    const v = evaluate(make({ tags }), { config: noPow, nowS: NOW })
    expect(v.accept).toBe(false)
    expect(v.accept === false && v.reason).toContain('tags')
  })
})

describe('signature', () => {
  it('refuse un event dont le contenu a été altéré après signature', () => {
    const ev = make({ content: 'original' }, 0)
    const tampered = { ...ev, content: 'altéré' }
    const v = evaluate(tampered, { config: noPow, nowS: NOW })
    expect(v.accept).toBe(false)
    expect(v.accept === false && v.reason).toContain('signature')
  })

  it('refuse un event dont la signature vient d\'une autre clé', () => {
    const other = generateSecretKey()
    const ev = finalizeEvent({ kind: KIND_COMMENT, content: 'x', tags: [], created_at: NOW }, other)
    const impersonated = { ...ev, pubkey: pk }
    expect(evaluate(impersonated, { config: noPow, nowS: NOW }).accept).toBe(false)
  })

  it("ne fait pas confiance au marqueur de vérification en cache de l'appelant", () => {
    // Régression sur un vrai piège : `finalizeEvent` renvoie un event portant un
    // marqueur « déjà vérifié » sur une clé Symbol, et le spread d'objet copie
    // les propriétés Symbol. Sans réduction aux champs canoniques, cet event
    // altéré passait la vérification.
    const ev = make({ content: 'original' })
    const tampered = { ...ev, content: 'charge utile injectée' }
    const symbols = Object.getOwnPropertySymbols(tampered)
    expect(symbols.length).toBeGreaterThan(0) // le marqueur a bien été copié
    expect(evaluate(tampered, { config: noPow, nowS: NOW }).accept).toBe(false)
  })
})

describe('débit par clé', () => {
  it('laisse passer sous le quota puis refuse au-dessus', () => {
    const cfg: PolicyConfig = { ...noPow, ratePerKey: 3, rateWindowS: 60 }
    const rate = new RateTracker(cfg.ratePerKey, cfg.rateWindowS)
    const results = [0, 1, 2, 3].map((i) =>
      evaluate(make({ content: `msg-${i}` }), { config: cfg, nowS: NOW, rate }),
    )
    expect(results.slice(0, 3).every((r) => r.accept)).toBe(true)
    expect(results[3]!.accept).toBe(false)
    expect(results[3]!.accept === false && results[3]!.reason).toContain('rate-limited')
  })

  it('la fenêtre glisse : le quota se libère avec le temps', () => {
    const cfg: PolicyConfig = { ...noPow, ratePerKey: 2, rateWindowS: 60 }
    const rate = new RateTracker(cfg.ratePerKey, cfg.rateWindowS)
    evaluate(make({ content: 'a' }), { config: cfg, nowS: NOW, rate })
    evaluate(make({ content: 'b' }), { config: cfg, nowS: NOW, rate })
    expect(evaluate(make({ content: 'c' }), { config: cfg, nowS: NOW, rate }).accept).toBe(false)
    // 61 s plus tard, la fenêtre est vide
    expect(
      evaluate(make({ content: 'd', created_at: NOW + 61 }), { config: cfg, nowS: NOW + 61, rate }).accept,
    ).toBe(true)
  })

  it('compte par clé, pas globalement', () => {
    const cfg: PolicyConfig = { ...noPow, ratePerKey: 1, rateWindowS: 60 }
    const rate = new RateTracker(cfg.ratePerKey, cfg.rateWindowS)
    expect(evaluate(make({ content: 'a' }), { config: cfg, nowS: NOW, rate }).accept).toBe(true)

    const otherSk = generateSecretKey()
    const otherEv = finalizeEvent(
      { kind: KIND_COMMENT, content: 'b', tags: [communityTag()], created_at: NOW },
      otherSk,
    )
    expect(evaluate(otherEv, { config: cfg, nowS: NOW, rate }).accept).toBe(true)
  })

  it("ne consomme pas de quota pour un event déjà refusé pour autre chose", () => {
    // Sinon un attaquant épuiserait le quota d'une clé légitime en rejouant des
    // events invalides signés par elle.
    const cfg: PolicyConfig = { ...noPow, ratePerKey: 1, rateWindowS: 60 }
    const rate = new RateTracker(cfg.ratePerKey, cfg.rateWindowS)
    const badKind = make({ kind: 1 })
    expect(evaluate(badKind, { config: cfg, nowS: NOW, rate }).accept).toBe(false)
    // le quota est intact
    expect(evaluate(make({ content: 'ok' }), { config: cfg, nowS: NOW, rate }).accept).toBe(true)
  })
})

describe('modération', () => {
  const VICTIM_TOPIC = 'b'.repeat(64)

  it('refuse une clé bannie avant même de mesurer sa PoW', () => {
    const cfg: PolicyConfig = { ...DEFAULT_POLICY, blocked: new Set([pk]) }
    const v = evaluate(make({ kind: KIND_COMMENT }), { config: cfg, nowS: NOW })
    expect(v.accept).toBe(false)
    expect(v.accept === false && v.reason).toContain('clé bannie')
  })

  it('laisse passer les autres clés', () => {
    const cfg: PolicyConfig = { ...noPow, blocked: new Set(['f'.repeat(64)]) }
    expect(evaluate(make(), { config: cfg, nowS: NOW }).accept).toBe(true)
  })

  it('refuse une réponse dans un topic verrouillé, en NIP-22 comme en NIP-10', () => {
    const cfg: PolicyConfig = { ...noPow, locked: new Set([VICTIM_TOPIC]) }
    const nip22 = make({ kind: KIND_COMMENT, tags: [['E', VICTIM_TOPIC]] })
    const nip10 = make({ kind: KIND_COMMENT, tags: [['e', VICTIM_TOPIC, '', 'root']] })
    expect(evaluate(nip22, { config: cfg, nowS: NOW }).accept).toBe(false)
    expect(evaluate(nip10, { config: cfg, nowS: NOW }).accept).toBe(false)
  })

  it('ne verrouille pas les autres topics', () => {
    const cfg: PolicyConfig = { ...noPow, locked: new Set([VICTIM_TOPIC]) }
    const ailleurs = make({ kind: KIND_COMMENT, tags: [['E', 'c'.repeat(64)]] })
    expect(evaluate(ailleurs, { config: cfg, nowS: NOW }).accept).toBe(true)
  })

  it('accepte les signalements NIP-56', () => {
    expect(evaluate(make({ kind: KIND_REPORT }), { config: noPow, nowS: NOW }).accept).toBe(true)
  })
})
