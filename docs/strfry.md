# strfry — le relais du forum

> Compiler le relais, le lancer, et vérifier que la policy d'écriture s'applique
> **à travers le vrai strfry** et pas seulement dans ses tests unitaires.

## Pourquoi un relais à nous

Le tag `t=forome` (voir `packages/relay-policy/src/index.ts`, `COMMUNITY`) borne
ce que le client **demande**. Il ne borne pas ce qui **existe** : n'importe qui
peut publier un kind 11 marqué `forome` sur un relais public, et il arrivera dans
la liste. Le tag est une adresse ; le relais est le mur.

C'est ce relais qui fait appliquer les règles dont l'opérateur répond :

- les kinds acceptés, et rien d'autre
- le périmètre du forum
- la preuve de travail, l'horodatage, la taille, le débit par clé
- les bannissements et les verrouillages décidés par le panneau de modération

## Installation (macOS)

```sh
brew install flatbuffers lmdb openssl@3 zstd secp256k1 libuv perl cpanminus
cpanm --notest YAML Template Regexp::Grammars   # golpe génère du code en perl

git clone --recurse-submodules --depth 1 https://github.com/hoytech/strfry.git .strfry
cd .strfry
make setup-golpe
make -j8
```

`.strfry/` est **gitignoré** : c'est un outil externe compilé, pas du code du
projet. Le supprimer et refaire ces trois commandes suffit à le reconstruire.

### Le patch qu'il faut réappliquer après un `git pull` de strfry

Un seul, et il ne vient pas de nous : `external/negentropy/cpp/negentropy.h`
expose `Negentropy` comme **alias de template**, et les appels du dépôt comptent
sur la déduction d'arguments à travers cet alias — une fonctionnalité C++20
(P1814R0) qu'**Apple Clang 16 n'implémente pas**. La compilation s'arrête sur
`RelayNegentropy.cpp` avec :

```
error: alias template 'Negentropy' requires template arguments;
       argument deduction only allowed for class templates
```

Correctif appliqué, en un seul point plutôt que sur les cinq appels :

```cpp
// remplace  template<typename T> using Negentropy = negentropy::Negentropy<T>;
using negentropy::Negentropy;
```

Une using-declaration introduit le **template de classe** lui-même, sur lequel la
déduction est du C++17 — donc les appels existants compilent sans être touchés.
Ce n'est pas un contournement de confort : sans lui, strfry ne compile pas du
tout sur un Mac à jour.

## Lancer

```sh
npm run dev:strfry      # port 7778, base persistante dans .strfry/strfry-db/
```

Puis ouvrir simplement `http://localhost:3002/` : **en développement, le client
vise ce relais par défaut** (`devRelay` dans `nuxt.config.ts`). Plus besoin de
`?relays=` — et surtout, plus moyen d'écrire sur le réseau public par
distraction. Voir `apps/nostr/utils/relayTargets.ts`.

Pour viser l'autre relais de dev (le Node, port 7447), il faut le dire :
`http://localhost:3002/?relays=ws://localhost:7447`.

### Écrire quand même sur le réseau public, en dev

Le client refuse, nomme le relais visé, et dit comment passer outre :
`?public=1`. L'autorisation vit en `sessionStorage`, donc elle **expire avec la
session du navigateur** — c'est voulu : une permission d'écrire là où rien ne
s'efface ne doit pas se transmettre en héritage d'un onglet à l'autre.

La config versionnée est `packages/relay-policy/strfry.conf`. Elle porte
`__FOROME_ROOT__` au lieu d'un chemin machine : strfry exige un chemin **absolu**
pour le plugin de policy, et `scripts/dev-strfry.sh` le substitue à chaque
lancement dans une copie dérivée. Ne pas figer le chemin à la main — un dépôt
déplacé laisserait un plugin introuvable, et strfry démarre quand même, en
acceptant tout.

### AUTH NIP-42, ou pourquoi les MP étaient muets

strfry exige une AUTH pour lire les kinds de MP : `auth.restrictedReadKinds`
vaut **« 4, 1059 » par défaut**, donc la règle s'applique même sans bloc `auth`.
C'est la bonne règle — sans elle, n'importe qui moissonne les emballages de
n'importe qui et sait qui reçoit des MP et quand, ce que le gift wrap est
précisément censé cacher au relais.

