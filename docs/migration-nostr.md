# Migration vers Nostr — état des lieux et chemin

> Compagnon de [`../projet-forum-specification.md`](../projet-forum-specification.md)
> (spec v2). Ce document ne conçoit rien : il inventorie **le code qui existe**
> et dit, fichier par fichier, ce qui survit au pivot, ce qui se rebranche et ce
> qui est jeté.
>
> **État au 2026-08-15.** Les **quatre étapes sont faites** : `apps/nostr` lit,
> publie, suit et échange des MP chiffrés ; `packages/relay-policy` porte la
> policy d'écriture, **appliquée par un vrai strfry** depuis le 2026-08-15
> (`docs/strfry.md`) ; `apps/indexer` publie un tick signé que le client
> consomme. Voir §7 à §10 pour ce qui est vérifié et, surtout, ce qui ne l'est
> pas.
>
> Le forum a désormais un **périmètre** : tout kind 11 / 1111 porte
> `["t","forome"]`, le client et l'indexeur filtrent dessus, la policy le refuse
> sinon. Sans lui, souscrire aux topics sur un relais public rapatriait les fils
> de tout Nostr — ce n'était pas une hypothèse, un topic d'un inconnu s'est
> affiché dans la liste.
>
> Rien n'a encore été publié sur un relais **public** : tout est vérifié contre
> un relais local, délibérément (§8).
>
> `apps/web`, `apps/server` et `packages/protocol` sont **inchangés** et
> implémentent toujours la spec v1
> ([`spec-v1-protocole-maison.md`](spec-v1-protocole-maison.md)) : la v1 reste
> lançable comme référence UX, ce qui était l'étape 0.
>
> Ce qui reste du plan et non du fait : la **réplication entre relais**
> (`strfry sync` / negentropy) — tant qu'il n'y a qu'un relais, la promesse
> d'incensurabilité est théorique. Et NIP-42, sans quoi les quotas par clé ne
> tiennent pas face à un adversaire.

---

## 1. Le résumé en trois lignes

- **Toute la couche UI survit** — c'est l'actif principal, et c'est aussi le seul
  avantage concurrentiel réel sur les clients Nostr existants (spec v2 §7.5).
- **Toute la couche protocole est jetée** — format, signatures, reçus, ordre.
  C'est la définition du pivot.
- **La couche serveur se scinde en deux** : ce qui certifiait disparaît, ce qui
  agrégeait devient l'indexeur (spec v2 §5.4).

Ordre de grandeur : `apps/web` est réutilisable à ~70 %, `apps/server` à ~35 %,
`packages/protocol` à ~15 %.

---

## 2. `packages/protocol` — 15 % survit

La bibliothèque canonique du format v1. Son intérêt principal — une seule
implémentation partagée client/serveur pour éviter la divergence de
canonicalisation — **devient sans objet** : NIP-01 spécifie la sérialisation en
amont et `nostr-tools` l'implémente (spec v2 §2.2, §13).

