// ============================================================================
// DRONE PET — Shared Types
// Hardware-agnostic contracts so the same brain can run in-browser (prototype)
// or on an onboard computer (Raspberry Pi 5 + flight controller) later.
// ============================================================================

export type Mood = "idle" | "curious" | "happy" | "excited" | "sleepy" | "alarmed" | "sleeping";

export type Activity = "hover" | "follow" | "come" | "trick" | "wander" | "sleep" | "search" | "scan" | "dock" | "walk";

/** world position (sim room meters, x = depth, y = lateral, z = altitude) */
export interface Vec3 { x: number; y: number; z: number }

/** One detected object from the scanner (COCO labels or learned names). */
export interface ObjectDetection {
  label: string;
  score: number;
  /** normalized bbox 0..1 relative to the frame */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Color identity signature — normalized brightness-invariant color layout
   * of the detected region (12 dims). Lets Zola tell two cups apart.
   * No pixels are stored anywhere — only this small vector.
   */
  sig: number[];
  /**
   * Shape identity signature — mini gradient-orientation histogram (32 dims):
   * the object's contour character. Round mug vs angular laptop vs hand.
   */
  shape: number[];
  /** true when confidence ≥ 0.5; below that she reports it as "uncertain" */
  certain: boolean;
}

/** What AURA reads off your face (0..1 smoothed scores). */
export interface Expression {
  smile: number;
  frown: number;
  eyesClosed: number;
  browRaise: number;
  /** composite stress indicator (0 = calm, 1 = visibly stressed) */
  stress: number;
}

/** What the vision+memory pipeline concluded about the person in frame. */
export interface FaceIdentity {
  known: boolean;
  name: string | null;
  similarity: number;
  personId: string | null;
}

/** Sensory input frame — produced by camera (vision) + mic (ears) + telemetry. */
export interface Percept {
  faceSeen: boolean;
  /** normalized face center, -1..1 (x = left..right, y = top..bottom) */
  faceX: number;
  faceY: number;
  /** normalized face size 0..1 — proxy for proximity */
  faceSize: number;
  /** 0..1 */
  battery: number;
  /** ms timestamp */
  now: number;
  /** optional speech line the brain may attach during perception */
  say: string | null;
  /** face identity for EVERY person in frame (multi-person aware) */
  identities: FaceIdentity[];
  /** expression read from your face (null if no face / vision off) */
  expression: Expression | null;
  /** items currently visible from the last scanner pass (may be empty) */
  visibleItems: string[];
  /** current drone heading (radians) — used for spatial navigation */
  yaw: number;
  /** drone world position — used for map navigation & auto-dock */
  px: number;
  py: number;
  pz: number;
  /** WAVE 7 — ms since her vision pipeline last produced ANY detection.
   * Undefined = no camera feed at all (the governor doesn't hold without one). */
  visionStaleMs?: number;
  /** WAVE 11 — her MEASURED velocity (pose deltas over the last frame),
   * in sim-units/sec — feeds the predictive trajectory governor. */
  vel?: { x: number; y: number; z: number };
}

/** Motor/LED output frame — consumed by the HAL (sim drone or real flight controller). */
export interface Actuation {
  /** velocity setpoints, normalized -1..1 */
  vx: number;
  vy: number;
  vz: number;
  /** yaw rate -1..1 */
  yaw: number;
  /** LED eye color, hex */
  led: string;
  /** optional one-shot speech line the brain wants spoken */
  say: string | null;
  mood: Mood;
  activity: Activity;
}

export interface DronePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** vertical bob phase for idle hover animation */
  bob: number;
  /** attitude in radians — she banks into turns like a real quad */
  pitch: number;
  roll: number;
  /** telemetry battery 0..1 (real-drone bridge only) */
  battery?: number;
}
