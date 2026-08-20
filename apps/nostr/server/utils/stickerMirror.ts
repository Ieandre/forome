/**
 * Le carnet du miroir : « ce sticker RisiBank est déjà chez nous, à cette
 * empreinte ».
 *
 * ## À quoi il sert
 *
 * La copie des octets est faite par le **navigateur** du premier utilisateur qui
 * poste un sticker donné, avec sa clé (c'est le chemin de `utils/blossom.ts` :
 * notre serveur ne détient aucune clé et ne peut donc pas déposer à la place de
 * quelqu'un). Sans mémoire de ce dépôt, les 400 personnes suivantes qui postent
 * le même sticker le redéposeraient — une signature et un transfert chacune,
 * pour un fichier identique.
 *
 * Ce carnet est cette mémoire : un dépôt par sticker pour toute la vie du forum.
 *
 * ## Pourquoi une entrée perdue n'est pas grave
 *
 * Le stockage est adressé par contenu : redéposer les mêmes octets produit le
 * même sha256, donc la même adresse. Perdre le carnet coûte un dépôt redondant,
 * jamais une incohérence. C'est ce qui autorise à tolérer un système de fichiers
 * en lecture seule au lieu d'exiger un volume.
 *
 * ## Pourquoi tout est validé, à l'écriture comme à la lecture
 *
 * Ce que ce carnet renvoie part dans le tag `imeta` d'events signés **par
 * d'autres utilisateurs**. Une valeur fausse ici — empreinte qui ne correspond
 * pas, dimensions inventées — se retrouve donc signée, définitivement, dans le
 * registre de quelqu'un qui n'a rien fait de mal. D'où la validation à chaque
 * frontière, y compris au chargement d'un fichier qui est pourtant le nôtre.
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface MirrorEntry {
  /** Empreinte des octets déposés. C'est elle qui part dans `imeta` (`x`). */
  sha256: string
  /** Adresse canonique chez l'hôte, celle que lisent les autres clients Nostr. */
  url: string
  mime: string
  width: number
  height: number
}

const SHA256_RE = /^[0-9a-f]{64}$/

/** Alignés sur `imageHeader.ts` : ce qu'on sait mesurer, on sait l'afficher. */
const MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** 32 768 px : au-delà, aucun format qu'on lit ne peut décrire l'image. */
const MAX_EDGE = 32_768

/**
 * Borne du carnet. La spec §8 annonce « quelques milliers de fichiers » ; 200 000
 * laisse deux ordres de grandeur de marge tout en gardant une borne, parce qu'un
 * `Map` sans plafond alimenté depuis l'extérieur est une fuite de mémoire à
 * déclenchement distant. Ajouter une entrée exige un dépôt signé et vérifié,
 * donc ce n'est pas un levier gratuit — mais « pas gratuit » n'est pas « borné ».
 */
const MAX_ENTRIES = 200_000

/** Fenêtre de regroupement des écritures : un tiroir actif produit des rafales. */
const FLUSH_DELAY_MS = 500

export function isMirrorEntry(value: unknown): value is MirrorEntry {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  if (typeof e.sha256 !== 'string' || !SHA256_RE.test(e.sha256)) return false
  if (typeof e.url !== 'string' || !e.url.startsWith('https://')) return false
  if (typeof e.mime !== 'string' || !MIMES.has(e.mime)) return false
  for (const n of [e.width, e.height]) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_EDGE) return false
  }
  return true
}

/**
 * ⚠️ L'adresse doit **porter** l'empreinte.
 *
 * C'est ce qui rend le carnet infalsifiable par son alimentateur : le client
 * annonce une adresse, mais l'empreinte est calculée par le serveur sur les
 * octets de RisiBank. Si l'adresse ne contient pas cette empreinte, elle désigne
 * autre chose que ce qu'on a mesuré, et l'enregistrer ferait signer aux suivants
 * un `x` qui ne correspond pas à l'image affichée.
 */
