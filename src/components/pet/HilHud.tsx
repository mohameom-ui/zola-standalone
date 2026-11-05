"use client";

// HilHud — PANEL 3's live HIL readout: the Zola flight controller's 100 Hz
// telemetry, CRC-verified by the bridge, rendered here. Honest by design:
// when the bridge is down it says OFFLINE (with the one-line start command)
// — it never shows a stale frame as if she were still flying.

import { useHilTelemetry } from "@/lib/pet/hilTelemetry";

export default function HilHud() {
  const { frame, fps, connected } = useHilTelemetry();
  const batt = frame ? (frame.battery_mv / 1000).toFixed(2) : null;
  const low = frame ? frame.battery_mv < 10500 : false;

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
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[10px] text-[#e9e7dc] font-mono">
          <span>seq {frame.sequence_id}</span>
          <span>R {frame.attitude.roll.toFixed(1)}°</span>
          <span>P {frame.attitude.pitch.toFixed(1)}°</span>
          <span>Y {frame.attitude.yaw.toFixed(1)}°</span>
          <span>M [{frame.motors.join(", ")}] µs</span>
          <span className={low ? "text-red-400" : ""}>BATT {batt} V{low ? " · LOW" : ""}</span>
        </div>
      )}
    </div>
  );
}