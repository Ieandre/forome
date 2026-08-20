/**
 * Ce que le carnet renvoie part dans le tag `imeta` d'events signés **par
 * d'autres utilisateurs** : une valeur fausse ici se retrouve signée, pour de
 * bon, dans le registre de quelqu'un qui n'a rien fait de mal.
 *
 * D'où la nature de ces tests : ils portent moins sur « le carnet retient » que
 * sur « le carnet refuse ». Le cas central est `urlCarriesSha` — c'est lui qui
 * empêche un client d'inscrire une adresse qui ne correspond pas à l'empreinte
 * mesurée côté serveur.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StickerMemo, isMirrorEntry, urlCarriesSha, type MirrorEntry } from '../server/utils/stickerMirror'

const SHA = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

const entry = (over: Partial<MirrorEntry> = {}): MirrorEntry => ({
  sha256: SHA,
  url: `https://blossom.primal.net/${SHA}.png`,
  mime: 'image/png',
  width: 136,
  height: 102,
  ...over,
})

describe('isMirrorEntry', () => {
  it('accepte une entrée complète', () => {
    expect(isMirrorEntry(entry())).toBe(true)
  })

  it('refuse une empreinte qui n’est pas un sha256', () => {
    for (const sha256 of ['', 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64), SHA.toUpperCase()]) {
      expect(isMirrorEntry(entry({ sha256 })), sha256).toBe(false)
    }
  })

  it('refuse une adresse non chiffrée', () => {
    expect(isMirrorEntry(entry({ url: `http://blossom.primal.net/${SHA}` }))).toBe(false)
  })

  /* Un type hors liste finirait en `content-type` sur notre origine. */
  it('refuse un type qu’on ne sait pas servir', () => {
    for (const mime of ['image/svg+xml', 'text/html', 'image/avif', '']) {
      expect(isMirrorEntry(entry({ mime })), mime).toBe(false)
    }
  })

  it('refuse des dimensions absentes, nulles, négatives ou fractionnaires', () => {
    for (const width of [0, -5, 1.5, Number.NaN, 40_000]) {
      expect(isMirrorEntry(entry({ width })), String(width)).toBe(false)
    }
    expect(isMirrorEntry({ ...entry(), height: undefined })).toBe(false)
  })

  it('refuse ce qui n’est pas un objet', () => {
    for (const bad of [null, undefined, 42, 'x', []]) expect(isMirrorEntry(bad)).toBe(false)
  })
})

describe('urlCarriesSha', () => {
  it('accepte une adresse adressée par contenu', () => {
    expect(urlCarriesSha(`https://h.tld/${SHA}`, SHA)).toBe(true)
    expect(urlCarriesSha(`https://h.tld/x/y/${SHA}.webp`, SHA)).toBe(true)
    expect(urlCarriesSha(`https://h.tld/${SHA}?v=1#z`, SHA)).toBe(true)
  })

  /* Le cœur de la garantie : l'adresse déposée doit désigner CES octets-là. */
  it('refuse une adresse qui porte une autre empreinte', () => {
    expect(urlCarriesSha(`https://h.tld/${OTHER}`, SHA)).toBe(false)
  })

  it('refuse une empreinte cachée ailleurs que dans le nom du fichier', () => {
    expect(urlCarriesSha(`https://h.tld/${SHA}/autre.png`, SHA)).toBe(false)
    expect(urlCarriesSha(`https://h.tld/img?x=${SHA}`, SHA)).toBe(false)
    expect(urlCarriesSha(`https://h.tld/prefixe${SHA}`, SHA)).toBe(false)
  })
})

describe('StickerMemo', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forome-stickers-'))
    path = join(dir, 'stickers.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('retient et rend une entrée', () => {
    const memo = new StickerMemo(null)
    expect(memo.put(224, entry())).toBe(true)
    expect(memo.get(224)).toEqual(entry())
    expect(memo.get(999)).toBeNull()
  })

  it('refuse une entrée dont l’adresse ne porte pas l’empreinte', () => {
    const memo = new StickerMemo(null)
    expect(memo.put(224, entry({ url: `https://blossom.primal.net/${OTHER}.png` }))).toBe(false)
    expect(memo.get(224)).toBeNull()
  })

  it('refuse un id invalide', () => {
    const memo = new StickerMemo(null)
    for (const id of [0, -1, 1.5]) expect(memo.put(id, entry()), String(id)).toBe(false)
  })

  /* Réécrire changerait l'adresse d'un sticker que des events citent déjà. */
  it('garde la première entrée en cas de doublon', () => {
    const memo = new StickerMemo(null)
    memo.put(224, entry())
    memo.put(224, entry({ sha256: OTHER, url: `https://blossom.primal.net/${OTHER}.png` }))
    expect(memo.get(224)?.sha256).toBe(SHA)
  })

  it('sélectionne les entrées connues d’un lot', () => {
    const memo = new StickerMemo(null)
    memo.put(1, entry())
    memo.put(3, entry())
    expect(Object.keys(memo.pick([1, 2, 3, 4]))).toEqual(['1', '3'])
  })

  it('écrit puis relit le carnet', async () => {
    const first = new StickerMemo(path)
    await first.load()
    first.put(224, entry())
    await first.flush()

    const second = new StickerMemo(path)
    await second.load()
    expect(second.get(224)).toEqual(entry())
  })

  it('n’écrit rien tant qu’il n’y a rien à écrire', async () => {
    const memo = new StickerMemo(path)
    await memo.load()
    await memo.flush()
    await expect(readFile(path, 'utf8')).rejects.toThrow()
  })

  it('repart de zéro sur un fichier corrompu au lieu d’échouer', async () => {
    await writeFile(path, '{ ceci n’est pas du JSON', 'utf8')
    const memo = new StickerMemo(path)
    await memo.load()
    expect(memo.size).toBe(0)
    // Et il reste utilisable : le carnet perdu ne coûte que des dépôts redondants.
    expect(memo.put(1, entry())).toBe(true)
  })

  it('ignore les entrées invalides d’un fichier plutôt que les croire', async () => {
    await writeFile(
      path,
      JSON.stringify({
        1: entry(),
        2: { ...entry(), sha256: 'trop-court' },
        3: { ...entry(), url: `https://h.tld/${OTHER}.png` },
        4: 'pas un objet',
        cinq: entry(),
      }),
      'utf8',
    )
    const memo = new StickerMemo(path)
    await memo.load()
    expect(memo.size).toBe(1)
    expect(memo.get(1)).not.toBeNull()
  })

  it('fonctionne en mémoire seule, sans chemin', async () => {
    const memo = new StickerMemo(null)
    await memo.load()
    memo.put(1, entry())
    await memo.flush()
    expect(memo.get(1)).not.toBeNull()
  })

  /* Un système de fichiers en lecture seule est une configuration valable : le
     forum doit continuer, pas s'arrêter. */
  it('survit à un chemin impossible à écrire', async () => {
    const memo = new StickerMemo('/proc/interdit/stickers.json')
    await memo.load()
    expect(memo.put(1, entry())).toBe(true)
    await expect(memo.flush()).resolves.toBeUndefined()
    expect(memo.get(1)).not.toBeNull()
  })
})