| Fichier | Sort | Détail |
|---|---|---|
| `cbor.ts` | **jeté** | codec CBOR déterministe maison (~200 lignes + vecteurs de test). Nostr sérialise en JSON selon NIP-01 |
| `envelope.ts` | **jeté** | enveloppes signées, conservation des octets originaux. Un event Nostr recalcule son id |
| `verify.ts` | **jeté** | chaîne de vérification à deux étapes (signature d'appareil + délégation valide à la date). Remplacé par `verifyEvent` — une étape, pas de délégation |
| `records.ts` | **jeté** | types du format (`post`, `edit`, `retract`, `moderate`, `profile`) → kinds Nostr |
| `builders.ts` | **jeté** | constructeurs de charges utiles → `finalizeEvent` |
| `keys.ts` | **jeté** | Ed25519 + X25519, deux étages, délégation. Nostr : une clé secp256k1, pas de délégation (spec v2 §3.2) |
| `dm.ts` | **jeté** | MP scellés maison → NIP-17 / NIP-44 / gift wrap (spec v2 §10.1) |
| `hash.ts` | **jeté** | trivial, remplacé par ce que `nostr-tools` utilise |
| `bytes.ts` | **réutilisable** | hex, base64url, utf8 — sans dépendance au format |
| **`vault.ts`** | **réutilisable** | Argon2id (~64 Mio, dérivation côté client) + XChaCha20-Poly1305 sur des octets arbitraires. Chiffre une `nsec` sans une ligne de changement → c'est le niveau 3 de l'échelle de récupération (spec v2 §3.4). **La seule brique crypto qui survit intacte** |
| **`identicon.ts`** | **réutilisable** | grille 5×5 dérivée du sha256 de la clé publique. Une clé Nostr est aussi 32 octets hex : retirer l'appel à `publicKeyFromId` (validation Ed25519) et passer le `pubkey` brut. Devient une **défense contre l'usurpation de pseudo** (spec v2 §3.5) |

Décision : ne pas faire évoluer ce paquet, en créer un nouveau
(`packages/nostr` ou directement `nostr-tools` dans le front) et **garder
`packages/protocol` intact** tant que la V1 lecture seule n'est pas validée.
L'app v1 doit rester lançable — c'est le point de comparaison UX.

---

## 3. `apps/server` — se scinde en deux

Tout ce qui **certifiait** (signer des reçus, attribuer un `seq`, arbitrer)
disparaît : c'était le rôle du serveur principal, et le pivot le supprime. Tout
ce qui **agrégeait** devient l'indexeur, qui ne certifie rien et reste
remplaçable (spec v2 §5.4).

| Fichier | Sort | Détail |
|---|---|---|
| `serverKey.ts` | **jeté** | clé du serveur, reçus signés. Plus de reçu (spec v2 §2.4) |
| `routes/forum.ts` (écriture) | **jeté** | ingestion, attribution du `seq` en transaction, reçus. Le client publie directement aux relais |
| `services/ingest.ts` | **jeté** | pipeline de vérification à l'ingestion → policy d'écriture strfry |
| `realtime/hub.ts` | **jeté** | protocole WS maison (canal topic / tick / personnel). Remplacé par les souscriptions `REQ` du relais (spec v2 §5.1) |
| `auth.ts` | **jeté** | sessions par défi signé, autorisation de clés d'appareil → NIP-42 côté relais |
| `routes/accounts.ts` | **partiel** | le coffre chiffré (`vault`) survit comme service de sauvegarde ; le reste (délégations d'appareil) part |
| `routes/social.ts` | **jeté** | suivre / bloquer en base → kind 3 et kind 10000 (spec v2 §11.2) |
| `db/migrations/001_init.sql` | **refait** | plus de table `messages` faisant autorité : l'indexeur a un schéma de projection, reconstructible depuis les relais. Changement de statut majeur — la base cesse d'être la source de vérité |
| **`services/hotlist.ts`** | **cœur de l'indexeur** | structure en mémoire des topics touchés, tri par vélocité (participants distincts + rythme + accélération), éviction. Logique métier intacte : seule l'entrée change (events de relais au lieu de messages ingérés), et la sortie devient un event remplaçable signé (spec v2 §5.2) |
| **`services/raid.ts`** | **réutilisable** | détection d'anomalie. Adapter « comptes récents » → « clés hors web of trust » (spec v2 §9.5) |
| **`services/risibank.ts`** | **réutilisable tel quel** | proxy + cache de recherche. Aucun lien avec le format |
| **`services/imgsize.ts`** | **réutilisable** | mesure des dimensions → alimente le tag `imeta` (`dim`, `x`) au lieu des champs signés (spec v2 §6.2, §8) |
| `routes/stickers.ts` | **partiel** | le miroir média survit ; l'exposition change (Blossom / NIP-96, adressage par sha256) |
| `services/bus.ts` | **réutilisable** | pubsub Redis, utile à l'indexeur multi-instance |
| `test/hotlist.test.ts`, `test/raid.test.ts`, `test/imgsize.test.ts` | **réutilisables** | les tests suivent leur service |

À ajouter, qui n'existe pas :

- **relais strfry** + plugin de policy d'écriture (kinds, PoW minimale, fenêtre
  `created_at`, débit par clé/IP)
- **suivi des relais** dans l'indexeur : `SimplePool` côté Node, dédoublonnage
  par `id`, backfill
- **publication du tick** et éventuellement de la numérotation, signés par la
  clé de l'indexeur

---

## 4. `apps/web` — ~70 % survit

C'est l'actif. Le fil de messages concentre l'accrochage, le tampon de lissage,
la réservation d'espace, le cap DOM et la correction de scroll — et aucune
bibliothèque ne le donne complet, dans aucun écosystème.

### Réutilisable sans toucher à la logique

| Fichier | Ce qui survit |
|---|---|
| `components/MessageFeed.vue` | accrochage, tampon, ambiance, cap DOM, correction de scroll. **Le composant le plus précieux du dépôt** |
| `components/TopicList.vue` | **le gel de la liste** (`frozen` sur survol/focus, `pendingOrder`, pilule `+N`, réordonnancement au dégel) — l'innovation UX centrale de la spec v2 §7.1, déjà écrite et validée |
| `components/MessageItem.vue` | codes forum : rangée distincte, barre d'auteur, numéro visible, « Citer » permanent. Voir §5 pour le numéro |
| `components/Composer.vue`, `StickerDrawer.vue`, `AttachmentImage.vue`, `QuoteCard.vue` | composeur, tiroir de stickers, réservation d'espace par dimensions, citation en contexte |
| `components/ForumShell.vue`, `NewTopicPanel.vue`, `UserDock.vue`, `UserMenu.vue` | vue 30/70, feuille mobile, chrome de l'app |
| `components/IdenticonAvatar.vue` | suit `identicon.ts` |
| `components/QrCode.vue` | **le rendu du QR survit ; sa charge utile change complètement** — voir §4 « à réécrire » |
| `composables/useMessageCache.ts`, `useHandleCache.ts`, `useToasts.ts` | caches et notifications, agnostiques du transport |
| `utils/format.ts` | formatage |
| `assets/css/main.css` | tout le design |

### À rebrancher (l'interface publique reste, l'intérieur change)

| Fichier | Aujourd'hui | Après |
|---|---|---|
| `composables/useSocket.ts` | socket unique vers notre serveur, 3 canaux multiplexés, protocole maison | pool de relais `nostr-tools`, souscriptions `REQ`, dédoublonnage par `id`. **L'API du composable peut rester quasi identique** — c'est ce qui rend la migration du front supportable |
| `composables/useApi.ts` | REST vers notre serveur | requêtes à l'indexeur (liste, recherche, backfill) uniquement |
| `composables/useIdentity.ts` (487 lignes) | clé de compte + clés d'appareil + délégations + sessions + coffre | génération secp256k1, `khey_<8 hex>`, signature locale, NIP-07, plus tard NIP-46. **Le plus gros morceau de réécriture du front** |
| `composables/useRelations.ts` | suivre / bloquer via l'API | kind 3 et kind 10000, publiés aux relais |
| `composables/useOnboarding.ts`, `useRecoveryTracking.ts` | onboarding clés + coffre + kit de secours, nudge de sauvegarde | garder le **squelette et le timing** (nudge après quelques posts, jamais bloquant) et changer le contenu : c'est exactement l'onboarding inversé de la spec v2 §3.1 |
| `utils/verify.ts` | vérification à deux étapes côté client | `verifyEvent` |
| `utils/http.ts` | base URL API + WS | URLs de relais |
| `pages/dm.vue` | MP scellés maison | NIP-17 |
| `pages/u/[aut].vue` | profil signé | kind 0 |
| `plugins/identity.client.ts` | init identité au boot | idem, sur la nouvelle identité |

### À réécrire entièrement

| Fichier | Pourquoi |
|---|---|
| `composables/useDevicePairing.ts` | **piège** : malgré le nom et la présence de `QrCode.vue`, ce n'est **pas** un transport de clé par QR. C'est une délégation — l'appareil neuf génère sa propre clé, affiche son id, et sonde la session jusqu'à autorisation depuis un appareil déjà connecté. Le modèle v2 est l'inverse exact : **la clé elle-même voyage** dans le QR (`nsec`, NIP-19), sans serveur, sans polling, sans délégation. Rien de la logique ne survit — seulement le composant d'affichage |
| `utils/rescueKit.ts` | kit de secours du format v1 → sauvegarde `nsec` (claire ou chiffrée par `vault.ts`) |
| `types/api.ts` | types du contrat maison → types d'events Nostr |

### À ajouter, qui n'existe pas

- **mineur de PoW** (NIP-13) en Web Worker, difficulté adaptée à l'appareil
- **encart non bloquant au premier post** (« Tu postes en tant que
  `khey_a3f81b2c` … [Choisir un pseudo] [Poster comme ça] »)
- **bouton « ↻ new khey »**
- **topic chaud pré-ouvert** à l'arrivée
- **discriminant de clé** systématique à côté de chaque pseudo (spec v2 §3.5)
- **web of trust** côté client sur le graphe des kind 3

---

## 5. Les cinq points de friction à traiter tôt

Rien de tout ça n'est un détail d'implémentation : ce sont des changements
visibles à l'écran ou des garanties qui disparaissent.

1. **Le numéro de post.** `MessageItem.vue` affiche `#seq`, qui était la position
   dans un registre signé. Sur Nostr ce numéro n'existe pas : il devient un index
   local, et le permalien devient l'`nevent` (spec v2 §6.4). **L'UI ne bouge
   pas**, mais ce que le numéro *signifie* change, et il faut décider tôt si
   l'indexeur en publie une version stable — parce que le format des liens
   partagés en dépend, et qu'un lien partagé est éternel.
2. **`created_at` remplace `rts`.** Partout où le front affiche une heure, elle
   devient déclarative. Toute logique qui s'y fie (tri, « il y a 2 min »,
   ancienneté de compte) doit tolérer des valeurs fausses.
