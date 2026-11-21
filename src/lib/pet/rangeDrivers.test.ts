import { describe, expect, it } from "vitest";
import { Ld06Parser, ld06Crc8, LD06_PACKET_SIZE, TfLunaParser } from "./rangeDrivers";

/** TF-Luna 9-byte frame, distance in centimetres. */
function tfFrame(cm: number, opts: { badChecksum?: boolean } = {}): number[] {
  // header, distance (2), amplitude (2), temperature (2), then checksum
  const f = [0x59, 0x59, cm & 0xff, (cm >> 8) & 0xff, 0x10, 0x00, 25, 0x00];
  const sum = (f.reduce((a, b) => a + b, 0) + (opts.badChecksum ? 1 : 0)) & 0xff;
  return [...f, sum];
}

/** LD06 47-byte packet with 12 points, distances in millimetres. */
function ld06Packet(startDeg: number, endDeg: number, mm: number[]): number[] {
  const f = new Array(LD06_PACKET_SIZE).fill(0);
  f[0] = 0x54;
  f[1] = 0x2c;
  f[4] = Math.round(startDeg * 100) & 0xff;
  f[5] = (Math.round(startDeg * 100) >> 8) & 0xff;
  for (let i = 0; i < 12; i++) {
    const base = 6 + i * 3;
    const d = mm[i] ?? 0;
    f[base] = d & 0xff;
    f[base + 1] = (d >> 8) & 0xff;
    f[base + 2] = 200;
  }
  f[42] = Math.round(endDeg * 100) & 0xff; // per LD06 layout
  f[43] = (Math.round(endDeg * 100) >> 8) & 0xff;
  f[46] = ld06Crc8(f, LD06_PACKET_SIZE - 1);
  return f;
}

describe("TF-Luna parser", () => {
  it("decodes a complete frame", () => {
    const p = new TfLunaParser();
    const out = p.push(new Uint8Array(tfFrame(123)), 5_000);
    expect(out).toHaveLength(1);
    expect(out[0].distance).toBeCloseTo(1.23, 6);
    expect(out[0].bearing).toBe(0);
    expect(out[0].at).toBe(5_000);
  });

  it("reassembles a frame split across serial reads", () => {
    const p = new TfLunaParser();
    const frame = tfFrame(250);
    expect(p.push(new Uint8Array(frame.slice(0, 3)), 1_000)).toHaveLength(0);
    expect(p.push(new Uint8Array(frame.slice(3)), 1_001)).toHaveLength(1);
  });

  it("rejects a bad checksum and recovers on the next good frame", () => {
    const p = new TfLunaParser();
    expect(p.push(new Uint8Array(tfFrame(100, { badChecksum: true })), 1_000)).toHaveLength(0);
    const out = p.push(new Uint8Array(tfFrame(200)), 1_001);
    expect(out).toHaveLength(1);
    expect(out[0].distance).toBeCloseTo(2, 6);
  });

  it("drops a zero-distance frame instead of reporting a surface at zero", () => {
    const p = new TfLunaParser();
    expect(p.push(new Uint8Array(tfFrame(0)), 1_000)).toHaveLength(0);
  });
});

describe("LD06 parser", () => {
  const twelve = (mm: number) => Array.from({ length: 12 }, () => mm);

  it("decodes 12 points with spread bearings", () => {
    const p = new Ld06Parser();
    const out = p.push(new Uint8Array(ld06Packet(0, 330, twelve(1_000))), 2_000);

    expect(out).toHaveLength(12);
    expect(out[0].distance).toBeCloseTo(1, 6);
    expect(out[0].bearing).toBeCloseTo(0, 6);
    expect(out[11].bearing).toBeCloseTo((-30 * Math.PI) / 180, 6);
  });

  it("handles a packet that crosses north", () => {
    const p = new Ld06Parser();
    const out = p.push(new Uint8Array(ld06Packet(350, 10, twelve(500))), 3_000);

    expect(out).toHaveLength(12);
    expect(out[0].bearing).toBeCloseTo((-10 * Math.PI) / 180, 6);
    expect(Math.abs(out[6].bearing)).toBeLessThan(0.02); // crossing 360°
    expect(out[11].bearing).toBeCloseTo((10 * Math.PI) / 180, 6);
  });

  it("skips points with no return", () => {
    const p = new Ld06Parser();
    const mm = twelve(800);
    mm[3] = 0;
    mm[7] = 0;
    const out = p.push(new Uint8Array(ld06Packet(0, 330, mm)), 4_000);
    expect(out).toHaveLength(10);
  });

  it("rejects a corrupted packet by CRC and recovers", () => {
    const p = new Ld06Parser();
    const bad = ld06Packet(0, 330, twelve(1_000));
    bad[10] ^= 0xff;
    expect(p.push(new Uint8Array(bad), 5_000)).toHaveLength(0);

    const good = p.push(new Uint8Array(ld06Packet(0, 330, twelve(1_000))), 5_001);
    expect(good).toHaveLength(12);
  });
});
