import { describe, it, expect } from "vitest";
import { PetBrain } from "./brain";
import { ISAAC_POLICIES, isaacPolicyLines } from "./isaacPolicies";

describe("the isaac report — her simulation skills, served honestly", () => {
  it("the manifests are the single source of truth and stay uncalibrated", () => {
    expect(ISAAC_POLICIES.length).toBeGreaterThanOrEqual(2);
    for (const p of ISAAC_POLICIES) {
      expect(p.hardware_calibrated).toBe(false);
      expect(p.roundtrip_max_abs_drift).toBeLessThan(1e-4);
      expect(p.source).toMatch(/simulation-only/);
    }
  });

  it("she reports her policies in her own words", () => {
    const brain = new PetBrain();
    const line = brain.command("tell me about your policies", 0.9);
    expect(line).toContain("Isaac Sim training report");
    expect(line).toMatch(/uncalibrated proxy/);
    expect(line).toMatch(/simulation skills, not hardware reflexes/);
    expect(isaacPolicyLines().length).toBe(ISAAC_POLICIES.length);
  });

  it("\"training\" still means drills — the report does not steal her drill command", () => {
    const brain = new PetBrain();
    const line = brain.command("training", 0.9);
    expect(line).not.toContain("Isaac Sim training report");
  });

  it("she knows her own body parts — from the physics profile, not memory", () => {
    const brain = new PetBrain();
    const line = brain.command("what are your body parts", 0.9);
    expect(line).toContain("37 actuated joints");
    expect(line).toMatch(/12 legs and feet/);
    expect(line).toMatch(/22 arms and hands/);
    expect(line).toMatch(/pendulum/);
    expect(line).toMatch(/Flailing is danger/);
  });

  it("the isaac report now counts the hands policy", () => {
    expect(isaacPolicyLines().some((l) => l.includes("arm and hand pose control"))).toBe(true);
  });

  it("the help line now mentions her simulation training", () => {
    const brain = new PetBrain();
    expect(brain.command("what can you do", 0.9)).toMatch(/Isaac Sim/);
  });
});
