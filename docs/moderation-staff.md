# Modération outillée : équipe, pouvoirs, panneau

> Complète le **§9 de la conception** (« Modération : filtrer, pas supprimer »),
> qui pose la philosophie mais s'arrête aux contrôles que chaque lecteur règle
> pour lui-même. Ce document décrit la couche au-dessus : **une équipe qui agit
> pour tout le monde**, ses pouvoirs, et l'outil qui lui sert à travailler.

---

## 1. Le problème

Un forum a besoin d'une équipe. Le §9 décrit un lieu où chacun règle sa propre
vue — mute NIP-51, labels NIP-32, web of trust — et c'est le bon défaut, mais ça
ne couvre pas le cas qui décide de la survie du forum : **le message que
personne ne devrait avoir à bloquer soi-même.** Le raid du §9.5, le spam
industriel, le doxxing. Une décision par lecteur arrive trop tard et coûte trop
cher ; il faut une décision prise une fois, pour tout le monde, par quelqu'un
dont c'est le rôle.

Le mur : **Nostr n'a pas de rôles.** Pas de base `users`, pas de session, pas de
serveur qui arbitre. Être modérateur ne peut donc pas être une ligne dans une
table — ça doit être une **propriété cryptographique que chaque client vérifie
seul**.

## 2. Ce que le §9 impose déjà, et qui n'est pas négociable

Ce document ne rouvre aucun de ces points. Il construit dedans.

| Contrainte | Origine | Conséquence pour l'équipe |
|---|---|---|
| Rien ne se retire du réseau | §2.5, §9.3 | un modérateur ne **supprime** jamais ; il retire de *notre* vue |
| Pas de censure silencieuse | §9.2 | toute action est **signée, attribuée, motivée**, et visible |
| L'opérateur répond de ce que son relais sert et de ce que son client affiche | §9.2 | c'est exactement — et seulement — là que l'équipe a du pouvoir |
| Les contrôles lecteur restent le mécanisme principal | §9.4 | la modération d'équipe s'ajoute, elle ne remplace pas le mute |
| Pas d'approbation préalable | §9.4, ligne 159 | la parole est libre par défaut, la modération est *a posteriori* |

## 3. Architecture : une chaîne de confiance à trois maillons

```
clé racine du forum  ──signe──▶  roster (qui est modérateur)
                                     │
                                     ▼
clé d'un modérateur  ──signe──▶  sa liste d'actions
                                     │
                        ┌────────────┴────────────┐
                        ▼                         ▼
              client : replie, verrouille   relais : refuse à l'écriture
```

Chaque maillon est un event signé, public, vérifiable par n'importe qui — y
compris par un client tiers qui voudrait contrôler ce que nous faisons.

### 3.1 La clé racine

Une clé épinglée dans la configuration du client, `adminPubkey`, **exactement
comme `indexerPubkey` l'est déjà** pour le tick (§5.2) : vide par défaut, fixée
par `NUXT_PUBLIC_ADMIN_PUBKEY`.

**Pas de surcharge par l'URL, et c'est une décision, pas un oubli.** `?relays=`
et `?indexer=` en ont une ; elles changent ce qu'on voit et dans quel ordre. Une
clé racine décide ce qui est **retiré de la vue au nom du forum** : un lien piégé
`?admin=<clé de l'attaquant>` aurait fait replier, chez la victime, n'importe
quel message sous l'étiquette « masqué par la modération ». Suppression de
contenu à distance déguisée en décision officielle. Même forme que les autres
surcharges, autre gravité.

### 3.1.1 L'installation — une commande, une fois

Le client et le relais sont deux programmes qui ne se parlent pas et qui doivent
connaître **la même** clé racine : sinon « bannir » masque sans bloquer.
`npm run setup:moderation` écrit donc **un seul `.env`**, lu par les deux.

