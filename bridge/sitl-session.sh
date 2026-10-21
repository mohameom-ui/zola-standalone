#!/usr/bin/env bash
# SITL session — one long-lived WSL session that owns both the virtual quad
# and the ground relay. WSL kills background children when the launching
# session exits, so both live INSIDE this session.
cd ~/ardupilot
echo "=== [1/2] launching SITL ArduCopter ==="
python3 Tools/autotest/sim_vehicle.py -v ArduCopter -f quad --no-mavproxy > /tmp/sitl.log 2>&1 &
sleep 45
echo "--- sitl.log tail:"
tail -3 /tmp/sitl.log

echo "=== [2/2] launching the ground relay ==="
cd ~/aura-bridge
~/aura-venv/bin/python -u aura_relay.py --connection tcp:127.0.0.1:5760 > /tmp/relay.log 2>&1 &
sleep 12
echo "--- relay.log tail:"
tail -6 /tmp/relay.log
echo "=== SESSION READY — keeping alive ==="
wait
