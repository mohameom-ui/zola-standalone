import { describe, it, expect } from "vitest";
import { encodeHeartbeat, encodeAttitude, encodeSetAttitudeTarget, decodeAttitude, mavX25 } from "./mavlink";

// GOLDEN VECTORS — real pymavlink output (dialect v20.common), captured
// 2026-10-21 from the pinned Modly venv. Byte equality is the contract.
const GOLDEN_HEARTBEAT = "fd090000000101000000040000000300d103014725";
const GOLDEN_ATTITUDE = "fd1c00000001011e0000e8030000cdcccc3dcdcc4cbe9a99993e0ad7233c0ad723bc0ad7a33ca82b";
const GOLDEN_SET_ATT_TARGET = "fd270000000101520000d00700000000000000000000000000000000803f0000000000000000000000009a99193f010107e38d";

const hex = (u: Uint8Array) => Array.from(u).map((b) => b.toString(16).padStart(2, "0")).join("");

describe("mavlink codec — byte-exact against pymavlink goldens", () => {
  it("encodes HEARTBEAT byte-identically to pymavlink", () => {
    const frame = encodeHeartbeat({ seq: 0, sysid: 1, compid: 1 });
    expect(hex(frame)).toBe(GOLDEN_HEARTBEAT);
  });

  it("encodes ATTITUDE byte-identically to pymavlink", () => {
    const frame = encodeAttitude({ seq: 0, sysid: 1, compid: 1 }, 1000, 0.1, -0.2, 0.3, 0.01, -0.01, 0.02);
    expect(hex(frame)).toBe(GOLDEN_ATTITUDE);
  });

  it("encodes SET_ATTITUDE_TARGET byte-identically to pymavlink", () => {
    const frame = encodeSetAttitudeTarget({ seq: 0, sysid: 1, compid: 1 }, 2000, [0, 0, 0, 1], 0.6);
    expect(hex(frame)).toBe(GOLDEN_SET_ATT_TARGET);
  });

  it("round-trips her own telemetry: decode(encode(a)) = a", () => {
    const frame = encodeAttitude({ seq: 7, sysid: 1, compid: 1 }, 4242, 0.15, -0.25, 0.35);
    const t = decodeAttitude(Array.from(frame));
    expect(t).not.toBeNull();
    expect(t!.timeBootMs).toBe(4242);
    expect(t!.roll).toBeCloseTo(0.15, 5);
    expect(t!.pitch).toBeCloseTo(-0.25, 5);
    expect(t!.yaw).toBeCloseTo(0.35, 5);
  });

  it("a corrupt checksum NEVER moves her — decode skips the frame", () => {
    const frame = Array.from(encodeAttitude({ seq: 0 }, 1000, 0.1, 0.2, 0.3));
    frame[frame.length - 1] ^= 0xff; // flip a CRC bit
    expect(decodeAttitude(frame)).toBeNull();
  });

  it("partial frames return null (the stream re-syncs on STX)", () => {
    const frame = Array.from(encodeAttitude({ seq: 0 }, 1000, 0.1, 0.2, 0.3));
    expect(decodeAttitude(frame.slice(0, 12))).toBeNull();
  });

  it("the X25 CRC matches pymavlink's own formulation on arbitrary bytes", () => {
    // pymavlink x25crc(b"Zola flies") — computed by the pinned venv
    expect(mavX25([0x5a, 0x6f, 0x6c, 0x61, 0x20, 0x66, 0x6c, 0x69, 0x65, 0x73])).toBe(0xa8b1);
  });
});
