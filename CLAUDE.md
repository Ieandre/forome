# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Langue

Tout le dépôt est en français : commentaires, documentation, messages de commit,
noms de routes (`/appareils`, `/profil/editer`, `/comment-ca-marche`) et textes
d'interface. Écrire en français, y compris les commentaires de code.

Les messages de commit suivent `<portée> : <ce que ça change, vu de l'utilisateur>`
(`client : …`, `docs : …`, `deploy : …`) — pas d'impératif technique, pas de
préfixe Conventional Commits.

## Commandes

```bash
npm install
npm run dev:nostr          # client, http://localhost:3002 (Nuxt, port fixé)
npm run dev:strfry         # le VRAI strfry sur :7778 — cible par défaut du client en dev
npm run dev:relay          # relais Node en mémoire sur :7447 (?relays=ws://localhost:7447)
npm run dev:indexer        # RELAYS=… INDEXER_NSEC=… pour fixer la clé du tick
                           # POINTS_STATE=… déplace le score (défaut data/points.json)
npm run dev:bunker         # signeur NIP-46, affiche une URI bunker://
npm run seed:relay         # 3 topics aux profils d'activité contrastés

npm test                   # relay-policy + points + indexer + client
npm run typecheck          # tous les workspaces (--if-present)
npm run build              # build de production du client
```

Un seul fichier de test :

```bash
npm test -w @forome/relay-policy -- test/polls.test.ts
npm test -w @forome/points -- test/ledger.test.ts
npm test -w @forome/nostr-client -- test/mentions.test.ts -t "nom du cas"
```

Vérifications bout en bout (elles publient sur un relais local, jamais ailleurs) :

```bash
npm run smoke:policy       # protocole du plugin strfry par pipe réel — tourne en CI
npm run smoke:strfry       # la même policy À TRAVERS strfry (dev:strfry requis)
npm run smoke:dm           # MP NIP-17 chiffrés
npm run smoke:nip46        # signature distante + révocation
npm run smoke:moderation   # roster → ban → refus réel du relais
npm run smoke:edit         # correction d'un message, client → relais → lecteur
npm run check:relays       # connexion, lecture et NIP-11 des relais publics
```

Modération en local : `npm run setup:moderation` écrit **un seul `.env`** (racine)
que le client et le relais lisent tous les deux ; relancer les deux ensuite,
sinon « bannir » masque sans bloquer.

CI (`.github/workflows/ci.yml`) : typecheck, test, `smoke:policy`, build. Un push
sur `main` qui passe est déployé par SSH sur la VM (`deploy/update.sh`) ; le
retour arrière se fait en relançant le workflow avec `ref = <sha>`.

## Architecture

Trois programmes qui ne se parlent pas et doivent pourtant s'accorder, plus le
code qu'ils sont obligés de lire à l'identique :

| | |
|---|---|
| `apps/nostr` | le client (Nuxt, `ssr: false`, Pinia). Signe et publie ; aucune base de données |
| `apps/indexer` | publie le classement comme event Nostr signé (kind 30078, tag `d` = `forome.tick`) |
| `packages/relay-policy` | la policy d'écriture, **seule implémentation**, partagée par le plugin strfry, `scripts/dev-relay.ts` et l'indexeur. Y vivent aussi les formats que plusieurs programmes doivent lire pareil : révisions, sondages, forme du fil (`thread.ts`) |
| `packages/points` | le barème des points et le pli qui les compte (spec §16). L'indexeur compte, le client dérive le niveau |

Le raisonnement complet est dans `docs/conception.md` ; le code y renvoie par
numéro de section (« spec §9.2 »). Ces renvois sont la clé pour comprendre un
module — les suivre avant de modifier, et les tenir à jour en ajoutant.

### Les invariants qui ne se négocient pas

1. **Rien ne part sur le réseau public depuis un environnement de dev.**
   `apps/nostr/utils/relayTargets.ts` est le verrou ; `?public=1` le lève
   sciemment, le temps d'une session. Sur Nostr, écrire est définitif.
2. **La policy a une seule implémentation.** Deux copies d'une règle de sécurité
   divergent toujours. Idem pour `src/moderation.ts`, partagé client/relais pour
   que masquer et bannir décrivent le même état.
