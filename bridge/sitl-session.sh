#!/usr/bin/env bash
# One managed ArduPilot SITL + Zola relay session. Stop it with stop-sim.bat.
set -Eeuo pipefail

ZOLA_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ARDUPILOT_DIR="${ARDUPILOT_DIR:-$HOME/ardupilot}"
ZOLA_VENV="${ZOLA_VENV:-$HOME/aura-venv}"
SESSION_PID_FILE="/tmp/zola-sitl-session.pid"
SITL_LOG="/tmp/zola-sitl.log"
RELAY_LOG="/tmp/zola-relay.log"
SITL_PID=""
RELAY_PID=""

if [[ -s "$SESSION_PID_FILE" ]] && kill -0 "$(cat "$SESSION_PID_FILE")" 2>/dev/null; then
  echo "[zola] a managed SITL session is already running (pid $(cat "$SESSION_PID_FILE"))"
  exit 1
fi
if [[ ! -d "$ARDUPILOT_DIR" ]]; then
  echo "[zola] ArduPilot checkout not found: $ARDUPILOT_DIR"
  echo "       Set ARDUPILOT_DIR to the directory containing Tools/autotest/sim_vehicle.py."
  exit 1
fi
if [[ ! -x "$ZOLA_VENV/bin/python" ]]; then
  echo "[zola] relay Python environment not found: $ZOLA_VENV/bin/python"
  echo "       Set up bridge/requirements.txt first, or set ZOLA_VENV."
  exit 1
fi

printf '%s\n' "$$" > "$SESSION_PID_FILE"
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  echo "[zola] stopping the managed SITL session..."
  if [[ -n "$RELAY_PID" ]] && kill -0 "$RELAY_PID" 2>/dev/null; then
    echo "[zola] asking the relay to land and disarm safely"
    kill -INT "$RELAY_PID" 2>/dev/null || true
    wait "$RELAY_PID" || true
  fi
  if [[ -n "$SITL_PID" ]] && kill -0 "$SITL_PID" 2>/dev/null; then
    kill -INT "$SITL_PID" 2>/dev/null || true
    wait "$SITL_PID" || true
  fi
  rm -f "$SESSION_PID_FILE"
  echo "[zola] SITL session stopped"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$ARDUPILOT_DIR"
echo "[zola] starting ArduCopter SITL..."
python3 Tools/autotest/sim_vehicle.py -v ArduCopter -f quad --no-mavproxy > "$SITL_LOG" 2>&1 &
SITL_PID=$!

for _ in {1..45}; do
  if ! kill -0 "$SITL_PID" 2>/dev/null; then
    echo "[zola] SITL exited before it was ready; recent log:"
    tail -n 20 "$SITL_LOG" || true
    exit 1
  fi
  sleep 1
done

echo "[zola] starting the relay against ArduPilot's TCP master port..."
"$ZOLA_VENV/bin/python" -u "$ZOLA_DIR/bridge/aura_relay.py" \
  --connection tcp:127.0.0.1:5760 --relaxed-arming > "$RELAY_LOG" 2>&1 &
RELAY_PID=$!
sleep 2
if ! kill -0 "$RELAY_PID" 2>/dev/null; then
  echo "[zola] relay exited; recent log:"
  tail -n 30 "$RELAY_LOG" || true
  exit 1
fi
echo "[zola] relay log: $RELAY_LOG"
echo "[zola] relay URL: ws://localhost:8765 (loopback only)"
echo "[zola] takeoff requires fresh battery telemetry and an explicit UI confirmation"

while kill -0 "$SITL_PID" 2>/dev/null && kill -0 "$RELAY_PID" 2>/dev/null; do
  sleep 1
done
echo "[zola] SITL or relay exited; session cleanup will stop the other process"