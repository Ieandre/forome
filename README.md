# Forome

Forum généraliste à haut débit : **tu lis en 2 secondes, tu postes sans compte,
et rien ne peut être retiré du réseau.**

Forome n'a pas de base de données, pas de comptes, pas de serveur applicatif au
milieu. Le client parle directement à des **relais Nostr indépendants** : il y
lit les messages et y publie les tiens, signés par une clé qui n'existe que dans
ton navigateur. Il n'y a rien à administrer qui puisse décider, un jour, de ce
que le forum a le droit de contenir.

Tout le code est ici, sous licence libre [AGPL-3.0](LICENSE) : ce forum se relit,
se modifie et se réhéberge, par n'importe qui.

## Pourquoi ça change quelque chose

Sur un forum classique, un message vit à un seul endroit — la base de données de
celui qui l'héberge. Il peut être modifié, retiré, ou disparaître avec le
serveur, et personne n'a de recours. Ici, un message est un **event signé** :

- **Tu le signes, pas nous.** Ton identité est une paire de clés générée à la
  première visite, sans inscription. La clé privée ne quitte pas l'appareil, et
  la même identité fonctionne dans n'importe quel autre client Nostr.
- **Il part sur plusieurs relais qui ne se connaissent pas.** Chacun en garde sa
  copie. Faire taire un message demanderait de convaincre tous les relais du
  réseau, simultanément et pour toujours — y compris ceux qui n'existent pas
  encore.
- **Personne ne peut le falsifier.** La signature est vérifiée à la réception :
  un relais peut refuser de servir un message, jamais en fabriquer un ou en
  changer le contenu.
- **La modération filtre, elle ne supprime pas.** Un modérateur retire un
  message de *ce* forum ; il ne le retire pas du réseau. La distinction est
  assumée et affichée à l'utilisateur, plutôt que promise à l'envers.

Ce que ça coûte, et qui est documenté plutôt que caché :

- **Publier est définitif.** Il n'y a pas de suppression garantie, seulement une
  demande de suppression que chaque relais honore ou non.
- **Pas d'ordre total.** L'heure d'un message est déclarée par son auteur ; le
  fil affiche l'ordre d'arrivée et ne le réécrit jamais.
- **Les pseudos ne sont pas uniques.** L'identité est la clé publique, donc tout
  pseudo affiché porte son discriminant de clé.
- **Pas de révocation de clé.** Une clé compromise est une identité perdue. Le
  remède est un signeur distant (NIP-46), où la clé reste ailleurs et le client
  ne détient qu'une autorisation révocable.

Le raisonnement complet — les décisions, les refus argumentés, les questions
encore ouvertes — est dans [`docs/conception.md`](docs/conception.md).

## Démarrer

```bash
npm install
npm run dev:nostr      # http://localhost:3002 — Node ≥ 22, aucun autre prérequis
```

