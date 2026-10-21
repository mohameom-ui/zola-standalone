#!/usr/bin/env bash
# ============================================================================
#  ZOLA ONE-COMMAND DEPLOY — desktop → her Pi body.
#  The three DEPLOY.md steps (sync → build → setup) in one shot.
#
#  Usage:  bash deploy-to-pi.sh [user@host] [dest-dir]
#          bash deploy-to-pi.sh                      # pi@zola.local:~/zola
#          bash deploy-to-pi.sh pi@192.168.1.42
#
#  What flies is defined by deploy-excludes.txt — see DEPLOY.md for the
#  measured manifest. First ever deployment runs pi-setup.sh on the Pi;
#  every later deployment only needs the sync + rebuild.
# ============================================================================
set -euo pipefail

HOST="${1:-pi@zola.local}"
DEST="${2:-~/zola}"

cd "$(dirname "$0")"

echo "[zola] syncing her body to $HOST:$DEST ..."
rsync -av --exclude-from deploy-excludes.txt ./ "$HOST:$DEST/"

echo "[zola] building on the Pi (she compiles herself — be patient)..."
ssh "$HOST" "cd $DEST && npm install && npm run build"

echo ""
echo "[zola] sync + build complete."
echo "  First deployment ever : ssh $HOST 'bash $DEST/pi-setup.sh'  (then sudo reboot)"
echo "  Acceptance check      : ssh $HOST 'bash $DEST/pi-dayone.sh'"