3. **La révocation d'appareil disparaît** de l'UI (`useIdentity`, `UserMenu`).
   Ne pas laisser un bouton qui ne protège plus de rien.
4. **Le blocage des MP passe côté client.** Le serveur ne peut plus filtrer :
   le gift wrap masque l'expéditeur (spec v2 §10.2). Il faut une file séparée et
   un filtre WoT avant que les MP soient visibles.
5. **Le pseudo n'est plus unique.** Aucun écran actuel ne le suppose
   explicitement, mais tous l'assument implicitement. Le discriminant de clé doit
   être ajouté partout où un pseudo est rendu, pas seulement sur le profil.

---

## 6. Ordre d'exécution

Aligné sur la roadmap (spec v2 §16). Le principe : **la V1 ne dépend de rien
qu'on possède**, donc on valide l'UX sur des relais publics avant d'écrire une
policy ou un indexeur.

| Étape | Travail | Critère de sortie | État |
|---|---|---|---|
| **0** | figer la v1 : la garder lançable comme référence UX. Aucune modification de `packages/protocol` | l'app v1 démarre encore | **fait** |
| **1** | nouveau front : pool de relais publics, souscriptions kind 11/1111, brancher `MessageFeed` et `TopicList` **tels quels** sur des events réels | des events publics arrivent en direct dans le fil existant, gel de liste compris | **fait** (`apps/nostr`) |
| **2** | identité locale secp256k1, `khey_<hex>`, PoW en worker, publication optimiste, création de topics, encart non bloquant | on poste sans compte | **fait** (vérifié contre un relais local, §8) |
| **3** | strfry + policy, QR `nsec`, indexeur (portage de `hotlist.ts` + `raid.ts`, publication du tick signé) | tri par vélocité et anti-spam à nous | **fait** (§9 ; strfry compilé et vérifié le 2026-08-15, `docs/strfry.md`) |
| **4** | kind 0 / kind 3 / WoT, NIP-17, NIP-46, NIP-05 | identité complète et portable | **fait** (§10, §11) |

