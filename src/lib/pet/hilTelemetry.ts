// HIL TELEMETRY LINK — Panel 3's live feed from the Zola flight controller.
// Consumes bridge/zola_bridge.py's WebSocket (ws://127.0.0.1:8002 default),
// which delivers the FC's 36-byte frames decoded + CRC-verified at 100 Hz.
// This module only accepts the bridge's envelope and keeps the LATEST frame
// plus an honest frame-rate reading — the HUD renders state, it never
// invents it. See docs/HIL.md for the wire contract.

import { useEffect, useRef, useState } from "react";

export const HIL_WS_URL = process.env.NEXT_PUBLIC_ZOLA_HIL_WS ?? "ws://127.0.0.1:8002";
export const HIL_PANEL_ID = "hil_telemetry_03";

// TWO LANES, ONE TRUTH: the USB-serial bridge speaks ZOLA_TELEMETRY_UPDATE,
// the Wi-Fi/UDP ground bridge speaks ZOLA_UDP_TELEMETRY — byte-identical
// packets on both, so the panel accepts either (and tags which it saw).

// THE COMMAND CANON's ids (the bridge builds the 16-byte frame + CRC — the
// panel sends semantics, never raw bytes):
export const HIL_CMD = {
  HEARTBEAT: 0x00,          // the link's pulse — the failsafe eats 500 ms of silence
  ARM: 0x01,                // payload byte 0 must be 0xA5 (the interlock token)
  EMERGENCY_DISARM: 0x02,   // no token — killing must be easy
  SET_WAYPOINT: 0x03,
  UPDATE_PID: 0x04,
  ARM_TOKEN: 0xA5,
} as const;

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

const VALID_TYPES = new Set(["ZOLA_TELEMETRY_UPDATE", "ZOLA_UDP_TELEMETRY"]);
const VALID_PDB_TYPES = new Set(["ZOLA_PDB_TELEMETRY"]);

// THE COMMAND'S CONFIRMATION — the FC's ACK frame (the panel stops guessing)
export interface AckFrame {
  cmd_id: number; result: number; timestamp_ms: number; mode: number;
}
export const ACK_RESULT_NAMES: Record<number, string> = {
  0: "OK", 1: "REJECTED", 2: "UNKNOWN", 3: "REFUSED",
};
const VALID_ACK_TYPES = new Set(["ZOLA_COMMAND_ACK"]);

export function parseAckEnvelope(raw: string): AckFrame | null {
  try {
    const msg = JSON.parse(raw) as HilEnvelope;
    if (!VALID_ACK_TYPES.has(msg.type) || msg.panel_id !== HIL_PANEL_ID) return null;
    const p = msg.payload as Record<string, unknown>;
    if (typeof p.cmd_id !== "number" || typeof p.result !== "number") return null;
    return p as unknown as AckFrame;
  } catch {
    return null;
  }
}

/** The PDB variant's payload (the FB FC frame — power/thermal/eRPM). */
export interface PdbFrame {
  sequence_id: number; current_ma: number; power_w: number; mah_used: number;
  esc_temp_max_c: number; sag_mv: number; throttle_limit_pct: number;
  erpm: number[]; v_bus_mv: number; thermal_brake: boolean; sag_limiting: boolean;
  // THE STATE ANNEX (the frame's bytes 27-33): the flight state rides with
  // the power data — one frame, both stories
  mode: number; sensor_flags: number; wp_index: number; wp_count: number;
  leader_id: number; live_peers: number; braking: boolean;
}

export function parsePdbEnvelope(raw: string): PdbFrame | null {
  try {
    const msg = JSON.parse(raw) as HilEnvelope;
    if (!VALID_PDB_TYPES.has(msg.type) || msg.panel_id !== HIL_PANEL_ID) return null;
    const p = msg.payload as Record<string, unknown>;
    if (typeof p.sequence_id !== "number" || typeof p.current_ma !== "number" ||
        typeof p.esc_temp_max_c !== "number" || !Array.isArray(p.erpm) ||
        typeof p.mode !== "number") return null;
    return p as unknown as PdbFrame;
  } catch {
    return null;
  }
}

