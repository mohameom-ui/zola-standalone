// ============================================================================
// ZOLA — rangefinder protocol parsers (bytes in, RangeReading out)
//
// These are real, documented wire formats, not invented ones:
//
//   TF-Luna (Benewake, UART/I2C): 9-byte frames, 0x59 0x59 header,
//     distance in centimetres, checksum = sum(first 8 bytes) & 0xFF.
//
//   LD06 / LD19 (LDRobot, UART): 47-byte packets, 0x54 0x2C header,
//     12 points per packet, angles in 0.01 degrees, CRC8 poly 0x4D.
//
// A parser is fed arbitrary byte chunks (serial reads split frames), keeps a
// small buffer, resynchronises on the header, and rejects anything whose
// checksum fails. Invalid points (distance 0) are dropped, not reported as
// zero-metre surfaces.
//
// The physical driver only has to move bytes from the port into push().
// ============================================================================

import type { RangeReading } from "./rangeFusion";

/** Little-endian u16 from two bytes. */
const u16 = (lo: number, hi: number) => lo | (hi << 8);

/** Normalise an angle to -π..π. */
function normalise(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class TfLunaParser {
  private buf: number[] = [];

  /** Feed bytes as they arrive; returns every complete, valid reading. */
  push(chunk: Uint8Array, now: number): RangeReading[] {
    for (const b of chunk) this.buf.push(b);
    const out: RangeReading[] = [];

    for (;;) {
      const start = this.findHeader();
      if (start < 0) {
        // keep the last byte: it may be the first half of a header
        this.buf = this.buf.slice(-1);
        break;
      }
      if (start > 0) this.buf.splice(0, start);
      if (this.buf.length < 9) break;

      const f = this.buf;
      const sum = (f[0] + f[1] + f[2] + f[3] + f[4] + f[5] + f[6] + f[7]) & 0xff;
      if (sum !== f[8]) {
        this.buf.shift(); // resync one byte and look again
        continue;
      }

      const cm = u16(f[2], f[3]);
      this.buf.splice(0, 9);
      if (cm > 0) out.push({ distance: cm / 100, bearing: 0, at: now });
    }
    return out;
  }

  private findHeader(): number {
    for (let i = 0; i + 1 < this.buf.length; i++) {
      if (this.buf[i] === 0x59 && this.buf[i + 1] === 0x59) return i;
    }
    return -1;
  }
}

/** CRC-8 used by LD06/LD19 packets: poly 0x4D, init 0x00. */
export function ld06Crc8(bytes: number[], len: number): number {
  let crc = 0;
  for (let i = 0; i < len; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x4d) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export const LD06_PACKET_SIZE = 47;

export class Ld06Parser {
  private buf: number[] = [];

  push(chunk: Uint8Array, now: number): RangeReading[] {
    for (const b of chunk) this.buf.push(b);
    const out: RangeReading[] = [];

    for (;;) {
      const start = this.findHeader();
      if (start < 0) {
        this.buf = this.buf.slice(-1);
        break;
      }
      if (start > 0) this.buf.splice(0, start);
      if (this.buf.length < LD06_PACKET_SIZE) break;

      const f = this.buf;
      if (ld06Crc8(f, LD06_PACKET_SIZE - 1) !== f[LD06_PACKET_SIZE - 1]) {
        this.buf.shift();
        continue;
      }

      // layout: 6..41 = 12 points, 42..43 end angle, 44..45 stamp, 46 CRC
      const startDeg = u16(f[4], f[5]) / 100;
      let endDeg = u16(f[42], f[43]) / 100;
      if (endDeg < startDeg) endDeg += 360; // packet crosses north

      for (let i = 0; i < 12; i++) {
        const base = 6 + i * 3;
        const mm = u16(f[base], f[base + 1]);
        if (mm === 0) continue; // no return
        const span = endDeg - startDeg;
        const deg = startDeg + (span * i) / 11;
        out.push({
          distance: mm / 1000,
          bearing: normalise((deg * Math.PI) / 180),
          at: now,
        });
      }
      this.buf.splice(0, LD06_PACKET_SIZE);
    }
    return out;
  }

  private findHeader(): number {
    for (let i = 0; i + 1 < this.buf.length; i++) {
      if (this.buf[i] === 0x54 && this.buf[i + 1] === 0x2c) return i;
    }
    return -1;
  }
}