3. **Lecture ≠ écriture.** En production on **lit** chez nous (`homeRelay`, le
   seul où la policy s'applique) et on **écrit** chez nous *et* chez les tiers
   (c'est ce qui rend la promesse de non-effacement vraie). Confondre les deux
   ensembles est le piège du fichier ci-dessus.
4. **Rien n'est modéré sans clé racine épinglée.** `adminPubkey` et
   `indexerPubkey` sont vides par défaut : accepter le roster ou le tick du
   premier venu donnerait à un inconnu le pouvoir de décider de l'écran
   principal. Sans clé, le client calcule son classement lui-même.
5. **La modération filtre, elle ne supprime pas.** Le masquage ne vaut que pour
   notre client ; le seul bannissement qui bannit est le refus avant stockage,
   côté relais (`PolicyConfig.blocked`), et il n'agit que sur le futur.

### Le format, tel que les trois programmes le partagent

- Topics en **kind 11**, réponses en **kind 1111** (NIP-22 : racine en `E`
  majuscule) — jamais kind 1.
- Tout contenu public porte `["t","forome"]` (`COMMUNITY`). Sans cette marque,
  souscrire aux kinds 11 revient à souscrire aux fils de tout Nostr. Le tag est
  une adresse, le relais est le mur.
- **Corriger un message est un event de plus**, jamais un remplacement
  (`src/revisions.ts`) ; l'autorité (« seul l'auteur révise ») se tranche à la
  lecture, la policy étant sans état.
- **PoW NIP-13** obligatoire sur le contenu public et les gift wraps (14 bits) ;
  zéro sur les profils, listes et trafic NIP-46. Minée dans
  `workers/pow.worker.ts`, spéculativement pendant la frappe (`usePowMiner`).
- Les gift wraps NIP-59 sont **antidatés jusqu'à deux jours** par conception :
  la fenêtre `maxPastS` est par kind pour cette raison, ne pas la resserrer.
- Les **points** (spec §16) sont un pli sur les events tenu par l'indexeur, publié
  en seize events remplaçables (`forome.points.<0-f>`) parce qu'un event est borné
  à 32 Ko. Le **niveau** n'est jamais transporté : il se dérive des points chez le
  lecteur. Et il ne débloque **rien** — un droit derrière un nombre que l'indexeur
  seul établit mettrait l'indexeur sur le chemin critique de l'écriture.

### Côté client

- `stores/relays.ts` est la seule porte vers le réseau : pool multi-relais,
  dédoublonnage par `id`, signature vérifiée par le pool, publication rapportée
  relais par relais.
- `/`, `/new` et `/t/:id` rendent **le même composant** avec la même `key`
  (`hooks['pages:extend']` dans `nuxt.config.ts`) : trois pages distinctes
  démonteraient tout le forum, souscriptions comprises, à chaque clic. Ce sont
  trois routes et surtout pas trois alias — voir le commentaire du fichier.
- L'écran n'attend ni la crypto ni le réseau : le geste se voit au moment du
  geste, la PoW et la signature suivent derrière.
- Aucun compteur technique devant le lecteur — ils décrivent le client, pas le
  forum, et vivent derrière `?dev=1` (`composables/useDevTools.ts`).
- SEO sans SSR : `server/plugins/seoHead.ts` réécrit le `<head>` avant l'envoi du
  HTML (`docs/seo.md`).

### Les deux relais de dev

`dev:relay` (Node, en mémoire, policy appelée en direct) est l'outil du test
reproductible et celui dont dépendent les smokes. `dev:strfry` est le seul qui
prouve que la policy tient **là où elle tournera** — protocole de plugin réel,
base persistante ; compilation préalable décrite dans `docs/strfry.md`.

Si strfry refuse tout en « internal error » : vérifier le bit `+x` sur
`packages/relay-policy/run-strfry.sh` avant de chercher un bug dans la policy.

## Commentaires

Ils portent les *pourquoi* : la décision prise, le piège qu'une modification
innocente ferait revenir, l'écart délibéré avec l'usage attendu. C'est la
première chose à lire avant de toucher un module, et la convention à tenir en en
ajoutant. Jamais pour paraphraser la ligne du dessous ni raconter ce qui a changé.
