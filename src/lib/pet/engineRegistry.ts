// ============================================================================
// THE ENGINE TRAINING REGISTRY — every part of her, and what "training" it
// honestly means. Nothing here is fake: engines whose weights are fixed
// (whisper, MediaPipe, SmolVLM, Kokoro) train through their ONLINE layers —
// learned phrases, encounter memory, behavior profiles — and the registry
// says so plainly. The motor engine trains through Isaac's PPO pipeline.
// The registry's numbers are pulled from the live modules, not memorized.
// ============================================================================

import { isaacTrainingReport, ISAAC_POLICIES } from "./isaacPolicies";

export interface EngineStatus {
  name: string;
  /** what "training" means for this engine — honestly */
  mode: string;
  /** live, real numbers from her running systems */
  metrics: string;
  /** how a human trains it right now */
  how: string;
}

export function engineReport(hooks: {
  learnedPhrases?: number;
  profileWarmth?: number;
  auraEntries?: number;
  capabilities?: number;
  memoryFacts?: number;
  sessions?: number;
  commandsTaken?: number;
}): { lines: string[]; engines: EngineStatus[] } {
  const isaacRuns = ISAAC_POLICIES.length;
  const engines: EngineStatus[] = [
    {
      name: "MOTOR (Isaac Sim)",
      mode: "REAL RL TRAINING — PPO in Isaac Sim, best-checkpoint selection, ONNX export",
      metrics: `${isaacRuns} training runs on the shelf, every artifact round-trip-verified`,
      how: "runs continuously via Scripts/isaac-continuous.mjs, or command a round from the trainer console (:3002)",
    },
    {
      name: "HEARING (ears + lexicon)",
      mode: "ONLINE — she learns YOUR phrases permanently; the STT weights are fixed and used as-is",
      metrics: `${hooks.learnedPhrases ?? 0} learned phrase mappings`,
      how: "correct her: \"no, I said ...\" — the correction is stored and applied forever",
    },
    {
      name: "PERSONALITY (bond + adaptation)",
      mode: "ONLINE REINFORCEMENT — warmth, brevity, and bond adapt to every interaction",
      metrics: `warmth ${(hooks.profileWarmth ?? 0).toFixed(2)} (−1..1) · ${hooks.sessions ?? 0} session(s) · ${hooks.commandsTaken ?? 0} commands taken`,
      how: "praise, apologies, and rudeness move it; kind words literally make her warmer",
    },
    {
      name: "SCANNING + VISION (aura cache)",
      mode: "ONLINE MEMORY — detection weights are fixed; her RECOGNITION of objects trains by encounter",
      metrics: `${hooks.auraEntries ?? 0} remembered objects with encounter counts`,
      how: "show her things twice — the second look is recognition, not detection",
    },
    {
      name: "TALKING (voice)",
      mode: "SELECTION, not training — the Kokoro voices are fixed weights; her expressiveness is trained through the persona engine",
      metrics: "every voice auditionable in VOICE STUDIO",
      how: "pick her voice in the panel; her delivery follows her personality state",
    },
    {
      name: "MEMORY (facts, items, nights)",
      mode: "ONLINE — everything she learns is stored, consolidated nightly, and reincarnates through the export",
      metrics: `${hooks.memoryFacts ?? 0} facts · ${hooks.capabilities ?? 0} self-built capabilities`,
      how: "\"my name is\", \"i like\", \"remember that\" — then EXPORT LIFE to carry it",
    },
  ];
  engines.push({
    name: "DEFENSE (host monitoring)",
    mode: "WATCHING — she monitors her own host: firewall states, listening ports, process anomalies, failed auth attempts. She reads and alerts. She does not attack.",
    metrics: "the defense watch runs at :3004 (Scripts/defense-watch.mjs) — sweeps every 30 s",
    how: "the red team tools (Metasploit, Hashcat, sqlmap) stay behind the human keyboard — an AI companion does not decide what to attack",
  });
  const lines = [
    "My engine training report — every part of me, and what training it honestly means:",
    ...engines.map((e) => `• ${e.name}: ${e.mode}. ${e.metrics}.`),
    isaacTrainingReport(),
  ];
  return { lines, engines };
}