C'est le seul geste du système qui ne peut pas vivre dans l'interface, et il faut
savoir pourquoi plutôt que de le regretter : si l'app pouvait nommer un
administrateur pour tout le monde, n'importe qui cliquerait dessus. Une action
in-app ne vaut que pour un navigateur — donc soit elle ne protège rien, soit elle
ne configure rien. **La clé épinglée est la propriété de sécurité elle-même.**

Tout le reste — nommer un modérateur, masquer, bannir, verrouiller — se fait au
clic dans le panneau, et n'a aucune raison de passer par un terminal.

Les deux formes de clé sont acceptées, `npub…` comme hexadécimal : **l'interface
ne montre jamais l'hexadécimal**, le profil affiche et copie une npub. Exiger une
forme que l'app ne donne nulle part produisait un rejet silencieux, sans staff et
sans message. Une `nsec` est refusée — c'est un secret au porteur, l'accepter
comme clé racine serait un piège.

Vide par défaut, et c'est délibéré, pour la même raison que le tick : **accepter
le roster du premier venu donnerait à un inconnu le pouvoir de masquer l'écran
principal.** Sans clé épinglée, aucun staff, aucune action appliquée, panneau
inaccessible.

> **Tranché** : clé **dédiée**, qui ne sert qu'à ça, gardée hors du
> navigateur et signant par bunker NIP-46. Ce n'est pas l'identité de tous les
> jours de l'opérateur — une clé qui poste quotidiennement est exposée
> quotidiennement, et Nostr n'a pas de révocation.

Pourquoi une clé épinglée plutôt qu'un mécanisme protocolaire : la légitimité de
l'équipe ne vient pas du réseau, elle vient de **l'opérateur qui répond
légalement** de ce qu'il sert (§9.2). Le client est précisément l'endroit où le
§9.2 reconnaît que l'opérateur a la main.

**Ce que ça coûte, sans enrobage : cette clé est un point de défaillance
unique.** Compromise, elle nomme n'importe qui modérateur pour tous les
utilisateurs de notre client, et Nostr n'a **pas de révocation** (§3.2). D'où la
règle d'exploitation qui va avec, et qui fait partie de la conception :

- la clé racine ne signe **que le roster** — une poignée d'events par an
- elle ne vit **pas dans le navigateur** : signature par bunker NIP-46 (§3.2),
  qui est déjà implémenté et déjà testé (`npm run smoke:nip46`)
- le travail quotidien passe par les clés des modérateurs, elles révocables

Clé racine froide, clés de travail chaudes : le modèle à deux étages, reconstruit
avec ce que Nostr permet.

### 3.2 Le roster — qui est modérateur

Un **kind 30078** (NIP-78, déjà accepté par la policy), tag `d` = `forome.staff`,
signé par la clé racine. Adressable, donc il n'en existe qu'un courant.

```json
{
  "v": 1,
  "at": 1800000000,
  "staff": [
    { "pubkey": "<64 hex>", "role": "moderator", "since": 1799000000 },
    { "pubkey": "<64 hex>", "role": "admin",     "since": 1798000000 }
  ]
}
```

Le client n'accepte cet event que si `ev.pubkey === adminPubkey`. Tout autre
roster est ignoré sans condition.

Deux rôles, pas trois : `moderator` agit sur le contenu, `admin` fait ça **plus**
nommer et révoquer. Chaque rôle supplémentaire est un état à afficher, à
expliquer et à tester ; deux suffisent à couvrir le besoin réel.

**La clé racine est admin implicitement**, même absente de sa propre liste. Sans
cette règle, un roster malformé ferme la porte définitivement, sans recours —
un lockout irréversible sur une faute de frappe.

### 3.3 Les actions — une liste par modérateur

Un **kind 30078**, `d` = `forome.moderation`, **une liste remplaçable par clé de
staff**, signée par elle.

```json
{
  "v": 1,
  "at": 1800000000,
  "actions": [
    { "type": "hide", "target": "<id d'event>",  "reason": "doxxing", "at": 1800000000 },
    { "type": "ban",  "target": "<clé publique>", "reason": "raid",    "at": 1799999000 }
  ]
}
```

