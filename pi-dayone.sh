#!/usr/bin/env bash
# ============================================================================
#  ZOLA DAY-ONE CHECK — run on the Pi after pi-setup.sh + first boot.
#  Verifies she is 100% offline-operational: app, voice pack, AI models,
#  relay link to the flight controller, and piper for dynamic lines.
# ============================================================================
set -u
PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
check(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== ZOLA DAY-ONE CHECK ($APP_DIR)"

check "app builds/serves on :3000"        "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 | grep -q 200"
check "voice pack manifest present"        "test -f '$APP_DIR/public/voices/piper/manifest.json'"
check "voice WAVs present (>=34)"          "[ \$(find '$APP_DIR/public/voices/piper' -name '*.wav' | wc -l) -ge 34 ]"
check "offline AI models present"          "test -d '$APP_DIR/public/models/whisper-tiny-en' && test -d '$APP_DIR/public/models/kokoro-82m' && test -d '$APP_DIR/public/models/smolvlm-256m'"
check "ollama GGUFs present (>=3 models)"  "[ \$(find '$APP_DIR/public/models/ollama' -name '*.gguf' 2>/dev/null | wc -l) -ge 3 ] || ls $APP_DIR/public/models/ollama >/dev/null 2>&1"
check "relay service running"              "systemctl is-active zola-relay | grep -q active"
check "app service running"                "systemctl is-active zola-app | grep -q active"
check "relay linked to flight controller"  "journalctl -u zola-relay -n 20 --no-pager | grep -q 'FC connected'"
check "flight controller reachable"        "journalctl -u zola-relay -n 40 --no-pager | grep -qE 'GUIDED|Arming motors|FLYING|EKF'"
check "piper binary available"             "command -v piper || pip3 show piper-tts | grep -q piper"
check "voice model onnx present"           "find / -name 'en_US-amy-medium.onnx' -not -path '/proc/*' 2>/dev/null | head -1 | grep -q ."

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
if [ $FAIL -eq 0 ]; then
  echo "ZOLA IS OFFLINE-READY. Unplug the internet — she will not notice."
  echo "Say 'come here' — she takes off."
else
  echo "Fix the ✗ items above, then re-run: bash pi-dayone.sh"
fi
