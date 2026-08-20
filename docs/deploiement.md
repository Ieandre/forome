# Déploiement — le pipeline et la VM

> Ce que fait le CI, ce que fait la VM, et ce qu'il faut brancher une fois pour
> que `git push` suffise.

## Ce qui tourne en production

Une VM Oracle (Ubuntu 24.04 aarch64), trois services systemd et Caddy devant :

| | |
|---|---|
| `forome-strfry` | le relais, sur `127.0.0.1:7777`, avec la policy en plugin |
| `forome-indexer` | le tick signé (kind 30078) |
| `forome-web` | le serveur Nitro du client, sur `127.0.0.1:3000` |
| Caddy | TLS, `/relay` → strfry, tout le reste → Nitro |

**Rien de vivant n'est dans le dépôt.** La clé de l'indexeur, la config publique
et la base du relais vivent dans `~/forome-data` — c'est ce qui permet à un
déploiement d'écraser le dépôt sans rien perdre :

```
~/forome-data/indexer.env     # la nsec de l'indexeur (chmod 600, jamais versionnée)
~/forome-data/indexer.pubkey
~/forome-data/web.env         # NUXT_PUBLIC_* — la seule source de vérité pour l'hôte
~/forome-data/strfry-db/
```

## Le pipeline

Un seul fichier, [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), avec
deux jobs. Les deux dans le même fichier à dessein : un déploiement ne peut pas
partir sans que les vérifications aient tourné sur **exactement** le commit
déployé.

**`verifier`** — sur chaque PR et chaque push sur `main` :

```
npm ci → typecheck → tests → smoke:policy → build
```

`smoke:policy` est là parce que la policy est la seule barrière du système et
qu'un test unitaire ne voit pas le protocole de plugin ; ce smoke le parle par un
pipe réel, sans strfry compilé, donc il tourne sur un runner nu. Le `build`, lui,
ne produit **aucun artefact déployable** : avec `ssr:false` les `NUXT_PUBLIC_*`
sont cuits dans le HTML au build et ils vivent sur la VM. Il prouve que le build
passe, rien de plus.

Un push sur une branche sans pull request ne déclenche rien : pour faire tourner
les vérifications sur un travail en cours, *Actions → CI → Run workflow* en
choisissant la branche. Lancé ailleurs que sur `main`, le workflow **vérifie
seulement** — il ne déploie pas.

**`deployer`** — seulement sur push `main` (ou à la main depuis `main`), après
`verifier` :

```
ssh vm → deploy/update.sh <sha> → deploy/healthcheck.sh → curl du site depuis le runner
```

`update.sh` reçoit le SHA et fait un `reset --hard` dessus : le déploiement est
**déterministe**, on obtient ce commit et pas « le dernier `main` au moment où le
job est passé ». Lancé sans argument (à la main, sur la VM) il garde son
`git pull --ff-only`, qui refuse plutôt que d'écraser un travail local.

La santé est vérifiée **dans** `update.sh`, pas après : un `systemctl restart`
réussi ne dit pas que le site répond. `healthcheck.sh` interroge les ports, pas
seulement l'état systemd — `forome-web` peut tourner sur un build cassé, servir
des 500 et rester « actif ». Le dernier `curl` vient du runner, lui, parce que
c'est la seule façon de voir ce que la VM ne peut pas voir d'elle-même : DNS,
liste de sécurité Oracle, pare-feu.

Les déploiements sont sérialisés (`concurrency`, sans annulation sur `main`) :
`update.sh` enchaîne `npm ci`, un build et un restart, et deux en parallèle
laisseraient un build à moitié écrit derrière eux.

## Brancher le déploiement

Trois secrets, une fois. Sans eux le job `deployer` s'arrête sur un message qui
dit lesquels manquent — le CI, lui, tourne quand même.

**1. Une clé dédiée au CI** (pas ta clé personnelle : celle-ci va vivre dans les
secrets GitHub) :

```sh
ssh-keygen -t ed25519 -C "ci@forome" -f ~/.ssh/forome-ci -N ""
ssh-copy-id -i ~/.ssh/forome-ci.pub ubuntu@<hôte>
```

**2. Les secrets**, avec le `gh` CLI depuis le dépôt. Le workflow exige
`StrictHostKeyChecking yes` — sans empreinte épinglée, un DNS détourné suffirait
à faire livrer la clé de déploiement, donc la VM, au premier qui répond — d'où
`DEPLOY_KNOWN_HOSTS`. Il se relève avec `ssh-keyscan`, sur **la même chaîne** que
`DEPLOY_HOST` : `known_hosts` s'apparie sur le nom utilisé pour se connecter, et
une entrée relevée sur l'IP ne valide pas un domaine. D'où la variable de shell,
qui empêche les deux de divorcer :

