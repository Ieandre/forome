#!/usr/bin/env bash
# Lanceur du plugin de policy pour strfry.
#
# strfry lance ce script et lui parle en JSON ligne à ligne sur stdin/stdout, en
# gardant le process vivant. Le wrapper existe pour deux raisons :
#   - fixer le cwd (strfry lance le plugin depuis son propre répertoire)
#   - garder stdout PROPRE : tout ce qui n'est pas une réponse JSON doit aller
#     sur stderr, sinon strfry reçoit du bruit et ferme le plugin
set -euo pipefail
cd "$(dirname "$0")"
exec npx --no-install tsx bin/strfry.ts
