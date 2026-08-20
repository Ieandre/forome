/**
 * Installe la modération du forum, une fois pour toutes.
 *
 * Le problème que ce script résout : « quelle clé ce forum écoute » doit être
 * connu de **deux** programmes qui ne se parlent pas — le client, qui replie ce
 * que l'équipe a masqué, et le relais, qui refuse d'écrire ce qu'elle a banni.
 * Les configurer à la main, chacun de son côté, était la friction que ce script
 * supprime : il écrit **un seul `.env`**, que les deux lisent.
 *
 * Ce n'est pas une commodité de développement qu'on pourrait remplacer par un
 * bouton dans l'interface. Si l'app pouvait rendre quelqu'un administrateur pour
 * tout le monde, n'importe qui cliquerait dessus : la clé épinglée **est** la
 * sécurité du système, pas un réglage oublié. Ce qui doit être fluide — nommer
 * un modérateur, masquer, bannir — se fait entièrement dans le panneau, après.
 *
 * Usage :
 *   npm run setup:moderation                 # demande ta npub
 *   npm run setup:moderation npub1…          # sans question
 *   npm run setup:moderation -- --dediee     # génère une clé racine dédiée
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { npubEncode, nsecEncode } from 'nostr-tools/nip19'
import { normalizePubkey } from '@forome/relay-policy/moderation'

const ENV_PATH = new URL('../.env', import.meta.url).pathname
const args = process.argv.slice(2)
const dedicated = args.includes('--dediee') || args.includes('--dedicated')
const fromArg = args.find((a) => !a.startsWith('-'))

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Écrit les clés dans `.env` **sans écraser le reste du fichier** : il peut déjà
 * contenir la configuration Blossom ou l'indexeur, et repartir de zéro à chaque
 * installation ferait perdre en silence des réglages qu'on n'a pas demandé à
 * changer.
 */
function writeEnv(entries: Record<string, string>): string[] {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
  const lines = existing.split('\n').filter((l) => l.trim() !== '')
  const changed: string[] = []

  for (const [key, value] of Object.entries(entries)) {
    const at = lines.findIndex((l) => l.startsWith(`${key}=`))
    const line = `${key}=${value}`
    if (at >= 0) {
      if (lines[at] !== line) changed.push(key)
      lines[at] = line
    } else {
      changed.push(key)
      lines.push(line)
    }
  }
  writeFileSync(ENV_PATH, `${lines.join('\n')}\n`, 'utf8')
  return changed
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

async function main(): Promise<void> {
  console.log('\n  Installation de la modération de Forome\n')

  let rootPubkey: string
  let rootNsec: string | null = null

  if (dedicated) {
    // Le chemin de production : la clé racine ne signe que le roster, quelques
    // events par an. Elle n'a rien à faire dans un navigateur, et Nostr n'offre
    // aucune révocation — une clé racine compromise l'est définitivement.
    const sk = generateSecretKey()
    rootPubkey = getPublicKey(sk)
    rootNsec = nsecEncode(sk)
    console.log('  Clé racine dédiée générée. Elle ne sert QU’À nommer les modérateurs.\n')
    console.log(`    ${rootNsec}\n`)
    console.log('  ⚠️  Sauvegarde-la maintenant, hors de ce dépôt. Elle ne sera plus affichée,')
    console.log('     et Nostr ne permet pas de la révoquer si elle fuite.')
    console.log('     En production, elle vit dans un signeur NIP-46 — pas dans un navigateur.\n')
  } else {
    const input =
      fromArg ??
      (await ask(
        '  Ta clé publique (forum → menu en haut à droite → Mon profil → « copier »)\n  npub… : ',
      ))
    const normalized = normalizePubkey(input)
    if (!normalized) {
      console.error(`\n  ✗ « ${input} » n’est pas une clé publique.`)
      console.error('    Attendu une npub… (le bouton « copier » de ton profil en donne une).')
      if (input.startsWith('nsec')) {
        console.error('    Ceci est ta clé PRIVÉE : ne la colle nulle part, elle EST ton compte.')
      }
      process.exit(1)
    }
    rootPubkey = normalized
  }

  const npub = npubEncode(rootPubkey)
  const changed = writeEnv({
    // Lue par le client (Nuxt la mappe sur `runtimeConfig.public.adminPubkey`).
    NUXT_PUBLIC_ADMIN_PUBKEY: rootPubkey,
    // Lue par le relais de dev, qui refuse d'écrire ce que l'équipe a banni.
    ADMIN_PUBKEY: rootPubkey,
  })

  console.log(`  ✓ .env écrit — ${changed.length ? changed.join(', ') : 'déjà à jour'}`)
  console.log(`    clé racine du forum : ${npub.slice(0, 20)}…\n`)

  if (dedicated) {
    console.log('  Prochaine étape : ouvre /admin avec cette clé racine (import de la nsec,')
    console.log('  ou signeur NIP-46) et nomme tes modérateurs depuis l’onglet Équipe.\n')
  } else {
    console.log('  Tu es la clé racine de ce forum. Relance les deux processus :\n')
    console.log('    npm run dev:relay')
    console.log('    npm run dev:nostr\n')
    console.log('  « Modération » apparaîtra dans ton menu. Tout le reste — nommer des')
    console.log('  modérateurs, masquer, bannir, verrouiller — se fait depuis le panneau.\n')
    console.log('  ⚠️  Pour un vrai déploiement, ne réutilise pas ton identité de tous les')
    console.log('     jours : `npm run setup:moderation -- --dediee` génère une clé séparée.\n')
  }
}

void main()
