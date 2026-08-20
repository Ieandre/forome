#!/usr/bin/env bash
#
# Première mise en service sur la VM, à lancer DANS le dépôt cloné :
#
#   git clone https://github.com/Ieandre/forome.git ~/forome
#   cd ~/forome && bash deploy/install.sh <hôte public>
#
# Prérequis : deploy/setup-server.sh déjà passé (Node 22, Caddy, strfry compilé).
# Idempotent : relançable ; ne régénère jamais une clé d'indexeur existante.
set -euo pipefail

HOST="${1:?usage: bash deploy/install.sh <hôte public, ex. forome.duckdns.org>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HOME/forome-data"

# Publique par nature (c'est elle qu'épinglent les clients) — voir docs/moderation-staff.md.
ADMIN_PUBKEY=1ebce27704449a3e1a26fed9227d41b9bb0f2b5dfbd5a2405e14e4fdd7383a50

mkdir -p "$DATA/strfry-db"

echo "=== Dépendances npm ==="
cd "$ROOT"
npm ci

echo "=== Identité de l'indexeur ==="
if [ ! -f "$DATA/indexer.env" ]; then
  npx --no-install tsx - > "$DATA/indexer.keys.tmp" <<'EOF'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
const sk = generateSecretKey()
console.log(nip19.nsecEncode(sk))
console.log(getPublicKey(sk))
EOF
  NSEC="$(sed -n 1p "$DATA/indexer.keys.tmp")"
  PUBKEY="$(sed -n 2p "$DATA/indexer.keys.tmp")"
  rm "$DATA/indexer.keys.tmp"

  # La nsec ne vit QUE dans ce fichier, hors dépôt, lisible par ubuntu seul.
  cat > "$DATA/indexer.env" <<EOF
INDEXER_NSEC=$NSEC
RELAYS=ws://127.0.0.1:7777
EOF
  chmod 600 "$DATA/indexer.env"
  echo "$PUBKEY" > "$DATA/indexer.pubkey"
  echo "Clé générée — pubkey : $PUBKEY"
else
  PUBKEY="$(cat "$DATA/indexer.pubkey")"
  echo "Clé existante conservée — pubkey : $PUBKEY"
fi

echo "=== Config du client ==="
cat > "$DATA/web.env" <<EOF
NUXT_PUBLIC_SITE_URL=https://$HOST
NUXT_PUBLIC_HOME_RELAY=wss://$HOST/relay
NUXT_PUBLIC_ADMIN_PUBKEY=$ADMIN_PUBKEY
NUXT_PUBLIC_INDEXER_PUBKEY=$PUBKEY
EOF

echo "=== Build du client ==="
# Les NUXT_PUBLIC_* doivent être là AU BUILD : avec ssr:false ils sont cuits
# dans le HTML servi, l'EnvironmentFile du service ne suffit pas pour le
# navigateur (il sert au Nitro : sitemap, robots, seoHead).
set -a; source "$DATA/web.env"; set +a
npm run build

echo "=== Services systemd ==="
sudo cp "$ROOT"/deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now forome-strfry forome-indexer forome-web

echo "=== Caddy ==="
sed "s|__HOST__|$HOST|g" "$ROOT/deploy/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy

echo
echo "=== Terminé ==="
echo "Site   : https://$HOST"
echo "Relais : wss://$HOST/relay"
echo "Statut : systemctl status forome-strfry forome-indexer forome-web caddy"
