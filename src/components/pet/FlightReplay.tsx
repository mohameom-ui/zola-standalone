"use client";

// ============================================================================
// ZOLA FLIGHT REPLAY — interactive black-box scrubber (WAVE 9)
// Purely client-side playback of the recorded ring buffer. INTEGRITY RULE:
// no interpolated or synthetic frames — the slider steps through EXACT
// recorded telemetry samples, and event pins mark real governor flags.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import type { BlackboxEntry } from "@/lib/pet/blackbox";

function pinColor(flags: string): string {
  if (/CRITICAL/.test(flags)) return "#ff4d4f";
  if (/VISUAL HOLD/.test(flags)) return "#b98cf0";
  if (/GEOFENCE/.test(flags)) return "#f0b90b";
  return "#35d0a5";
}

export default function FlightReplay({ getEntries }: { getEntries: () => BlackboxEntry[] }) {
  const [entries, setEntries] = useState<BlackboxEntry[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // the ring keeps recording live — pull a fresh copy every few seconds
  useEffect(() => {
    const pull = () => setEntries(getEntries());
    pull();
    const iv = setInterval(pull, 5000);
    return () => clearInterval(iv);
  }, [getEntries]);

  // playback at 8 samples/sec (2 Hz recording → 4× speed review)
  useEffect(() => {
    if (!playing || entries.length === 0) return;
    const iv = setInterval(() => setIdx((i) => (i + 1) % entries.length), 125);
    return () => clearInterval(iv);
  }, [playing, entries.length]);

  const cur = entries.length > 0 ? entries[Math.min(idx, entries.length - 1)] : null;

  // ---- draw: altitude trace + battery trace + event pins + attitude dial ----
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || entries.length === 0) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    ctx.fillStyle = "#0b0e17";
    ctx.fillRect(0, 0, W, H);
    const px = (i: number) => (i / (entries.length - 1 || 1)) * (W - 8) + 4;

    // battery trace (top, amber)
    const bats = entries.map((e) => e.battery);
    const minB = Math.min(...bats), maxB = Math.max(...bats);
    const spanB = Math.max(0.02, maxB - minB);
    ctx.strokeStyle = "#f0b90b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    entries.forEach((e, i) => {
      const y = 22 - ((e.battery - minB) / spanB) * 14;
      i === 0 ? ctx.moveTo(px(i), y) : ctx.lineTo(px(i), y);
    });
    ctx.stroke();
    ctx.fillStyle = "#8b8f9c";
    ctx.font = "9px monospace";
    ctx.fillText("BATTERY %", 4, 12);

    // altitude trace (middle, cyan)
    const alts = entries.map((e) => e.alt);
    const minA = Math.min(...alts), maxA = Math.max(...alts);
    const spanA = Math.max(0.05, maxA - minA);
    const base = 52, height = 44;
    ctx.strokeStyle = "#1c2230";
    ctx.beginPath(); ctx.moveTo(0, base + height); ctx.lineTo(W, base + height); ctx.stroke();
    ctx.strokeStyle = "#5ac8fa";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    entries.forEach((e, i) => {
      const y = base + height - ((e.alt - minA) / spanA) * height;
      i === 0 ? ctx.moveTo(px(i), y) : ctx.lineTo(px(i), y);
    });
    ctx.stroke();
    ctx.fillStyle = "#8b8f9c";
    ctx.fillText(`ALT ${minA.toFixed(2)}–${maxA.toFixed(2)} m`, 4, base - 2);

    // event pins along the altitude trace
    entries.forEach((e, i) => {
      if (!e.flags) return;
      const y = base + height - ((e.alt - minA) / spanA) * height;
      ctx.fillStyle = pinColor(e.flags);
      ctx.fillRect(px(i) - 1.5, y - 6, 3, 6);
    });

    // playhead
    const x = px(Math.min(idx, entries.length - 1));
    ctx.strokeStyle = "#e9e7dc";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, base + height + 4); ctx.stroke();

    // attitude dial (artificial horizon): roll rotates, pitch offsets — EXACT sample
    const cx = W - 46, cy = 52, r = 22;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(((cur?.roll ?? 0) * Math.PI) / 180);
    ctx.translate(0, (cur?.pitch ?? 0) * 0.5);
    ctx.fillStyle = "#38a8d8"; ctx.fillRect(-r * 2, -r * 2, r * 4, r * 2); // sky
    ctx.fillStyle = "#7a5230"; ctx.fillRect(-r * 2, 0, r * 4, r * 2);      // ground
    ctx.strokeStyle = "#e9e7dc"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "#8b8f9c";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#8b8f9c";
    ctx.fillText("ATT", cx - 10, cy + r + 11);
  }, [idx, entries, cur]);

  if (entries.length === 0) return null;

  const time = cur ? new Date(cur.t).toLocaleTimeString() : "";
  return (
    <div className="glass-soft rounded-xl p-2">
      <div className="hud-label px-1 pb-1">FLIGHT REPLAY · BLACK-BOX SCRUBBER (exact recorded samples — no interpolation)</div>
      <canvas ref={canvasRef} width={640} height={100} className="w-full rounded-lg bg-[#0b0e17]" />
      <div className="flex items-center gap-2 mt-2 px-1">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="px-2 py-1 rounded border border-[#5ac8fa]/60 text-[#5ac8fa] text-[9px] tracking-widest hover:bg-[rgba(90,200,250,0.12)]"
        >
          {playing ? "⏸ PAUSE" : "▶ PLAY"}
        </button>
        <input
          type="range"
          min={0}
          max={entries.length - 1}
          value={Math.min(idx, entries.length - 1)}
          onChange={(e) => { setPlaying(false); setIdx(parseInt(e.target.value)); }}
          className="flex-1 accent-[#5ac8fa]"
        />
        <span className="font-mono text-[9px] text-[#8b8f9c] whitespace-nowrap">
          {Math.min(idx, entries.length - 1) + 1}/{entries.length}
        </span>
      </div>
      {cur && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 px-1 font-mono text-[9px]">
          <span className="text-[#8b8f9c]">{time}</span>
          <span style={{ color: pinColor(cur.flags ?? "") }}>{cur.activity.toUpperCase()}</span>
          <span className="text-[#8b8f9c]">{cur.mood}</span>
          <span className="text-[#f0b90b]">BAT {(cur.battery * 100).toFixed(0)}%</span>
          <span className="text-[#5ac8fa]">ALT {cur.alt.toFixed(2)}m</span>
          <span className="text-[#c8ccd6]">PITCH {(cur.pitch ?? 0).toFixed(1)}° ROLL {(cur.roll ?? 0).toFixed(1)}°</span>
          {cur.flags && <span className="text-[#ff9f43]">⚑ {cur.flags}</span>}
        </div>
      )}
      <div className="flex gap-2 mt-1 px-1 text-[8px] tracking-wider text-[#5a5f6e]">
        <span style={{ color: "#35d0a5" }}>● governor</span>
        <span style={{ color: "#f0b90b" }}>● geofence</span>
        <span style={{ color: "#b98cf0" }}>● visual hold</span>
        <span style={{ color: "#ff4d4f" }}>● critical</span>
      </div>
    </div>
  );
}