**Décision SSR prise** (spec v2 §15.1) : **SPA pour les étapes 1–2.** En v2 le
SSR ne peut rendre que depuis l'indexeur, et l'indexeur n'existe qu'à l'étape 3 —
trancher plus tôt serait décider sans l'information. On reste sur Nuxt, donc
l'option SSR reste ouverte sans réécriture. À rouvrir à l'étape 3, quand le coût
réel (indexeur sur le chemin critique du premier rendu) sera mesurable.

---

## 7. Ce que l'étape 1 a établi

`apps/nostr` — Nuxt 3 SPA, Pinia, `nostr-tools`. `npm run dev:nostr` (port 3002).

```
stores/relays.ts     pool multi-relais, dédoublonnage par id, vérification de
                     signature active, état de connexion par relais
stores/topics.ts     liste + vélocité calculées côté client (la version pauvre
                     du tick — voir l'avertissement en tête du fichier)
stores/profiles.ts   kind 0 groupés et cachés ; le défaut khey_ ne dépend de rien
components/TopicList.vue   gel sur survol/focus + pilule +N — porté tel quel
components/PostFeed.vue    accrochage, tampon, ambiance, cap DOM, correction de
                           scroll — porté ; pagination sur created_at
components/PostItem.vue    codes forum : rangée distincte, nº local, Citer permanent
```

**Vérifié contre de vrais relais** (build + typecheck propres, navigateur) :

- 1000+ events reçus, 3–4 relais sur 5 connectés — un relais en 503 n'empêche
  rien, ce qui est le comportement voulu
- vrais topics kind 11 listés (« How to use kind 11 threads », « NIP-7D Forum
  Thread on MCP Tools »…), fil kind 1111 reconstruit et trié
- profils kind 0 résolus (`m4d4m`, `Silberengel`…) **et** repli `khey_xxxxxxxx`
  pour les clés sans kind 0 — les deux chemins marchent
- discriminant de clé affiché dès qu'un pseudo vient d'un kind 0 (§3.5)
- numérotation locale strictement croissante et sans trou sur 121 posts
- décrochage : la position ne bouge plus, pilule « +15 nouveaux », puis vidage du
  backlog et ré-accrochage au clic
- URLs rendues comme liens, jamais embarquées en images (§8)

**Non vérifié, et à ne pas supposer acquis :**

- **mode ambiance et cap DOM.** Les seuils (>4 msg/s, 150 rangées) n'ont pas été
  atteints : le flux global kind 1 sur ces relais tourne autour de 0,7 event/s.
  Le code est porté, le chemin ne s'est pas exécuté.
- **gel de la liste sous charge réelle.** La mécanique est vérifiée par le code
  porté et le rendu, pas par un reclassement observé — les topics kind 11 publics
  bougent trop peu pour déclencher un changement d'ordre.
- **le backlog n'est pas borné** quand on reste décroché longtemps (comportement
  hérité de la v1, pas introduit ici). À traiter si l'étape 2 amène du débit.
- feuille glissante mobile (§7.4) : non portée — bascule pleine largeur à la
  place. Elle demande une lib de gestes et ne teste pas le protocole.

**Le mode « démo débit »** (bouton dans l'en-tête de la liste) remplace les
topics par le flux global kind 1. Il n'a qu'un but : stresser le fil, parce que
les kind 11 publics sont trop rares pour ça. Ce n'est pas le produit, et
l'interface le dit.

---

## 8. Ce que l'étape 2 a établi

```
stores/identity.ts          clé secp256k1 générée à la première visite, khey_<hex>,
                            new khey, NIP-07, export nsec, compteurs d'onboarding
workers/pow.worker.ts       minage NIP-13 + calibration hors du thread principal
composables/usePowMiner.ts  singleton : un worker, une calibration, minage spéculatif
composables/usePublisher.ts construire → miner → signer → vérifier → afficher → diffuser
components/Composer.vue     composeur, encart d'onboarding, nudge de sauvegarde
components/NewTopicPanel.vue création de topic kind 11
components/UserMenu.vue     identité, new khey, bascule NIP-07
scripts/dev-relay.ts        relais NIP-01 minimal en mémoire, pour tester sans polluer
```

### Pourquoi un relais local

Sur Nostr, **écrire est irréversible** (§2.5 de la spec) : un event de test
publié sur `relay.damus.io` n'en sort plus jamais. Tester la publication contre
des relais publics reviendrait donc à polluer définitivement un bien commun.
D'où `scripts/dev-relay.ts` : `npm run dev:relay` (port 7447, en mémoire), puis
l'app avec `?relays=ws://localhost:7447`.

Ce relais vérifie les signatures et applique une `MIN_POW` optionnelle — c'est
tout ce qu'il faut pour observer les deux comportements qui comptent, et c'est
une implémentation **indépendante** du client, donc une vraie contre-vérification.

**Vérifié :**

- identité générée sans rien demander : `khey_2d665d50` présent avant toute
  interaction, aucun formulaire, aucune inscription
- calibration réelle : ~186k hachages/s mesurés dans ce navigateur → difficulté
  16 bits choisie automatiquement, minage observé à 452 ms
- **minage spéculatif effectif** : le travail était déjà fait *avant* l'appui sur
  Poster, donc la PoW est invisible dans le cas courant
- kind 11 accepté (pow 16 bits) puis kind 1111 accepté (pow 20 bits), **signature
  et PoW revérifiées par le relais** — id commençant par `0000ae…`, les zéros de
  tête sont visibles à l'œil dans l'URL
- affichage optimiste : le post apparaît immédiatement, **sans doublon** quand
  l'écho du relais arrive ensuite par la souscription live
- encart d'onboarding après le premier post, non bloquant, avec [Choisir un
  pseudo] / [Garder khey_…]
