#!/usr/bin/env bash
#
# Redéploiement après un push : cd ~/forome && bash deploy/update.sh
# Ne touche ni aux clés ni à la base strfry (elles vivent dans ~/forome-data).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HOME/forome-data"

cd "$ROOT"
git pull --ff-only
npm ci

set -a; source "$DATA/web.env"; set +a
npm run build

sudo cp "$ROOT"/deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
# strfry aussi : la policy (packages/relay-policy) a pu changer avec le pull.
sudo systemctl restart forome-strfry forome-indexer forome-web

echo "OK — $(git rev-parse --short HEAD) déployé."