export function urlCarriesSha(url: string, sha256: string): boolean {
  const path = url.split(/[?#]/)[0] ?? ''
  return new RegExp(`(^|/)${sha256}(\\.[a-z0-9]{1,5})?$`, 'i').test(path)
}

export class StickerMemo {
  readonly #path: string | null
  readonly #entries = new Map<number, MirrorEntry>()

  #loaded = false
  #dirty = false
  #timer: ReturnType<typeof setTimeout> | null = null
  #writing: Promise<void> = Promise.resolve()
  /** Une seule plainte par processus : un FS en lecture seule le reste. */
  #warned = false

  /** `null` : carnet en mémoire seule, ce qui reste correct (voir l'en-tête). */
  constructor(path: string | null) {
    this.#path = path
  }

  get size(): number {
    return this.#entries.size
  }

  /**
   * Relit le carnet. Idempotent : appelable à chaque requête sans coût.
   *
   * Un fichier illisible ou corrompu ne fait pas échouer le démarrage — on repart
   * d'un carnet vide, et le pire qui arrive est une série de dépôts redondants.
   */
  async load(): Promise<void> {
    if (this.#loaded) return
    this.#loaded = true
    if (!this.#path) return

    const raw = await readFile(this.#path, 'utf8').catch(() => null)
    if (raw === null) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null) return

    for (const [key, value] of Object.entries(parsed)) {
      const id = Number(key)
      if (!Number.isInteger(id) || id < 1) continue
      // Une entrée invalide est ignorée, pas réparée : on ne devine pas ce qu'un
      // fichier corrompu voulait dire, et le sticker sera simplement redéposé.
      if (!isMirrorEntry(value) || !urlCarriesSha(value.url, value.sha256)) continue
      this.#entries.set(id, value)
      if (this.#entries.size >= MAX_ENTRIES) break
    }
  }

  get(id: number): MirrorEntry | null {
    return this.#entries.get(id) ?? null
  }

  /**
   * Les entrées connues parmi `ids`, pour annoter une page de résultats d'un
   * coup : le tiroir sait alors quels stickers s'insèrent sans aucun dépôt.
   */
  pick(ids: number[]): Record<string, MirrorEntry> {
    const out: Record<string, MirrorEntry> = {}
    for (const id of ids) {
      const hit = this.#entries.get(id)
      if (hit) out[String(id)] = hit
    }
    return out
  }

  /** Enregistre, puis planifie l'écriture. Refuse une entrée qui ne se tient pas. */
  put(id: number, entry: MirrorEntry): boolean {
    if (!Number.isInteger(id) || id < 1) return false
    if (!isMirrorEntry(entry) || !urlCarriesSha(entry.url, entry.sha256)) return false
    // Premier arrivé, premier servi : réécrire une entrée existante changerait
    // l'adresse d'un sticker que d'autres events citent déjà.
    if (this.#entries.has(id)) return true
    if (this.#entries.size >= MAX_ENTRIES) return false

    this.#entries.set(id, entry)
    this.#dirty = true
    this.#schedule()
    return true
  }

  #schedule(): void {
    if (!this.#path || this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.flush()
    }, FLUSH_DELAY_MS)
    // Sans ça, un carnet écrit une fois par heure suffirait à garder le
    // processus en vie à l'arrêt.
    this.#timer.unref?.()
  }

  /**
   * Écrit le carnet. Sérialisé et atomique : `rename` sur le même système de
   * fichiers est atomique, donc un arrêt au mauvais moment laisse l'ancien
   * fichier intact plutôt qu'un JSON tronqué.
   */
  async flush(): Promise<void> {
    if (!this.#path || !this.#dirty) return
    const path = this.#path

    this.#writing = this.#writing.then(async () => {
      if (!this.#dirty) return
      this.#dirty = false

      const snapshot: Record<string, MirrorEntry> = {}
      for (const [id, entry] of this.#entries) snapshot[String(id)] = entry

      try {
        await mkdir(dirname(path), { recursive: true })
        const tmp = `${path}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(snapshot), 'utf8')
        await rename(tmp, path)
      } catch (e) {
        // Un FS en lecture seule est une configuration valable : le carnet vit
        // alors en mémoire et le forum fonctionne, au prix de dépôts redondants
        // après chaque redémarrage.
        this.#dirty = true
        if (!this.#warned) {
          this.#warned = true
          console.warn(
            `[stickers] carnet non persisté (${e instanceof Error ? e.message : 'erreur inconnue'}) — mémoire seule`,
          )
        }
      }
    })

    return this.#writing
  }
}

let singleton: StickerMemo | null = null

/**
 * Le carnet du processus.
 *
 * Le chemin vient de l'environnement plutôt que de `runtimeConfig` pour que ce
 * module reste testable hors de Nitro (`useRuntimeConfig` n'existe pas sous
 * Vitest). `NUXT_STICKER_MEMO=` vide force le mode mémoire seule.
 */
export function stickerMemo(): StickerMemo {
  if (!singleton) {
    const configured = process.env.NUXT_STICKER_MEMO
    const path = configured === undefined ? '.data/stickers.json' : configured || null
    singleton = new StickerMemo(path)
  }
  return singleton
}