- **refus honnête** : relais à 28 bits → « refusé par tous les relais : pow: 17
  bits < 28 requis », brouillon conservé, aucune navigation vers un topic
  inexistant
- la liste **s'est réordonnée** sur activité réelle (un topic à 3 min d'activité
  est remonté au-dessus d'un topic à 9 h) — ce qui était marqué non vérifié en §7

**Trois défauts trouvés par l'observation, et corrigés :**

1. `usePowMiner` était instancié par composant → deux workers, deux
   calibrations, et un indicateur affichant « PoW off » dans le composeur alors
   que le minage fonctionnait. Devenu un singleton de module, calibré au
   démarrage. *Un indicateur qui ment sur l'état de la PoW est pire que pas
   d'indicateur.*
2. Une publication **refusée incrémentait quand même** le compteur de posts, qui
   pilote l'encart et le nudge de sauvegarde. On poussait donc l'utilisateur à
   sauvegarder une clé avec laquelle il n'avait jamais rien publié. Le compteur
   n'avance plus qu'après acceptation par au moins un relais.
3. En-tête de liste surchargé : titre tronqué à « khe… », boutons cassés en deux
   lignes. Actions regroupées, pseudo retiré du bouton d'identité.

**Toujours non vérifié :**

- **aucune publication sur un relais public.** Tout a été testé en local, à
  dessein. Le premier envoi réel est irréversible et c'est une décision à prendre
  sciemment, pas un effet de bord d'une session de dev.
- mode ambiance et cap DOM : seuils toujours pas atteints (§7).
- NIP-07 : le code existe, aucune extension n'était installée dans le navigateur
  de test. Chemin non exécuté.
- `new khey` : implémenté avec confirmation explicite, non exercé.

### Écart assumé avec la spec

La spec (§3.1) décrit l'encart comme apparaissant **à l'appui sur Entrée**, avec
un bouton « [Poster comme ça] » — ce qui retarde littéralement le premier post
d'un clic, en contradiction avec la thèse « zéro friction » et avec le mot « non
bloquant ». Choix retenu : **le premier post part immédiatement**, l'encart
apparaît juste après, en ligne, dismissible. À rediscuter si l'intention était
bien de faire payer un clic avant la première publication.

---

## 9. Ce que l'étape 3 a établi

```
packages/relay-policy/       policy d'écriture PARTAGÉE + plugin strfry + 19 tests
  src/index.ts               evaluate() : kinds, PoW, fenêtre created_at, taille, débit
  src/strfry-plugin.ts       protocole JSON ligne-à-ligne de strfry
  bin/strfry.ts              point d'entrée ; run-strfry.sh le lance
  strfry.conf.example        config d'exemple (NON testée contre strfry)

apps/indexer/                le tick signé (spec v2 §5.2, §5.4)
  src/hotlist.ts             portage de apps/server — vélocité, 9 tests
  src/raid.ts                portage de apps/server — détection de raid
  src/index.ts              souscrit, classe, publie le tick (kind 30078, NIP-78)

apps/nostr/                  côté client
  stores/topics.ts           consomme le tick, retombe sur le local s'il manque
  components/DevicePairing   QR nsec (export temporisé) + import par collage
  components/QrCode.vue      porté de apps/web

scripts/dev-relay.ts         applique LA MÊME policy que le plugin strfry
scripts/seed-dev-relay.ts    peuple le relais avec des profils d'activité contrastés
scripts/smoke-policy.ts      teste le protocole du plugin par pipe réel
```

### Une seule policy, deux consommateurs

`@forome/relay-policy` est importée à l'identique par le plugin strfry **et** par
le relais de dev. Ce qui est testé unitairement est donc exactement ce qui
tourne — c'est la leçon que la v1 avait apprise sur la canonicalisation
(« une seule bibliothèque »), appliquée à la policy.

```bash
npm run dev:relay                  # :7447, policy réelle, en mémoire
MIN_POW=28 npm run dev:relay       # pour observer un refus légitime
npm run seed:relay                 # 3 topics aux profils d'activité contrastés
npm run dev:indexer                # RELAYS=… INDEXER_NSEC=… pour fixer la clé
npm run smoke:policy               # protocole du plugin strfry
# client : http://localhost:3002/?relays=ws://localhost:7447&indexer=<hex>
```

**Vérifié** (61 tests au total dans le dépôt, build et typecheck propres) :

