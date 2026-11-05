// HIL TELEMETRY LINK — Panel 3's live feed from the Zola flight controller.
// Consumes bridge/zola_bridge.py's WebSocket (ws://127.0.0.1:8002 default),
// which delivers the FC's 36-byte frames decoded + CRC-verified at 100 Hz.
// This module only accepts the bridge's envelope and keeps the LATEST frame
// plus an honest frame-rate reading — the HUD renders state, it never
// invents it. See docs/HIL.md for the wire contract.

import { useEffect, useRef, useState } from "react";

export const HIL_WS_URL = process.env.NEXT_PUBLIC_ZOLA_HIL_WS ?? "ws://127.0.0.1:8002";
export const HIL_PANEL_ID = "hil_telemetry_03";

export interface HilAttitude { roll: number; pitch: number; yaw: number }
export interface HilFrame {
  sequence_id: number;
  timestamp_us: number;
  attitude: HilAttitude;
  motors: [number, number, number, number];
  battery_mv: number;
}

/** Structural validator for one decoded frame — every field, every type. */
export function isValidHilFrame(p: unknown): p is HilFrame {
  if (typeof p !== "object" || p === null) return false;
  const f = p as Record<string, unknown>;
  if (typeof f.sequence_id !== "number" || typeof f.timestamp_us !== "number") return false;
  const a = f.attitude as Record<string, unknown> | undefined;
  if (!a || typeof a.roll !== "number" || typeof a.pitch !== "number" || typeof a.yaw !== "number") return false;
  if (!Array.isArray(f.motors) || f.motors.length !== 4) return false;
  if (f.motors.some((m) => typeof m !== "number")) return false;
  if (typeof f.battery_mv !== "number") return false;
  return true;
}

export interface HilEnvelope { type: string; panel_id: string; payload: unknown }

export function parseHilEnvelope(raw: string): HilFrame | null {
  try {
    const msg = JSON.parse(raw) as HilEnvelope;
    if (msg.type !== "ZOLA_TELEMETRY_UPDATE" || msg.panel_id !== HIL_PANEL_ID) return null;
    return isValidHilFrame(msg.payload) ? msg.payload : null;
  } catch {
    return null;
  }
}

export class HilTelemetryLink {
  private ws: WebSocket | null = null;
  private frameCount = 0;
  private rateStart = 0;
  private _frame: HilFrame | null = null;
  private _fps = 0;
  private _connected = false;

  constructor(private url: string = HIL_WS_URL) {}

  get frame(): HilFrame | null { return this._frame; }
  get fps(): number { return this._fps; }
  get connected(): boolean { return this._connected; }

  connect(onChange?: () => void, onDrop?: () => void): void {
    try { this.ws = new WebSocket(this.url); } catch { onDrop?.(); return; }
    const socket = this.ws;
    socket.onopen = () => {
      this._connected = true;
      this.rateStart = performance.now();
      this.frameCount = 0;
      onChange?.();
    };
    socket.onmessage = (ev) => {
      const frame = parseHilEnvelope(typeof ev.data === "string" ? ev.data : "");
      if (!frame) return; // foreign or malformed traffic — ignored, never trusted
      this._frame = frame;
      this.frameCount++;
      if (this.frameCount % 20 === 0) {  // 5 Hz rate readout at 100 fps
        const elapsed = (performance.now() - this.rateStart) / 1000;
        if (elapsed > 0.5) {
          this._fps = Math.round(this.frameCount / elapsed);
          this.frameCount = 0;
          this.rateStart = performance.now();
        }
      }
      onChange?.();
    };
    socket.onclose = () => { this._connected = false; onChange?.(); };
    socket.onerror = () => { this._connected = false; onDrop?.(); };
  }

  disconnect(): void {
    try { this.ws?.close(); } catch { /* already gone */ }
    this.ws = null;
    this._connected = false;
  }
}

/** React hook: the latest flight frame + live fps, re-rendered at 10 Hz
 * (the HUD does not need 100 re-renders/s — the DATA is 100 Hz, the paint
 * is 10). */
export function useHilTelemetry(url: string = HIL_WS_URL): {
  frame: HilFrame | null; fps: number; connected: boolean;
} {
  const linkRef = useRef<HilTelemetryLink | null>(null);
  const [state, setState] = useState<{ frame: HilFrame | null; fps: number; connected: boolean }>(
    { frame: null, fps: 0, connected: false },
  );
  const [, force] = useState(0);

  useEffect(() => {
    const link = new HilTelemetryLink(url);
    linkRef.current = link;
    const paint = setInterval(() => {
      setState({ frame: link.frame, fps: link.fps, connected: link.connected });
      force((n) => n + 1);
    }, 100);
    link.connect(
      () => setState({ frame: link.frame, fps: link.fps, connected: link.connected }),
      () => setState((s) => ({ ...s, connected: false })),
    );
    return () => { clearInterval(paint); link.disconnect(); };
  }, [url]);

  return state;
}
