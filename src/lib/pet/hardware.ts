// ============================================================================
// DRONE PET — Hardware Abstraction Layer
// The brain speaks "normalized velocity setpoints"; the HAL translates them
// for whichever body it is attached to:
//   • SimDroneHAL   — in-browser physics stand-in (this prototype)
//   • MavLinkBridgeHAL — WebSocket -> MAVLink velocity setpoints on a real
//     quad (PX4/ArduPilot) or the Bitcraze Crazyflie Python bridge.
// The brain never knows which one is attached.
//
// SimDroneHAL flight character:
//   • second-order dynamics — momentum, overshoot, banking into turns
//   • mood-driven flight style: sluggish when sleepy, jittery when alarmed,
//     bouncy when excited, smooth sway when happy
//   • reflexes: startle dart on sudden alarms, barrel roll during tricks
// ============================================================================

import type { Actuation, DronePose } from "./types";
import { encodeHeartbeat, encodeSetAttitudeTarget } from "./mavlink";
import { sunReport } from "./suncalc";

/** obstacle-avoidance whisker: given (from,to,altitude) return a steered target */
export type AvoidFn = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  altitude: number,
) => { x: number; y: number };

export interface PetHAL {
  apply(act: Actuation, dt: number): void;
  pose(): DronePose;
  propsRpm(): number;
  /** optional obstacle-avoidance whiskers (wired to the PetMap) */
  avoid: AvoidFn | null;
  /** optional self-tuning (training adjusts her gains) */
  setTuning?(t: { gain: number; drag: number; power: number }): void;
}

/** In-browser drone body: momentum physics + attitude + personality. */
export class SimDroneHAL implements PetHAL {
  private p: DronePose = { x: 0, y: 0, z: 0, yaw: 0, bob: 0, pitch: 0, roll: 0 };
  private v = { x: 0, y: 0, z: 0 };
  private vyaw = 0;
  private rpm = 0;
  private t = 0;
  private prevMood = "";
  private dart = 0; // startle dart timer
  private rollSpin = 0; // barrel-roll accumulator