- **19 tests de policy**, dont les cas limites : bornes inclusives de la fenêtre
  `created_at`, taille mesurée en **octets UTF-8** et non en caractères, quota
  par clé et non global, fenêtre de débit qui glisse
- **protocole du plugin strfry** par pipe réel : 7 réponses JSON valides, stdout
  propre, une ligne d'entrée illisible ne tue pas le plugin et ne produit aucune
  réponse (elle partirait sur stdout et strfry fermerait le plugin)
- **9 tests d'indexeur** ciblant les différences avec la v1 : doublons de relais,
  désordre d'arrivée, et le faux positif de raid au démarrage
- **la boucle complète, observée** : 52 events minés et publiés → policy → relais
  → indexeur → tick kind 30078 signé → client affiche « tri : indexeur »
- **le classement porté fait ce qu'il promet** : trois topics, dont deux avec
  exactement 24 messages — l'un de 10 kheys, l'autre de 2. Ordre obtenu :
  vivant > squatté > mort. « Les participants pèsent plus que le volume » n'est
  pas qu'un commentaire.
- **QR** : rendu en data-URI PNG local (aucune requête réseau), affichage
  temporisé à 30 s, avertissement secret-au-porteur
- **import de clé** : `nsec` acceptée → identité devient `khey_e9cf26fc`
  (clé publique attendue, donc dérivation correcte) ; `npub` refusée avec un
  message utile **et sans détruire l'identité en place**

### Quatre défauts trouvés par la vérification, et corrigés

1. **`verifyEvent` faisait confiance à un cache transporté par l'objet.**
   `nostr-tools` mémorise le résultat de la vérification dans une propriété à clé
   Symbol, et le spread d'objet copie les Symbols — donc
   `{...eventVérifié, content: 'autre chose'}` **passait la vérification**. La
   policy réduit maintenant l'event à ses 7 champs canoniques avant de vérifier.
   C'est une frontière de sécurité : elle ne fait confiance à aucun marqueur venu
   de l'appelant. Test de régression ajouté.
