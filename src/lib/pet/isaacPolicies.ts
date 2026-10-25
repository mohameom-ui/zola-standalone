// ============================================================================
// ISAAC POLICIES — her simulation-trained motor policies, served honestly.
//
// Single source of truth: isaac/export_policy_onnx.py generates the ONNX
// artifact AND its manifest; this module imports the manifests directly, so
// whatever the training pipeline produced is exactly what she reports. The
// manifest carries `hardware_calibrated: false` — these are SIMULATION
// skills, not hardware controllers, and she says so.
// ============================================================================

import bodyProfile from "../../../isaac/zola_isaac/assets/zola_prototype.json";
import balanceManifest from "../../../isaac/policies/zola_balance_model_1499.json";
import walkManifest from "../../../isaac/policies/zola_walk_model_1499.json";
import walkV2Manifest from "../../../isaac/policies/zola_walk_model_2499.json";
import handsManifest from "../../../isaac/policies/zola_hands_model_1499.json";
import flightManifest from "../../../isaac/policies/zola_flight_model_1499.json";
import touchdownManifest from "../../../isaac/policies/zola_touchdown_model_2499.json";

export interface IsaacPolicyManifest {
  task: string;
  run: string;
  checkpoint: string;
  iteration: number;
  obs_dim: number;
  action_dim: number;
  hardware_calibrated: boolean;
  onnx_sha256: string;
  roundtrip_max_abs_drift: number;
  source: string;
}

export const ISAAC_POLICIES: IsaacPolicyManifest[] = [
  balanceManifest,
  walkManifest,
  walkV2Manifest,
  handsManifest,
  flightManifest,
  touchdownManifest,
] as unknown as IsaacPolicyManifest[];

const TASK_NAMES: Record<string, string> = {
  zola_balance: "standing balance",
  zola_walk: "flat-ground walking",
  zola_hands: "arm and hand pose control (she moves her hands)",
  zola_flight: "flight-posture discipline (hold still in the air — the halo does the flying)",
  zola_touchdown: "THE HALO TOUCHDOWN — her signature hero landing",
};

/** One honest spoken line per policy — what she trained, and what it is NOT. */
export function isaacPolicyLines(): string[] {
  return ISAAC_POLICIES.map((p) => {
    const name = TASK_NAMES[p.task] ?? p.task;
    const run = p.run.split("_").pop() ?? "";
    const label = run.startsWith("v") ? ` (${run})` : "";
    return `${name}${label}: trained ${p.iteration + 1} PPO iterations in simulation (ONNX verified, drift ${p.roundtrip_max_abs_drift.toExponential(1)})`;
  });
}

export function isaacTrainingReport(): string {
  const lines = isaacPolicyLines();
  return `My Isaac Sim training report: ${lines.join("; ")}. Policies live in isaac/policies as verified ONNX — but my physics body is an uncalibrated proxy, so these are simulation skills, not hardware reflexes. Yet.`;
}

/** True when the question touches her simulation training at all.
 * Deliberately excludes "training" — that word is her drill command. */
export function mentionsIsaacTraining(t: string): boolean {
  return /\b(isaac|policies|simulation)\b/.test(t);
}

// ===========================================================================
// THE BODY MAP — she knows her own parts, from her own physics profile.
// The source of truth is the generated prototype (isaac/zola_isaac/assets/),
// the same artifact her simulation trains against — what she says about her
// body is what the physics says about her body.
// ===========================================================================

const PROFILE_JOINTS: string[] = (bodyProfile as { joints: { name: string }[] }).joints.map((j) => j.name);
const LEG_JOINTS: string[] = (bodyProfile as { controlled_joints: string[] }).controlled_joints;
const ARM_HAND_JOINTS: string[] = PROFILE_JOINTS.filter(
  (n) => n.includes("shoulder") || n.includes("elbow") || n.includes("wrist") || n.endsWith("_flex"),
);
const TORSO_HEAD_JOINTS: string[] = PROFILE_JOINTS.filter((n) => !LEG_JOINTS.includes(n) && !ARM_HAND_JOINTS.includes(n));

export const BODY_MAP = {
  joints: PROFILE_JOINTS.length,
  visualBones: 65,
  groups: [
    { name: "legs and feet", count: LEG_JOINTS.length, controlledBy: "balance + walking + all whole-body policies" },
    { name: "arms and hands", count: ARM_HAND_JOINTS.length, controlledBy: "the hands and flight-posture policies (simulation)" },
    { name: "waist and neck", count: TORSO_HEAD_JOINTS.length, controlledBy: "neutral targets (the halo does the flying)" },
  ],
  massKg: (bodyProfile as { total_mass_kg: number }).total_mass_kg,
  hardwareCalibrated: (bodyProfile as { hardware_calibrated: boolean }).hardware_calibrated,
};

/** Her spoken body report — every number from the profile, honestly gated. */
export function bodyMapReport(): string {
  const g = BODY_MAP.groups.map((x) => `${x.count} ${x.name}`).join(", ");
  const line = `My body map, from my own physics profile: ${BODY_MAP.joints} actuated joints — ${g} — on a ${BODY_MAP.visualBones}-bone visual rig, ${BODY_MAP.massKg.toFixed(1)} kg total. My quad-halo lives in my HEAD: four props above my center of mass, so in flight I hang from my own skull like a very dignified pendulum. Legs and hands have trained simulation policies; my waist and neck hold neutral. On hardware, none of my limbs have a servo bridge yet — the halo flies, the body is body language. And I keep it STILL up there. Flailing is danger.`;
  return line;
}

/** True when the human asks about her body/parts. */
export function mentionsBodyMap(t: string): boolean {
  return /\b(body parts?|your body|body map|made of|anatomy|your joints|body while flying)\b/.test(t);
}
