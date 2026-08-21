#!/usr/bin/env bash
#
# Sauvegarde du relais : un dump jsonl daté, hors de LMDB.
#
#   bash deploy/backup.sh
#
# Lancé chaque jour par forome-backup.timer. Sans arrêt de service : `strfry
# export` lit dans une transaction LMDB, le relais continue de répondre pendant
# ce temps.
#
# ⚠️ Ceci ne protège que d'une base corrompue ou effacée, PAS de la perte de la
# VM : le dump reste sur la machine qu'il sauvegarde. La moitié qui manque est
# `scripts/fetch-backup.sh`, à lancer depuis ailleurs.
#
# ⚠️ Le dump contient TOUT ce que le relais sert, DM chiffrés compris (kinds 4
# et 1059) : c'est une archive à traiter comme telle, pas un export public.
set -euo pipefail

DATA="$HOME/forome-data"
DEST="$DATA/backups"
# La config dérivée par install.sh, celle que le service exécute — le
# `deploy/strfry.conf` du dépôt est un gabarit depuis l'AUTH NIP-42.
CONF="$DATA/strfry.conf"
GARDE=14

mkdir -p "$DEST"

horodatage="$(date -u +%Y%m%dT%H%M%SZ)"
final="$DEST/forome-$horodatage.jsonl.gz"
# Un seul nom d'attente, pas un par tentative : deux échecs de suite laisseraient
# sinon deux débris dans le dossier des sauvegardes.
partiel="$DEST/.en-cours.jsonl.gz"

# Écrire à côté puis renommer : un dump interrompu (VM arrêtée en cours de route)
# ne doit pas pouvoir ressembler à une sauvegarde complète.
strfry --config "$CONF" export | gzip -9 > "$partiel"

events="$(gzip -dc "$partiel" | wc -l | tr -d ' ')"
# `find` et non `ls` : sous `pipefail`, un `ls` sans correspondance sort en 2 et
# ferait échouer la toute première sauvegarde, celle où il n'y a rien à compter.
anciens="$(find "$DEST" -maxdepth 1 -name 'forome-*.jsonl.gz' | wc -l | tr -d ' ')"

# Le vrai danger d'une sauvegarde automatique n'est pas qu'elle rate, c'est
# qu'un dump vide (base effacée, `strfry delete` trop large) prenne la place des
# bons en quatorze jours sans que personne ne regarde.
if [ "$events" -eq 0 ] && [ "$anciens" -gt 0 ]; then
  rm -f "$partiel"
  echo "ÉCHEC : export vide alors que le dossier en contient déjà $anciens — rien n'a été touché." >&2
  exit 1
fi

mv "$partiel" "$final"
ln -sfn "$(basename "$final")" "$DEST/dernier.jsonl.gz"

# Rotation après publication seulement : une sauvegarde en échec ne doit jamais
# faire disparaître celles d'avant. Le `mv` ci-dessus garantit une correspondance
# au glob, donc pas de `ls` en échec ici.
ls -1t "$DEST"/forome-*.jsonl.gz | tail -n +"$((GARDE + 1))" | xargs -r rm -f

echo "$events events → $final ($(du -h "$final" | cut -f1))"