  apply(act: Actuation, dt: number) {
    this.t += dt;

    // ---- reflex: startled → dart away in a random direction ------------------
    if (act.mood === "alarmed" && this.prevMood !== "alarmed") {
      const dir = Math.random() * Math.PI * 2;
      this.v.x += Math.cos(dir) * 0.55;
      this.v.y += Math.sin(dir) * 0.55;
      this.v.z += 0.18;
      this.dart = 0.6;
    }
    this.prevMood = act.mood;

    // ---- style constants from mood -------------------------------------------
    const sleeping = act.activity === "sleep";
    const sluggish = act.mood === "sleepy" || act.mood === "sleeping" || sleeping;
    const excited = act.mood === "excited" || act.activity === "trick";
    const gScale = this.tuning.gain / 3.2;                // trained gain multiplier
    const gain = (sluggish ? 1.4 : excited ? 4.2 : 3.2) * gScale;   // control response
    const drag = (sluggish ? 2.6 : 2.4) * (this.tuning.drag / 2.4); // air resistance
    const power = (sluggish ? 0.45 : excited ? 1.05 : 0.8) * (this.tuning.power / 0.8); // throttle

    const dartFactor = this.dart > 0 ? 0.15 : 1; // commands are ignored mid-dart
    this.dart = Math.max(0, this.dart - dt);

    // ---- second-order flight: acceleration = command − drag -------------------
    const ease = Math.min(1, dt * gain);
    this.v.x += (act.vx * power * dartFactor - this.v.x * drag * 0.45) * ease * 2.2;
    this.v.y += (act.vy * power * dartFactor - this.v.y * drag * 0.45) * ease * 2.2;
    this.v.z += (act.vz * power * dartFactor - this.v.z * drag * 0.5) * ease * 2.2;
    this.vyaw += (act.yaw * 2.4 - this.vyaw * 1.6) * ease;

    // ambient wind wobble — she is never perfectly still
    const wind = sleeping ? 0 : Math.sin(this.t * 0.7) * 0.006 + Math.sin(this.t * 1.9) * 0.004;
    this.v.x += wind * dt * 10;

    // GRAVITY: with the props spooled down, gravity wins and she falls
    if (this.rpm < 250) {
      this.v.z -= 0.5 * dt; // free-fall acceleration (sim gravity)
    }

    // WIND GUSTS: the air shoves her; her attitude controller self-levels back
    this.gustTimer -= dt;
    if (this.gustTimer <= 0 && !sleeping && act.activity !== "trick") {
      this.gustTimer = 15 + Math.random() * 20;
      const dir = Math.random() * Math.PI * 2;
      const strength = 0.12 + Math.random() * 0.28;
      this.v.x += Math.cos(dir) * strength;
      this.v.y += Math.sin(dir) * strength;
      // the unbalanced moment: she tilts — then her self-leveling recovers
      this.p.roll += (Math.random() - 0.5) * 0.55;
      this.p.pitch += (Math.random() - 0.5) * 0.35;
      this.onGust?.(strength);
    }

    // body-frame → world-frame: she flies where her nose points
    const cy = Math.cos(this.p.yaw), sy = Math.sin(this.p.yaw);
    let wdx = (this.v.x * cy - this.v.y * sy) * dt;
    let wdy = (this.v.x * sy + this.v.y * cy) * dt;

    // obstacle-avoidance whiskers: look ahead, steer around what's there
    const speed = Math.hypot(wdx, wdy);
    if (this.avoid && speed > 1e-5) {
      const from = { x: this.p.x, y: this.p.y };
      const ahead = { x: this.p.x + (wdx / dt) * 0.45, y: this.p.y + (wdy / dt) * 0.45 };
      const steered = this.avoid(from, ahead, this.p.z);
      const sdx = steered.x - from.x, sdy = steered.y - from.y;
      const slen = Math.hypot(sdx, sdy) || 1e-6;
      wdx = (sdx / slen) * speed;
      wdy = (sdy / slen) * speed;
    }

    // integrate + soft wall bounce
    const nx = clamp(this.p.x + wdx, -ROOM_BOUND, ROOM_BOUND);
    if (nx === -ROOM_BOUND || nx === ROOM_BOUND) this.v.x *= -0.3;
    this.p.x = nx;
    const ny = clamp(this.p.y + wdy, -ROOM_BOUND, ROOM_BOUND);
    if (ny === -ROOM_BOUND || ny === ROOM_BOUND) this.v.y *= -0.3;
    this.p.y = ny;
    this.p.z = clamp(this.p.z + this.v.z * dt, -0.35, DEFAULT_CEILING);
    this.p.yaw += this.vyaw * dt;

    // ---- attitude: bank into lateral moves, pitch into forward ones -----------
    let targetRoll = clamp(-this.v.y * 1.1, -0.45, 0.45);
    let targetPitch = clamp(-this.v.x * 0.9, -0.4, 0.4);

    // barrel roll during tricks
    if (act.activity === "trick") {
      this.rollSpin += dt * 7.5;
      targetRoll = this.rollSpin;
    } else {
      this.rollSpin = 0;
    }

    // alarmed = nervous jitter; excited = extra bounce
    if (act.mood === "alarmed" && act.activity !== "sleep") {
      targetRoll += Math.sin(this.t * 31) * 0.08;
      targetPitch += Math.cos(this.t * 27) * 0.06;
    }

    const attitudeEase = Math.min(1, dt * (sluggish ? 2 : 6));
    this.p.roll += (targetRoll - this.p.roll) * attitudeEase;
    this.p.pitch += (targetPitch - this.p.pitch) * attitudeEase;

    // ---- hover bob: personality-sized ------------------------------------------
    const bobSpeed = sleeping ? 0 : excited ? 5.2 : act.mood === "happy" ? 3.8 : 3.1;
    const bobAmp = sleeping ? 0 : excited ? 0.05 : act.mood === "alarmed" ? 0.02 : 0.035;
    this.p.bob += dt * bobSpeed * (sleeping ? 0 : 1);
    this.bobAmp = bobAmp;

    // COMPANION IDLE ORBIT: Lissajous floating near the human's position —
    // organic, non-repetitive hover that feels alive, not robotic
    if (act.activity === "hover" && !sleeping) {
      // WAVE 5 — SHADOW PLAY: her local sun model bends the orbit. Golden hour
      // drifts her gently toward the light side; high sun steadies the orbit
      // (comfort-seeking, not random). Night keeps her parked near center.
      const sun = sunReport();
      const drift = sun.phase === "golden" ? 0.06 : sun.phase === "dawn" || sun.phase === "dusk" ? 0.03 : 0;
      const orbit = 0.1 * (sun.phase === "midday" ? 0.75 : 1);
      this.v.x += (Math.sin(this.t * 0.31) * orbit + drift - this.v.x) * dt * 0.5;
      this.v.y += (Math.sin(this.t * 0.47 + Math.PI / 3) * orbit * 0.7 - this.v.y) * dt * 0.5;
    }

    // ---- props --------------------------------------------------------------------
    const thrust = Math.abs(act.vx) + Math.abs(act.vy) + Math.abs(act.vz) + Math.abs(act.yaw);
    const targetRpm = sleeping ? 300 : excited ? 3200 + thrust * 1500 : 2400 + thrust * 1400;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 4);
  }

  private bobAmp = 0.035;
  private tuning = { gain: 3.2, drag: 2.4, power: 0.8 };
  private gustTimer = 10; // seconds until the next wind gust
  avoid: AvoidFn | null = null;
  /** fired when a wind gust knocks her — the brain comments on strong ones */
  onGust: ((strength: number) => void) | null = null;

  /** TRAINING: her gains are adjustable — she tunes herself from drill grades. */
  setTuning(t: { gain: number; drag: number; power: number }) {
    this.tuning = { ...t };
  }

  pose(): DronePose {
    const bobOffset = Math.sin(this.p.bob) * this.bobAmp;
    return { ...this.p, bob: bobOffset };
  }

  propsRpm(): number { return this.rpm; }
}