Pourquoi une liste **par modérateur** et pas une liste commune : un event
remplaçable est identifié par (pubkey, kind, `d`). Une liste commune exigerait
donc une **clé commune** — c'est-à-dire un secret partagé entre N personnes, plus
aucune attribution, et plus aucune révocation. Une liste par modérateur donne
gratuitement les trois propriétés qu'on veut :

- **attribution** — chaque action est signée par celui qui l'a prise
- **révocation** — retirer une clé du roster retire **toutes** ses actions d'un
  coup, sans avoir à les défaire une par une
- **pas de conflit d'écriture** — personne n'écrase la liste d'un autre

⚠️ **Piège hérité de `stores/social.ts`** : c'est remplaçable, donc republier une
liste partielle **détruit** les actions précédentes. Même règle que pour les
follows, sans exception : *on ne publie jamais sans avoir lu sa propre liste
courante, et on refuse de publier si la lecture a échoué.*

### 3.4 État effectif : la fusion

1. lire le roster signé par `adminPubkey` → l'ensemble des clés de staff
2. lire la liste `forome.moderation` de **chaque clé du roster**
3. ne retenir que les actions dont l'auteur est **actuellement** dans le roster
4. par cible, **l'action au `at` le plus récent gagne**

Le point 4 est ce qui permet à un modérateur de défaire la décision d'un autre :
les types vont par paires (`hide`/`show`, `ban`/`unban`, `lock`/`unlock`,
`pin`/`unpin`), et le plus récent l'emporte. Sans ça, seul l'auteur d'une action
pourrait la corriger — donc un modérateur en vacances bloquerait une erreur.

**Une action visant une clé du roster est ignorée.** Sinon deux modérateurs en
désaccord se bannissent mutuellement et l'état effectif dépend de qui a publié en
dernier. Seul un admin retire quelqu'un, et ça passe par le roster.

## 4. Les pouvoirs

| type | cible | effet dans notre client | effet au relais |
|---|---|---|---|
| `hide` (éditorial) | id d'event | le message est **replié** : motif, auteur de la décision, bouton « afficher » | aucun — rien ne se supprime |
| `hide` (illégal) | id d'event | rangée **sans bouton**, remplacée par la mention du retrait | **n'est plus servi** (§6) |
| `ban` | clé publique | tous ses messages repliés, marqueur sur son profil | **refus à l'écriture** |
| `lock` | id de topic | composeur fermé, bandeau explicatif | **refus des réponses** |
| `pin` | id de topic | en tête de la liste, marqueur `épinglé` | aucun |
| `ignore` | id d'event ou clé | classe un signalement sans suite | aucun |

Le **motif est obligatoire** sur toutes. Une action sans motif est une censure
silencieuse avec une signature dessus — le §9.2 la refuse autant que l'autre.

`hide` porte donc un champ `class` : `editorial` par défaut, `illegal` pour le
plancher du §9.2. Les deux régimes sont détaillés au §5 — ils ne diffèrent pas
seulement par un bouton en moins.

`ignore` existe parce que la file de signalements a besoin d'un état « vu, et
c'est non » : sans lui, un signalement abusif remonte indéfiniment.

## 5. Deux régimes de masquage, et pourquoi ils ne diffèrent pas que d'un bouton

> **Tranché** : dépliable par défaut, **sauf** la catégorie
> « illégal ». Ce qui suit dit ce que chacun des deux régimes engage.

### 5.1 Éditorial — replier, pas escamoter

**Masquer replie, ça n'escamote pas.** La rangée reste, avec son numéro, son
auteur, le motif, le nom du modérateur, et un bouton « afficher quand même ».

Ce n'est pas une demi-mesure, c'est le seul geste qui a du sens ici. Le but du
masquage n'est pas d'empêcher la lecture — c'est **impossible** : le message est
sur le réseau, un autre client le montre. Le but est de **retirer la
récompense**. Un raid fonctionne parce que le message est vu par défaut par tout
le monde ; replié, il est vu par ceux qui vont le chercher, c'est-à-dire presque
personne, et jamais par accident. Escamoter en silence coûterait la seule chose
qu'on possède en propre — la crédibilité — pour un gain nul.

