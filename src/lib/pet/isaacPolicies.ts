// ============================================================================
// ISAAC POLICIES — her simulation-trained motor policies, served honestly.
//
// Single source of truth: isaac/export_policy_onnx.py generates the ONNX
// artifact AND its manifest; this module imports the manifests directly, so
// whatever the training pipeline produced is exactly what she reports. The
// manifest carries `hardware_calibrated: false` — these are SIMULATION
// skills, not hardware controllers, and she says so.
// ============================================================================

import balanceManifest from "../../../isaac/policies/zola_balance_model_1499.json";
import walkManifest from "../../../isaac/policies/zola_walk_model_1499.json";
import walkV2Manifest from "../../../isaac/policies/zola_walk_model_2499.json";
import handsManifest from "../../../isaac/policies/zola_hands_model_1499.json";

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
] as unknown as IsaacPolicyManifest[];

const TASK_NAMES: Record<string, string> = {
  zola_balance: "standing balance",
  zola_walk: "flat-ground walking",
  zola_hands: "arm and hand pose control (she moves her hands)",
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