2. **`minePow` réécrit `created_at`** (vérifié dans la source amont : elle remet
   le compteur à zéro et met l'heure courante à chaque seconde qui tourne).
   Reprendre le `created_at` d'avant minage produit un id différent, donc une PoW
   perdue. Corrigé dans les helpers de test ; le client, lui, utilisait déjà le
   bon champ.
3. **Les surcharges `?relays=` et `?indexer=` étaient perdues silencieusement.**
   La pré-ouverture du topic chaud réécrivait l'URL sans la query, et le moindre
   rechargement renvoyait le client vers les **relais publics** — pendant une
   session censée être locale. Observé dans la console, pas anticipé. La query est
   maintenant préservée dans la redirection *et* la surcharge est persistée en
   sessionStorage, avec un indicateur orange dans l'en-tête.
4. **La pré-ouverture choisissait le mauvais topic.** Elle ouvrait le premier
   `hottest` observé — donc le premier topic arrivé du relais, pas le plus chaud.
   En test elle a ouvert le topic *mort*. Elle attend maintenant la fin du
   chargement initial.

Plus un défaut du relais de dev lui-même : il ne traitait pas les events
**adressables** (30000–39999) comme remplaçables, donc les ticks s'accumulaient
(8 exemplaires) au lieu de se remplacer. Un relais de dev qui diverge d'un vrai
relais masque des bugs de client au lieu de les révéler.

### Non vérifié, et à ne pas supposer acquis

- **strfry lui-même.** C'est du C++ à compiler ; l'installer n'était pas dans la
  portée. La policy et son protocole sont testés, la config est un exemple. Le
  premier déploiement réel demandera une vraie validation.
- **Aucune publication sur un relais public**, toujours (§8). Écrire est
  irréversible.
- **NIP-42 (AUTH)** : les quotas sont par clé publique, mais rien ne prouve qu'une
  connexion appartient à cette clé. Les quotas ne tiennent donc pas face à un
  adversaire qui change de clé — c'est à ça que sert la PoW en attendant.
- **Réplication entre plusieurs relais** (`strfry sync`, negentropy) : pas faite.
  Un relais unique ridiculiserait la promesse d'incensurabilité.
- **Alerte de raid en conditions réelles** : la logique est testée, mais le
  substitut à `accountCreatedAt` (« clé jamais vue par cet indexeur ») a une
  faiblesse connue et documentée dans `raid.ts` — une clé ancienne mais inconnue
  de nous compte comme récente. Le vrai remède est le web of trust (étape 4).
- **Mode ambiance et cap DOM** : toujours pas atteints.

### Ce que le tick concède, et qu'il faut assumer

La clé de l'indexeur a un **pouvoir d'affichage** : elle décide de l'ordre de
l'écran principal. Elle ne peut ni retenir ni falsifier un message — les events
restent sur les relais, vérifiables sans elle — mais elle peut mettre en avant ce
qu'elle veut. Trois choix découlent de là :

- le client n'accepte un tick que d'une **clé épinglée** ; sans configuration, il
  calcule localement plutôt que d'accepter celui du premier venu
- un tick de plus de 30 s est ignoré : un classement figé serait pire qu'un
  classement partiel
- l'interface **dit d'où vient le tri** (« tri : indexeur » / « tri : local »),
  avec la clé au survol. La zone blanche de §15.2 est visible, pas cachée.

---

## 10. Ce que l'étape 4 a établi

```
apps/nostr/stores/social.ts    follows kind 3, mute kind 10000, web of trust
apps/nostr/stores/dms.ts       MP NIP-17 : rumeur → sceau → emballage AVEC PoW
apps/nostr/pages/dm.vue        deux files : boîte, et hors web of trust
apps/nostr/stores/profiles.ts  vérification NIP-05 réelle (3 états, pas 2)
apps/nostr/workers/pow.worker  minage à created_at FIGÉ, en plus du minage normal
apps/indexer/src/raid.ts       graphe kind 3 en remplacement du proxy faible
scripts/smoke-dm.ts            MP de bout en bout contre le relais local
```

### Deux conflits entre la spec et les bibliothèques, trouvés en testant

Ce sont les vraies trouvailles de l'étape. Aucun des deux n'était prévisible en
lisant la spec.

1. **`nostr-tools` ne met pas de PoW sur les emballages**, et ne peut pas en
   mettre : `nip17.wrapEvent` génère la clé éphémère en interne et signe
   immédiatement. Or le nonce est dans les tags, donc dans l'id, donc dans le
   signé — miner après coup invaliderait la signature. Ma propre policy exigeait
   16 bits sur les kind 1059 : **tous les MP légitimes étaient refusés par mon
   propre relais.** Corrigé en refaisant l'emballage à la main pour contrôler la
   clé éphémère. Ce n'est pas un caprice : sur les MP, la PoW est la *seule*
   barrière possible, puisque le gift wrap empêche tout quota par identité et
   tout filtrage d'un bloqué (§10.2).

2. **NIP-59 antidate les emballages jusqu'à deux jours**, délibérément — si
   l'emballage portait l'heure réelle, un relais corrélerait les deux copies
   publiées simultanément (destinataire + soi) et en déduirait la conversation.
   Ma fenêtre anti-spam de 1 h les rejetait donc tous. La tolérance sur
   `created_at` est maintenant **par kind** : deux jours pour les MP, une heure
   pour le contenu public. Une confidentialité et un anti-spam qui se marchent
   dessus, et qu'il fallait réconcilier explicitement.

Corollaire découvert au passage : **`minePow` de `nostr-tools` ne peut pas miner à
`created_at` fixé** — il remet l'horloge à l'heure courante à chaque seconde qui
tourne. C'est souhaitable pour un post, incompatible avec l'antidatage. D'où une
seconde boucle de minage dans le worker, à horodatage figé.

### Vérifié

**MP de bout en bout** (`npm run smoke:dm`, 10 contrôles, contre la vraie policy) :

- emballage miné à 16 bits, accepté par le relais
- la clé qui signe l'emballage est **éphémère** : ni celle de l'expéditeur, ni
  celle du destinataire
- ni le clair ni la clé publique de l'expéditeur n'apparaissent dans l'emballage
  — les métadonnées sont bien masquées au relais
- le destinataire déchiffre **et retrouve le bon auteur** (le sceau porte la
  signature réelle : c'est ce qui rend un MP signalé prouvablement authentique)
- l'expéditeur relit sa propre copie
- un tiers ne reçoit rien, et **ne déchiffre rien même en récupérant tous les
  emballages du relais**

**Follows et web of trust**, dans le navigateur : clic sur « suivre » → kind 3
publié sur le relais avec le bon tag `p` → bouton « suivi » → marques ★ sur les
posts de cette clé.

**Détection de raid renforcée** : 60 clés inconnues d'un coup déclenchent une
alerte ; les mêmes 60 clés, une fois citées dans un kind 3, n'en déclenchent
aucune. Le contrôle négatif est dans les tests, sinon le test ne prouverait rien.

**Un troisième défaut de pré-ouverture**, corrigé : `loading` ne suivait que
l'EOSE des topics, pas celui des réponses. Le classement était donc encore vide
(toutes vélocités à zéro) quand la pré-ouverture se déclenchait — elle ouvrait un
topic au hasard. Observé deux fois avant d'être compris. Elle attend maintenant
les deux souscriptions, et ouvre bien « le topic qui vit » (24 réponses,
10 kheys).

**Un test devenu silencieusement faux**, corrigé : en passant `maxPastS` d'un
nombre à un Record, `NOW - DEFAULT_POLICY.maxPastS` valait `NaN`, et les
comparaisons avec `NaN` étant toutes fausses, le test des bornes passait sans
rien vérifier.

### Non fait

- ~~NIP-46~~ — **fait à l'étape suivante, voir §11.**
- **MP avec une extension NIP-07** : impossible en l'état. Les MP exigent la clé
  privée pour dériver le secret de conversation ; il faudrait passer par
  `nip44Encrypt`/`nip44Decrypt` de NIP-07, optionnels et inégalement implémentés.
  L'interface le dit au lieu d'échouer silencieusement.
- **Entrées privées dans les listes** : NIP-51 permet de chiffrer le contenu
  d'une liste de mute. On ne s'en sert pas — donc **bloquer quelqu'un est
  public**, ce qui est en soi une information. Décision produit à trancher, pas
  un détail d'implémentation : elle change ce que le réseau apprend de chaque
  utilisateur.

  Corrigé au passage, et c'était pire que le point ci-dessus : **`unmute()`
  existait dans le store sans être exposé nulle part.** Bloquer était donc une
  porte à sens unique dans l'interface alors que la liste kind 10000 est
  remplaçable par nature. Une section « Bloqués » dans `/dm` donne maintenant le
  retour. La leçon générale : une action réversible dans le protocole mais
  irréversible à l'écran est un défaut d'interface, pas une préférence de design —
  et elle se repère en cherchant les fonctions de store que personne n'appelle.
- **Mode ambiance et cap DOM** : toujours pas atteints, depuis l'étape 1.
- **Aucune publication sur un relais public**, toujours.

---

## 11. NIP-46 — le signeur distant

```
scripts/dev-bunker.ts          bunker de test avec révocation par client
apps/nostr/stores/identity.ts  mode signeur 'nip46', reconnexion, déconnexion
apps/nostr/components/DevicePairing.vue   onglet « Signeur distant »
scripts/smoke-nip46.ts         11 contrôles de bout en bout
```

### Pourquoi un bunker de test

Écrire le client sans pouvoir l'exercer, c'était livrer du non-vérifié sur la
brique la plus sensible du projet. Même logique que `dev-relay.ts` : le minimum
pour parcourir le vrai chemin. `npm run dev:bunker` affiche une URI `bunker://`
à coller dans le client, et accepte `revoke` / `restore` / `status` sur stdin.

Deux choix délibérés du bunker de test, qui exercent des chemins qu'un bunker
naïf raterait :

- **la clé de communication est distincte de la clé de signature.** NIP-46
  l'autorise, et `nostr-tools` avertit explicitement que le pubkey du bunker peut
  différer du pubkey signataire. Un bunker qui confond les deux laisse passer un
  client qui suppose l'égalité.
- **`sign_event` signe le gabarit tel quel.** Voir le piège ci-dessous.

### Le piège d'interopérabilité

**Un bunker qui « rafraîchit » `created_at` détruit la preuve de travail.** Le
nonce NIP-13 est dans les tags et l'horodatage entre dans l'id : si le signeur
distant modifie quoi que ce soit, la PoW minée par le client tombe et l'event se
fait refuser par la policy. Le bunker de test signe donc à l'identique, et le
smoke test **vérifie explicitement** que `created_at` et la difficulté sont
intacts après signature distante. C'est le genre de contrat qu'on ne découvre
qu'en branchant les deux bouts.

### Vérifié (`npm run smoke:nip46`, 11 contrôles)

- connexion, `get_public_key`, et la clé signataire est bien **distincte** de la
  clé de communication du bunker
- la clé cliente n'est pas l'identité : la compromettre ne donne qu'une
  autorisation révocable, pas la clé de l'utilisateur
- signature distante valide, par la clé de l'utilisateur
- **la PoW survit** : 16 bits minés, 16 bits après signature, `created_at` intact
- l'event signé à distance est **accepté par le relais**
- **la révocation coupe réellement** : après `revoke`, signer échoue
- **un client révoqué ne se réautorise pas** en rappelant `connect`

Ce dernier point est celui qui compte. Une implémentation qui signe mais dont on
ne peut pas retirer l'accès donnerait l'illusion d'avoir résolu la perte
d'appareil, ce qui est pire que de ne rien avoir.

### Ce que ça change pour la promesse du projet

L'astérisque de §3.2 se réduit : avec un bunker, **perte d'appareil ≠ identité
perdue**. On révoque le client compromis, l'identité continue. C'est le modèle à
deux étages de la v1 (clé de compte / clés d'appareil révocables), reconstruit une
couche plus haut — au prix d'une dépendance à un signeur qu'il faut héberger.

L'astérisque ne disparaît pas complètement : **si la clé du bunker fuite, tout
est perdu**, exactement comme la clé de compte v1. Et la rotation de clé reste
sans standard adopté (§15.2).

### Deux conflits de plus avec la policy, du même genre que ceux de l'étape 4

1. **kind 24133 n'était pas autorisé** → tout le trafic du signeur distant était
   refusé par mon propre relais. Ajouté, avec PoW à zéro : exiger une PoW sur
   chaque requête RPC ferait payer deux minages par signature et rendrait le
   signeur distant insupportable. Le débit par clé suffit à borner l'abus.
2. **24133 est un kind éphémère** (plage 20000–29999) : NIP-01 dit qu'un relais
   le diffuse **sans le stocker**. Le relais de dev stockait tout — il aurait
   rempli sa base de RPC périmés. Corrigé, et c'est aussi ce que fera strfry.

### Non fait

- **MP via NIP-46** : `BunkerSigner` expose `nip44Encrypt`/`nip44Decrypt`, donc
  c'est possible — mais `stores/dms.ts` construit le sceau avec la clé locale
  (`createSeal`), ce qui demande de réimplémenter le scellage contre le signeur
  distant. Les MP restent donc réservés à une clé locale, et l'interface le dit.
- **`auth_url`** (NIP-46 permet au bunker de demander une validation humaine par
  URL) : non géré. Un bunker de production l'utilise.
- **Permissions par méthode** : le bunker de test autorise tout ou rien. Un vrai
  bunker distingue « peut signer des kind 1 » de « peut signer n'importe quoi ».
