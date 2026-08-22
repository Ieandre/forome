# Forome — conception

> On consigne les décisions **et leurs raisons**, y compris les décisions
> négatives : un refus dont le motif est perdu se rejoue tous les six mois.
>
> **Convention de lecture.** Les numéros de kinds et de NIP cités viennent du
> dépôt `nostr-protocol/nips`. Plusieurs (NIP-7D, NIP-22, NIP-17) bougent
> encore : revérifier contre le dépôt amont au moment d'implémenter, jamais
> contre ce document.

---

## 0. Ce que le protocole décide à notre place

Il n'y a pas de centre. Personne n'ordonne les messages, ne les horodate ni ne
certifie qui les a écrits : un message est un **event signé par son auteur**, et
un relais ne fait que le stocker et le servir. L'incensurabilité n'est donc pas
une sortie de secours, c'est la propriété par défaut — et symétriquement, tout ce
qui demanderait une autorité devient un problème à résoudre.

| | Ce que Nostr fournit | Ce qu'il faut assumer |
|---|---|---|
| Format | event JSON NIP-01, id = hash d'une sérialisation canonique spécifiée | pas d'extension hors des `tags` |
| Signature | secp256k1 / Schnorr (BIP-340), vérifiable par n'importe quel client | aucune, c'est du gain net |
| Identité | une clé publique | ni délégation ni révocation (§3.2) |
| Ordre | `created_at`, déclaré par l'auteur | pas d'ordre total, pas d'horloge fiable (§2.4) |
| Retrait | une demande de suppression, honorée relais par relais | **aucun retrait garanti** (§2.5, §9.2) |
| Pseudo | un kind 0 modifiable à volonté | non unique, usurpable (§3.5) |
| Interop | tout client Nostr lit et écrit les mêmes events | le forum ne possède pas ses lecteurs |
| Réplication | n'importe qui peut garder une copie | on ne choisit pas qui la garde |

**Ce que ça donne :** l'interopérabilité — le profil, les follows et les MP
existent déjà et suivent l'utilisateur hors de l'app —, la réplication gratuite
sur des relais tiers, et une promesse produit nette : personne ne peut retirer un
message du réseau, pas même son auteur.

**Ce que ça coûte :** l'ordre total, l'horodatage fiable, la révocation de clé,
la numérotation des posts, l'unicité des pseudos et le retrait dur. Les six
sections qui traitent ces pertes (§2.4, §3.2, §3.5, §6.4, §9.2, §10.2) sont la
partie utile de ce document. Le reste est de la plomberie.

---

## 1. Thèse

**Un forum généraliste à haut débit, sans inscription, en temps réel, sur un
protocole que personne ne contrôle.**

Le tempo d'un forum vivant, l'anonymat de 4chan, l'incensurabilité d'un protocole
ouvert, et une UX temps réel que personne n'a construite sur Nostr.

| Pilier | Ce que ça donne | Difficulté |
|---|---|---|
| **Zéro friction** | tu lis en 2 s, tu postes en 5, sans compte | UX / crypto invisible |
| **Temps réel intégral** | un forum au tempo d'un chat, sans jamais recharger | UX / systèmes |
| **Incensurable par construction** | signé, répliqué, retirable par personne | protocole (acquis) |

Critère de jugement d'une idée : elle doit être (a) techniquement difficile, (b)
immédiatement ressentie sans explication, (c) coûteuse à copier. Une idée qui
échoue au (b) est de la plomberie et doit être présentée comme telle.

**Le créneau réel** est le (b). Le protocole est public depuis des années ; ce
qui n'existe pas, c'est un client Nostr qui donne la sensation d'un forum vivant.
L'avantage n'est pas cryptographique, il est ergonomique — et c'est tant mieux,
parce que c'est le seul des trois qu'on maîtrise.

---

## 2. Le protocole

### 2.1 L'event, seul objet

Un event NIP-01 :

```json
{
  "id":         "<sha256 des octets canoniques>",
  "pubkey":     "<clé publique secp256k1, 32 octets hex>",
  "created_at": 1772000000,
  "kind":       1111,
  "tags":       [["E","<id du topic>"], ["e","<id du message cité>"]],
  "content":    "…",
  "sig":        "<Schnorr BIP-340 sur id>"
}
```

`id = sha256(utf8(JSON.stringify([0, pubkey, created_at, kind, tags, content])))`
avec les règles d'échappement fixées par NIP-01. Adressage par contenu : un
event est citable et infalsifiable.

### 2.2 La canonicalisation, et pourquoi elle reste un piège

La règle prudente serait : *signer des octets, jamais un objet ; ne jamais
re-sérialiser pour vérifier.* **Nostr l'interdit** — la vérification re-sérialise
nécessairement, puisque seuls les six champs voyagent et que l'id est recalculé.

Ce n'est pas grave en soi : NIP-01 spécifie la sérialisation exactement
(ordre des champs imposé, échappement minimal, pas d'espaces), donc deux
implémentations correctes produisent les mêmes octets. Le risque passe de « ma
bibliothèque contre la sienne » à « ma bibliothèque contre la spec » — beaucoup
plus petit, et couvert par les vecteurs de test amont.

**Mais deux conséquences dures :**

1. **Les champs inconnus ne sont pas préservés.** Un champ ajouté à la racine de
   l'event n'entre pas dans l'id, n'est pas signé, et sera jeté par n'importe
   quel relais ou client. Toute extension du format passe donc **par les
   `tags`** — un tag inconnu est conservé parce qu'il est *dans* l'id. La
   discipline « un client ancien garde intact ce qu'il ne comprend pas » reste
   obligatoire, mais elle s'applique aux tags.
2. **Pas de nonce implicite.** Deux events identiques du même auteur à la même
   seconde ont le même id, donc le second est un doublon indistinguable. Sur
   Nostr le problème se résout gratuitement : le tag `nonce` de la preuve de
   travail
   (§12) rend chaque event unique. Sans PoW, il faudrait un tag aléatoire
   explicite.

### 2.3 Modélisation : topic et message

Décision : **topic = kind 11** (NIP-7D, *Forum Threads*), titre dans un tag
`title`. **Message = kind 1111** (NIP-22, *Comment*), avec la convention de
NIP-22 : tags majuscules pour la racine (`E` id du topic, `K` kind de la
racine, `P` auteur de la racine), tags minuscules pour le parent immédiat
(`e`, `k`, `p`). Appartenance au forum par un tag `t` (hashtag) commun.

Pourquoi celui-là :

- kind 11 est *littéralement* fait pour ça, avec un titre — c'est la seule
  primitive Nostr qui modélise un fil de forum plutôt qu'un flux
- NIP-22 distingue racine et parent, donc la citation (§6.5) est native et le
  fil reste plat en affichage tout en gardant le lien sémantique
- un topic est un event non remplaçable → un titre ne peut pas être réécrit
  après coup, ce qui est la bonne propriété pour un forum

Écarté :

| Option | Raison du rejet |
|---|---|
| **kind 1** (note courte) + tags `e` | tout client Nostr afficherait nos messages dans son flux global comme des posts sociaux. Pollution dans les deux sens, et aucun titre |
| **NIP-28** (chat public, kinds 40–44) | modélise un salon, pas un fil. Adopte les codes du chat — précisément ce qu'on refuse (voir §7) |
| **NIP-72** (communautés modérées, 34550 + approbations 4550) | conçu autour de l'approbation par des modérateurs, donc d'une autorité. Utile plus tard **par-dessus** comme vue filtrée (§9.4), pas comme structure de base |
| **NIP-29** (groupes portés par le relais) | recentralise l'appartenance sur un relais unique, ce qui annule le bénéfice du pivot |

### 2.4 Ni numéro d'ordre, ni reçu, ni horloge

Un serveur central signerait un reçu : un numéro de séquence qui donne un ordre
total, et une heure de réception fiable. Sur Nostr il n'y a qu'un objet signé,
celui de l'auteur, et c'est **lui** qui déclare l'heure.

Conséquences, toutes structurelles :

- **`created_at` est une déclaration.** Un client peut mentir, en avant comme en
  arrière. Atténuation : le relais rejette les events hors d'une fenêtre de
  tolérance (quelques minutes autour de son horloge) via la policy d'écriture, et
  le client borne l'affichage. On ne fera pas mieux.
- **Ordre d'affichage** = `created_at`, départage par `id` pour être
  déterministe entre clients. Ce n'est pas un ordre total *du réseau*, c'est une
  convention de rendu. Deux clients honnêtes affichent la même chose ; un menteur
  peut s'insérer ailleurs dans le fil.
- **La numérotation des posts n'a pas de fondement.** `#1204` ne peut pas être
  une position dans un registre, puisqu'il n'y a pas de registre. Voir §6.4 :
  c'est un index local, et le permalien est l'id de l'event.
- **Un registre de prédictions horodatées est hors de portée.** Sans horodatage
  de confiance, une prédiction « datée » ne prouve rien. Il faudrait un tiers
  horodateur (ancrage OpenTimestamps, ou une attestation signée par un relais
  avec son horloge) — pas exclu, mais ce serait un autre projet.
- **Aucun arbitrage de révocation de clé n'est possible** : il demanderait une
  heure de confiance pour décider si une signature précède une révocation. Voir
  §3.2.

### 2.5 Édition et suppression

- **Édition** : kinds 11 et 1111 ne sont pas remplaçables, donc rien n'écrase
  rien — c'est le protocole qui offre l'historique, pas nous. Une correction est
  un nouvel event référençant l'ancien ; l'affichage montre
  la dernière version et garde l'historique consultable. Convention de client,
  pas garantie de protocole : un autre client montrera les deux events à plat.
- **Suppression** : NIP-09 (kind 5) est une **demande**, pas un ordre. Ton
  relais l'honore, les autres font ce qu'ils veulent. Un message publié sur trois
  relais et retiré du tien reste lisible sur les deux autres, par n'importe qui.
  C'est la promesse du produit et son principal risque juridique — §9.
- Garder hash et signature d'un message purgé, pour prouver « X a existé ici,
  retiré par M », est ici sans objet : rien n'est purgé, l'event est simplement
  ailleurs.

---

## 3. Identité

**Le principal risque produit du projet.** Un système à comptes offrirait deux
étages de clés, une révocation par appareil et une échelle de récupération à
cinq niveaux. Nostr a une clé, et c'est tout.

### 3.1 Onboarding inversé — la vraie fonctionnalité

Principe : **ne jamais rien demander avant l'action qui l'exige.** L'inscription
classique fait payer le coût d'identité à l'entrée ; ici il est payé
progressivement, et seulement quand il y a quelque chose à protéger.

| Moment | Ce qui se passe | Ce qu'on demande |
|---|---|---|
| **seconde 0** | arrivée directe sur la vue 30/70, un topic chaud pré-ouvert, la liste bouge. En arrière-plan : génération de la paire de clés, stockage local. Il est déjà `khey_a3f81b2c` | **rien** |
| **minute 1** | il lit, ouvre, ferme des topics. Aucun event publié, lecture totalement passive | **rien** |
| **minute 5** | il poste. Encart **non bloquant** : « Tu postes en tant que `khey_a3f81b2c` — identité anonyme générée sur cet appareil. [Choisir un pseudo] [Poster comme ça] ». La PoW se mine pendant la frappe | un choix, esquivable |
| **après quelques posts** | nudge discret : « Ton identité vit uniquement sur cet appareil. [Sauvegarder ma clé] [Lier un appareil] » — l'équivalent Nostr du « confirme ton email », optionnel | une sauvegarde |

Deux règles non négociables :

- **ne jamais bloquer** sur la sauvegarde de clé. Le nudge arrive après quelques
  posts, pas au premier — avant, l'utilisateur n'a rien à perdre et le message
  ne veut rien dire pour lui
- **la crypto est invisible par défaut.** Elle ne se manifeste qu'au moment où
  elle sert : quand on cite, quand on doute, quand on lie un appareil. Si
  l'utilisateur voit de la crypto, c'est raté

Le pseudo affiché par défaut est `khey_` + les 8 premiers hex de la clé
publique — déterministe, sans état, et déjà une identité. Avatar : identicon
dérivé de la clé — zéro upload, et deux clés ne peuvent pas produire le même.

### 3.2 Une seule clé, et aucune révocation

Le modèle qu'on voudrait : une clé de compte qui est l'identité, et des clés
d'appareil (une par navigateur, révocables individuellement, autorisées par
délégation signée). Téléphone perdu → révocation, identité intacte.

