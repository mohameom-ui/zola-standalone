#!/usr/bin/env bash
# ============================================================================
#  ZOLA ONBOARD DEPLOYMENT — Raspberry Pi 5 (Pi OS Bookworm 64-bit)
#  Turns the Pi into her body-computer: app + relay autostart, kiosk browser
#  with camera/mic pre-granted. Run ONCE on the Pi, then reboot.
#
#  Assumes: this repo cloned/copied to ~/zola on the Pi.
#  Usage:   bash pi-setup.sh
# ============================================================================
set -euo pipefail

ZOLA_DIR="$HOME/zola"
echo "[zola] system update (5-15 min)..."
sudo apt update -y
sudo apt upgrade -y

echo "[zola] installing Node.js 20 + kiosk Chromium + tools..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || true
sudo apt install -y nodejs chromium git

echo "[zola] enabling Pi camera interface (if present)..."
sudo raspi-config nonint do_camera 0 2>/dev/null || true

if [ ! -d "$ZOLA_DIR" ]; then
  echo "ERROR: place this repository at $ZOLA_DIR first (scp / git clone)."
  exit 1
fi
cd "$ZOLA_DIR"

echo "[zola] installing her app (npm install — takes a while on a Pi)..."
npm install
echo "[zola] building the app..."
npm run build

echo "[zola] Piper TTS: installing engine + her voice (en_US-amy-medium)..."
sudo apt install -y piper 2>/dev/null || pip3 install --user piper-tts 2>/dev/null || true
VOICE_DIR="$ZOLA_DIR/public/voices/piper-model"
mkdir -p "$VOICE_DIR"
# her voice comes from the GameDevLibrary mirror if mounted — else download once
if [ -d "$HOME/GameDevLibrary/Tools/AI-Voice/Piper/voices" ]; then
  cp "$HOME/GameDevLibrary/Tools/AI-Voice/Piper/voices/en_US-amy-medium.onnx" "$VOICE_DIR/" 2>/dev/null || true
  cp "$HOME/GameDevLibrary/Tools/AI-Voice/Piper/voices/en_US-amy-medium.onnx.json" "$VOICE_DIR/" 2>/dev/null || true
  echo "[zola] voice copied from library mirror"
else
  curl -sL --retry 3 -o "$VOICE_DIR/en_US-amy-medium.onnx" "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx" 2>/dev/null || true
  curl -sL --retry 3 -o "$VOICE_DIR/en_US-amy-medium.onnx.json" "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json" 2>/dev/null || true
  echo "[zola] voice downloaded"
fi
echo "[zola] NOTE: her core lines are pre-rendered WAVs in public/voices/piper/ — they speak offline with no Piper runtime at all."

echo "[zola] setting up the relay environment..."
python3 -m venv "$HOME/aura-venv"
"$HOME/aura-venv/bin/pip" install -q pymavlink websockets

echo "[zola] installing systemd services (app + relay)..."
sudo tee /etc/systemd/system/zola-app.service > /dev/null <<EOF
[Unit]
Description=Zola brain app (Next.js)
After=network-online.target
[Service]
User=$USER
WorkingDirectory=$ZOLA_DIR
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

# WAVE 12 — bench-correct relay wiring (edit these two before running this
# script if your wiring differs):
#   • physical FC on a UART  → ZOLA_CONNECTION="/dev/serial0"  ZOLA_BAUD=57600
#   • FC over USB            → ZOLA_CONNECTION="/dev/ttyACM0"  ZOLA_BAUD=57600
#   • SITL on this same Pi   → ZOLA_CONNECTION="udpin:0.0.0.0:14551"  ZOLA_RELAXED=1
ZOLA_CONNECTION="${ZOLA_CONNECTION:-/dev/serial0}"
ZOLA_BAUD="${ZOLA_BAUD:-57600}"
RELAXED_FLAG=""
[ "${ZOLA_RELAXED:-0}" = "1" ] && RELAXED_FLAG="--relaxed-arming"  # SITL ONLY — never on hardware
sudo tee /etc/systemd/system/zola-relay.service > /dev/null <<EOF
[Unit]
Description=Zola MAVLink relay
After=network-online.target
[Service]
User=$USER
ExecStart=$HOME/aura-venv/bin/python -u $ZOLA_DIR/bridge/aura_relay.py --connection '$ZOLA_CONNECTION' --baud $ZOLA_BAUD $RELAXED_FLAG
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

echo "[zola] kiosk browser autostart (camera/mic permissions pre-granted)..."
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/zola-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Zola Kiosk
Exec=chromium-browser --kiosk --app=http://localhost:3001 --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --disable-features=Translate
Restart=false
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now zola-relay
sudo systemctl enable --now zola-app

echo ""
echo "============================================================"
echo "  ZOLA IS DEPLOYED ON THIS PI."
echo "  • relay:    systemd zola-relay  (MAVLink <-> WebSocket:8765)"
echo "  • app:      systemd zola-app    (http://localhost:3001)"
echo "  • screen:   kiosk Chromium auto-opens her panel on boot"
echo "  Reboot now: sudo reboot"
echo "  - relay wired for: connection '$ZOLA_CONNECTION' @ $ZOLA_BAUD baud"
echo "  - arming checks: ENABLED on hardware (relaxed only when ZOLA_RELAXED=1, SITL)"
echo "  - FC side must match: SERIAL2_PROTOCOL=2, SERIAL2_BAUD=57 (57600), saved."
echo "  Verify with: bash pi-dayone.sh"
echo "============================================================"