```sh
HOTE=forome.cc      # ou l'IP — mais la même des deux côtés

gh secret set DEPLOY_HOST        -b "$HOTE"
gh secret set DEPLOY_SSH_KEY     < ~/.ssh/forome-ci
gh secret set DEPLOY_KNOWN_HOSTS -b "$(ssh-keyscan -t ed25519 "$HOTE" 2>/dev/null)"
```

Si la VM est recréée un jour, son empreinte change et le déploiement s'arrêtera
sur un refus de connexion : rejouer la dernière ligne.

`DEPLOY_USER` est une **variable** facultative (`gh variable set DEPLOY_USER`),
`ubuntu` par défaut. `DEPLOY_HOST` est un secret plutôt qu'une variable pour ne
pas afficher l'adresse de la VM dans des logs publics.

Vérifier sans rien casser : onglet *Actions* → *CI* → **Run workflow**. Le job
redéploie le `main` courant, ce qui est sans effet si la VM y est déjà — mais
prouve que la chaîne SSH, `update.sh` et la santé passent.

### Durcir la clé

Cette clé donne un shell sur la VM à quiconque obtient les secrets du dépôt :
c'est le prix d'un déploiement poussé depuis GitHub, et il faut le savoir. À
défaut de pouvoir restreindre l'origine (les runners GitHub n'ont pas d'IP
fixe), au moins lui retirer tout ce dont le déploiement n'a pas besoin, dans
`~/.ssh/authorized_keys` sur la VM :

```
restrict,no-agent-forwarding ssh-ed25519 AAAA…  ci@forome
```

`restrict` coupe les redirections de ports, X11 et l'allocation de pty ;
`update.sh` n'en a besoin d'aucun (le `sudo` de la VM est en NOPASSWD et ne
réclame pas de tty).

La seule façon d'éviter l'accès entrant tout court serait un **runner
auto-hébergé** sur la VM : le déploiement devient tiré au lieu d'être poussé, et
plus rien n'a besoin d'entrer par le port 22. En échange, c'est le CI qui prend
racine sur la machine de production.

## Retour arrière

Il n'est **pas** automatique : rebuild d'un Nuxt sur une VM ARM se compte en
minutes, et l'annuler sur un `curl` peut-être capricieux ferait plus de dégâts
que le déploiement à réparer. En cas d'échec, le job affiche le SHA qui était en
place et la commande pour y revenir. Deux chemins, au choix :

```sh
# Depuis GitHub : Actions → CI → Run workflow → ref = <sha>
# Depuis la VM :
ssh <vm> "cd ~/forome && bash deploy/update.sh <sha>"
```

Et pour comprendre ce qui s'est passé :

```sh
ssh <vm> 'bash ~/forome/deploy/healthcheck.sh'
ssh <vm> 'journalctl -u forome-web -u forome-strfry -u forome-indexer -n 50 --no-pager'
```

## Première mise en service

Le pipeline **redéploie**, il n'installe pas. Une VM neuve passe d'abord par le
kit, dans cet ordre :

```sh
scp deploy/setup-server.sh <vm>:~/ && ssh <vm> 'bash setup-server.sh'   # Node, Caddy, strfry compilé
ssh <vm> 'git clone https://github.com/Ieandre/forome.git ~/forome'
ssh <vm> 'cd ~/forome && bash deploy/install.sh forome.cc'              # clés, web.env, services, Caddy
```

`install.sh` est idempotent et ne régénère **jamais** une clé d'indexeur
existante. C'est lui qui écrit `web.env`, donc lui qui fixe l'hôte : rien n'est
codé en dur dans le dépôt, et `healthcheck.sh` relit ce fichier plutôt que de
supposer un domaine.

## Ce que le pipeline ne fait pas

- **Aucun test bout en bout contre le vrai relais.** `smoke:strfry`,
  `smoke:dm`, `smoke:nip46`, `smoke:moderation` et `smoke:edit` demandent un
  relais lancé (et, pour le premier, strfry compilé) : ils restent manuels.
  Compiler strfry sur un runner à chaque push coûterait plus que ce qu'il
  rapporte tant qu'un seul relais est déployé.
- **Aucune réplication.** Un seul relais reste un point de censure unique —
  c'est un manque de l'architecture, pas du pipeline (voir le README).
- **L'indexeur n'est vérifié que par systemd.** Le client et le relais ont un
  port qu'on peut interroger, lui n'a rien : un `forome-indexer` qui redémarre
  en boucle peut passer pour actif entre deux crashs. Ce qui le prouverait
  vraiment, c'est son tick — donc un kind 30078 récent lu sur le relais.
- **Le build tourne sur la VM**, pas sur le runner, parce que les
  `NUXT_PUBLIC_*` doivent être présents au build et que leur source de vérité
  est `~/forome-data/web.env`. Le jour où c'est trop lent, il faudra faire
  remonter cette config en secrets GitHub et envoyer `.output/` — au prix d'une
  deuxième source de vérité pour l'hôte.
