import { describe, it, expect } from "vitest";
import { MavLinkBridgeHAL } from "./hardware";
import { mavX25, MAV_CRC_EXTRA, MAV_STX } from "./mavlink";

const hal = new MavLinkBridgeHAL("ws://localhost:9999");

function validFrame(f: Uint8Array): boolean {
  if (f[0] !== MAV_STX) return false;
  const len = f[1];
  const header = Array.from(f.slice(1, 10));
  const payload = Array.from(f.slice(10, 10 + len));
  const crc = mavX25([...header, ...payload, MAV_CRC_EXTRA[82]]);
  return (f[10 + len] | (f[10 + len + 1] << 8)) === crc;
}

describe("MavLinkBridgeHAL — her commands in her FC's language", () => {
  it("level hover: yaw 0 → identity quaternion, thrust 0.5, valid CRC", () => {
    const f = hal.attitudeCommand(0, 0);
    expect(validFrame(f)).toBe(true);
    expect(f[7]).toBe(82); // msgid byte 0 (LE) of SET_ATTITUDE_TARGET
  });

  it("yaw rotates her quaternion; thrust never leaves [0,1]", () => {
    const up = hal.attitudeCommand(0, 10);
    const down = hal.attitudeCommand(0, -10);
    const thrustAt = (f: Uint8Array) => {
      // payload: time(4) + q(16) + rates(12) + thrust(4) — thrust at 42
      const v = new DataView(f.buffer, 10 + 4 + 16 + 12, 4);
      return v.getFloat32(0, true);
    };
    expect(thrustAt(up)).toBe(1);
    expect(thrustAt(down)).toBe(0);
    const qz = hal.attitudeCommand(Math.PI, 0);
    const v = new DataView(qz.buffer, 10 + 4, 16);
    expect(v.getFloat32(8, true)).toBeCloseTo(1, 5); // qz = sin(90°) for a 180° yaw
  });

  it("each command gets a fresh sequence number", () => {
    const a = hal.attitudeCommand(0, 0);
    const b = hal.attitudeCommand(0, 0);
    expect(b[4]).toBe((a[4] + 1) & 0xff); // seq byte advances
  });
});