Le piège est ailleurs : `auth.serviceUrl` vide, strfry **réclame une AUTH qu'il
ne peut pas valider**, et il n'annonce même pas le NIP 42 dans son document
NIP-11. Vu du client, les MP partaient (2/2 emballages acceptés) et ne
revenaient jamais. D'où `serviceUrl` dans nos deux configs — `ws://localhost:7778`
en dev, `wss://__HOST__/relay` en prod, résolu par `install.sh`. Seul `hôte:port`
est comparé : le schéma et le chemin sont ignorés des deux côtés.

Second piège, côté client : strfry préfixe la raison du CLOSED par
`ERROR: auth-required: …`, alors que la reprise automatique de `nostr-tools`
exige `auth-required:` **en tête**. Elle ne se déclenche donc jamais, sans un
mot dans la console. `stores/relays.ts` refait cette reprise (`answerAuth`), et
c'est la seule souscription du projet qui s'authentifie — voir `authSigner` pour
pourquoi les autres ne doivent pas.

## Vérifier

```sh
npm run smoke:strfry    # exige que dev:strfry tourne
npm run smoke:dm -- ws://localhost:7778
```
⚠️ `smoke:dm` **sur les deux relais**. Son défaut vise le relais Node (7447),
qui n'applique pas NIP-42 : lancé seulement là, il passe alors que les MP sont
illisibles sur strfry, donc en prod. Sa sortie dit désormais lequel des deux on
interroge (« lecture anonyme : 0 emballage(s) »).

Il rejoue la policy **à travers strfry** et non par un pipe simulé, ce qui est
une propriété différente de `smoke:policy` : c'est lui qui a attrapé le seul vrai
défaut de cette installation — `run-strfry.sh` sans bit exécutable, donc plugin
jamais lancé, donc **tout refusé** en « internal error ». Le sens du défaut est
rassurant (une policy tombée ferme la porte au lieu de l'ouvrir) mais le message
ne ressemble en rien à sa cause.

Un détail vu en passant : strfry applique **ses propres** bornes avant d'appeler
le plugin — un `created_at` trop lointain est refusé par lui (`created_at too
late`), pas par nous. Nos règles s'ajoutent aux siennes, elles ne les remplacent
pas.

## Les deux relais de dev, et lequel utiliser

| | `npm run dev:relay` | `npm run dev:strfry` |
|---|---|---|
| implémentation | Node, ~250 lignes, en mémoire | le vrai strfry (C++) |
| port | 7447 | 7778 |
| stockage | perdu à l'arrêt | persistant (`.strfry/strfry-db/`) |
| policy | appelée en direct | à travers le protocole de plugin réel |

Garder les deux est délibéré. Le relais Node reste le bon outil pour un test
isolé et reproductible (il oublie tout entre deux essais, et les smokes en
dépendent). strfry est le seul qui prouve que la policy fonctionne **là où elle
tournera vraiment** — et c'est une propriété différente.

## Ce que vise le client, et quand

|  | lecture | écriture |
|---|---|---|
| développement | relais local (`devRelay`) | relais local **uniquement** |
| production | notre relais (`homeRelay`) | notre relais **+ les relais publics** |

L'asymétrie de production est le cœur du modèle, et elle vient de la spec :

- **écrire chez les tiers** rend vraie la promesse de §9.3 — « rien ne peut être
  retiré du réseau, et tu peux emporter ce que tu as écrit dans n'importe quel
  autre client ». Un forum qui n'écrirait que chez lui serait un service
  centralisé en costume Nostr : tous les inconvénients du protocole, aucun de ses
  bénéfices.
- **lire chez nous** parce que la policy ne s'applique qu'ici. Un bannissement
  veut dire « mon relais refuse ses écritures » : si le client lisait aussi
  ailleurs, la personne bannie réapparaîtrait — non par ruse, mais parce que
  notre pouvoir s'arrête à notre relais. §9.2 le dit sans détour : on répond de
  ce que notre relais sert et de ce que notre client montre, pas du reste.

Tant que `homeRelay` n'est pas configuré, la lecture retombe sur les relais
publics : un forum qui n'afficherait rien serait pire.

## Ce qui reste ouvert

- **Pas de NIP-42 (AUTH)** : les quotas sont par clé, mais rien ne prouve qu'une
  connexion appartient à la clé qu'elle revendique. À ajouter le jour où les
  quotas doivent tenir face à un adversaire et pas seulement face au bruit.
- **Un seul relais** : `strfry sync` (negentropy) donne la réplication entre
  plusieurs relais à nous. Tant qu'il n'y en a qu'un, la promesse
  d'incensurabilité est théorique — c'est le point ouvert le plus important.
- **Le retrait dur reste manuel** (`strfry delete`), et ne retire l'event que de
  CE relais (conception §9.2).