### 5.2 Illégal — retirer le bouton ne suffit pas, et c'est le piège

Pour le plancher du §9.2 (pédocriminalité, apologie du terrorisme, doxxing), le
bouton « afficher » n'a pas sa place : le proposer, c'est offrir un chemin vers
un contenu dont l'opérateur répond.

Mais **retirer le bouton ne retire rien.** Un message replié sans bouton reste un
message que *notre relais sert* : n'importe qui peut le demander au relais
directement, sans passer par notre client. Une catégorie « illégal » qui ne
serait qu'un affichage en moins donnerait à l'opérateur l'illusion d'avoir agi —
exactement le risque juridique qu'elle prétend traiter.

Donc, dans ce projet, la catégorie `illegal` est définie comme **deux gestes
liés, jamais un seul** :

1. côté client — la rangée perd son bouton et porte la mention du retrait
2. côté relais — l'id entre dans l'ensemble `purged` : **le relais cesse de le
   servir** (§6)

Le second est le geste réel ; le premier n'en est que la conséquence visible.
C'est la seule chose qui ressemble à une suppression et qui soit vraie ici :
nous ne pouvons pas retirer un event du réseau, nous pouvons cesser de le
distribuer. C'est précisément la promesse du §9.2 — « ce que *nous* servons,
nous en répondons » — et rien de plus.

**Conséquence pour le panneau :** classer en `illegal` n'est pas une variante de
« masquer », c'est une autre action, avec une autre confirmation, qui dit à
l'écran ce qu'elle fait et ce qu'elle ne fait pas — le message reste sur les
autres relais du réseau, et ça, personne ne peut le changer.

## 6. L'application au relais — le seul endroit où bannir bannit

Côté client, un ban n'est qu'un repli. La seule barrière du système est la policy
d'écriture (§12.2 : « le seul endroit où on peut refuser *avant* stockage »).
`PolicyConfig` gagne donc deux ensembles :

```ts
/** Clés bannies : refus dur, avant tout autre contrôle. */
blocked: ReadonlySet<string>
/** Topics verrouillés : les réponses ne sont plus acceptées. */
locked: ReadonlySet<string>
```

### 6.1 Purger n'est pas refuser — deux chemins différents

`blocked` et `locked` agissent **à l'écriture**, donc sur ce qui n'est pas encore
arrivé. La catégorie `illegal` du §5.2 demande l'inverse : agir sur ce qui est
**déjà stocké**. Ce n'est pas la même mécanique, et c'est une distinction qu'il
ne faut pas écraser dans le code :

- **le relais de dev** (en mémoire, `scripts/dev-relay.ts`) tient un ensemble
  `purged` d'ids qu'il **cesse de servir** en réponse aux `REQ`. Suffisant pour
  vérifier la boucle complète en local
- **strfry**, lui, ne peut pas faire ça depuis la policy d'écriture : un plugin
  strfry ne voit que les écritures. Le retrait réel est une **commande
  d'exploitation** (`strfry delete --filter '{"ids":[…]}'`), donc un geste
  d'opérateur sur la machine, pas un clic dans un panneau

Le panneau produit donc, pour la catégorie `illegal`, **la liste d'ids à purger**
et la commande correspondante — il ne prétend pas l'exécuter. Un bouton qui
promettrait une purge sur un relais de production qu'il ne pilote pas serait le
même mensonge d'interface qu'un « bannir » qui ne bannit rien.

**Comment le relais apprend l'état sans canal privé :** il est un relais, donc il
reçoit et stocke les kind 30078 signés ; il connaît la clé racine par
configuration. Il reconstruit donc l'état de modération **à partir de ce qu'il
stocke déjà**, sans base parallèle ni API d'administration.