/** sim altitude ceiling — mirrors the safety governor's maxAltitude */
const DEFAULT_CEILING = 0.85;
/** room half-extent — mirrors the PetMap bounds */
const ROOM_BOUND = 1.6;

/**
 * Real-drone bridge. Point it at a tiny WebSocket relay running next to
 * MAVSDK/mavlink-router on the companion computer (see README hardware map).
 * Sends normalized setpoints; the ground bridge converts to
 * SET_POSITION_TARGET_LOCAL_NED velocity frames or Crazyflie cmdVel.
 */
export class MavLinkBridgeHAL implements PetHAL {
  private ws: WebSocket | null = null;
  private lastPose: DronePose = { x: 0, y: 0, z: 0.8, yaw: 0, bob: 0, pitch: 0, roll: 0 };
  private lastRpm = 0;
  private url: string;
  private seq = 0;
  private bootAt = Date.now();
  private hbTimer: ReturnType<typeof setInterval> | null = null;

  avoid: AvoidFn | null = null;

  constructor(url: string) { this.url = url; }

  /** Build one MAVLink SET_ATTITUDE_TARGET frame for her FC — exported for
   * the tests: yaw -> quaternion, vz -> thrust (clamped, the governor rules). */
  attitudeCommand(yaw: number, vz: number): Uint8Array {
    const yawHalf = yaw / 2;
    const q: [number, number, number, number] = [0, 0, Math.sin(yawHalf), Math.cos(yawHalf)];
    const thrust = Math.max(0, Math.min(1, 0.5 + vz * 0.2));
    return encodeSetAttitudeTarget(
      { seq: this.seq++ & 0xff, sysid: 1, compid: 1 },
      Date.now() - this.bootAt,
      q,
      thrust,
    );
  }

  private sendMav(frame: Uint8Array) {
    if (!this.connected) return;
    let bin = "";
    for (const b of frame) bin += String.fromCharCode(b);
    try { this.ws!.send(JSON.stringify({ action: "mav", frame: btoa(bin) })); } catch { /* link hiccup */ }
  }

  connect(onOpen?: () => void, onClose?: () => void) {
    try { this.ws = new WebSocket(this.url); } catch { this.ws = null; }
    if (this.ws) {
      this.ws.onopen = () => {
        // her heartbeat keepalive: one HEARTBEAT per second, MAVLink-native
        this.hbTimer = setInterval(() => {
          this.sendMav(encodeHeartbeat({ seq: this.seq++ & 0xff, sysid: 1, compid: 1 }));
        }, 1000);
        onOpen?.();
      };
      this.ws.onclose = () => {
        if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
        this.ws = null; onClose?.();
      };
    }
  }

  /** land + shut the offboard session down cleanly */
  disconnect() {
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    if (this.connected) {
      // her landing command: thrust zero, level attitude, in HER language
      this.sendMav(this.attitudeCommand(this.lastPose.yaw, -5));
    }
    this.ws?.close();
    this.ws = null;
  }

  get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  apply(act: Actuation, _dt: number) {
    if (!this.connected) return;
    // her commands ride the MAVLink lane now: real SET_ATTITUDE_TARGET
    // frames the Matek F405 (or the SITL sim) speaks natively
    this.sendMav(this.attitudeCommand(act.yaw, act.vz));
    // the halo lighting stays on the bridge's own channel — a body concern,
    // not a flight-control concern
    // telemetry comes back as JSON {t:"pose", x,y,z,yaw,rpm}
    this.ws!.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string) as Partial<DronePose> & { rpm?: number };
        this.lastPose = { ...this.lastPose, ...d, bob: this.lastPose.bob };
        if (typeof d.rpm === "number") this.lastRpm = d.rpm;
      } catch { /* ignore bad frames */ }
    };
  }

  pose(): DronePose { return this.lastPose; }
  propsRpm(): number { return this.lastRpm; }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
