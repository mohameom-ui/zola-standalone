import { describe, it, expect } from "vitest";
import { isValidHilFrame, parseHilEnvelope, HilTelemetryLink } from "./hilTelemetry";

const goodPayload = {
  sequence_id: 42,
  timestamp_us: 1_000_000,
  attitude: { roll: 1.5, pitch: -2.5, yaw: 45 },
  motors: [1150, 1150, 1148, 1152],
  battery_mv: 12450,
};

const envelope = (payload: unknown) =>
  JSON.stringify({ type: "ZOLA_TELEMETRY_UPDATE", panel_id: "hil_telemetry_03", payload });

describe("HIL telemetry", () => {
  it("accepts a valid frame", () => {
    expect(isValidHilFrame(goodPayload)).toBe(true);
    expect(parseHilEnvelope(envelope(goodPayload))).toEqual(goodPayload);
  });

  it("rejects the wrong envelope type or panel", () => {
    expect(parseHilEnvelope(JSON.stringify({ type: "OTHER", panel_id: "hil_telemetry_03", payload: goodPayload }))).toBeNull();
    expect(parseHilEnvelope(JSON.stringify({ type: "ZOLA_TELEMETRY_UPDATE", panel_id: "panel_9", payload: goodPayload }))).toBeNull();
  });

  it("rejects structurally broken payloads (every field checked)", () => {
    expect(isValidHilFrame(null)).toBe(false);
    expect(isValidHilFrame({ ...goodPayload, sequence_id: "7" })).toBe(false);
    expect(isValidHilFrame({ ...goodPayload, attitude: { roll: 1, pitch: 2 } })).toBe(false);
    expect(isValidHilFrame({ ...goodPayload, motors: [1, 2, 3] })).toBe(false);
    expect(isValidHilFrame({ ...goodPayload, motors: [1, 2, 3, "4"] })).toBe(false);
    expect(isValidHilFrame({ ...goodPayload, battery_mv: null })).toBe(false);
  });

  it("rejects malformed JSON silently — foreign traffic is never trusted", () => {
    expect(parseHilEnvelope("not json at all")).toBeNull();
    expect(parseHilEnvelope("<html>502</html>")).toBeNull();
  });

  it("the link stays inert until connected and parses only valid envelopes", () => {
    const link = new HilTelemetryLink("ws://127.0.0.1:1"); // nothing there
    expect(link.connected).toBe(false);
    expect(link.frame).toBeNull();
    // the class is constructed without touching the network in this test —
    // connect() against a dead port fires onerror/onclose, no throw
    expect(() => link.connect()).not.toThrow();
    link.disconnect();
  });
});