Le client démarre seul et génère une identité locale. En développement il ne
parle qu'au **relais local**, en lecture comme en écriture : sans lui, la liste
reste vide (voir [la pile locale](#la-pile-locale)).

En développement, l'écriture est **verrouillée sur la machine** : le client
refuse tout relais tiers, parce qu'un essai parti sur un relais public n'en
revient pas. `?public=1` lève le verrou, sciemment, le temps d'une session.

```bash
npm test               # policy, indexeur, client
npm run typecheck
npm run build          # build de production du client
```

Ces trois-là, plus `smoke:policy`, tournent sur chaque pull request ; un push sur
`main` qui les passe est déployé automatiquement
([`docs/deploiement.md`](docs/deploiement.md)).

## Le dépôt

| | |
|---|---|
| [`apps/nostr`](apps/nostr) | **le client** (Nuxt, SPA). Lit les relais, publie avec preuve de travail, suit et bloque (kind 3, kind 10000), mentionne (`nostr:npub…`), MP chiffrés de bout en bout (NIP-17), signeur distant révocable (NIP-46) |
| [`apps/indexer`](apps/indexer) | **le tick signé** : vélocité des topics et détection de raid, publiés comme event Nostr (kind 30078) plutôt que calculés par chaque client |
| [`packages/relay-policy`](packages/relay-policy) | **la policy d'écriture**, partagée par le plugin strfry, le relais de dev et l'indexeur. La seule barrière du système, donc la plus testée du dépôt |
| [`scripts/`](scripts) | relais de dev, seed, bunker NIP-46, mise en place de la modération, smokes bout en bout |
| [`docs/`](docs) | conception, relais, déploiement, modération, SEO |

## Comment le client est fait

```
stores/relays.ts      pool multi-relais, dédoublonnage par id, vérification de
                      signature, publication rapportée relais par relais
stores/topics.ts      tick de l'indexeur, avec repli sur un calcul local
stores/profiles.ts    kind 0 groupés et cachés + vérification NIP-05 réelle
stores/identity.ts    clé secp256k1 locale, identité jetable, NIP-07, NIP-46
stores/social.ts      follows kind 3, mute kind 10000, web of trust
stores/moderation.ts  roster signé par la clé racine, décisions des modérateurs,
                      file de signalements NIP-56 triée par voix distinctes
stores/dms.ts         MP NIP-17 : rumeur → sceau → emballage, avec PoW
stores/notifications.ts / reading.ts
                      réponses reçues, position de lecture
workers/pow.worker.ts minage NIP-13, deux modes : horodatage libre ou figé
composables/          usePowMiner (minage spéculatif pendant la frappe),
                      usePublisher
components/           TopicList (liste gelée pendant la lecture), PostFeed
                      (accrochage bas de fil, tampon de débit, cap DOM),
                      PostItem, Composer, RichEditor (frappe stylisée,
                      complétion `@…`), PostEditor (correction d'un message
                      publié), DevicePairing (QR + bunker)
utils/mentions.ts     mentions : `nostr:npub…` dans le texte, tag `p` dérivé de
                      l'arbre analysé — donc jamais de notification sans mention
                      visible en face
pages/                / , /t/[id] (vue 30/70) et /new ; /dm, /profil,
                      /appareils, /admin, /moderation, et /comment-ca-marche,
                      qui explique le mécanisme à l'utilisateur (clés, event
                      signé, relais, PoW, MP) avec schémas et démos calculées
```

Les corrections de message ([`packages/relay-policy/src/revisions.ts`](packages/relay-policy/src/revisions.ts))
sont un event **de plus**, jamais un remplacement : le format est partagé par le
client, le relais et l'indexeur, et `npm run smoke:edit` en vérifie le trajet
complet.

## La pile locale

Deux relais de dev, complémentaires
([`docs/strfry.md`](docs/strfry.md) les compare) :

```bash
npm run dev:strfry     # :7778 — le VRAI strfry, policy via le protocole de
                       #         plugin réel, base persistante (compilation
                       #         préalable : docs/strfry.md)
npm run dev:relay      # :7447 — relais Node en mémoire, policy appelée en
                       #         direct ; l'outil des tests reproductibles
```

En développement le client vise `ws://localhost:7778` par défaut — ouvrir
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

« Modération » apparaît alors dans le menu. **Tout le reste se fait au clic** :
nommer des modérateurs, masquer, bannir, verrouiller, épingler. `/moderation`
montre au public qui modère et ce qui a été décidé.

Pourquoi une commande et pas un bouton : le client et le relais sont deux
programmes qui ne se parlent pas, et ils doivent connaître la même clé racine —
sinon « bannir » masque sans bloquer. `setup:moderation` écrit **un seul `.env`**
que les deux lisent. Et si l'interface pouvait nommer un administrateur pour tout
le monde, n'importe qui cliquerait dessus : cette clé épinglée *est* la
protection du forum, pas un réglage.

⚠️ En production, la clé racine n'est **pas** une identité de tous les jours :
`npm run setup:moderation -- --dediee` en génère une séparée, à garder hors du
navigateur (bunker NIP-46) — Nostr ne permet aucune révocation.

## Les documents

| Document | Rôle |
|---|---|
| [`docs/conception.md`](docs/conception.md) | **la conception** : le protocole tel qu'on s'en sert, les décisions et leurs raisons, les refus argumentés, les questions ouvertes |
| [`docs/strfry.md`](docs/strfry.md) | **le relais** : compiler strfry, le lancer, le vérifier ; qui lit où, qui écrit où, et pourquoi |
| [`docs/deploiement.md`](docs/deploiement.md) | **la mise en production** : le pipeline, les secrets, la santé d'un déploiement, le retour arrière |
| [`docs/moderation-staff.md`](docs/moderation-staff.md) | **la modération outillée** : équipe, pouvoirs, panneau d'administration |
| [`docs/seo.md`](docs/seo.md) | ce qu'un moteur de recherche voit d'une SPA branchée sur des relais, et le dispositif qui répare ça sans SSR |

## Contribuer

Les commentaires du code portent les *pourquoi* : un fichier explique la
décision et le piège qu'une modification innocente ferait revenir. C'est la
première chose à lire avant de toucher à un module, et la convention à tenir en
en ajoutant.

Deux règles qui ne se négocient pas, parce qu'elles protègent des utilisateurs
et pas du code :

1. **Rien ne part sur le réseau public depuis un environnement de
   développement.** Le verrou est dans
   [`apps/nostr/utils/relayTargets.ts`](apps/nostr/utils/relayTargets.ts).
2. **La policy d'écriture a une seule implémentation**
   ([`packages/relay-policy`](packages/relay-policy)), partagée par le relais,
   le relais de dev et l'indexeur. Deux copies d'une règle de sécurité finissent
   toujours par diverger.

## Licence

**Logiciel libre**, sous [GNU AGPL-3.0](LICENSE) — Copyright (C) 2026 les
contributeurs de Forome.

Lire, modifier, héberger, ouvrir son propre forum : tout est permis. La seule
contrepartie est celle qui compte ici — **qui héberge une version modifiée en
publie les sources**. Un forum dont le code serait invérifiable ne pourrait rien
promettre à ses lecteurs ; la licence est ce qui étend cette promesse aux
instances que nous ne tenons pas.