**Rien de tout ça n'existe sur Nostr.** La délégation (NIP-26) est dépréciée et
quasi non implémentée ; la rotation de clé n'a pas de standard adopté. Donc :

- une clé = l'identité, et elle signe au quotidien
- **appareil perdu = clé potentiellement compromise, sans recours.** Pas de
  révocation, pas de continuité : la seule réponse est de changer d'identité et
  de perdre sa réputation
- un pseudo « repris » par un attaquant qui a la clé est indistinguable du
  vrai — il *est* le vrai, cryptographiquement

Le seul vrai remède est **NIP-46 (signeur distant, dit « bunker »)** : la clé
vit dans une seule app dédiée, et les clients demandent une signature à
distance via une connexion autorisée, révocable indépendamment : le modèle à
deux étages, reconstruit une couche au-dessus du protocole. Il s'adresse aux
utilisateurs avancés ; **NIP-07** (extension navigateur) est l'échappatoire
desktop, plus simple et déjà répandue.

L'autorisation se demande par QR, pas par copie : le client affiche une
invitation `nostrconnect://` (clé publique de client + jeton à usage unique) et
c'est **le signeur qui scanne**. Rien de secret ni d'irréversible ne transite,
et coller une adresse `bunker://` à la main reste le repli.

### 3.3 Multi-appareil : le QR

Décision retenue : **export/import de la clé par QR code.** Sur l'ordi, « Ajouter
un appareil » affiche un QR ; sur le téléphone, on scanne. Pattern WhatsApp Web
inversé, connu de tout le monde, zéro concept nouveau à apprendre — c'est ce qui
couvre 95 % des cas.

Ce que porte le QR est un **lien vers `/appareils`, la clé dans le fragment**, et
pas la `nsec` nue : un appareil photo sait ouvrir un lien, il ne sait rien faire
d'un `nsec1…` sinon le donner à recopier. Forome s'ouvre, reconnaît l'identité,
la montre et attend une confirmation. Le fragment ne part jamais dans la requête
HTTP ; il est retiré de l'URL avant même l'hydratation. Son prix, lui, est réel :
il passe par l'historique du navigateur et par l'app photo, là où la clé nue ne
tenait que dans un presse-papier. Le QR de la clé nue reste donc accessible, pour
les apps signeur qui savent le lire.

Bonus structurel : comme le profil, les follows et les MP vivent sur les
relais, **il n'y a rien d'autre à synchroniser**. Un seul secret de 32 octets
voyage, et tout l'univers de l'utilisateur réapparaît.

À écrire dans l'interface, sans jargon : **un QR qui mène à une `nsec` est un
secret au porteur.** Quiconque le photographie devient l'utilisateur, pour
toujours. Donc : affichage à la demande, avec un compte à rebours d'expiration de
l'affichage, jamais dans une capture partageable par accident, et un
avertissement en une phrase.

### 3.4 Échelle de récupération