export function parseHilEnvelope(raw: string): HilFrame | null {
  try {
    const msg = JSON.parse(raw) as HilEnvelope;
    if (!VALID_TYPES.has(msg.type) || msg.panel_id !== HIL_PANEL_ID) return null;
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
  private _pdb: PdbFrame | null = null;
  private _ack: AckFrame | null = null;
  private _fps = 0;
  private _connected = false;

  constructor(private url: string = HIL_WS_URL) {}

  get frame(): HilFrame | null { return this._frame; }
  get pdb(): PdbFrame | null { return this._pdb; }
  get ack(): AckFrame | null { return this._ack; }
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
      const raw = typeof ev.data === "string" ? ev.data : "";
      const pdb = parsePdbEnvelope(raw);   // the PDB variant rides the same socket
      if (pdb) this._pdb = pdb;
      const ack = parseAckEnvelope(raw);   // the command's confirmation
      if (ack) this._ack = ack;
      const frame = parseHilEnvelope(raw);
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
    this.stopHeartbeat();
    try { this.ws?.close(); } catch { /* already gone */ }
    this.ws = null;
    this._connected = false;
  }

  /** THE RETURN PATH: a semantic command to the FC. The bridge owns the
   * frame canon and the CRC — the panel sends semantics, never raw bytes. */
  sendCommand(cmdId: number, payload: number[] = []): boolean {
    if (!this._connected || !this.ws) return false;
    const bytes = new Uint8Array(9);  // the canon's payload is always 9 bytes
    bytes.set(payload.slice(0, 9), 0);
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    try {
      this.ws.send(JSON.stringify({ type: "ZOLA_COMMAND", cmd_id: cmdId, payload_hex: hex }));
      return true;
    } catch {
      return false;
    }
  }

  /** The master kill-switch: EMERGENCY DISARM — no token, every mode. */
  emergencyDisarm(): boolean {
    return this.sendCommand(HIL_CMD.EMERGENCY_DISARM);
  }

  /** Arm with the interlock token (an accidental arm is a launch). */
  arm(): boolean {
    return this.sendCommand(HIL_CMD.ARM, [HIL_CMD.ARM_TOKEN]);
  }

  /** The heartbeat — the ground station must send this ≥ 2 Hz or the
   * failsafe descends her. Pings whenever the socket is up (harmless while
   * disarmed). */
  startHeartbeat(intervalMs = 250): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendCommand(HIL_CMD.HEARTBEAT), intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
}

/** React hook: the latest flight frame + live fps + the LINK ITSELF (the
 * HUD's kill-switch calls through it), re-rendered at 10 Hz — the DATA is
 * 100 Hz, the paint is 10. */
export function useHilTelemetry(url: string = HIL_WS_URL): {
  frame: HilFrame | null; fps: number; connected: boolean; link: HilTelemetryLink | null;
  pdb: PdbFrame | null; ack: AckFrame | null;
} {
  const linkRef = useRef<HilTelemetryLink | null>(null);
  const [state, setState] = useState<{ frame: HilFrame | null; fps: number; connected: boolean; pdb: PdbFrame | null; ack: AckFrame | null }>(
    { frame: null, fps: 0, connected: false, pdb: null, ack: null },
  );
  const [linkReady, setLinkReady] = useState(0);
  const [, force] = useState(0);

  useEffect(() => {
    const link = new HilTelemetryLink(url);
    linkRef.current = link;
    setLinkReady((n) => n + 1);  // the ref is live — re-render so callers see it
    const paint = setInterval(() => {
      setState({ frame: link.frame, fps: link.fps, connected: link.connected, pdb: link.pdb, ack: link.ack });
      force((n) => n + 1);
    }, 100);
    link.connect(
      () => {
        // THE GROUND STATION'S FAILSAFE DUTY: while the panel listens, it
        // pulses the heartbeat — silence longer than 500 ms descends her
        link.startHeartbeat();
        setState({ frame: link.frame, fps: link.fps, connected: link.connected, pdb: link.pdb, ack: link.ack });
      },
      () => setState((s) => ({ ...s, connected: false })),
    );
    return () => { clearInterval(paint); link.disconnect(); };
  }, [url]);

  return { ...state, link: linkReady >= 0 ? linkRef.current : null };
}
