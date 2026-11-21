"""Byte-level tests for the rangefinder parsers (no hardware required).

    cd bridge && python3 -m unittest test_range_sensor -v
"""

import math
import unittest

from range_sensor import (
    Ld06Parser,
    TfLunaParser,
    ld06_crc8,
    make_parser,
)


def tf_frame(cm: int, bad: bool = False) -> bytes:
    frame = [0x59, 0x59, cm & 0xFF, (cm >> 8) & 0xFF, 0x10, 0x00, 25, 0x00]
    checksum = (sum(frame) + (1 if bad else 0)) & 0xFF
    return bytes(frame + [checksum])


def ld06_packet(start_deg: float, end_deg: float, mm: list[int]) -> bytes:
    f = [0] * 47
    f[0], f[1] = 0x54, 0x2C
    raw_start = int(round(start_deg * 100))
    raw_end = int(round(end_deg * 100))
    f[4], f[5] = raw_start & 0xFF, (raw_start >> 8) & 0xFF
    for i in range(12):
        base = 6 + i * 3
        d = mm[i] if i < len(mm) else 0
        f[base], f[base + 1], f[base + 2] = d & 0xFF, (d >> 8) & 0xFF, 200
    f[42], f[43] = raw_end & 0xFF, (raw_end >> 8) & 0xFF  # per LD06 layout
    f[46] = ld06_crc8(bytes(f), 46)
    return bytes(f)


class TfLunaTests(unittest.TestCase):
    def test_complete_frame(self):
        out = TfLunaParser().push(tf_frame(123), now=5000.0)
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0]["distance"], 1.23)
        self.assertEqual(out[0]["bearing"], 0.0)
        self.assertEqual(out[0]["at"], 5000.0)

    def test_split_frame(self):
        p = TfLunaParser()
        frame = tf_frame(250)
        self.assertEqual(p.push(frame[:3], now=1.0), [])
        self.assertEqual(len(p.push(frame[3:], now=1.1)), 1)

    def test_bad_checksum_recovers(self):
        p = TfLunaParser()
        self.assertEqual(p.push(tf_frame(100, bad=True), now=1.0), [])
        out = p.push(tf_frame(200), now=1.1)
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0]["distance"], 2.0)

    def test_default_timestamp_is_milliseconds(self):
        # the browser's RangeReading.at is ms; seconds would read as stale
        out = TfLunaParser().push(tf_frame(100))
        self.assertEqual(len(out), 1)
        self.assertGreater(out[0]["at"], 1_000_000_000_000)

    def test_zero_distance_dropped(self):
        self.assertEqual(TfLunaParser().push(tf_frame(0), now=1.0), [])

    def test_out_of_range_dropped(self):
        self.assertEqual(TfLunaParser().push(tf_frame(900), now=1.0), [])

    def test_header_in_noise_resyncs(self):
        p = TfLunaParser()
        noisy = b"\x00\x13\x37" + tf_frame(150)
        out = p.push(noisy, now=1.0)
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0]["distance"], 1.5)


class Ld06Tests(unittest.TestCase):
    def test_twelve_points_spread(self):
        out = Ld06Parser().push(ld06_packet(0, 330, [1000] * 12), now=2.0)
        self.assertEqual(len(out), 12)
        self.assertAlmostEqual(out[0]["distance"], 1.0)
        self.assertAlmostEqual(out[0]["bearing"], 0.0)
        self.assertAlmostEqual(out[-1]["bearing"], math.radians(-30), places=6)

    def test_north_wrap(self):
        out = Ld06Parser().push(ld06_packet(350, 10, [500] * 12), now=3.0)
        self.assertEqual(len(out), 12)
        self.assertAlmostEqual(out[0]["bearing"], math.radians(-10), places=6)
        self.assertLess(abs(out[6]["bearing"]), 0.02)
        self.assertAlmostEqual(out[-1]["bearing"], math.radians(10), places=6)

    def test_no_return_points_skipped(self):
        mm = [800] * 12
        mm[3] = 0
        mm[7] = 0
        out = Ld06Parser().push(ld06_packet(0, 330, mm), now=4.0)
        self.assertEqual(len(out), 10)

    def test_crc_rejects_and_recovers(self):
        p = Ld06Parser()
        bad = bytearray(ld06_packet(0, 330, [1000] * 12))
        bad[10] ^= 0xFF
        self.assertEqual(p.push(bytes(bad), now=5.0), [])
        self.assertEqual(len(p.push(ld06_packet(0, 330, [1000] * 12), now=5.1)), 12)

    def test_split_packet(self):
        p = Ld06Parser()
        packet = ld06_packet(0, 330, [700] * 12)
        self.assertEqual(p.push(packet[:20], now=6.0), [])
        self.assertEqual(len(p.push(packet[20:], now=6.1)), 12)


class FactoryTests(unittest.TestCase):
    def test_known_sensors(self):
        self.assertIsInstance(make_parser("tf-luna"), TfLunaParser)
        self.assertIsInstance(make_parser("ld06"), Ld06Parser)

    def test_unknown_sensor_refused(self):
        with self.assertRaises(ValueError):
            make_parser("lidar-9000")


if __name__ == "__main__":
    unittest.main()
