#!/usr/bin/env bash
#
# Installation initiale de la VM Forome (Ubuntu 24.04 aarch64, Oracle Cloud).
# Idempotent : relançable sans casser ce qui est déjà en place.
#
# Usage : scp deploy/setup-server.sh forome:~/ && ssh forome 'bash setup-server.sh'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "=== [1/5] Paquets système ==="
sudo apt-get update
sudo apt-get install -y \
  build-essential git pkg-config curl \
  libyaml-perl libtemplate-perl libregexp-grammars-perl \
  libssl-dev zlib1g-dev liblmdb-dev libflatbuffers-dev \
  libsecp256k1-dev libzstd-dev

echo "=== [2/5] Node 22 ==="
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "=== [3/5] Caddy ==="
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y caddy
fi
caddy version

echo "=== [4/5] Pare-feu local : ouvrir 80/443 ==="
# Les images Ubuntu d'Oracle terminent la chaîne INPUT par un REJECT : insérer
# en tête, sinon la règle n'est jamais atteinte.
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  fi
done
sudo netfilter-persistent save

echo "=== [5/5] Compilation strfry ==="
if [ ! -x /usr/local/bin/strfry ]; then
  if [ ! -d ~/strfry-src ]; then
    git clone --recurse-submodules --depth 1 https://github.com/hoytech/strfry.git ~/strfry-src
  fi
  cd ~/strfry-src
  make setup-golpe
  make -j"$(nproc)"
  sudo install -m 755 strfry /usr/local/bin/strfry
fi
strfry --version || true

echo "=== Terminé ==="
