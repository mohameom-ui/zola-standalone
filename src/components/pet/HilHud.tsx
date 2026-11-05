"use client";

// HilHud — PANEL 3's live HIL readout: the Zola flight controller's 100 Hz
// telemetry, CRC-verified by the bridge, rendered here. Honest by design:
// when the bridge is down it says OFFLINE (with the one-line start command)
// — it never shows a stale frame as if she were still flying.

import { ACK_RESULT_NAMES, useHilTelemetry } from "@/lib/pet/hilTelemetry";

const FC_MODE_NAMES: Record<number, string> = {
  0: "DISARMED", 1: "STABILIZED", 2: "AUTONOMOUS", 3: "FAILSAFE-LAND",
};

export default function HilHud() {
  const { frame, fps, connected, link, pdb, ack } = useHilTelemetry();
  const batt = frame ? (frame.battery_mv / 1000).toFixed(2) : null;
  const low = frame ? frame.battery_mv < 10500 : false;
  // THE SMART PDB READOUT: the 2 Hz power/thermal variant rides the same
  // socket — amps, watts, the ESC's hottest temperature, the sag state
  const pdbLine = pdb
    ? `${(pdb.current_ma / 1000).toFixed(1)}A · ${pdb.power_w.toFixed(0)}W · ESC ${pdb.esc_temp_max_c}°C` +
      (pdb.sag_limiting ? ` · SAG-LIMIT ${pdb.throttle_limit_pct}%` : "") +
      (pdb.thermal_brake ? " · THERMAL BRAKE" : "")
    : null;
  // THE STATE ANNEX: the flight mode, the sensor health, the mission's
  // progress, and her role in the swarm — the operator sees ALL of it
  const mode = FC_MODE_NAMES[pdb?.mode ?? -1];
  const sens = pdb
    ? ["flow", "tof", "mag", "baro", "bias"].filter((_, i) => pdb.sensor_flags & (1 << i)).join("+")
    : null;
  const ackLine = ack
    ? `ACK: ${ACK_RESULT_NAMES[ack.result] ?? ack.result}${ack.cmd_id === 2 ? " (disarm)" : ""}`
    : null;

  return (
    <div className="glass-soft rounded-xl p-2">
      <div className="hud-label px-1 pb-1">
        HIL TELEMETRY · ZOLA FC @ 100 Hz {fps ? `· ${fps} fps` : ""}
      </div>
      {!connected || !frame ? (
        <div className="px-1 text-[10px] text-[#8b8f9c]">
          FC OFFLINE — no telemetry on ws://127.0.0.1:8002.
          <span className="text-[#8b8f9c] opacity-80"> Start it: python bridge/zola_bridge.py --sim</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 items-center px-1 text-[10px] text-[#e9e7dc] font-mono">
          <span>seq {frame.sequence_id}</span>
          <span>R {frame.attitude.roll.toFixed(1)}°</span>
          <span>P {frame.attitude.pitch.toFixed(1)}°</span>
          <span>Y {frame.attitude.yaw.toFixed(1)}°</span>
          <span>M [{frame.motors.join(", ")}] µs</span>
          <span className={low ? "text-red-400" : ""}>BATT {batt} V{low ? " · LOW" : ""}</span>
          {mode && <span className="text-cyan-300 font-bold">{mode}</span>}
          {sens && <span className="text-[#8b8f9c]">sensors: {sens}</span>}
          {pdb && pdb.wp_count > 0 && <span>WP {pdb.wp_index}/{pdb.wp_count}{pdb.braking ? " · BRAKING" : ""}</span>}
          {pdb && <span>swarm: {pdb.leader_id === 1 ? "LEADER" : `peer (leader ${pdb.leader_id})`} ×{pdb.live_peers}</span>}
          {pdbLine && <span className={pdb?.thermal_brake ? "text-orange-400" : ""}>{pdbLine}</span>}
          {ackLine && <span className={ack?.result === 0 ? "text-green-400" : "text-red-400"}>{ackLine}</span>}
          {/* THE MASTER KILL-SWITCH: no token, every mode — killing must be easy */}
          <button
            onClick={() => { link?.emergencyDisarm(); }}
            className="ml-auto px-2 py-0.5 rounded bg-red-900/70 border border-red-500/60 text-red-200 text-[10px] font-bold hover:bg-red-800/80"
          >
            KILL
          </button>
        </div>
      )}
    </div>
  );
}