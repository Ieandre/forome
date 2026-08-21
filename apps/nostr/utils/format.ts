/**
 * Formateurs. **Toutes les durées sont en secondes** (unité Nostr) — voir
 * l'avertissement dans `types/nostr.ts`.
 */
import { mentionUriRegex, decodeMentionUri } from '~/utils/richtext'
import { kheyHandle } from '~/utils/nostr'

/**
 * Formateurs ICU construits une fois. `toLocale*String` avec options en crée un
 * neuf à CHAQUE appel — et un re-rendu du fil, c'est ~300 appels d'un coup.
 */
const HMS = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const DAY_LONG = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const DAY_LONG_NO_YEAR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' })
const ABSOLUTE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const HM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

export function relativeTime(sec: number): string {
  const s = Math.round(Date.now() / 1000 - sec)
  if (s < 5) return "à l'instant"
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} j`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo} mois`
  const y = Math.round(mo / 12)
  return `${y} an${y > 1 ? 's' : ''}`
}

/**
 * Horodatage de post, au format des forums de jeuxvideo.com :
 * « Le 11 août 2026 à 15:18:22 ». Le jour est omis pour la journée en cours,
 * parce que dans un fil vivant il est redondant sur des centaines de rangées.
 *
 * Les secondes sont conservées : dans un forum à haut débit, deux messages de
 * la même minute sont la règle, et l'ordre relatif est une information.
 */
export function forumTime(sec: number): string {
  const d = new Date(sec * 1000)
  const hms = HMS.format(d)
  const now = new Date()
  const sameDay =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  if (sameDay) return `à ${hms}`
  return `Le ${DAY_LONG.format(d)} à ${hms}`
}

export function absoluteTime(sec: number): string {
  return ABSOLUTE.format(new Date(sec * 1000))
}

/** L'heure seule. Dans un fil de MP, la date est portée par le filet de jour. */
export function clockTime(sec: number): string {
  return HM.format(new Date(sec * 1000))
}

/** Clé de jour locale, pour découper un fil. Pas UTC : on segmente sur SES jours. */
export function dayKey(sec: number): string {
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function dayLabel(sec: number): string {
  const d = new Date(sec * 1000)
  const now = new Date()
  const jour = 86400_000
  const minuit = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (t === minuit) return "aujourd'hui"
  if (t === minuit - jour) return 'hier'
  const memeAnnee = d.getFullYear() === now.getFullYear()
  return (memeAnnee ? DAY_LONG_NO_YEAR : DAY_LONG).format(d)
}

export function shortId(id: string, n = 8): string {
  return `${id.slice(0, n)}…`
}

/**
 * Aperçu en texte plat d'un message, pour la citation en tête d'une réponse.
 *
 * Ce n'est pas un rendu : les marqueurs sont retirés (`**gras**` → `gras`) et
 * les sauts de ligne écrasés. Une citation est une amorce d'une ou deux lignes,
 * pas un second message rendu à l'identique — et un vrai rendu ferait s'imbriquer
 * les citations de citations jusqu'à noyer la réponse elle-même.
 *
 * ⚠️ Les spoilers sont **remplacés**, jamais dépouillés : retirer les `||`
 * afficherait en clair, dans la réponse, ce que l'auteur d'origine avait masqué.
 * Même raison pour les blocs de code, qu'on ne veut pas voir s'aplatir sur une
 * ligne.
 */
export function quotePreview(
  text: string,
  max = 220,
  nameOf: (pubkey: string) => string = kheyHandle,
): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/\|\|[\s\S]*?\|\|/g, ' [spoil] ')
    .replace(/`([^`]*)`/g, '$1')
    /*
     * Une mention redevient un pseudo. Laisser passer l'URI mettrait 63
     * caractères de bech32 dans une amorce de deux lignes — et un identifiant
     * technique à la place de ce qu'il désigne est précisément ce qu'on refuse
     * ailleurs (voir la citation montrée en tête de réponse).
     *
     * `nameOf` par défaut ne dépend de rien : le handle `khey_` se déduit de la
     * clé. L'appelant qui a les profils sous la main passe le vrai pseudo, pour
     * que l'amorce nomme les gens comme le fil au-dessus.
     */
    .replace(mentionUriRegex(), (whole, bech: string) => {
      const pubkey = decodeMentionUri(bech)
      return pubkey ? `@${nameOf(pubkey)}` : whole
    })
    // Un lien ne garde que son libellé : l'URL est du bruit dans une amorce.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Une image est nommée, pas transcrite : son adresse fait 80 caractères sans
    // espace et remplirait à elle seule les deux lignes de l'amorce.
    .replace(/https?:\/\/\S+?\.(?:png|jpe?g|gif|webp|avif)(?:\?\S*)?(?=\s|$)/gi, ' [image] ')
    .replace(/^\s*>+\s?/gm, '')
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
    // `**` avant `*`, sinon le gras se lirait comme deux italiques vides. Le `_`
    // seul n'est pas un marqueur ici, et le retirer casserait `snake_case`.
    .replace(/\*\*|__|~~|\*/g, '')
    .replace(/\s+/g, ' ')
    // Les remplacements ci-dessus laissent une espace avant la ponctuation
    // (« un spoiler : [spoil] . »). Seuls le point et la virgule sont recollés :
    // en français, « ; », « ! », « ? » et « : » prennent bien une espace avant.
    .replace(/\s+([.,])/g, '$1')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}
