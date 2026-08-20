#!/usr/bin/env bash
#
# Vérifie qu'un déploiement est vivant : bash deploy/healthcheck.sh
# Sortie non nulle = déploiement à rejeter (update.sh s'arrête dessus, et le CI
# fait échouer le job).
#
# Un service « actif » ne prouve rien : forome-web peut tourner sur un build
# cassé, répondre 500 et rester actif aux yeux de systemd. On interroge donc
# les ports, et le domaine public par-dessus.
#
# Pas de set -e : on veut la liste complète de ce qui va mal, pas la première
# ligne qui casse.
set -uo pipefail

DATA="$HOME/forome-data"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

note() { printf '  %-26s %s\n' "$1" "$2"; }

# Appelé juste après un restart : Nitro et strfry mettent quelques secondes à
# écouter. Réessayer, plutôt que déclarer mort ce qui n'a pas fini de démarrer.
patienter() { # patienter <libellé> <commande...>
  local label="$1"; shift
  local i
  for i in $(seq 1 15); do
    if "$@" >/dev/null 2>&1; then
      note "$label" "OK"
      return 0
    fi
    sleep 2
  done
  note "$label" "ÉCHEC"
  fail=1
  return 1
}

echo "Services"
for svc in forome-strfry forome-indexer forome-web; do
  patienter "$svc" systemctl is-active --quiet "$svc"
done

echo "Ports locaux"
# strfry sert le NIP-11 en HTTP sur le port du WebSocket : une réponse prouve
# que le relais est debout, pas seulement que le process existe.
patienter "relais (NIP-11)" \
  curl -fsS -m 5 -H 'Accept: application/nostr+json' http://127.0.0.1:7777
patienter "client (Nitro)" curl -fsS -m 5 http://127.0.0.1:3000/

echo "Bout en bout"
# L'hôte n'est nulle part en dur dans le dépôt : la seule source de vérité est
# le web.env écrit par install.sh.
SITE="$(sed -n 's/^NUXT_PUBLIC_SITE_URL=//p' "$DATA/web.env" 2>/dev/null || true)"
if [ -n "$SITE" ]; then
  # Par le domaine public : vérifie Caddy, le certificat et le bon vhost.
  patienter "$SITE" curl -fsS -m 15 "$SITE/"
else
  note "site public" "non testé (web.env absent)"
fi

echo
if [ "$fail" -eq 0 ]; then
  # Le SHA est un agrément, pas un résultat : lancé hors du dépôt (par un pipe,
  # par exemple), le script doit conclure quand même.
  echo "Santé OK — $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'commit inconnu,') en place et répond."
else
  echo "Santé DÉGRADÉE — voir les lignes ÉCHEC ci-dessus."
  echo "Diagnostic : journalctl -u forome-web -u forome-strfry -u forome-indexer -n 50 --no-pager"
fi
exit "$fail"
