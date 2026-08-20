#!/usr/bin/env bash
#
# Lance le VRAI strfry (C++) avec notre policy d'écriture.
#
# Pourquoi ce script plutôt qu'un appel direct : strfry exige un chemin ABSOLU
# pour le plugin de policy, et le dépôt n'est pas au même endroit chez tout le
# monde. La config versionnée porte donc `__FOROME_ROOT__`, remplacé ici à la
# volée dans une copie — l'original reste lisible et sans chemin machine.
#
# Usage : npm run dev:strfry
#
# Différence avec `npm run dev:relay` (le relais Node en mémoire) :
#   - celui-ci PERSISTE sur disque (`.strfry/strfry-db/`) ; l'autre oublie tout
#     à l'arrêt, ce qui reste le bon défaut pour un test isolé
#   - celui-ci exerce la policy à travers le protocole de plugin réel de strfry,
#     donc il est le seul à prouver que ce qu'on a écrit fonctionne pour de vrai
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STRFRY_DIR="$ROOT/.strfry"
STRFRY_BIN="$STRFRY_DIR/strfry"

if [ ! -x "$STRFRY_BIN" ]; then
  echo "strfry n'est pas compilé — voir docs/strfry.md" >&2
  exit 1
fi

# La config effective est dérivée, jamais éditée : régénérée à chaque lancement
# pour qu'un dépôt déplacé ne laisse pas un chemin de plugin périmé derrière lui.
CONF="$STRFRY_DIR/strfry-forome.conf"
sed "s|__FOROME_ROOT__|$ROOT|g" "$ROOT/packages/relay-policy/strfry.conf" > "$CONF"

echo "strfry — relais du forum"
echo "  binaire : $STRFRY_BIN"
echo "  config  : $CONF"
echo "  policy  : packages/relay-policy/run-strfry.sh"
echo "  base    : $STRFRY_DIR/strfry-db/ (persistante — supprimer pour repartir à zéro)"
echo "  client  : http://localhost:3002/?relays=ws://localhost:7778"
echo

cd "$STRFRY_DIR"
exec "$STRFRY_BIN" --config "$CONF" relay
