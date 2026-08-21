#!/usr/bin/env bash
#
# Rapatrie la dernière sauvegarde du relais SUR CETTE MACHINE.
#
#   npm run backup:fetch -- <hôte ssh>              # → ~/forome-backups
#   npm run backup:fetch -- <hôte ssh> ~/ailleurs
#
# C'est la moitié qui compte : un dump resté sur la VM ne protège que d'une base
# corrompue, pas de la VM perdue. Et c'est un tirage, pas un envoi — la VM n'a
# ainsi aucun accès, aucune clé, vers l'endroit où vivent les sauvegardes.
#
# ⚠️ L'archive contient tout ce que le relais sert, DM chiffrés compris : elle
# atterrit ici avec les mêmes précautions qu'une base de données.
#
# Ce que ce script NE sauvegarde pas : `~/forome-data/indexer.env` (la nsec de
# l'indexeur). Une clé n'a rien à faire dans une archive qui tourne toute seule
# chaque nuit — à copier une fois, à la main, là où tu gardes tes secrets. La
# perdre ne coûte qu'une identité d'indexeur à regénérer (le classement retombe
# sur un calcul local), pas le contenu du forum.
set -euo pipefail

HOTE="${1:?usage: bash scripts/fetch-backup.sh <hôte ssh> [dossier local]}"
DEST="${2:-$HOME/forome-backups}"

mkdir -p "$DEST"

distant="$(ssh "$HOTE" 'ls -1t ~/forome-data/backups/forome-*.jsonl.gz 2>/dev/null | head -1')"
if [ -z "$distant" ]; then
  echo "Aucune sauvegarde sur $HOTE — systemctl list-timers forome-backup.timer" >&2
  exit 1
fi

nom="$(basename "$distant")"
if [ -f "$DEST/$nom" ]; then
  echo "Déjà là : $DEST/$nom"
  exit 0
fi

scp -q "$HOTE:$distant" "$DEST/$nom.part"
# gzip porte son propre CRC : le vérifier ici dispense d'une somme de contrôle à
# côté, et prouve que c'est la copie locale qui est lisible, pas l'originale.
gzip -t "$DEST/$nom.part"
mv "$DEST/$nom.part" "$DEST/$nom"

echo "$(gzip -dc "$DEST/$nom" | wc -l | tr -d ' ') events → $DEST/$nom"