La propriété qui en découle vaut d'être notée : **le panneau publie, le relais
applique, et n'importe qui peut vérifier que les deux disent la même chose.** Une
modération qui se contrôle depuis l'extérieur.

Trois limites à énoncer plutôt qu'à découvrir :

- ça n'agit que sur les **écritures futures** — Nostr n'a pas de suppression, ce
  qui est stocké reste stocké jusqu'à une purge d'exploitation
- ça ne vaut que pour **nos** relais ; les autres font ce qu'ils veulent, et
  c'est la promesse du §9.3, pas un défaut
- **strfry n'est pas installé** (README) : à cette étape, seul le relais de dev
  applique réellement la règle. Le code de policy étant partagé, la règle est
  écrite et testée — pas déployée. Ne pas confondre les deux

## 7. Signalements — NIP-56, et l'heuristique de diversité du §9.6

Un signalement est un **kind 1984** (NIP-56) : tag `e` pour un message, `p` pour
une clé, plus un type (`spam`, `illegal`, `impersonation`, `other`…). Kind à
ajouter à `allowedKinds`.

La file du panneau **ne trie pas par nombre de signalements** — ce serait offrir
le pouvoir de modération au premier groupe organisé venu. Elle applique le
substitut retenu au §9.6, « l'heuristique de diversité, version pauvre » :
exiger qu'un signalement soit corroboré par des comptes qui n'interagissent pas
habituellement ensemble.

Version retenue, calculable avec ce qu'on a déjà : parmi les signalants d'une
même cible, on construit le graphe « se suit, dans un sens ou dans l'autre »
(kind 3, déjà chargés par `stores/social.ts`), et on compte un **ensemble
indépendant** par glouton. Trois comptes qui se suivent = **1 voix**. Trois
inconnus l'un de l'autre = **3 voix**. La file est triée sur les voix.

Coût : une fonction pure, testable, une centaine de lignes. Bénéfice : le
brigading ne remonte plus la file. C'est exactement le « casse le brigading pour
1 % de la complexité » du §9.6.

## 8. Le panneau — `/admin`

Accessible uniquement si la clé locale est dans le roster. Quatre volets.

**Principe directeur : c'est un outil de travail, pas un tableau de bord.** Aucun
chiffre décoratif — chaque nombre affiché doit décider quelque chose. Un
compteur qu'on regarde sans agir dessus n'a rien à faire ici.

