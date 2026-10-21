// MAVLINK CODEC — her flight-control language (v3.0)
// Zola's Pi 5 streams MAVLink v2 over UART (115200 baud) to her Matek
// F405-MINITE flight controller. This codec packs the frames her brain
// sends and parses the telemetry her FC returns.
//
// Golden vectors are REAL pymavlink output (dialect v20.common) — byte
// equality is enforced in mavlink.test.ts. Rule 2: no guessed CRC tables.

export const MAV_STX = 0xfd;

// crc_extra per message id (from the pymavlink-generated dialect)
export const MAV_CRC_EXTRA: Record<number, number> = {
  0: 50, // HEARTBEAT
  30: 39, // ATTITUDE
  82: 49, // SET_ATTITUDE_TARGET
};

/** MAVLink X25 CRC-16/CCITT-FALSE as the spec defines it. */
export function mavX25(bytes: readonly number[]): number {
  let crc = 0xffff;
  for (const b of bytes) {
    const tmp = (b ^ (crc & 0xff)) & 0xff;
    const t2 = (tmp ^ (tmp << 4)) & 0xff;
    crc = ((crc >> 8) ^ (t2 << 8) ^ (t2 << 3) ^ (t2 >> 4)) & 0xffff;
  }
  return crc;
}

interface FrameOptions {
  seq: number;
  sysid?: number;
  compid?: number;
}

/** Build a full MAVLink v2 frame around a payload. */
export function mavFrame(msgid: number, payload: readonly number[], opts: FrameOptions): Uint8Array {
  const header = [
    MAV_STX,
    payload.length,
    0, // incompat flags
    0, // compat flags
    opts.seq & 0xff,
    opts.sysid ?? 1,
    opts.compid ?? 1,
    msgid & 0xff,
    (msgid >> 8) & 0xff,
    (msgid >> 16) & 0xff,
  ];
  const crc = mavX25([...header.slice(1), ...payload, MAV_CRC_EXTRA[msgid] ?? 0]);
  return new Uint8Array([...header, ...payload, crc & 0xff, (crc >> 8) & 0xff]);
}

const f32 = (v: number): number[] => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return [...b];
};
const u32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];

/** HEARTBEAT (#0) — her "I am alive" pulse. */
export function encodeHeartbeat(
  opts: FrameOptions,
  customMode = 4,
  type = 3, // MAV_TYPE_QUADROTOR — her halo is a quad
  autopilot = 0, // MAV_AUTOPILOT_GENERIC
  baseMode = 0xd1,
  systemStatus = 3, // STANDBY — flips to ACTIVE when she arms
): Uint8Array {
  const payload = [...u32(customMode), type, autopilot, baseMode, systemStatus, 1];
  return mavFrame(0, payload, opts);
}

/** ATTITUDE (#30) — she reports her own orientation. */
export function encodeAttitude(
  opts: FrameOptions,
  timeBootMs: number,
  roll: number,
  pitch: number,
  yaw: number,
  rollspeed = 0,
  pitchspeed = 0,
  yawspeed = 0,
): Uint8Array {
  const payload = [
    ...u32(timeBootMs),
    ...f32(roll), ...f32(pitch), ...f32(yaw),
    ...f32(rollspeed), ...f32(pitchspeed), ...f32(yawspeed),
  ];
  return mavFrame(30, payload, opts);
}

/** SET_ATTITUDE_TARGET (#82) — her brain commanding her FC's attitude. */
export function encodeSetAttitudeTarget(
  opts: FrameOptions,
  timeBootMs: number,
  q: readonly [number, number, number, number],
  thrust: number,
): Uint8Array {
  const payload = [
    ...u32(timeBootMs),
    ...f32(q[0]), ...f32(q[1]), ...f32(q[2]), ...f32(q[3]),
    ...f32(0), ...f32(0), ...f32(0), // body rates: the FC stabilizes
    ...f32(thrust),
    1, // target_system
    1, // target_component
    0b00000111, // type_mask: ignore body-rate + thrust-body fields (last byte on the wire)
  ];
  return mavFrame(82, payload, opts);
}

export interface AttitudeTelemetry {
  timeBootMs: number;
  roll: number;
  pitch: number;
  yaw: number;
}

/**
 * Parse one ATTITUDE frame out of a byte stream. Returns null for partial,
 * non-ATTITUDE, or checksum-corrupt input — a corrupt frame NEVER moves her.
 */
export function decodeAttitude(buf: readonly number[]): AttitudeTelemetry | null {
  for (let i = 0; i + 10 <= buf.length; i++) {
    if (buf[i] !== MAV_STX) continue;
    const len = buf[i + 1];
    if (i + 10 + len + 2 > buf.length) return null; // partial — wait for more
    const header = buf.slice(i + 1, i + 10);
    const payload = buf.slice(i + 10, i + 10 + len);
    const msgid = header[6] | (header[7] << 8) | (header[8] << 16);
    if (msgid !== 30) continue;
    const crc = mavX25([...header, ...payload, MAV_CRC_EXTRA[30]]);
    const crcWire = buf[i + 10 + len] | (buf[i + 10 + len + 1] << 8);
    if (crc !== crcWire) continue; // corrupt — skip it
    const v = new DataView(new Uint8Array(payload).buffer);
    return {
      timeBootMs: v.getUint32(0, true),
      roll: v.getFloat32(4, true),
      pitch: v.getFloat32(8, true),
      yaw: v.getFloat32(12, true),
    };
  }
  return null;
}
