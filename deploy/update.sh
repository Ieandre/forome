#!/usr/bin/env bash
#
# Redéploiement après un push :
#   cd ~/forome && bash deploy/update.sh          # le dernier commit de main
#   cd ~/forome && bash deploy/update.sh <sha>    # ce commit précisément
#
# Ne touche ni aux clés ni à la base strfry (elles vivent dans ~/forome-data).
set -euo pipefail

REF="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HOME/forome-data"

cd "$ROOT"
if [ -n "$REF" ]; then
  # Déploiement piloté (CI, retour arrière) : on veut ce commit-là et pas un
  # autre, y compris en arrière — donc reset dur, quitte à écraser une retouche
  # faite à la main sur la VM. Rien de vivant ne vit dans le dépôt.
  git fetch --prune origin
  git checkout -f main
  git reset --hard "$REF"
else
  # À la main : --ff-only refuse plutôt que d'écraser un travail local.
  git pull --ff-only
fi
npm ci

set -a; source "$DATA/web.env"; set +a
npm run build

sudo cp "$ROOT"/deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
# strfry aussi : la policy (packages/relay-policy) a pu changer avec le pull.
sudo systemctl restart forome-strfry forome-indexer forome-web

echo
# Un restart réussi ne dit pas que le site répond : la santé fait partie du
# déploiement, pas d'un contrôle qu'on penserait à faire après.
bash "$ROOT/deploy/healthcheck.sh"

echo "OK — $(git rev-parse --short HEAD) déployé."