1. **File des signalements** — l'écran par défaut, trié par voix distinctes.
   Chaque ligne montre **le message en clair** (on ne modère pas à l'aveugle),
   son auteur avec ses messages récents, les motifs invoqués, le nombre de voix.
   Actions en ligne : masquer / bannir / classer sans suite, motif obligatoire.
2. **Journal** — les actions en vigueur, avec auteur, cible, motif, date. C'est
   le contre-pouvoir, et il ne coûte rien : les actions *sont* des events signés
   publics, le journal ne fait que les rendre lisibles.
3. **Équipe** — admin seulement : nommer, révoquer, avec l'avertissement sur la
   clé racine et sur ce que la révocation emporte (§3.3).
4. **Relais** — l'état à appliquer côté relais, et la distinction masquer/purger
   du §5, écrite là où on la lit avant d'agir.

## 9. Ce que voit un utilisateur normal

- **badge `modération` / `admin`** sur les messages du staff. Une autorité
  invisible n'existe pas ; et sans badge, un modérateur qui intervient dans un
  fil est indistinguable d'un khey qui se donne de l'importance
- **action « signaler »** dans la rangée d'actions, à côté de « répondre » — code
  forum, jamais au survol (§7.3)
- **messages repliés** avec motif, auteur de la décision, et bouton « afficher »
- **topic verrouillé** : bandeau, composeur fermé, motif visible
- **topic épinglé** : en tête de liste, marqueur explicite

### 9.1 La page publique `/moderation`

> **Tranché** : oui, **avec le nom du modérateur qui a agi**.

Une page ordinaire du forum, ouverte à tous : l'équipe, et les décisions en
vigueur — quoi, par qui, pour quel motif.

Elle ne rend rien public qui ne le soit déjà : le roster et les actions **sont**
des events signés, lisibles par n'importe quel client Nostr. Ce qu'elle change,
c'est qu'elles deviennent lisibles **par un lecteur ordinaire**. Sans elle, le
« pas de censure silencieuse » du §9.2 n'est tenu que pour qui sait interroger un
relais à la main — c'est-à-dire pour personne.

Ce que ça engage, et qu'il vaut mieux avoir décidé que subi : **les modérateurs
sont nommés à chaque décision contestée.** Sur un forum à haut débit, avec les
raids du §9.5, c'est aussi une liste de cibles. Trois conséquences à tenir
dans l'interface :

- un modérateur devrait pouvoir travailler sous une **clé de rôle** distincte de
  son identité de lecteur — le roster nomme des clés, rien n'oblige à ce que ce
  soit celles avec lesquelles on poste
- le motif est lu par tout le monde, donc il est **public par destination** : le
  panneau doit le dire au moment de la saisie, pas après
- la page liste des décisions, **pas un palmarès** : ni compteur par modérateur,
  ni classement — ce serait offrir une cible chiffrée

## 10. Décisions négatives

| Écarté | Pourquoi |
|---|---|
| **NIP-72** (kind 34550 + approbations 4550) en structure de base | déjà écarté par la spec (ligne 159) : conçu autour de l'approbation *préalable*, donc d'une autorité qui autorise avant. Ici la parole est libre par défaut. Publier un 34550 **en plus**, pour l'interopérabilité, reste possible plus tard |
| **kind 5** (demandes de suppression) | demander poliment à des relais d'oublier. §2.5. Un modérateur qui « supprime » et voit le message rester ailleurs croirait son geste effectif — pire que pas de bouton |
| **Sanctions temporaires** (mute 24 h, ban 7 jours) | `created_at` est déclaratif (§2.4) : côté client, une expiration se falsifie. Faisable **au relais seulement**, qui a une horloge réelle. Étagère |
| **Modération des MP** | NIP-17 : contenu chiffré, expéditeur masqué par le gift wrap (§10.2). Le staff ne peut pas, et ne doit pas. Le seul recours est côté destinataire |
| **Vote communautaire / Community Notes** | §9.6 : exige une échelle qu'on n'a pas, latence batch incompatible avec un raid |
| **Modérateurs par topic, hiérarchie fine** | chaque rôle est un état à afficher, expliquer, tester. Deux suffisent |

## 11. Limites connues

- **Taille de liste.** `maxContentBytes` vaut 32 Ko : à ~145 octets par action,
  une liste plafonne vers **220 actions par modérateur**. Il faudra soit borner
  les motifs, soit segmenter par `d` (`forome.moderation.2`), soit relever le
  plafond pour les clés du roster. À traiter avant, pas après le mur.
- **Le journal est l'état courant, pas un historique.** Les listes sont
  remplaçables : les versions précédentes sont écrasées sur les relais. Un
  historique inaltérable exigerait un event par action (non remplaçable), donc
  un chargement complet pour reconstruire l'état — intenable sans l'indexeur.
  Si l'audit devient un besoin, c'est l'indexeur qui archive et signe.
- **Révoquer un modérateur annule ses actions.** C'est la propriété qui rend la
  révocation crédible, et c'est brutal : 200 masquages légitimes disparaissent
  avec un départ à l'amiable. Parade : un admin reprend les actions à son compte
  **avant** de révoquer. À prévoir dans le volet Équipe.
- **Le staff ne modère que notre client et nos relais.** Un autre client Nostr
  affichera tout, sans repli. C'est la promesse du §9.3 tenue, pas une fuite.
- **Un message corrigé reste modéré sur son id d'origine.** Une correction
  (spec §2.5) est un event de plus qui référence le premier ; le client résout
  toujours l'ancre, donc masquer un message masque aussi ses versions
  ultérieures, et l'historique tombe sous le voile avec le reste. Deux réserves
  qui, elles, ne sont pas couvertes : le relais ne connaît pas le lien entre les
  deux events, donc **une purge `illegal` ne retire que l'event visé** — les
  révisions d'un contenu illégal sont à purger explicitement ; et un dossier
  peut viser un texte que l'auteur a déjà corrigé, d'où les deux versions
  affichées côte à côte dans le panneau (`AdminCase`). La décision porte sur
  l'id d'origine, donc sur les deux à la fois.
- **Deux décisions dans la même seconde.** Un event adressable est remplacé sur
  `created_at`, et Nostr compte en **secondes** : republier une liste dans la
  même seconde produit un event que le relais ignore *tout en répondant `OK`* —
  donc une décision acceptée à l'écran et sans effet. Le client horodate ses
  republications de façon strictement croissante (`nextStamp`). Trouvé par
  `npm run smoke:moderation`, pas anticipé.

## 12. Les décisions, et leur statut

### Tranché

1. **Clé racine** — clé dédiée, hors du navigateur, signature par bunker NIP-46.
   `?admin=<hex>` en développement, comme `?indexer=`. (§3.1)
2. **Portée** — client **et** relais dans la même livraison. Un bouton
   « bannir » qui ne bannit rien est un mensonge d'interface. (§6)
3. **Repli** — dépliable par défaut ; catégorie `illegal` sans bouton, liée à la
   purge côté relais, parce que le bouton en moins ne retire rien à lui seul.
   (§5)

4. **Page publique `/moderation`** — oui, avec le nom du modérateur qui a agi,
   et les trois garde-fous du §9.1. (§9.1)

### Adopté par défaut, révisable sans rien casser

5. **PoW sur les signalements** — même difficulté que le contenu (14 bits,
   ~30 ms). La taxer davantage découragerait le signalement ; ne pas la taxer
   ouvrirait le flood de la file. La file triée par voix distinctes rend le
   flood inefficace de toute façon.
6. **Classer en `illegal` : admins seulement.** Le geste engage l'opérateur
   juridiquement et déclenche une purge — ce n'est pas de la modération
   éditoriale.

## 13. Où ça vit dans le code

L'ordre suit la chaîne de confiance : ce qui se vérifie sans interface d'abord.

| # | Portée | Fichiers | Vérification |
|---|---|---|---|
| 1 | Policy relais : `blocked`, `locked`, kind 1984 | `packages/relay-policy/src/index.ts` | tests unitaires (le seul endroit du projet qui les mérite vraiment — §policy.test.ts) |
| 2 | Types et fonctions pures : roster, fusion, voix distinctes | `apps/nostr/types/moderation.ts`, `utils/moderation.ts` | `test/moderation.test.ts` — fusion, révocation, brigading |
| 3 | Store : lecture, souscriptions, publication | `apps/nostr/stores/moderation.ts` | relais de dev + `?admin=` |
| 4 | Publication de données applicatives | `composables/usePublisher.ts` (`publishAppData`) | — |
| 5 | Le relais de dev applique l'état qu'il reçoit, `purged` compris | `scripts/dev-relay.ts` | bannir → l'écriture est refusée ; classer `illegal` → le relais ne sert plus l'event |
| 6 | Lecteur : repli (deux régimes), badges, signaler, verrouillé, épinglé | `PostItem.vue`, `TopicList.vue`, `Composer.vue`, `ForumShell.vue` | à l'œil, sur le relais local |
| 7 | Panneau `/admin`, dont la liste d'ids à purger et sa commande `strfry delete` | `pages/admin.vue` (+ composants de file) | — |
| 8 | Entrée dans le menu | `UserMenu.vue` | — |

Rien de tout ça ne touche au réseau public : la vérification se fait contre
`npm run dev:relay`, avec `?admin=` et `?relays=`, comme le reste (README).
`npm run smoke:moderation` fait le trajet complet — roster, bannissement, refus
réel du relais.
