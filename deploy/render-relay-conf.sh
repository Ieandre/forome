#!/usr/bin/env bash
#
# Écrit la config que strfry exécute : bash deploy/render-relay-conf.sh [hôte]
#
# `deploy/strfry.conf` est un GABARIT depuis l'AUTH NIP-42 — il porte `__HOST__`,
# que l'AUTH doit comparer au tag `relay` envoyé par le client. Le service ne lit
# donc jamais le fichier du dépôt mais sa version résolue, dans `~/forome-data`,
# hors du dépôt comme la base : un `git reset --hard` de déploiement ne peut pas
# la toucher.
#
# ## Pourquoi ce script existe plutôt qu'une ligne dans install.sh
#
# Il y était, et c'était le bug : `update.sh` ne rejoue pas `install.sh` (il le
# dit en commentaire), donc un déploiement ordinaire copiait l'unité systemd
# pointant sur la config dérivée **sans jamais l'écrire**. strfry redémarrait en
# boucle sur un fichier absent, `systemctl is-active` l'attrapait entre deux
# relances et annonçait « OK » pendant que le port ne répondait pas.
#
# La règle « la config exécutée est dérivée » a donc besoin d'un seul endroit qui
# la porte, et des deux chemins de déploiement qui l'appellent — même raison que
# la policy du relais, qui n'a qu'une implémentation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HOME/forome-data"

# L'hôte vient de l'argument (mise en service, où on le saisit) ou de `web.env`
# (déploiement, où il est déjà décidé). Même source de vérité que
# `healthcheck.sh` : l'hôte n'est nulle part en dur dans le dépôt.
HOST="${1:-}"
if [ -z "$HOST" ]; then
  SITE="$(sed -n 's/^NUXT_PUBLIC_SITE_URL=//p' "$DATA/web.env" 2>/dev/null || true)"
  HOST="${SITE#https://}"
  HOST="${HOST#http://}"
  HOST="${HOST%%/*}"
fi

if [ -z "$HOST" ]; then
  echo "render-relay-conf: hôte introuvable — passer l'hôte en argument, ou vérifier $DATA/web.env" >&2
  exit 1
fi

mkdir -p "$DATA"
# Fichier temporaire puis `mv` : le remplacement est atomique, donc un strfry qui
# redémarre pendant l'écriture ne peut pas lire une config à moitié écrite.
sed "s|__HOST__|$HOST|g" "$ROOT/deploy/strfry.conf" > "$DATA/strfry.conf.tmp"

# Garde-fou : un `__HOST__` restant ferait refuser l'AUTH à tout le monde, en
# comparant le tag `relay` du client à l'hôte littéral. Mieux vaut ne pas
# remplacer la config qui tourne que d'en installer une qui rend les MP muets.
if grep -q '__HOST__' "$DATA/strfry.conf.tmp"; then
  rm -f "$DATA/strfry.conf.tmp"
  echo "render-relay-conf: __HOST__ non résolu dans le gabarit — config inchangée" >&2
  exit 1
fi

mv "$DATA/strfry.conf.tmp" "$DATA/strfry.conf"
echo "Config du relais : $DATA/strfry.conf (hôte $HOST)"
