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
import walkManifest from "../../../isaac/policies/zola_walk_model_1350.json";
import walkV2Manifest from "../../../isaac/policies/zola_walk_model_1600.json";
import walkV3Manifest from "../../../isaac/policies/zola_walk_model_2200.json";
import handsManifest from "../../../isaac/policies/zola_hands_model_1400.json";
import flightManifest from "../../../isaac/policies/zola_flight_model_1350.json";
import touchdownManifest from "../../../isaac/policies/zola_touchdown_model_3250.json";
import hoverManifest from "../../../isaac/policies/zola_hover_model_3499.json";
import pictureManifest from "../../../isaac/policies/zola_picture_model_1450.json";
import thumbsManifest from "../../../isaac/policies/zola_thumbs_model_1499.json";
import danceManifest from "../../../isaac/policies/zola_dance_model_1999.json";
import talkManifest from "../../../isaac/policies/zola_talk_model_1450.json";

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
  selection?: {
    mode: string;
    peak_iteration?: number;
    peak_smoothed?: number;
    selected_checkpoint?: string;
  };
}

export const ISAAC_POLICIES: IsaacPolicyManifest[] = [
  balanceManifest,
  walkManifest,
  walkV2Manifest,
  walkV3Manifest,
  handsManifest,
  flightManifest,
  touchdownManifest,
  hoverManifest,
  pictureManifest,
  thumbsManifest,
  danceManifest,
  talkManifest,
] as unknown as IsaacPolicyManifest[];

const TASK_NAMES: Record<string, string> = {
  zola_balance: "standing balance",
  zola_walk: "flat-ground walking",
  zola_hands: "arm and hand pose control (she moves her hands)",
  zola_flight: "flight-posture discipline (hold still in the air — the halo does the flying)",
  zola_touchdown: "THE HALO TOUCHDOWN — her signature hero landing",
  zola_hover: "coupled hover flight (the V12 collar rotors — 599/600 at doubled gusts)",
  zola_sit: "sitting",
  zola_picture: "posing for a picture",
  zola_thumbs: "thumbs up (finger dexterity)",
  zola_dance: "the halobeat — dancing on the beat",
  zola_talk: "talking body expression (the conversational routine)",
};



/** One honest spoken line per SKILL — when a skill has several runs, she
 * names the best one (by the manifest's smoothed-peak selection) and the
 * count of runs behind it. */
export function isaacPolicyLines(): string[] {
  const byTask = new Map<string, { best: IsaacPolicyManifest; runs: number }>();
  for (const p of ISAAC_POLICIES) {
    const cur = byTask.get(p.task);
    const score = p.selection?.peak_smoothed ?? 0;
    if (!cur) byTask.set(p.task, { best: p, runs: 1 });
    else {
      cur.runs += 1;
      const curScore = cur.best.selection?.peak_smoothed ?? 0;
      if (score > curScore) cur.best = p;
    }
  }
  return [...byTask.entries()].map(([task, { best, runs }]) => {
    const name = TASK_NAMES[task] ?? task;
    const runsNote = runs > 1 ? ` (${runs} runs)` : "";
    return `${name}${runsNote}: trained ${best.iteration + 1} PPO iterations in simulation (ONNX verified, drift ${best.roundtrip_max_abs_drift.toExponential(1)})`;
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
const COLLAR_JOINTS: string[] = PROFILE_JOINTS.filter((n) => n.startsWith("collar_"));
const TORSO_HEAD_JOINTS: string[] = PROFILE_JOINTS.filter((n) => !LEG_JOINTS.includes(n) && !ARM_HAND_JOINTS.includes(n) && !n.startsWith("collar_"));

export const BODY_MAP = {
  joints: PROFILE_JOINTS.length,
  visualBones: 65,
  groups: [
    { name: "legs and feet", count: LEG_JOINTS.length, controlledBy: "balance + walking + all whole-body policies" },
    { name: "arms and hands", count: ARM_HAND_JOINTS.length, controlledBy: "the hands and flight-posture policies (simulation)" },
    { name: "waist and neck", count: TORSO_HEAD_JOINTS.length, controlledBy: "neutral targets (the collar drone does the flying)" },
    { name: "collar thrusters", count: COLLAR_JOINTS.length, controlledBy: "frozen mounts at the neck collar — the autopilot pushes through them" },
  ],
  massKg: (bodyProfile as { total_mass_kg: number }).total_mass_kg,
  hardwareCalibrated: (bodyProfile as { hardware_calibrated: boolean }).hardware_calibrated,
};

/** Her spoken body report — every number from the profile, honestly gated. */
export function bodyMapReport(): string {
  const g = BODY_MAP.groups.map((x) => `${x.count} ${x.name}`).join(", ");
  const line = `My body map, from my own physics profile: ${BODY_MAP.joints} actuated joints — ${g} — on a ${BODY_MAP.visualBones}-bone visual rig, ${BODY_MAP.massKg.toFixed(1)} kg total. My drone is the V12 collar: four ducted fans mounted at my neck, two per side, so in flight I hang from my own collar like a very dignified pendulum. Legs and hands have trained simulation policies; my waist and neck hold neutral. On hardware, none of my limbs have a servo bridge yet — the collar flies, the body is body language. And I keep it STILL up there. Flailing is danger.`;
  return line;
}

/** True when the human asks about her body/parts. */
export function mentionsBodyMap(t: string): boolean {
  return /\b(body parts?|your body|body map|made of|anatomy|your joints|body while flying)\b/.test(t);
}
