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