| # | Cas | Mécanisme |
|---|---|---|
| 1 | un appareil encore valide | QR vers le nouvel appareil |
| 2 | clé sauvegardée (fichier / gestionnaire de mots de passe) | import de la `nsec` |
| 3 | sauvegarde chiffrée par phrase de passe, stockée où on veut (un relais peut l'héberger sans jamais voir le clair) | déchiffrement côté client |
| 4 | signeur NIP-46 | la clé n'a jamais quitté le bunker |
| 5 | rien | **identité perdue définitivement** |

Le niveau 3 demande un coffre chiffré côté client (Argon2id +
XChaCha20-Poly1305, dérivation dans le navigateur) : la phrase de passe ne sort
jamais de l'appareil, et l'hébergeur du coffre ne voit que des octets.

### 3.5 Le pseudo n'est plus unique

**C'est la perte la plus contre-intuitive, et elle touche la thèse.** Un forum
classique garantit l'unicité du pseudo et son non-réattribution — sans quoi
quelqu'un attend la libération d'un pseudo connu pour usurper dix ans de
réputation.

Sur Nostr, le nom est un champ libre d'un event kind 0. **N'importe qui peut se
nommer `khey_legend`.** L'identité est la clé publique ; le nom est une
étiquette décorative. Conséquences à traiter en UX, pas en protocole :

- afficher **toujours** un discriminant à côté du pseudo (les 4–6 premiers hex
  de la clé, plus l'identicon qui en est dérivé — deux clés différentes ne
  peuvent pas produire le même avatar)
- **NIP-05** (`khey@ton-domaine`) donne une unicité vérifiée par DNS, avec une
  coche. Le prix : ton domaine redevient l'autorité de nommage, donc une
  recentralisation partielle et assumée — sur le *nom*, jamais sur l'identité ni
  sur les messages
- dans un fil, marquer visuellement les auteurs non suivis dont le pseudo
  ressemble à celui d'un compte suivi. C'est le vecteur d'arnaque classique de
  Nostr, il arrivera

### 3.6 Anonymat jetable, et sa borne

Le forum offre **« ↻ new khey »** : une identité jetable en un clic.

L'objection est réelle et n'est pas réfutée — l'anonymat total *détruit
l'attachement au pseudo*, et une communauté de comptes jetables n'accumule pas
de réputation, donc pas de folklore, donc pas de culture. D'où la borne :

- **le défaut est une identité persistante**, générée sans friction et
  conservée. L'onboarding inversé ne crée pas une identité par session
- **« new khey » est une action secondaire délibérée**, pas un mode. Elle sert
  les topics d'aveu et le besoin ponctuel de se détacher de son historique : un
  mode couvert, pris exprès, pas la manière ordinaire de poster
- la réputation reste attachée à la clé ; c'est le web of trust (§12) qui la
  rend utile, et il pénalise mécaniquement les clés neuves

Si l'usage réel montre que le jetable devient le défaut, c'est un signal
d'échec produit à traiter, pas une victoire de l'anonymat.

### 3.7 Mode anonyme : le grain fin du jetable

« new khey » (§3.6) répond au besoin *« je veux me détacher de mon
historique »*. Il ne répond pas à *« je veux dire **ça** sans que ce soit
signé de moi »* — pour cela il faudrait changer d'identité, poster, revenir, et
personne ne le fera. D'où le **mode anonyme** : une paire de clés éphémère signe
le message à la place de celle du compte, **sans que l'identité courante bouge**.

#### Une clé par topic

Le grain n'est pas le message. Une clé par message rendrait deux messages du
même auteur indistinguables de deux personnes — donc permettrait de se répondre
à soi-même en paraissant deux, dans le fil qu'on a ouvert. Une clé par topic
donne un `Anonyme·a3f81b` **stable dans ce fil et nulle part ailleurs** : la même
voix se voit, rien ne la relie à un autre fil. C'est le *poster ID* de 4chan, et
c'est la borne de §3.6 transposée au grain du message.

Conséquence heureuse pour §5 : le compte de participants d'un topic reste juste,
puisqu'une personne anonyme y vaut exactement une clé.

#### Le message le dit

Un message anonyme porte `["anon"]` et s'affiche sous un losange, sans identicon
ni lien de profil. La marque est **déclarative et ne prouve rien** — n'importe
qui peut signer avec une clé neuve sans la poser. Ce qu'elle empêche est plus
modeste et suffisant : que le client fasse passer un message jetable pour un
nouveau venu, ce qui rendrait suspect **tout compte neuf réel**.

#### Ce que ça ne protège pas

**Le relais voit la connexion** : même socket, même IP, même session que les
messages signés du compte. L'anonymat vaut vis-à-vis des *lecteurs*, pas de
l'opérateur, et l'interface le dit avant le premier envoi. Promettre l'anonymat
sans nommer contre qui, c'est mentir par omission à quelqu'un qui s'apprête à
écrire ce qu'il ne pourra pas reprendre.

Il en découle une règle que le code doit tenir : **on ne s'abonne jamais aux clés
anonymes**. Demander `{"#p": [ma clé, mes clés jetables]}` inscrirait le lien
dans une requête que le relais lit et journalise, là où il n'est aujourd'hui
qu'inférable. Le prix, réel : une réponse à un message anonyme ne notifie pas —
on la voit en rouvrant le fil, qui se souscrit par `#E` et ne nomme personne.

#### Ce que ça coûte à la modération

Le débit par clé (§12.2) ne mord plus : chaque fil donne une clé neuve. Restent
la PoW, qui est payée à l'identique, et le fait qu'un `blocked` ne peut pas viser
une clé qui n'existe pas encore. Ce n'est pas une régression du mode anonyme mais
de §3.6, qui a déjà cette propriété — et durcir la policy sur le tag `anon` ne
protégerait de rien, puisqu'un spammeur ne le pose pas. Ce qui tient reste ce qui
tenait : la PoW, le web of trust (§12.3) qui enfonce mécaniquement les clés
neuves, et le refus avant stockage pour ce qu'on voit passer.

#### Où vivent les clés

En localStorage, parce que **corriger son message demande de le resigner** (§2.5 :
l'autorité de révision se tranche sur `pubkey`). Elles ne sont ni exportées avec
la `nsec` ni synchronisées : un message anonyme n'est pas réclamable depuis un
autre appareil. C'est une propriété, pas un manque. « new khey » les efface avec
le reste — une identité jetée emporte ses masques, sinon le lien survivrait dans
le seul endroit qui le détenait.

#### La borne, comme en §3.6

Le mode est **rémanent par fil** et coupé par défaut. Rémanent, parce que
reprendre le geste à chaque réponse d'un fil d'aveu est intenable et qu'un oubli
y expose ; coupé par défaut, parce que l'identité persistante reste la voix
normale. Ce que la rémanence exige en échange, et qui n'est pas négociable :
l'état est visible en permanence dans le composeur — masque, cadre tireté,
libellé du bouton. Un état rémanent qu'on ne voit pas est un état qu'on oublie,
et ici l'oubli est définitif.

---

## 4. Ce que la signature débloque

| Fonctionnalité | Ce qu'en fait Nostr |
|---|---|
| **Citation vérifiable** | vérifiable par n'importe quel client Nostr, pas seulement le nôtre |
| Censure prouvable | gratuite et plus forte qu'ailleurs : l'event n'est pas retiré, il est ailleurs |
| Édition transparente | convention de client (§2.5) : l'historique existe de toute façon |
| Continuité de pseudo | acquise — le nom est un kind 0 modifiable, l'identité est la clé |
| Badge auto-vérifié | NIP-05 + liens croisés dans le kind 0 |
| Registre de prédictions horodatées | **hors de portée** — pas d'horloge fiable (§2.4), il faudrait un horodateur tiers |
| Citation d'échange | chaîne d'ids, gratuite |
| Engagement scellé | intact : un commit-reveal ne dépend pas de l'horloge |

Règle de présentation : **la crypto est invisible par défaut.** Le risque de cette direction est de produire un forum
froid et intimidant, plein de cadenas — l'inverse d'un lieu où on poste des
stickers à 3 h du matin.

---

## 5. Temps réel

### 5.1 Le modèle Nostr

Une WebSocket par relais, plusieurs souscriptions multiplexées dessus :
`REQ` avec un filtre → le relais envoie l'historique correspondant, puis `EOSE`,
puis les nouveaux events en direct. Trois souscriptions, une par usage :

- **topic ouvert** — `{kinds:[1111], "#E":[<id du topic>]}`
- **liste** — voir §5.2
- **personnel** — mentions (`{"#p":[<ma clé>]}`), MP (kind 1059 adressés à moi)

Un pool de relais (`SimplePool`) dédoublonne par `id` : le même event reçu de
trois relais s'affiche une fois. La réplication devient invisible, ce qui est
le but.

### 5.2 Le tick de liste

Ce qu'on veut pour la liste de topics : **un instantané calculé une seule fois,
diffusé identique à tout le monde.** Coût = un calcul + N envois, pas
N × événements ; la charge ne dépend quasiment plus du nombre d'utilisateurs.

Nostr ne sait pas faire ça : chaque client a sa propre souscription et le relais
lui pousse ses events. Deux options, et la première est un piège :

1. **chaque client souscrit large et calcule sa liste** — bande passante et CPU
   par client, tri par vélocité impossible à faire correctement sans voir tout
   le trafic. C'est ce que font les clients Nostr existants, et c'est pourquoi
   aucun n'a de vraie liste de topics chauds
2. **retenu — l'indexeur publie le tick comme event remplaçable**, signé par sa
   clé, toutes les ~2 s. Les clients souscrivent à un seul event replaceable et
   reçoivent tous les mêmes octets. L'instantané est préservé, et il devient
   *vérifiable* : le tick est signé, donc attribuable, et plusieurs indexeurs
   concurrents peuvent publier le leur

Corollaire : **le personnel se superpose côté client.**
Non-lu, topics suivis, filtres, blocages sont calculés par le client sur le
squelette reçu. L'instantané diffusé doit rester identique pour tous, sinon le
bénéfice disparaît.

### 5.3 Classement par vélocité

Trier par dernier message laisse **un seul « up » remonter un topic mort**, et
trois personnes suffisent à squatter le haut de la liste. D'où un tri par
participants distincts, rythme et accélération. La même mesure sert à la
détection de raid.

À sa place, cependant : la vélocité n'est **pas** un pilier, c'est de la
plomberie plus une fonction de tri.

### 5.4 L'indexeur n'est pas optionnel

Il est tentant de le présenter comme « un petit indexeur optionnel ». C'est faux
pour l'écran principal :

| Fonction | Sans indexeur |
|---|---|
| liste chronologique brute | ✔ possible |
| **tri par vélocité (l'écran phare)** | ✗ impossible |
| recherche plein texte | ✗ strfry n'implémente pas NIP-50 |
| numérotation stable des posts (§6.4) | ✗ |
| détection de raid | ✗ |

Le piège de l'index est connu, et la réponse est de **rendre l'index
remplaçable.** Les données étant auto-vérifiables, plusieurs indexeurs
concurrents peuvent tourner dessus,
et tout est reconstructible depuis les relais. Ce n'est pas « pas de centre »,
c'est « le centre n'a pas de pouvoir de rétention ».

C'est aussi pourquoi Bluesky a *une* AppView et Nostr une poignée de gros
relais : l'agrégation se recentralise toujours, par gravité économique.

---

## 6. Affichage du fil

C'est de l'UX pure, et c'est là que se joue le produit : un fil qui défile en
direct sans jamais faire perdre au lecteur la ligne qu'il était en train de
lire. Trois pièges, tous rencontrés en vrai.

### 6.1 Machine à états d'accrochage

État booléen **`accroché`**, pas une position recalculée : vrai à moins de
~80 px du bas (pas 0 — inertie de scroll, arrondis sous-pixel et zoom feraient
décrocher tout seul) ; scroll vers le haut → faux, plus rien ne bouge ; retour
en zone basse ou clic sur la pilule « N nouveaux » → vrai.

### 6.2 Trois pièges

1. **Contenu ajouté au-dessus** : mesurer `scrollHeight` avant/après, corriger
   `scrollTop` de la différence.
2. **Images** — le pire, et central ici : un sticker qui finit de charger fait
   sauter tout ce qui est en dessous. **Réserver la place à l'avance.** Sur
   Nostr, les dimensions viennent du tag `imeta` (NIP-92, champ `dim`). Piège :
   `dim` est *déclaré par l'auteur* et signé par lui, mais aucun serveur ne le
   vérifie contre les octets. Le hash `x` du même tag permet
   de vérifier les octets ; ton miroir média (§8) recalcule et sert les vraies
   dimensions. Non négociable.
3. **Taille du DOM** : cap dur à ~150 messages rendus. (Conséquence : pas besoin
   de virtualisation.)

### 6.3 Débit lissé + ambiance

Lissage sans mode signal : **aucune filtration éditoriale**, rien n'est jamais
masqué, aucun algorithme ne décide quel message mérite d'être vu. On ne joue que
sur le rythme. Tampon libéré à cadence lisible (~350 ms), débit de sortie
fonction du remplissage ; passé ~4 messages/seconde on est *de facto* en
ambiance, avec changement d'étiquette (« flux brut ») et rendu allégé.

Détails sans lesquels ça ne marche pas :

- **son propre message ne passe jamais par le tampon** — sinon écrire donne
  l'impression que le site est cassé. Bug le plus fréquent de ce pattern. Sur
  Nostr c'est l'affichage optimiste : l'event est rendu dès la signature, avant
  l'`OK` des relais, et réconcilié par `id`
- le tampon ne sert que si `accroché`
- le compteur du tampon est un **signal d'ambiance** : un « +14 » qui pulse dit
  que la pièce est en feu avant d'avoir lu une ligne

### 6.4 Ordre d'affichage et numérotation

**L'ordre d'arrivée fait loi en direct. Ne jamais réordonner ce qui est déjà
affiché** — voir le fil se réécrire sous les yeux est très désagréable. La
réconciliation ne s'applique qu'au chargement initial.

La numérotation des posts, elle, demande une définition. Ailleurs, `#1204` est
une position dans un registre : un permalien, et une preuve. Ici il n'y a pas de
compteur (§2.4). Décision :

- **le permalien canonique est l'id de l'event** (`nevent`, NIP-19). C'est lui
  qui est partagé, cité, et qui fonctionne dans tout autre client
- **le numéro affiché est un index local**, calculé par le client sur son
  ordre de rendu (`created_at`, départage par `id`). Il reste utile à l'usage —
  « regarde le #47 » dans un fil ouvert au même moment — mais il **n'est pas
  stable entre clients ni dans le temps** si un event arrive en retard
- l'indexeur peut publier une numérotation stable, comme le tick (§5.2) : un
  numéro attribué à l'ordre d'arrivée *chez lui*, signé. Ça restaure un `#seq`
  partageable au prix d'une confiance en l'indexeur — acceptable, puisqu'il ne
  peut rien retenir ni falsifier, seulement numéroter

Ce point compte plus qu'il n'y paraît : le post numéroté est un **code de
forum** — phpBB le fait depuis vingt ans — et pas un détail. Il reste affiché,
il change seulement de statut : d'une preuve à une commodité de lecture.

### 6.5 Répondre à haut débit

Le message ciblé est déjà 200 lignes plus haut quand on finit de taper. →
**citer capture l'id**, pas la position. Sur Nostr c'est exactement le tag `e`
de NIP-22 : la réponse s'ancre quelle que soit la distance, et l'affichage
rappelle la cible en contexte.

---

## 7. Interface

### 7.1 Desktop — la vue 30/70

Liste à gauche (~30 %), topic ouvert à droite (~70 %), tout en direct, jamais
de rechargement.

- **Permalien obligatoire** : le state du panneau droit est dans l'URL,
  `history.pushState`, un lien partagé ouvre les deux panneaux au bon endroit.
  La culture repose entièrement sur le partage de liens — l'oublier tuerait ça.
- **Tri figé par défaut** : l'ordre ne se réordonne jamais tout seul sous les
  yeux du lecteur — c'est l'état normal de la liste, pas un mode déclenché par
  le curseur ou le focus (chaque déclencheur essayé a produit des gels
  inexplicables, voir `TopicList.vue`). Les changements s'accumulent en
  arrière-plan et s'appliquent à des moments prévisibles : au retour à la liste
  (fermeture du topic ou du filtre), ou au clic sur la pilule « +N nouveaux
  topics », réservée aux topics nouveaux — un simple échange de rangs s'applique
  en silence au prochain retour. Seul l'ordre est figé : compteurs, chaleur et
  heures des rangées restent vivants. Sans ça, les topics bougent sous le
  curseur et c'est insupportable en dix secondes. **C'est l'innovation UX
  centrale : on ne perd jamais sa position dans le flux.**
- Le topic ouvert est **épinglé visuellement** quoi qu'il arrive à son rang.

### 7.2 À l'arrivée : un topic chaud pré-ouvert

Question tranchée : à l'arrivée, on **pré-ouvre un topic chaud** plutôt que de
laisser la colonne de droite vide.

Raison : la sensation « des gens parlent LÀ, maintenant » est le hook émotionnel
du produit, et un écran à moitié vide ne la donne pas. Coût assumé : la liste
ne se réordonne pas d'entrée (l'ordre est figé par défaut, §7.1), donc la
démonstration du flux de gauche est légèrement affaiblie — compensée par les
compteurs et les rails de chauffe, qui vivent en direct.

À mesurer dès qu'il y a du trafic : si le taux de fermeture immédiate du topic
pré-ouvert est élevé, c'est que le choix du topic est mauvais, pas le principe.

### 7.3 Codes forum, jamais codes chat

Contrainte de design ferme. L'objet central est **le post distinct dans un fil**,
pas la bulle de conversation :

- chaque message est une rangée à part entière, **jamais fusionnée** avec la
  suivante du même auteur
- barre d'auteur, numéro de post visible, bouton « répondre » **permanent** (pas
  au survol)
- rangées bordées ou zébrées, provenance en mono (pseudo, heure, numéro, id
  court)
- pas de regroupement de messages consécutifs, pas de barres d'outils au survol,
  pas de bulles

Référence : le forum classique, en thème sombre. Tout ce qui évoque une app de
chat est un bug.

### 7.4 Mobile — feuille glissante

Trois points d'ancrage : **aperçu** (~20 %, triage sans engagement),
**mi-hauteur** (~55 %, lisible et on peut répondre), **plein** (lecture
immersive). Bénéfice majeur : la position de scroll de la liste ne bouge jamais,
puisqu'on ne l'a jamais quittée.

Plus : rail des topics chauds en haut (épaisseur d'anneau = vélocité, swipe
horizontal = topic suivant) ; composition et gestes principaux dans la zone du
pouce ; swipe sur un message → citer, sur une ligne de liste → suivre/masquer ;
tiroir de stickers en swipe-up depuis le composeur.

Risque connu : le scroll imbriqué entre la feuille et son contenu est le piège
classique des bottom sheets. S'appuyer sur une lib de gestes.

### 7.5 Le composant à posséder

Le fil de messages concentre l'accrochage, le tampon, la réservation d'espace,
le cap DOM et la correction de scroll. **Aucune bibliothèque ne le donne
complet, dans aucun écosystème.** Composant isolé, machine à états explicite,
testable sans le reste de l'app. C'est là que se joue la qualité perçue — et
c'est le seul avantage réel sur les clients Nostr existants.

---

## 8. Stickers et médias

Répartition : **RisiBank = découverte** (recherche, collections, tags — ils le
font mieux), **nous = durabilité**.

À la publication : copie des octets sur notre stockage, calcul du sha256,
mesure des dimensions, puis publication du tag `imeta` (NIP-92) portant `url`,
`m` (mime), `dim`, `x` (sha256) et `alt`. L'id RisiBank est conservé comme
provenance et ne sert plus le contenu.

Raison critique : le hash est **dans l'event signé**. Si RisiBank
ré-encode, déplace ou disparaît, un client qui vérifie `x` verra une image qui
ne correspond plus. Ce serait une contradiction directe avec la thèse.

Stockage : **Blossom** (adressage par sha256, ce qui colle exactement à `x`) ou
NIP-96. Volume : seulement les stickers réellement utilisés → quelques milliers
de fichiers, quelques Go. Trivial.

Décisions :

- **API, pas widget** — `RisiBank.activate()` injecte un sélecteur dans un site
  existant, inadapté au composeur et aux gestes conçus ici. Proxy côté serveur,
  jamais depuis le client : cache, pas de fuite d'IP des utilisateurs vers un
  tiers, une seule IP donc allowlist utilisable. **Les contacter tôt.**
- **Pas d'upload utilisateur.** Supprime la pipeline, le risque de contenu
  illégal déposé, le hash-blocking, la modération d'images, la croissance
  imprévisible. Qui veut ajouter va sur RisiBank.
- **Pas d'auto-embed d'URL externes** dans *notre* client — sinon on recrée
  l'hébergement arbitraire et la fuite d'IP des lecteurs. À savoir : ce n'est
  qu'une politique de rendu locale, un autre client Nostr fera ce qu'il veut des
  mêmes events.
- **Avatars = identicon dérivé de la clé publique.** Déterministe, impossible à
  usurper, et visuellement l'identité *est* la clé — ce qui devient une défense
  directe contre l'usurpation de pseudo (§3.5). Zéro upload.
- **Contrainte = identité.** Texte + stickers RisiBank, rien d'autre. Les
  palettes étroites produisent des cultures fortes.

---

## 9. Modération : filtrer, pas supprimer

### 9.1 Décomposition

« Incensurable » recouvre quatre objectifs distincts, et ils ne se valent pas :

| | Objectif | Ce que Nostr en fait |
|---|---|---|
| a | Résister à son propre hébergeur | **acquis par défaut** |
| b | Empêcher la censure silencieuse | **acquis trivialement** — rien n'est retiré, donc rien ne disparaît en silence |
| c | Résister aux injonctions légales | **non**, et c'est le point dur — voir 9.2 |
| d | Rendre tout retrait techniquement impossible | **c'est le défaut**, qu'on le veuille ou non |

Ailleurs, (d) est une option qu'on écarte après réflexion. Ici c'est une
propriété structurelle : il faut donc dire pourquoi elle est dangereuse, parce
qu'elle l'est.

### 9.2 Un forum où rien ne se retire n'est pas habitable

Bilan empirique sans exception : les forums qui ne retirent rien ne deviennent
pas des havres de parole libre, ils deviennent **inutilisables** — spam
industriel, contenu illégal qui expose chaque opérateur, harcèlement qui chasse
tout le monde sauf ceux qui le pratiquent. Voat est mort d'inanition, 8chan a
détruit son propre hébergement, **et les relais Nostr sans filtrage sont
noyés** — et c'est exactement le terrain de jeu de ce projet.

La liberté d'expression suppose un lieu **habitable**. Un espace où tout reste
est un espace où presque personne ne parle → *moins* de parole réelle.
Observation d'ingénierie, pas jugement moral.

**Le point juridique, sans enrobage.** Le plancher non négociable — contenu
pédocriminel, apologie du terrorisme, doxxing : retirable immédiatement — **n'est
pas atteignable au niveau du réseau.** Ce qui reste atteignable, et sur quoi
l'opérateur est jugé :

- tu opères un relais → tu es hébergeur de ce que **ton relais** sert, et tu
  peux le purger. Ça, c'est faisable et obligatoire
- tu opères un client et un indexeur → tu contrôles ce qu'ils affichent et
  indexent. Ça aussi
- tu ne contrôles pas les autres relais, et personne ne l'attend de toi

Donc la promesse honnête n'est pas « incensurable », c'est : **« rien ne peut
être retiré du réseau ; ce que *nous* servons, nous en répondons ».**
« Impossible en silence » est une promesse plus solide qu'« impossible » — et une
promesse fausse décrédibilise le projet le jour où il faut retirer quelque chose.
À faire relire par un juriste avant l'ouverture publique (§15.4).

### 9.3 Formulation retenue

> **Rien ne peut être retiré du réseau, personne ne peut te retirer ton
> identité, et tu peux emporter tout ce que tu as écrit dans n'importe quel
> autre client.**

### 9.4 Contrôles côté lecteur — le mécanisme principal

On ne retire rien du réseau ; chacun choisit ce qu'il voit. Sur Nostr, tout
l'outillage existe et il est portable :

| Besoin | Mécanisme |
|---|---|
| bloquer / masquer | **NIP-51** liste de mute (kind 10000), signée, donc portable entre clients et appareils |
| étiqueter | **NIP-32** labels (kind 1985) — un curateur publie ses étiquettes, l'étiquette n'agit que sur ceux qui l'ont choisi |
| signaler | **NIP-56** rapports (kind 1984) |
| vue modérée | **NIP-72** approbations (kind 4550) : une lecture « approuvée par ces modérateurs », en surcouche, jamais en défaut |
| filtrage à l'écriture | policy d'écriture du relais (§12) |

Bénéfices : c'est le maximum de parole compatible avec un lieu vivable,
**plusieurs régimes de modération coexistent sur les mêmes données**, et
l'opérateur n'a pas à trancher les débats de modération — la position la plus
tenable pour une petite équipe. Et comme les listes et les labels sont des events
signés, ils suivent l'utilisateur d'un client à l'autre.

### 9.5 Détection de raid — priorité haute

Les forums francophones à haut débit ont produit du harcèlement organisé, avec
condamnations à la clé. Annoncer « pas de censure » attire **en priorité les gens
exclus d'ailleurs, avant la communauté visée** — et le peuplement initial
détermine la culture pour toujours. Ici le risque est aggravé : la promesse
d'incensurabilité est vraie et affichée, donc elle attire plus fort.

C'est un problème de conception, pas de morale. Un raid a une signature
statistique évidente : accélération brutale du débit, comptes récents
surreprésentés (sur Nostr : clés sans historique, hors du web of trust),
arrivées corrélées, forte convergence sémantique. Détection d'anomalie basique,
dans l'indexeur, en temps réel, avec alerte pendant que ça se passe.

En topic signalé : les clés hors WoT sont ralenties (PoW plus difficile demandée
par la policy du relais, ou débit limité), jamais bloquées. Et la règle qui évite
les faux positifs : des habitués qui s'emballent ne sont pas un raid — pondérer
l'accélération par la part de comptes récents.

### 9.6 Modération par pontage — étagère

L'algorithme (factorisation matricielle à la Community Notes) est simple, le mur
est ailleurs. Il faut des votants qui se recouvrent (avec 200
utilisateurs la matrice est trop creuse), la latence batch est structurellement
incompatible avec un raid qui fait ses dégâts en dix minutes, et il faut un
corps de votants motivés = un produit entier. Circulaire : exige l'échelle qu'on
n'a que si on a déjà réussi. **À ne pas tenter d'emblée.**

Substitut retenu — **heuristique de diversité, version pauvre** : exiger qu'un
signalement soit corroboré par des comptes qui n'interagissent pas
habituellement ensemble. Sur Nostr, le graphe des kind 3 donne ça
gratuitement. Casse le brigading pour 1 % de la complexité.

### 9.7 L'équipe et son outil — document séparé

Tout ce qui précède décrit ce que chaque lecteur règle pour lui-même. La couche
qui manque — **une équipe qui décide une fois pour tout le monde**, ses pouvoirs,
et le panneau qui lui sert à travailler — est conçue dans
[`moderation-staff.md`](moderation-staff.md) : chaîne de confiance en
trois maillons (clé racine → roster → listes d'actions signées), application au
relais, file de signalements triée par l'heuristique de diversité du §9.6.

---

## 10. Messages privés

**Le seul endroit du projet où le chiffrement a un sens.** Le E2EE n'a aucun
sens sur du contenu public : chiffrer pour un groupe = tout le monde, donc ne
rien chiffrer.

### 10.1 NIP-17

Retenu : **NIP-17** — message de chat (kind 14), chiffré en **NIP-44 v2**
(clé de conversation dérivée par ECDH secp256k1), scellé (kind 13) puis
**gift-wrappé** (kind 1059) dans un event signé par une **clé éphémère**.

Ce que le gift wrap achète : **les métadonnées sont masquées aux relais.** Qui
parle à qui, et quand, n'est pas lisible — seul le destinataire apparaît, en tag
`p` sur l'emballage. Chiffrer le seul contenu, comme le fait n'importe quelle
messagerie à serveur, laisserait expéditeur et destinataire en clair.

- **Ne pas utiliser NIP-04** (kind 4), déprécié, qui laisse fuiter les
  métadonnées.
- `nostr-tools` fournit NIP-44 et l'emballage — quelques dizaines de lignes.
- **Envoyer aussi un emballage à soi-même**, sinon l'expéditeur ne relit pas ses
  propres MP : NIP-17 prescrit deux boîtes par message, une par lecteur légitime.
- Historique sur nouvel appareil : une fois la clé arrivée par QR, les
  emballages sont refetchés depuis les relais et déchiffrés. Le problème
  d'historique inaccessible qui traîne chez Matrix et Signal ne se pose pas.
- **Pas de forward secrecy** (fuite de la clé = historique lisible) — compromis
  assumé, et à afficher dans l'interface plutôt qu'à taire.
- MP sur une liste de relais dédiée, séparée des relais de contenu.

### 10.2 Ce que le gift wrap casse

Le blocage des MP **côté serveur** — le client ne reçoit jamais un MP d'un compte
bloqué — est **impossible ici**, et c'est la contrepartie directe du gain de
confidentialité : l'emballage est signé par une
clé éphémère, donc **le relais ne peut pas connaître l'expéditeur** — donc il ne
peut pas filtrer sur lui. Personne ne peut, sauf le destinataire après
déchiffrement.

Conséquence : les MP sont le principal vecteur de harcèlement, et toute la
défense passe côté client, après déchiffrement.

- **file séparée** pour les MP de clés non suivies / hors WoT — jamais dans la
  boîte principale
- **PoW exigée sur l'emballage** : rend le spam de MP coûteux sans connaître
  l'expéditeur
- inbox filtrée par web of trust par défaut, ouvrable explicitement
- ce qui reste vrai et précieux : **un MP signalé est prouvablement
  authentique.** Le destinataire révèle le message et sa signature interne, le
  modérateur vérifie l'auteur. Plus de « c'est un faux screen », plus de parole
  contre parole — et ça fonctionne justement parce que l'auteur signe le clair
  *avant* l'emballage

---

## 11. Profil et relations

### 11.1 Profil = kind 0

Event remplaçable signé par la clé : pseudo, avatar, bio, NIP-05. Il te suit
partout — n'importe quel client Nostr affiche le même profil pour la même clé.
Modifiable à volonté, ou jamais publié (le défaut `khey_xxxxxxxx` de §3.1 ne
coûte aucun event).

Affiche :

- **avatar dérivé de la clé** (identicon) ou média RisiBank
- **discriminant de clé toujours visible** (§3.5)
- ancienneté : le plus ancien event connu de cette clé — **déclarative, pas
  vérifiable** (§2.4), et à présenter comme telle
- liens externes vérifiés, NIP-05
- **état de récupérabilité** (« clé sauvegardée / 2 appareils liés ») → une info
  de sécurité transformée en élément de profil, qui pousse doucement à
  sauvegarder sa clé

Le kind 0 ne porte **pas** de clé de chiffrement séparée : la même clé secp256k1
signe et dérive le secret des MP (ECDH), là où un système à deux clés séparerait
Ed25519 et X25519. Une clé de moins à gérer, une surface de compromission de
plus.

### 11.2 Follows = kind 3, et le web of trust gratuit

Liste de contacts signée, portable. Elle donne le « follow » (un onglet « topics
de mes kheys ») et surtout **elle alimente le web of trust** : le client peut
prioriser ce qui vient des gens suivis par les gens qu'on suit. C'est
l'anti-spam le plus efficace du lot (§12), et il arrive sans travail.

**Pas d'amis réciproques** : l'amitié réciproque coûte cher (demandes,
acceptations, états intermédiaires, visibilité) et un forum fonctionne très bien
sans. Suivre (asymétrique) et bloquer (kind 10000, asymétrique, dur) suffisent.

Effet de bord à assumer : **la liste de follows est publique.** Qui tu suis est
lisible par tout le monde, pour toujours. NIP-51 permettrait de chiffrer les
entrées ; le blocage, en particulier, le mériterait (§15.1).

---

## 12. Anti-spam

Trois couches, aucune suffisante seule.

### 12.1 Preuve de travail (NIP-13)

Un tag `nonce` est incrémenté jusqu'à ce que l'id de l'event commence par *d*
bits à zéro. Coût pour l'auteur : ~2^*d* hachages. Minée **dans un Web Worker
pendant la frappe**, donc invisible.

- cible : **18–20 bits**, soit quelques centaines de millisecondes sur un
  desktop. **À calibrer, et à adapter par appareil** : un mobile est 3 à 5 fois
  plus lent, et une PoW qui fait chauffer le téléphone d'un lecteur légitime est
  un bug, pas une protection
- bénéfice secondaire gratuit : le nonce élimine les collisions d'id du §2.2
- **limite à connaître** : la PoW est régressive. Elle taxe un téléphone bien
  plus qu'un spammeur avec un CPU loué. Elle relève le plancher et arrête le
  spam paresseux ; elle n'arrête pas un adversaire motivé

### 12.2 Le relais

**strfry** (C++, LMDB) avec une **policy d'écriture** custom : events acceptés
sur critères (kinds autorisés, PoW minimale, fenêtre de tolérance sur
`created_at` — §2.4, débit par clé et par IP, taille). C'est le seul endroit où
on peut refuser *avant* stockage.

Plus **NIP-42 (AUTH)** pour lier une connexion à une clé quand on veut
appliquer des quotas par identité, et la synchronisation par negentropy entre
relais pour la réplication.

### 12.3 Web of trust

Le graphe des kind 3 (§11.2), côté client : ce qui vient d'une clé neuve et
isolée est affiché en second, ou replié, jamais supprimé. C'est la couche la
plus efficace et la plus juste — elle ne coûte rien à un habitué et beaucoup à
une ferme de clés — mais **elle ne marche pas à trente utilisateurs** (le
graphe est vide). D'où l'ordre : PoW et policy de relais d'abord, WoT quand il y
a un graphe.

---

## 13. Stack

| Couche | Choix | Raison |
|---|---|---|
| Front | **Vue 3 + Nuxt** | déjà en place ; Nuxt garde l'option SSR, indispensable si le forum doit se découvrir par Google (permaliens + Open Graph). Voir la nuance ci-dessous |
| État | **Pinia** | le gel de la liste, le pool de relais et le fil live sont trois états partagés à durée de vie longue |
| Protocole | **nostr-tools** | `SimplePool`, `generateSecretKey`, `finalizeEvent`, `verifyEvent`, `nip19`, `nip44`, `nip13` |
| Relais | **strfry** + policy custom | C++/LMDB, plugin de policy en JSON sur stdin/stdout, sync negentropy |
| Indexeur | **Node + TS + Postgres** | tri par vélocité, recherche, numérotation, détection de raid, publication du tick (§5.2) |
| Médias | **Blossom** (ou NIP-96) | adressage par sha256, aligné sur le tag `imeta x` |
| Crypto | via `nostr-tools` / `@noble/curves` | secp256k1 Schnorr, navigateur **et** Node |

**Nuance SSR (§15.1).** Un forum se découvre par un moteur de recherche, ce qui
plaide pour le SSR ; l'app est en `ssr: false`, et le dispositif de
[`docs/seo.md`](seo.md) répare le `<head>` sans SSR. Un vrai rendu serveur ne
pourrait pas s'appuyer sur les relais (trop lent, non déterministe) : il devrait
rendre **depuis l'indexeur**, ce qui le met sur le chemin critique du premier
rendu — exactement ce que §5.4 veut garder remplaçable. Arbitrage à faire
consciemment, pas par défaut.

**Ce que le protocole retire du risque projet :** avec un format maison, la
canonicalisation impose une seule bibliothèque partagée client/serveur, sous
peine de deux implémentations divergentes — et c'est ce qui obligerait à tenir
Node+TS des deux côtés. Ici le format est spécifié et testé en amont : le relais
peut être en C++ sans risque.

Écarté : GraphQL (les deux besoins réels sont un tick diffusé et un flux
d'events → des sockets), microservices, ORM lourd.

---

## 14. Décisions négatives

Consignées pour ne pas refaire le débat tous les six mois.

| Écarté | Raison |
|---|---|
| **Protocole signé maison** | l'interopérabilité et une canonicalisation spécifiée en amont valent plus que l'ordre total et l'horloge fiable qu'un serveur central donnerait. Prix payé : §2.4, §3.2, §3.5, §9.2 |
| **Inscription, même minimale** | le coût d'identité à l'entrée est le premier frein produit (§3.1). L'identité anonyme est le défaut, bornée par §3.6 : *persistante*, le jetable reste secondaire |
| **Clé jetable par message** (plutôt que par topic) | l'anonymat parfait dans un fil autorise à se répondre à soi-même en paraissant deux, sans que le lecteur puisse le voir. Une clé par topic garde la voix reconnaissable là où ça compte et nulle part ailleurs (§3.7) |
| **PoW renforcée sur le tag `anon`** | un spammeur ne pose pas le tag. Taxer la marque ne taxerait que ceux qui jouent le jeu (§3.7) |
| **Clés d'appareil révocables** | Nostr n'offre pas la délégation (§3.2). Le signeur distant NIP-46 reconstruit le modèle pour qui le veut ; sinon, perte d'appareil = compromission sans recours |
| **NIP-04 pour les MP** | déprécié, fuite des métadonnées. NIP-17 uniquement |
| **kind 1 pour les messages** | pollution croisée avec les flux sociaux, pas de titre (§2.3) |
| **NIP-29 (groupes portés par le relais)** | recentralise l'appartenance, annule le bénéfice du pivot |
| **E2EE sur le contenu public** | aucun sens : chiffrer pour un groupe = tout le monde |
| **P2P intégral** (DHT, gossip, NAT traversal) | les relais donnent 95 % du bénéfice ; le P2P donne latence imprévisible, temps réel impossible, spam ingérable, batterie morte |
| **Mode signal (masquage)** | choix de n'avoir aucune filtration éditoriale — on ne joue que sur le rythme |
| **Upload d'images utilisateur** | supprime le risque légal, la modération d'images et la pipeline |
| **Auto-embed d'URL externes** | recréerait l'hébergement arbitraire + fuite d'IP des lecteurs |
| **Widget RisiBank** | inadapté au composeur et aux gestes conçus ici |
| **Passkeys pour signer** | un geste par signature, clé non exportable → contredit la portabilité |
| **Amis réciproques** | coût élevé pour un gain nul : suivre + bloquer suffisent |
| **Modération par pontage** | exige une échelle qu'on n'a pas ; latence batch incompatible avec un raid |
| **IA générative visible** | ce que tout le monde fait (donc pas un différenciateur) et ça détruit ce qu'on vient chercher : des humains |

**Position IA :** structurelle et invisible uniquement — recherche sémantique,
clustering, détection de raid, extraction du lexique, outillage modérateurs.
**Jamais en production de contenu.** Le forum garantit l'humain, ce qui prendra
mécaniquement de la valeur à mesure que le slop LLM noiera les autres.

---

## 15. Questions ouvertes

### 15.1 À trancher

- **SSR ou SPA** (§13) : le SSR met l'indexeur sur le chemin critique. Décision
  structurante
- **Vérification client** : vérifier la signature de tout ce qui arrive, ou à la
  demande ? Attention au changement de courbe : Schnorr sur secp256k1 est
  nettement plus coûteux à vérifier qu'Ed25519 en JS — ordre de la
  milliseconde, contre quelques dizaines de microsecondes. **À mesurer avant de
  décider**, pas à supposer : à 40 events/s
  la vérification systématique reste probablement tenable, mais dans un Worker
  et pas sur le thread qui rend le fil
- **Numérotation stable** (§6.4) : index local seulement, ou numéro signé par
  l'indexeur ?
- **Organisation des topics** : liste plate unique, catégories, ou tags `t` ?
  Petite décision, mais elle structure la liste — et sur Nostr le tag `t` est
  aussi ce qui définit l'appartenance au forum
- **Un relais ou plusieurs à nous** ? Un seul relais est un point de défaillance
  qui ridiculiserait la promesse ; deux ou trois avec sync negentropy coûtent peu
- **Bloquer quelqu'un est public** (§11.2) : NIP-51 permet de chiffrer les
  entrées d'une liste. Qui bloque qui est en soi une information

### 15.2 Zones blanches protocolaires

- **Rotation de clé.** Nostr n'a pas de standard adopté pour « cette clé
  remplace celle-là ». Sans ça, une clé compromise est une identité perdue, et
  la promesse « personne ne peut te retirer ton identité » a un astérisque. À
  suivre en amont ; ne pas inventer un mécanisme maison
- **Qui modère ?** Il n'y a pas de retrait à autoriser, mais il y a des
  curateurs d'étiquettes
  (§9.4) et une policy de relais. Qui publie les labels « officiels », et
  comment cette autorité se transmet, reste à écrire
- **Numérotation et tick signés par l'indexeur** : ça crée une clé
  d'infrastructure qui a du pouvoir d'affichage. À documenter comme telle

### 15.3 Zone blanche produit — la couche culturelle

Rien n'en est conçu à ce stade :

- **recherche de stickers par intention** (« quand quelqu'un dit une énormité
  avec assurance ») : embeddings CLIP sur le cache local + tagging communautaire
  + stats d'usage réelles. Probablement la fonctionnalité qui fait adopter le
  plus vite, parce qu'elle est ressentie immédiatement
- généalogie des remix, packs personnels, stats d'usage
- **lexique auto-extrait** de l'usage réel : définitions au survol, étymologie
  (premier topic où le terme apparaît). Remplace l'apprentissage par humiliation
- mémoire : recherche sémantique sur l'archive, curation des topics légendaires

### 15.4 Avec de l'aide extérieure

**Cadre légal**, et l'incensurabilité le rend d'autant plus nécessaire (§9.2) :
statut d'hébergeur pour le relais **et** pour l'indexeur, procédure de
signalement, mentions légales, personne physique ou structure. Une vraie
consultation, pas une intuition. Avant l'ouverture publique.

### 15.5 Risque n°1 — les gens

Très loin devant tous les risques techniques. Le produit est conçu pour le haut
débit : **à trente utilisateurs, rien de ce qui précède ne fonctionne** — le tri
par vélocité n'a rien à classer, le lissage ne lisse rien, le web of trust est
vide, la culture n'existe pas.

- un forum vide se peuple **par niche**, jamais par généralité. « Le même
  forum, mais en mieux » n'attire personne ; un lieu pour une communauté précise
  et mal servie attire quinze personnes qui reviennent
- la technologie ne sera jamais l'avantage réel — Nostr moins que tout, puisqu'il
  est disponible pour tout le monde. Ce qui protège un forum, c'est sa culture et
  ses habitués. Mais une technologie qui **sert**
  cette culture (zéro friction, tempo respecté, folklore transmis) devient
  indissociable d'elle, et c'est ça qui devient impossible à copier

---

## 16. Points et niveaux

Section ajoutée après coup, et posée en fin de document plutôt qu'à sa place
logique (elle irait après §11, l'identité) : les numéros de section sont cités
depuis le code par dizaines, et les décaler pour une insertion transformerait
chaque renvoi en fausse piste.

### 16.1 Le problème, qui n'est pas celui qu'on croit

Un forum classique tient un compteur : la ligne de l'utilisateur en base porte
son nombre de messages, et le niveau s'en déduit. **Rien de tout ça n'existe
ici.** Il n'y a ni inscription, ni ligne, ni serveur qui aurait vu passer une
identité — une clé publique est une clé publique. Un score ne peut donc être
qu'un **pli sur les events**, tenu par un programme qui voit tout le trafic.

C'est exactement le piège du §5.4, transposé d'un classement à un nombre
cumulatif : un client qui compterait lui-même ne verrait que ce qui est passé
devant lui depuis son ouverture, donc deux lecteurs afficheraient deux scores
différents pour la même personne, sans qu'aucun des deux puisse savoir lequel est
faux. Pour un classement, le repli local est acceptable (§5.2) ; pour un score,
il ne l'est pas.

D'où la répartition retenue :

| | |
|---|---|
| **l'indexeur compte** | il est le seul à tout voir. Il publie les points comme des events remplaçables signés, exactement comme le tick |
| **le client dérive** | le **niveau** se calcule des points chez le lecteur, par le barème partagé (`@forome/points`) |

Le bénéfice de la coupure est concret : retoucher la courbe des niveaux ne
demande ni redéploiement de l'indexeur ni recomptage, et la clé de
l'infrastructure gagne le pouvoir de compter sans gagner celui de décider des
paliers.

### 16.2 Ce que les points récompensent

Deux blocs volontairement déséquilibrés — **ce qu'on fait est le plancher, ce
qu'on provoque est le score** :

| Ce que tu fais | |
|---|---|
| ouvrir un topic | +5 |
| répondre | +1 |
| avoir posté ce jour-là | +2, une fois par jour |

| Ce que tu provoques | |
|---|---|
| une personne distincte répond à ton message | +2, une fois par personne |
| une personne distincte vient parler dans ton topic | +3, une fois par personne |
| ton topic rassemble du monde (trois participants dans la fenêtre de §5.3) | +10, une fois par topic |
| quelqu'un vote à ton sondage | +1, une fois par personne |

Répondre deux cents fois dans la journée rapporte donc moins qu'ouvrir un fil où
douze personnes viennent parler. Ce n'est pas un réglage, c'est la thèse : **un
score au volume travaillerait contre le tri par vélocité (§5.3) et contre la
détection de raid (§9.5)**, qui existent tous les deux pour que le débit ne soit
pas une monnaie.

Il n'y a par ailleurs **aucun signal de qualité** à convertir — pas de kind 7,
donc ni « j'aime » ni vote positif (§14). La réception se lit dans les réponses
reçues et dans les gens qu'un topic rassemble, ce qui est plus coûteux à truquer
qu'un bouton.

### 16.3 Les garde-fous, sans lesquels le système meurt en une nuit

- **plafond quotidien : 40 points.** Un habitué l'atteint sans y penser, une
  ferme n'accélère pas. Il fait bien plus que borner : il **transforme le niveau
  en durée minimale** — aucune activité, aucun CPU loué et aucune collusion ne va
  plus vite, donc le niveau 20 réclame au moins 119 jours *quoi qu'on fasse*.
  C'est ce qui rend un niveau élevé lisible.
  **Une seule chose passe outre, et c'est assumé** : les attributions à la main du
  §16.8. Le niveau n'est donc pas une durée pure, c'est *durée **ou**
  reconnaissance* — et les deux se distinguent à l'écran, un profil disant
  toujours quelle part a été donnée.
- **un seul crédit par couple** (qui crédite, ce qui est crédité) : le pote qui
  répond cinquante fois compte une fois.
- **seuil pour créditer : 10 points.** Une clé neuve ne fabrique pas de valeur,
  donc une ferme de clés neuves non plus. Le système s'amorce quand même, puisque
  poster rapporte : à forum vide, personne ne crédite personne pendant les
  premiers messages, puis tout se débloque.
- **jamais de crédit à soi-même**, sinon se répondre est le meilleur placement du
  forum.
- le crédit est **consommé même quand le plafond du jour absorbe le gain** —
  sinon il suffirait d'attendre demain pour le rejouer, et le plafond ne serait
  qu'un étalement.

Deux effets de bord n'ont pas besoin de règle : le **mode anonyme** (§3.7)
utilise une clé par topic, qui ne capitalise donc jamais ; et les **révisions**
(§2.5) sont écartées par la même fonction partagée que le tick.

### 16.4 La courbe : infinie, et arithmétique

Passer du niveau *n* au niveau *n+1* coûte **25 × *n*** points. Les niveaux sont
donc infinis et se paient de plus en plus cher sans jamais devenir
inatteignables : niveau 2 à 25 points, 5 à 250, 10 à 1 125, 20 à 4 750, 50 à
30 625. Une courbe linéaire ferait arriver le niveau 40 en trois mois et le
rendrait muet ; une exponentielle bloquerait tout le monde au même palier.

L'incrément arithmétique a un troisième mérite : il se dit en une phrase — « le
niveau 5 coûte 100 points de plus que le niveau 4 » — ce qui rend une barre de
progression explicable au lecteur au lieu d'être un remplissage magique.

Pas de paliers nommés. Un nom de palier est une **fiction sur la personne**
(« vétéran », « pilier ») que ni les données ni le forum n'établissent ; un
numéro ne prétend rien de plus que ce qu'il est.

### 16.5 Ce que ça ne débloque pas

**Rien**, et c'est une décision, pas une timidité. Quatre raisons qui vont dans
le même sens :

1. Les points sont *ce que l'indexeur a vu*. Une nuit où il est tombé n'a jamais
   eu lieu. Mettre un droit d'écriture derrière un nombre indémontrable, ce
   serait refuser un message pour une raison qu'on ne peut pas opposer au lecteur.
2. Ça mettrait l'indexeur **sur le chemin critique de l'écriture**. Aujourd'hui
   s'il tombe, le classement se recalcule localement et le forum marche ; demain
   il faudrait que la policy connaisse le niveau — donc qu'elle devienne à état,
   et l'invariant « une seule implémentation, sans état » tombe.
3. Ça verrouille le nouveau venu dehors, alors que le coût d'identité à l'entrée
   est identifié comme le premier frein produit (§3.1).
4. Filtrer est déjà le travail de la PoW, de la policy et du web of trust (§12).
   Le rôle des points est de **rendre la contribution visible**, qui est une
   fonction culturelle (§15.3). Les mélanger abîmerait les deux.

Corollaire, valable pour **ce qui se gagne** : les points ne descendent jamais.
Une clé bannie cesse simplement de gagner, puisque le relais refuse ses events
avant stockage (§9.5) — rien ne se reprend rétroactivement.

Le staff, lui, peut retirer des points à la main (§16.8). La distinction est
nette et vaut d'être tenue : **le pli automatique est monotone, la décision
humaine est réversible dans les deux sens.** Un score qui baisserait tout seul
rendrait l'archive instable ; un score qu'une personne corrige, en signant et en
motivant, est une décision comme un masquage.

### 16.6 À l'écran : le niveau est un mot, les points sont une métrique

- **bande d'auteur du fil** : le niveau seul, en mono, dans le groupe de
  provenance (pseudo, discriminant, heure, nº de post) — et **pas** en pastille.
  Le niveau est un *fait sur l'identité*, pas un statut accordé par le forum ;
  une pastille lui donnerait le poids visuel du marqueur de modérateur. Rien en
  dessous du niveau 2 : une marque dont la seule information est « cette personne
  n'a rien fait » désigne le nouveau venu, ce qui est le contraire du but.
- **page de profil** : le nombre en entier, la progression, les faits qui
  l'expliquent. C'est la page où l'on vient jauger un inconnu, donc la seule où
  le chiffre informe.
- **`/classement`** : un registre, pas un podium — ni or, ni argent, ni bronze.
  La charte réserve sa seule couleur chaude à ce qui arrive *maintenant* ; trois
  médailles y mettraient un second accent chaud pour dire quelque chose de bien
  plus tiède. Le seul aplat coloré de la page est **ta** place. Le barème y est
  affiché, et lu depuis le code qui compte : une page qui recopierait les valeurs
  finirait par annoncer un barème que le forum n'applique plus.
- **pas dans la liste des topics** : c'est une liste de triage, le niveau du
  dernier posteur n'aide aucune décision.

Sans clé d'indexeur épinglée, **il n'y a pas de points du tout** : le store rend
`null` et l'interface n'affiche rien (invariant 4). Un « niveau 1 » affiché faute
de source serait un mensonge tranquille.

### 16.7 Les limites, à dire plutôt qu'à cacher

- **L'indexeur devient à état.** C'était le seul programme entièrement en
  mémoire, et il redémarrait vide sans que personne puisse s'en apercevoir — un
  classement par vélocité ne parle que du présent. Un score cumulatif, non. D'où
  un fichier hors du dépôt (`POINTS_STATE`, `~/forome-data` en production, sinon
  un déploiement le remettrait à zéro), écrit atomiquement, et dont l'illisibilité
  ne bloque pas le démarrage : le tick est l'écran principal, il n'a pas à tomber
  avec une fonctionnalité de confort.
- **Le pli n'est pas commutatif** : le seuil de crédit se lit sur le total
  courant de celui qui crédite. Un rejeu doit donc se faire par `created_at`
  croissant, sinon deux reconstructions donnent deux scores. C'est pourquoi la
  reconstruction complète n'est pas automatisée, et pourquoi le rattrapage au
  démarrage trie avant d'ingérer.
- **Le trou d'arrêt n'est comblé qu'en partie.** Le rattrapage repart de la
  dernière date comptée, mais il est borné (`CATCHUP_LIMIT`) et il le dit dans le
  journal quand il tape son plafond.
- **~5 000 membres classés**, plafond de fait : la policy borne un event à 32 Ko,
  d'où seize morceaux répartis par premier caractère de clé. Au-delà il faudra
  couper plus fin (deux caractères, 256 morceaux) — le format le permet, mais il
  faudra trancher qui reste au classement.

### 16.8 Attribuer des points à la main

Le barème ne sait voir que ce qui se compte. Il ne verra jamais le message qui a
sauvé un fil, la réponse qui a appris quelque chose à trois cents personnes, ou
le type qui a passé sa soirée à documenter un bug. D'où une attribution
manuelle : le staff donne des points, autant qu'il veut, pour ce que le pli ne
sait pas mesurer.

**Ce n'est pas un pli, c'est une décision signée** — donc ça vit avec la
modération (`packages/relay-policy/src/moderation.ts`) et pas avec les points.
Une liste remplaçable par clé de staff (`d = forome.points.grants`), exactement
comme la liste d'actions. Cette parenté n'est pas une commodité de rangement,
elle donne quatre propriétés d'un coup :

| | |
|---|---|
| **révocable** | annuler, c'est republier sa liste sans la ligne. Aucun contre-event à inventer, et une faute de frappe à 50 000 points se répare en dix secondes — sur un réseau sans suppression, c'est ce qui compte |
| **annulée en bloc** | la règle 1 de `deriveState` s'applique : retirer une clé du roster efface tout ce qu'elle a donné, d'un geste |
| **auditable** | le motif et la clé qui a signé voyagent avec les points, et s'affichent |
| **durable** | elle vit dans un event signé, donc elle survit à une perte de l'état de l'indexeur — les points les plus chargés de sens sont aussi les moins périssables |

Deux règles :

1. seules comptent les attributions d'une clé **actuellement** au roster ;
2. **ça s'additionne**, ça ne se remplace pas. Contrairement à tout le reste de
   la modération, une attribution n'est pas un état : en recevoir trois, c'est
   trois lignes sur un profil, pas la dernière qui gagne. C'est aussi ce qui
   permet à un modérateur de **corriger la générosité d'un autre**, en posant un
   retrait dans sa propre liste.

**S'attribuer des points à soi-même est permis.** La première version l'a
interdit, en miroir du « pas d'auto-crédit » du pli automatique. L'analogie était
fausse : l'auto-crédit est interdit là-bas parce qu'il y est *invisible*, *non
attribuable* et *farmable à grande échelle*. Aucune des trois ne vaut ici — une
attribution est signée, publique et motivée, et l'interface affiche « par
soi-même » quand l'auteur est la cible. Le garde-fou n'est pas une règle de
dérivation, c'est le roster : abuser se voit, et se révoque (ce qui efface tout
d'un geste, auto-attributions comprises).

**Retirer des points est permis aussi**, dans la même liste et par la même somme :
`amount` est signé. La première version le refusait au nom de « les points ne
descendent jamais » — mais cet engagement porte sur le **pli automatique** (§16.5),
pas sur une décision humaine signée. Un score que personne ne peut corriger à la
baisse rend la moitié de l'outil inutile : une attribution de complaisance ou une
faute de frappe à 50 000 points ne se réparent, sinon, que par celui qui les a
posées.

Une seule borne, et elle est de présentation : **le score affiché est plancherisé
à zéro.** La somme attribuée peut être négative, le nombre montré non — un négatif
dans un classement public serait un pilori permanent, ce qui est un acte bien plus
fort que « retirer des points ». Le retrait reste intégralement lisible ligne par
ligne sur le profil, avec son motif : on plancherise le total, on ne cache pas le
geste. Et le panneau annonce le plancher avant la signature (« c'est 500 de plus
que ce qu'il a »), pour que retirer trop ne passe pas pour retirer juste.

**Ce n'est pas la clé racine qui signe, c'est une clé de staff.** La clé racine
n'est pas une identité de tous les jours (§15.2, `docs/moderation-staff.md`) :
elle ne signe que le roster, quelques events par an, et vit dans un signeur
NIP-46 parce que Nostr n'a pas de révocation. Récompenser un bon message trois
fois par semaine la ferait descendre dans l'usage quotidien — exactement le
risque qu'elle décrit. Le roster délègue déjà ; les attributions passent par la
même délégation.

**L'indexeur n'en sait rien.** Il reste un pli pur sur le contenu public ; c'est
le client qui additionne les deux sources. Lui donner cette autorité l'obligerait
à connaître la clé racine, qu'il ignore aujourd'hui.

**Pas de points négatifs.** « Les points ne descendent jamais » (§16.5) tient :
annuler une attribution précise couvre l'erreur, et une sanction chiffrée est une
autre fonctionnalité que récompenser — elle se concevra à part si elle se
conçoit.

**Publique, motif compris.** Une récompense que personne ne voit ne récompense
rien : c'est l'argument principal, avant même la cohérence avec le reste de la
modération (`/moderation` dit déjà « rien n'est secret »). Le motif s'affiche sur
le profil de la personne, sous les points, avec la clé qui l'a donné. Le motif
est **obligatoire à l'écriture** et **accepté vide à la lecture** : c'est la
leçon déjà apprise sur `normalizePubkey` — être strict à la lecture produit un
rejet muet, où le staff donne trois cents points et où rien ne se passe.

À l'écran : un onglet dans `/admin`, à côté de Signalements / Journal / Équipe /
Relais. Il montre **la conséquence avant la signature** (« passe du niveau 4 au
niveau 6 »), comme le bloc de confirmation d'une révocation juste à côté, et pour
la même raison. Ce n'est pas une caisse : aucun prix, aucune pastille, et le seul
élément mis en avant est ce que le geste va faire.

### 16.9 Apparence : ce qu'un niveau ouvre

Un forum où personne ne peut se donner une tête est un forum mort. Les points
rendent la contribution visible ; l'apparence la rend **portable** — c'est la
différence entre porter un galon et s'être construit une figure.

#### Le mécanisme : revendiquer, puis accorder au rendu

Une customisation vit dans le **kind 0**, sous des clés namespacées
(`forome_color`, `forome_gradient`, `forome_anim`, `forome_ring`, `forome_title`,
`forome_avatar_anim`), à côté de `forome_signature` qui suivait déjà ce chemin.

Conséquence qu'il faut regarder en face : **le kind 0 est signé par la personne
elle-même**, donc il n'existe aucun portier à l'écriture. Une clé neuve peut
déclarer `forome_gradient: "arc-en-ciel"`, et n'importe quel client tiers
l'affichera sans rien vérifier. Ce qui protège le forum n'est donc pas un refus
d'écriture — il n'y en a pas — mais **notre décision de ne rendre que ce qui est
gagné** : `grantStyle(revendication, niveau)`, chez le lecteur, à chaque rendu.

C'est la doctrine du §9.4 appliquée à autre chose que la modération : le lecteur
décide de ce qu'il affiche. Et c'est ce qui rend cohérent l'interrupteur
« afficher les couleurs de pseudo » du menu utilisateur — allumé par défaut, mais
c'est bien le lecteur qui tranche.

Aucune monnaie, aucun solde, aucune transaction. **Des droits, pas des achats** :
un droit se recalcule à chaque rendu, un solde ne se recalcule pas. Un solde
assis sur un nombre que l'indexeur peut réviser à la baisse (§16.7) rendrait un
achat invalide après coup, et il faudrait alors reprendre la customisation —
c'est-à-dire le retrait que tout le projet refuse (§9.2).

#### La palette est fermée

C'est la décision structurante. Un `#RRGGBB` libre donne, garanti : du gris
illisible sur fond sombre, du jaune fluo sur fond clair, et un pseudo qui
disparaît quand le lecteur bascule le thème — parce que la personne a choisi sa
couleur dans un thème et pas dans l'autre.

Chaque entrée est donc un **couple** (clair, sombre), et le plancher de contraste
est **vérifié par les tests** dans les deux thèmes, pas à l'œil. Les deux valeurs
partent ensemble dans le DOM ; c'est le CSS qui tranche, par les mêmes sélecteurs
de thème que la charte.

Bénéfice qu'un sélecteur libre ne peut pas donner : **du vocabulaire.** « Le mec
au pseudo cramoisi » est une phrase que les gens diront ; « le mec en #B21E3C »
n'en est pas une. C'est la couche culturelle du §15.3, et elle arrive gratuitement.

#### L'orange reste réservé

La charte n'a qu'un signal qui doit percer : l'orange dit « ça chauffe ». Un
pseudo orange fabriquerait une fausse alerte dans chaque fil où il passe, et le
rail de chauffe cesserait de vouloir dire quelque chose. La bande de teintes
8–45 est donc interdite à la palette, et c'est un test, pas une intention.

Une couleur retirée sur douze — pas une interdiction de couleur. (Le « cuivre »
de la première liste est tombé pour cette raison : teinte 29, en pleine bande.)

Un dégradé multi-teintes échappe à la règle : `arc-en-ciel` contient une part
d'orange, en un arrêt sur six, et se lit comme une décoration et non comme le
remplissage uni d'un signal.

#### L'échelle

| Palier | Points | ~jours min | Ce qui s'ouvre |
|---|---|---|---|
| 2 | 25 | 1 | six couleurs sobres |
| 4 | 150 | 4 | six couleurs vives · titre libre |
| 6 | 375 | 10 | cadre d'avatar uni |
| 9 | 900 | 23 | dégradés · cadre en dégradé |
| 12 | 1 650 | 42 | le dégradé animé |
| 15 | 2 625 | 66 | l'avatar animé |

Deux règles de composition l'ont dessinée :

1. **Le premier palier doit tomber en un ou deux jours.** Sur un forum jeune, une
   récompense qui arrive dans six semaines ne donne de vie à rien.
2. **Un axe qu'on peut effacer en déposant son propre média n'est pas un axe de
   récompense, c'est un défaut.** Les variantes d'identicon ont été écartées pour
   ça : au niveau 6, elles n'auraient récompensé que les gens qui ont refusé de
   mettre une photo. Ce qui tient le milieu de l'échelle est donc le **cadre
   d'avatar** — le seul objet du fil qu'une photo de profil n'efface pas.

#### Le titre libre, et l'usurpation

Du texte qu'on s'écrit à côté de son pseudo. Deux protections :

- **registre typographique** : mono, encre faible, jamais une pastille. Une
  pastille dirait « rôle accordé par le forum », ce qu'un titre n'est pas. C'est
  la protection principale — quelqu'un qui écrit « modo » ne ressemble pas à un
  modérateur, il ressemble à quelqu'un qui a écrit « modo » ;
- **liste de mots réservés**, qui ne protège que du cas honnête-paresseux et le
  dit dans son propre commentaire : une graphie exotique passe.

Un filtre plus important qu'il n'y paraît : les **invisibles** (contrôles,
espaces de largeur nulle, et surtout les surcharges de direction `U+202A-202E`).
Sans lui, un seul caractère inverse l'ordre d'affichage de la bande d'auteur. Le
trou était dans la première version du filtre et c'est le test qui l'a trouvé,
pas la relecture.

#### L'avatar animé

Le GIF ne passe pas par le cadreur : celui-ci recadre au canevas, et un canevas
ne garde que la première image — le recadrage tuerait ce qu'on vient chercher. Il
part donc tel quel, plafonné à 1 Mo, et le carré est fait à l'affichage.

Deux cas le **figent**, en peignant sa première image :

- l'animation est revendiquée sans être gagnée ;
- le lecteur a demandé à son système de réduire les animations. Pour certaines
  personnes une image qui clignote est un déclencheur, pas une décoration, et
  aucun palier ne passe devant ça.

Le gel est gratuit : `createImageBitmap` d'un GIF ne rend que sa première image —
la même propriété qui interdit de le recadrer. Aucun décodage côté serveur.

Le palier 15 (66 jours minimum) n'est pas qu'une récompense, **c'est la
protection** : un avatar qui clignote est le vecteur de troll le plus classique
qui existe, et on ne farme pas deux mois pour faire clignoter un écran alors
qu'on ouvrirait dix comptes dans l'heure.

#### À l'écran : un miroir, pas une boutique

L'éditeur (`/profil/editer`) est un vestiaire. La page portait déjà un aperçu
« Vu par les autres » qui rend une **vraie bande d'auteur** ; l'apparence se pose
juste au-dessus, et chaque clic y atterrit. On ne choisit pas une pastille dans
une grille, on s'habille devant une glace.

Quatre décisions qui font que ça ne ressemble pas à du free-to-play :

- **aucun cadenas, aucun grisé.** Les couleurs qu'on n'a pas encore sont montrées
  **dans leur vraie couleur**, en plus petit. Griser détruirait la seule chose qui
  motive — voir ce qu'on vise — et un cadenas a le vocabulaire du paiement. **La
  taille dit la disponibilité** ;
- **la palette est rangée par palier**, pas par teinte : le regroupement encode
  une progression, qui est vraie, plutôt qu'un nuancier, qui ne l'est pas ;
- **le nom de la couleur est toujours affiché** — c'est lui que les gens diront ;
- **rien ne publie au clic.** Les choix rejoignent le formulaire, donc un seul
  « Publier le profil » écrit **un seul** kind 0. Une pastille qui publierait au
  clic remplacerait le profil une douzaine de fois pendant qu'on regarde, et
  chaque remplacement est un event poussé sur tous les relais.

Dans le fil, **le titre cède avant le pseudo** : une bande chargée (pseudo,
discriminant, niveau, titre, « auteur du topic », « toi ») tronquait le pseudo à
huit caractères pour garder un titre entier — l'inverse exact de la hiérarchie.
