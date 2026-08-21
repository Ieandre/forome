# Forome

Forum généraliste à haut débit, culture 18-25 : **tu lis en 2 secondes, tu
postes sans compte, et rien ne peut être retiré du réseau.**

Le forum tourne sur **Nostr** : relais indépendants, identité par paire de clés
générée à la première visite (aucune inscription), MP chiffrés de bout en bout
(NIP-17), anti-spam par preuve de travail (NIP-13). Pas de base de données, pas
de serveur applicatif — le client parle directement aux relais. La conception
complète (décisions, refus argumentés, zones ouvertes, roadmap) est dans
[`projet-forum-specification.md`](projet-forum-specification.md).

## Essayer

```bash
npm install
npm run dev:nostr      # http://localhost:3002 — Node ≥ 22, aucun autre prérequis
```

Le client fonctionne seul : il génère une identité locale et lit les relais.
Pour **publier**, il faut un relais local (voir [la pile de dev](#la-pile-locale-complète-sans-toucher-au-réseau-public)) :
en développement, l'écriture est verrouillée sur la machine, parce que sur
Nostr écrire est **irréversible** — un event parti sur un relais public n'en
sort plus.

```bash
npm run build          # build de production du client
npm test               # policy, indexeur, client
npm run typecheck
```

Ces trois-là, plus `smoke:policy`, tournent sur chaque pull request ; un push sur
`main` qui les passe est déployé tout seul ([`docs/deploiement.md`](docs/deploiement.md)).

## Le dépôt

| | |
|---|---|
| [`apps/nostr`](apps/nostr) | **le client** (Nuxt, SPA). Lit les relais, publie avec PoW, consomme le tick de l'indexeur, suit/bloque (kind 3, kind 10000), mentionne (`nostr:npub…` NIP-27 + tag `p`), MP chiffrés NIP-17, signature par signeur distant révocable (NIP-46) |
| [`apps/indexer`](apps/indexer) | **le tick signé** : vélocité, détection de raid, publié comme event Nostr (kind 30078) |
| [`packages/relay-policy`](packages/relay-policy) | **la policy d'écriture**, partagée par le plugin strfry, le relais de dev et l'indexeur. La seule barrière du système, donc la plus testée du dépôt (policy, modération, révisions) |
| [`scripts/`](scripts) | relais de dev, seed, bunker NIP-46, mise en place de la modération, smokes bout en bout |
| [`docs/`](docs) | les documents ci-dessous |

## Où en est le projet

**Fait, et vérifié en local** : le client complet, l'indexeur, la policy — et
**strfry lui-même**, compilé et lancé avec la vraie policy à travers le vrai
protocole de plugin (`npm run smoke:strfry`, [`docs/strfry.md`](docs/strfry.md)).

**Pas fait** :

- **aucun relais à nous n'est déployé.** Tant que `homeRelay` est vide, le
  client lit les relais publics en repli — le forum affiche ce qui existe,
  mais aucune de nos règles ne s'applique nulle part.
- **la réplication.** Il faut **au moins deux** relais avec `strfry sync` :
  un relais unique ridiculiserait la promesse d'incensurabilité.
- **NIP-42 (AUTH)** : les quotas sont par clé, mais rien ne prouve qu'une
  connexion appartient à la clé qu'elle revendique.

⚠️ **Le forum n'a pas été lancé sur le réseau public.** Un seul event y est
parti — par accident, le 15 août 2026, depuis un serveur de dev — et c'est ce
qui a conduit à verrouiller l'écriture : en développement, le client refuse
tout relais tiers (`?public=1` pour passer outre, sciemment, le temps d'une
session). Voir [`apps/nostr/utils/relayTargets.ts`](apps/nostr/utils/relayTargets.ts).

## Les documents

| Document | Rôle |
|---|---|
| [`projet-forum-specification.md`](projet-forum-specification.md) | **la spec** — la direction. Conception, décisions négatives, zones ouvertes, roadmap V1→V4 |
| [`docs/moderation-staff.md`](docs/moderation-staff.md) | **modération outillée** : équipe, pouvoirs, panneau d'administration. Complète le §9 de la spec, qui s'arrête aux contrôles côté lecteur |
| [`docs/strfry.md`](docs/strfry.md) | **le relais** : compiler strfry (dont le patch Apple Clang), le lancer, le vérifier ; qui lit où et qui écrit où, et pourquoi |
| [`docs/deploiement.md`](docs/deploiement.md) | **la mise en production** : le pipeline CI/CD, les secrets à brancher, la santé d'un déploiement, le retour arrière |
| [`docs/seo.md`](docs/seo.md) | ce qu'un moteur de recherche voit d'une SPA branchée sur des relais, et le dispositif `<head>` + sitemap qui répare ça sans SSR |
| [`docs/migration-nostr.md`](docs/migration-nostr.md) | document d'époque : l'inventaire du code v1 au moment du portage, ce qui a survécu, ce qui a été jeté |

## D'où ça vient : le pivot v1 → v2

La v1 était un protocole maison, client-serveur. Elle a été supprimée du dépôt
le 13 août 2026 une fois le portage vers Nostr terminé ; ce qui en a survécu
vit dans `apps/indexer` (hotlist, raid) et `apps/nostr` (composants, QR).

| | v1 (supprimée) | v2 (le dépôt) |
|---|---|---|
| Format | CBOR déterministe maison | event JSON NIP-01 |
| Signature | Ed25519 + X25519 | secp256k1 / Schnorr |
| Identité | clé de compte + clés d'appareil révocables | une clé, transportée par QR |
| Ordre | `seq` serveur, ordre total | `created_at` déclaré par l'auteur |
| Retrait | pierre tombale signée + purge des octets | impossible au-delà de son propre relais |
| Inscription | clés + coffre + kit de secours | aucune — identité générée à la première visite |

Les pertes (ordre total, horloge fiable, révocation de clé, unicité des pseudos,
retrait dur) sont documentées et argumentées dans la spec — §2.4, §3.2, §3.5,
§6.4, §9.2, §10.2. C'est la partie utile du document.

## `apps/nostr` — le client

```
stores/relays.ts      pool multi-relais, dédoublonnage par id, vérification de
                      signature, publication rapportée relais par relais
stores/topics.ts      tick de l'indexeur, avec repli sur un calcul local
stores/profiles.ts    kind 0 groupés et cachés + vérification NIP-05 réelle
stores/identity.ts    clé secp256k1 locale, new khey, NIP-07, signeur NIP-46
stores/social.ts      follows kind 3, mute kind 10000, web of trust
stores/moderation.ts  roster signé par la clé racine, décisions des modérateurs,
                      file de signalements NIP-56 triée par voix distinctes
stores/dms.ts         MP NIP-17 : rumeur → sceau → emballage avec PoW
stores/notifications.ts / reading.ts
                      réponses reçues, position de lecture
packages/relay-policy/src/revisions.ts
                      format des corrections (§2.5) : un event de plus, jamais
                      un remplacement — partagé client / relais / indexeur
                      (`npm run smoke:edit` vérifie le trajet bout en bout)
workers/pow.worker.ts minage NIP-13, deux modes : horodatage libre ou figé
composables/          usePowMiner (singleton, minage spéculatif), usePublisher
components/           TopicList (gel + pilule +N), PostFeed (accrochage, tampon,
                      ambiance, cap DOM), PostItem (codes forum, nº local),
                      Composer (encart + nudge), RichEditor (frappe stylisée,
                      complétion `@…`), PostEditor (correction d'un message
                      publié), DevicePairing (QR + bunker)
utils/mentions.ts     mentions : `nostr:npub…` dans le texte, tag `p` dérivé de
                      l'arbre analysé — donc jamais de notification sans mention
                      visible en face
pages/                / , /t/[id] (vue 30/70) et /new — trois routes, un seul
                      écran ; /dm, /profil, /appareils, /admin, /moderation,
                      /comment-ca-marche (la doc du mécanisme : clés, event
                      signé, relais, PoW, MP — schémas et démos calculées)
```

L'en-tête passe en orange quand les relais sont surchargés, et le pied de la
liste indique si le tri vient de l'indexeur ou d'un calcul local.

## La pile locale complète, sans toucher au réseau public

Deux relais de dev, complémentaires ([`docs/strfry.md`](docs/strfry.md) les
compare) :

```bash
npm run dev:strfry     # :7778 — le VRAI strfry, policy via le protocole de
                       #         plugin réel, base persistante (compilation
                       #         préalable : docs/strfry.md)
npm run dev:relay      # :7447 — relais Node en mémoire, policy appelée en
                       #         direct ; l'outil des tests reproductibles
```

En développement, le client vise `ws://localhost:7778` par défaut — ouvrir
`http://localhost:3002/` suffit. Pour viser le relais Node :
`?relays=ws://localhost:7447`.

```bash
npm run seed:relay     # 3 topics aux profils d'activité contrastés
npm run dev:indexer    # RELAYS=ws://localhost:7778 INDEXER_NSEC=… pour fixer la clé
npm run dev:bunker     # signeur distant NIP-46 ; affiche une URI bunker://

MIN_POW=28 npm run dev:relay   # pour observer un refus de PoW légitime
```

Et les vérifications bout en bout :

```bash
npm run smoke:policy           # protocole du plugin strfry, par pipe réel
npm run smoke:strfry           # la même policy À TRAVERS strfry (dev:strfry requis)
npm run smoke:dm               # MP chiffrés de bout en bout
npm run smoke:nip46            # signature distante + révocation
npm run smoke:moderation       # roster → ban → refus réel du relais
npm run smoke:edit             # correction d'un message, client → relais → lecteur
```

## Se donner les droits de modération, en local

L'équipe est désignée par un **roster signé** par la clé racine du forum
([`docs/moderation-staff.md`](docs/moderation-staff.md)). Rien n'est modéré tant
qu'aucune clé racine n'est épinglée — accepter le roster du premier venu
donnerait à un inconnu le pouvoir de masquer l'écran principal.

Une commande, une seule fois dans la vie du forum :

```bash
npm run setup:moderation      # demande ta npub (profil → « copier »)
npm run dev:relay             # relancer : les deux lisent le même .env
npm run dev:nostr
```

« Modération » apparaît alors dans ton menu. **Tout le reste se fait au clic** :
nommer des modérateurs (onglet *Équipe*), masquer, bannir, verrouiller, épingler.
`/moderation` montre au public qui modère et ce qui a été décidé.

Pourquoi une commande et pas un bouton : le client et le relais sont deux
programmes qui ne se parlent pas, et ils doivent connaître la même clé racine —
sinon « bannir » masque sans bloquer. `setup:moderation` écrit **un seul `.env`**
que les deux lisent. Et si l'interface pouvait nommer un administrateur pour tout
le monde, n'importe qui cliquerait dessus : cette clé épinglée *est* la
protection du forum, pas un réglage.

⚠️ En production, la clé racine n'est **pas** ton identité de tous les jours :
`npm run setup:moderation -- --dediee` en génère une séparée, à garder hors du
navigateur (bunker NIP-46) — Nostr ne permet aucune révocation.

## Prochaine étape

Deux choses, dans cet ordre :

**1. Déployer notre relais — au moins deux.** strfry compile, tourne et
applique la policy en local ; il reste à l'installer quelque part, à remplir
`homeRelay`, et à en synchroniser un deuxième (`strfry sync`) pour que
l'incensurabilité cesse d'être théorique.

**2. Décider de lancer pour de vrai.** Tout est vérifié en local, mais le
premier envoi public ne se rattrape pas. C'est un choix à faire, pas une case à
cocher.

Restent en suspens : **NIP-42** (prouver qu'une connexion possède la clé
qu'elle revendique, le jour où les quotas affrontent un adversaire et pas
seulement du bruit), le **mode ambiance** et le **cap DOM** (jamais atteints
faute de débit), et un point de conception à trancher : bloquer quelqu'un est
actuellement **public** (NIP-51 permettrait de chiffrer la liste), ce qui est
en soi une information.
