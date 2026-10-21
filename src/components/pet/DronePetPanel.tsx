"use client";

// ============================================================================
// DronePetPanel — F7 · AURA, the drone AI pet
// Safety-first design:
//   • EXPLICIT consent gate before any camera/mic/face-index use
//   • ALL learning is local-only; face data = non-reversible numeric signature
//   • SafetyGovernor hard-limits every actuation (speed, stand-off, battery)
//   • One-click kill switch, one-click full memory wipe
// ============================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import GestureStage from "./GestureStage";
import FlightReplay from "./FlightReplay";
import { AmbientMusic } from "@/lib/pet/ambient";
import { Blackbox } from "@/lib/pet/blackbox";
import { Storyteller } from "@/lib/pet/storyteller";
import { FlightTimeEstimator } from "@/lib/pet/battery";
import { runDiagnostics, type DiagnosticsResult } from "@/lib/pet/diagnostics";
import { MissionExecutor, type Waypoint, type MissionAct } from "@/lib/pet/missions";
import { runDreamCycle, type DreamResult } from "@/lib/pet/dreamEngine";
import { SpatialMap } from "@/lib/pet/spatialMap";
import { HapticLink } from "@/lib/pet/haptics";
import { webRecon } from "@/lib/pet/recon";
import { emotionFromTrack } from "@/lib/pet/advancedSensors";
import { checkForUpdates, installPack } from "@/lib/pet/updates";
import { pickSpontaneous, shouldSelfMove } from "@/lib/pet/spontanea";
import { Cortex } from "@/lib/pet/cortex";
import { allPersonas, modeByName } from "@/lib/pet/modes";
import { scanAsset, scanWorldManifest } from "@/lib/pet/auraCache";
import { compileVlog, spokenDaySummary, type VlogInput } from "@/lib/pet/vlog";
import { sunReport, isGoldenHour, circadianVoice } from "@/lib/pet/suncalc";
import ZolaShell from "@/components/pet/ZolaShell";
import { PetBrain } from "@/lib/pet/brain";
import { DroneVision } from "@/lib/pet/vision";
import { DroneEars } from "@/lib/pet/ears";
import { SimDroneHAL, MavLinkBridgeHAL, type PetHAL } from "@/lib/pet/hardware";
import { PiperPack } from "@/lib/pet/piperPack";
import { AuraMemory } from "@/lib/pet/memory";
import { SafetyGovernor, DEFAULT_LIMITS } from "@/lib/pet/safety";
import { LlmConsultant, LocalGenie, type LlmDecision } from "@/lib/pet/llm";
import { SoundWatch, PetChirps } from "@/lib/pet/sound";
import { LocalEars } from "@/lib/pet/earsLocal";
import { SfxFiles } from "@/lib/pet/sfxFiles";
import { NeuralVoice, KOKORO_VOICES } from "@/lib/pet/voiceKokoro";
import { HAZARD_LABELS } from "@/lib/pet/lexicon";
import { DeepEyes } from "@/lib/pet/eyesDeep";
import DroneBody3D, { type GestureApi, GESTURE_REPERTOIRE } from "./DroneBody3D";
import { PetMap, DOCK, ROOM_EXTENT } from "@/lib/pet/map";
import type { FaceTrack } from "@/lib/pet/vision";
import type { DronePose, FaceIdentity, Mood } from "@/lib/pet/types";

const PERSONA_TONE: Record<string, string> = {
  SWEET: "#35d0a5", EXPLORER: "#5ac8fa", HYPER: "#ff9f43", SKITTISH: "#ff4d4f",
  GRUMPY: "#b58a2e", DREAMING: "#43506b", "ROAST MODE": "#ff9f43", SULKING: "#ff4d4f",
};

// WAVE 5 — LED ring color: what her simulated (and, later, real) LED ring shows.
// Same color drives the panel's ambient glow — screen and drone agree.
const LED_FOR_PERSONA: Record<string, string> = {
  SWEET: "#35d0a5", EXPLORER: "#5ac8fa", HYPER: "#f0b90b", SKITTISH: "#ffd98a",
  GRUMPY: "#c8ccd6", DREAMING: "#b98cf0", "ROAST MODE": "#ff6b7b", SULKING: "#ff4d4f",
};

const MOOD_LABEL: Record<Mood, string> = {
  idle: "IDLE", curious: "CURIOUS", happy: "HAPPY", excited: "EXCITED",
  sleepy: "SLEEPY", alarmed: "ALARMED", sleeping: "SLEEPING",
};

interface LogEntry { who: "you" | "aura" | "sys"; text: string; at: number }

const CHIPS = [
  ["come here", "COME"], ["follow me", "FOLLOW"], ["do a trick", "TRICK"],
  ["go to sleep", "SLEEP"], ["wake up", "WAKE"], ["status", "STATUS"],
  ["scan the room", "SCAN"], ["what do you see", "SEE"], ["what do you remember", "MEMORY"],
  ["find my cup", "FIND"], ["patrol the room", "PATROL"], ["check on me", "CHECK"],
  ["dance", "DANCE"], ["where is my cup", "WHERE"],
  ["you are stupid", "ROAST HER"], ["i love you", "PRAISE"], ["sorry", "APOLOGY"],
  ["check on me every 2 minutes", "SCHEDULE"], ["list routines", "ROUTINES"],
  ["train", "TRAIN"], ["tell me a joke", "JOKE"], ["how are you", "MOOD"], ["sing", "SING"],
  ["what can you do", "SKILLS"], ["goodbye", "BYE"],
];

export default function DronePetPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camCanvasRef = useRef<HTMLCanvasElement>(null);
  const droneCanvasRef = useRef<HTMLCanvasElement>(null);
  const visionRef = useRef<DroneVision | null>(null);
  const earsRef = useRef<DroneEars>(new DroneEars());
  const neuralRef = useRef<NeuralVoice>(new NeuralVoice());
  const halRef = useRef<PetHAL>(new SimDroneHAL());
  const bodyModeRef = useRef<"sim" | "real">("sim");
  const governorRef = useRef<SafetyGovernor>(new SafetyGovernor(DEFAULT_LIMITS));
  const petMapRef = useRef<PetMap>(new PetMap());
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const llmRef = useRef<LlmConsultant>(new LlmConsultant());
  const genieRef = useRef<LocalGenie>(new LocalGenie());
  const deepEyesRef = useRef<DeepEyes>(new DeepEyes());
  const piperPackRef = useRef<PiperPack>(new PiperPack());
  const soundWatchRef = useRef<SoundWatch>(new SoundWatch());
  const chirpsRef = useRef<PetChirps>(new PetChirps());
  const sfxFilesRef = useRef<SfxFiles>(new SfxFiles());
  const localEarsRef = useRef<LocalEars>(new LocalEars());
  const cmdRef = useRef<(t: string) => void>(() => {});
  // v2.4 CORTEX — late-bound feature handles for brain-level decisions
  // (handlers declared later in the component, reached via this ref)
  const featuresRef = useRef<{
    vlog?: () => void;
    integrity?: () => void;
    story?: () => void;
    dream?: () => void;
    gesture?: (name: string) => boolean;
    patrol?: () => void;
  }>({});
  // v3.1 CORTEX — the capability registry: 500 persona-shifts + the system ops
  const cortexRef = useRef(new Cortex());
  const gestureApiRef = useRef<GestureApi | null>(null);
  // SPONTANEA — her last interaction (commands reset it; idle accrues)
  const lastInteractionRef = useRef(performance.now());
  const lastVisionEventRef = useRef(0);
  const prevVisualHoldRef = useRef(false);
  const prevMoodRef = useRef<Mood>("curious");
  const prevActivityRef = useRef<string>("hover");
  const lastSayRef = useRef<{ text: string; until: number }>({ text: "", until: 0 });
  const lastLevelUpdateRef = useRef(0);
  const trackRef = useRef<FaceTrack>({ seen: false, x: 0, y: 0, size: 0, embedding: [], expression: null });
  const identityRef = useRef<FaceIdentity | null>(null);
  const identityListRef = useRef<FaceIdentity[]>([]);
  const batteryRef = useRef(0.86);
  const lastTickRef = useRef(0);
  const autoScanTried = useRef(false);
  const uncertainAnnouncedRef = useRef<Set<string>>(new Set());
  const movedAnnouncedRef = useRef<Set<string>>(new Set());
  const logTailRef = useRef<{ who: string; text: string }[]>([]);

  // ---- local-only learning memory -------------------------------------------
  const memoryRef = useRef<AuraMemory | null>(null);
  if (!memoryRef.current) memoryRef.current = new AuraMemory();
  const memory = memoryRef.current;

  // ---- brain, wired to the memory hooks --------------------------------------
  const brainRef = useRef<PetBrain | null>(null);
  if (!brainRef.current) {
    brainRef.current = new PetBrain({
      onLearnName: (n) => {
        const t = trackRef.current;
        if (!t.seen || t.embedding.length === 0) {
          return "I need to see your face to attach a name to it. Look at my camera eye.";
        }
        const person = memory.learnName(n, t.embedding);
        return `Nice to meet you, ${person.name}. I will remember you.`;
      },
      onLearnFact: (f) => {
        memory.learnFact(f);
        memory.countCommand();
        return `Noted: ${f}.`;
      },
      // WAVE 2+6.6 — on sleep: build the nightly node AND consolidate the day
      consolidateNight: () => {
        memory.buildNightlyNode();
        return memory.consolidateNight();
      },
      takeNightInsight: () => memory.takeNightInsight(),
      memorySummary: () => {
        const snap = memory.snapshot;
        if (snap.people.length === 0 && snap.facts.length === 0 && snap.items.length === 0) {
          return "My memory is empty. Teach me: say 'my name is', or let me scan the room.";
        }
        const who = snap.people.map((p) => p.name).join(", ") || "no faces yet";
        const things = snap.items.slice(-5).map((i) => i.customName ?? i.label).join(", ") || "no items yet";
        const facts = snap.facts.slice(-5).map((f) => f.text).join("; ") || "no facts yet";
        return `I remember: ${who}. Items I have seen: ${things}. And that ${facts}.`;
      },
      onWipeMemory: () => {
        memory.wipeAll();
        identityRef.current = null;
        setPeopleCount(0);
        setFactsCount(0);
        setItemsCount(0);
        return "Memory wiped clean. We start fresh as strangers.";
      },
      describeScene: () => {
        const objs = visionRef.current?.objects ?? [];
        if (objs.length === 0) return "I do not see any items right now. Try: scan the room.";
        const named = objs.map((o) => ({ o, m: memory.snapshot.items.find((i) => i.label === o.label) }));
        // spatial relations from her map: things that sit near each other
        const withPos = named.filter((n) => n.m?.pos);
        if (withPos.length >= 2) {
          let bestA = withPos[0], bestB = withPos[1], bestD = 99;
          for (let i = 0; i < withPos.length; i++) {
            for (let j = i + 1; j < withPos.length; j++) {
              const dpos = Math.hypot(
                (withPos[i].m?.pos?.x ?? 0) - (withPos[j].m?.pos?.x ?? 0),
                (withPos[i].m?.pos?.y ?? 0) - (withPos[j].m?.pos?.y ?? 0),
              );
              if (dpos < bestD) { bestD = dpos; bestA = withPos[i]; bestB = withPos[j]; }
            }
          }
          if (bestD < 0.5) {
            const na = bestA.m?.customName ?? bestA.o.label;
            const nb = bestB.m?.customName ?? bestB.o.label;
            return `I can see a ${na} near the ${nb}. They are about ${bestD.toFixed(1)} meters apart.`;
          }
        }
        const names = named.map((n) => n.m?.customName ?? n.o.label);
        return `I can see: ${names.join(", ")}.`;
      },
      onNameObject: (n) => {
        const it = memory.renameMostRecentItem(n);
        return it ? `Noted. The ${it.label} is now called ${it.customName}.` : null;
      },
      hazardReport: (personVisible) => {
        const known = memory.knownHazards();
        const visibleNow = (visionRef.current?.objects ?? []).filter((o) => HAZARD_LABELS.includes(o.label));
        const faces = (visionRef.current?.faces ?? []).length;
        const parts: string[] = [];
        if (visibleNow.length > 0) {
          parts.push(`CAUTION: I can see a ${visibleNow.map((o) => o.label).join(" and a ")} right now${faces > 0 ? " — and a person is near it" : ""}.`);
        }
        if (known.length > 0) {
          const list = known.slice(-3).map((h) => `${h.name} (${h.agoSec < 60 ? "just seen" : `${Math.round(h.agoSec / 60)} min ago`})`).join(", ");
          parts.push(`Hazards on my map: ${list}.`);
        }
        if (parts.length === 0) {
          return personVisible || faces > 0
            ? "Room check: no dangerous objects visible. The only thing here that could fall from the sky is me, and I do not intend to."
            : "All clear. No hazards on my map, none in view. The room is safe.";
        }
        return parts.join(" ");
      },
      zoneQuery: (query) => {
        const zones = petMapRef.current.getZones();
        const zone = zones.find((z2) => query.includes(z2.name) || z2.itemLabels.some((l) => query.includes(l)));
        if (!zone) return null;
        return `The ${zone.name} has: ${zone.itemLabels.join(", ")}.`;
      },
      gotoZone: (zoneName) => {
        const zone = petMapRef.current.getZones().find((z2) => zoneName.includes(z2.name) || z2.itemLabels.some((l) => zoneName.includes(l)));
        if (!zone) return null;
        const yaw = zone.x != null && zone.y != null ? Math.atan2(zone.y, zone.x) : null;
        const pos = zone.x != null && zone.y != null ? { x: zone.x, y: zone.y, z: 0.8 } : null;
        const task = brainRef.current!.runner.planGoto(zone.name, yaw, pos);
        if (!task) return null;
        brainRef.current!.runner.start(task, performance.now());
        return `Navigating to the ${zone.name}.`;
      },
      investigateSound: (kind) => {
        const dir = soundWatchRef.current.lastDirection > 0 ? "left" : "right";
        return `Investigating a ${kind} from the ${dir}. Flying to check.`;
      },
      anticipateGaze: (fvx, fvy) => {
        if (Math.abs(fvx) > 0.04 && Math.abs(fvy) > 0.02) {
          const dir = fvx > 0 ? "right" : "left";
          return `You're heading ${dir}. I'll lead the way.`;
        }
        return null;
      },
      balanceReport: () => {
        const p = poseRef.current;
        const tiltDeg = Math.hypot(p.pitch, p.roll) * 57.3;
        const verdict = tiltDeg < 1 ? "perfectly balanced" : tiltDeg < 6 ? "within limits — self-leveling active" : "recovering from a knock";
        return `Altitude ${p.z.toFixed(2)} meters. Tilt ${tiltDeg.toFixed(1)} degrees. ${verdict}.`;
      },
      whereIs: (target) => {
        const t = target.toLowerCase().trim();
        const from = { x: halRef.current.pose().x, y: halRef.current.pose().y };
        const hit = memory.nearestItem(
          (i) => t.includes(i.label) || i.label.includes(t) || (i.customName ? t.includes(i.customName.toLowerCase()) : false),
          from,
        );
        if (!hit) return `I have never seen a ${t}. Try: scan the room.`;
        const ago = Math.round((Date.now() - hit.lastSeen) / 1000);
        const name = memory.displayName(hit);
        return ago < 6
          ? `Your ${name} is in view right now.`
          : `I last saw your ${name} ${ago < 60 ? `${ago} seconds` : `${Math.round(ago / 60)} minutes`} ago.`;
      },
      whereYaw: (target) => {
        const t = target.toLowerCase().trim();
        const hit = memory.snapshot.items.find(
          (i) => t.includes(i.label) || i.label.includes(t) || (i.customName ? t.includes(i.customName.toLowerCase()) : false)
        );
        return hit?.lastYaw ?? null;
      },
      wherePos: (target) => {
        const t = target.toLowerCase().trim();
        const from = { x: halRef.current.pose().x, y: halRef.current.pose().y };
        const hit = memory.nearestItem(
          (i) => t.includes(i.label) || i.label.includes(t) || (i.customName ? t.includes(i.customName.toLowerCase()) : false),
          from,
        );
        return hit?.pos ?? null;
      },
      dockPose: () => DOCK,
      profile: {
        get: () => memory.getProfile(),
        update: (dw, db, bondAbs) => memory.updateProfile(dw, db, bondAbs),
      },
      onCorrection: (heard, understood) => pushLog("sys", `heard \u201c${heard}\u201d \u2192 understood \u201c${understood}\u201d`),
      noteBehavior: (pid, kind, detail) => memory.noteBehavior(pid, kind, detail),
      behaviorSummary: (pid) => memory.behaviorSummary(pid),
      greetMorning: () => memory.greetMorning(),
      dailyReport: () => memory.dailyReport(),
      getDream: () => memory.getDream(),
      yesterdayReport: () => memory.yesterdayReport(),
      learnPhrase: (heard, means) => memory.learnPhrase(heard, means),
      getLearnedPhrases: () => memory.getLearnedPhrases(),
      flightGrade: (drill, score) => memory.flightGrade(drill, score),
      getFlightTuning: () => memory.getFlightTuning(),
      setFlightTuning: (patch) => memory.setFlightTuning(patch),
      getFlightScores: () => memory.getFlightScores(),
      getChatterWeights: () => memory.getChatterWeights(),
      reinforceChatter: (cat, responded) => memory.reinforceChatter(cat, responded),
      addRoutine: (label, task, everyMin) => memory.addRoutine(label, task, everyMin),
      getRoutines: () => memory.listRoutines(),
      setRoutineLastRun: (id, at) => memory.touchRoutine(id, at),
      removeRoutine: (idOrLabel) => { const ok = memory.removeRoutine(idOrLabel); setRoutinesCount(memory.listRoutines().length); return ok; },
    });
  }
  const brain = brainRef.current;

  const [tab, setTab] = useState<"senses" | "flight" | "mind" | "memory">("senses");
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [mood, setMood] = useState<Mood>("curious");
  const [activity, setActivity] = useState("hover");
  const [battery, setBattery] = useState(0.86);
  const [bond, setBond] = useState(0);
  const [safetyFlags, setSafetyFlags] = useState("");
  const [taskInfo, setTaskInfo] = useState<{ desc: string; step: string; done: number; total: number } | null>(null);
  const [flightStats, setFlightStats] = useState({ alt: 0, pitch: 0, roll: 0, rpm: 0 });
  const lastTaskKeyRef = useRef("");
  const poseRef = useRef<DronePose>({ x: 0, y: 0, z: 0, yaw: 0, bob: 0, pitch: 0, roll: 0 });
  const flightStatsKeyRef = useRef("");
  const [killed, setKilled] = useState(false);
  const [consentTopic, setConsentTopic] = useState<"camera" | "mic" | null>(null);
  const [consent, setConsent] = useState(memory.getConsent());
  const [peopleCount, setPeopleCount] = useState(memory.snapshot.people.length);
  const [factsCount, setFactsCount] = useState(memory.snapshot.facts.length);
  const [itemsCount, setItemsCount] = useState(memory.snapshot.items.length);
  const [scannerOn, setScannerOn] = useState(false);
  const [llmOn, setLlmOn] = useState(false);
  const [geniusOn, setGeniusOn] = useState(false);
  const [brainTier, setBrainTier] = useState<"smart" | "genius">("smart");
  const [deepEyesOn, setDeepEyesOn] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [soundEvent, setSoundEvent] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [chirpsOn, setChirpsOn] = useState(true);
  const [gestOn, setGestOn] = useState(false);
  const [persona, setPersona] = useState("SWEET");
  const [resent, setResent] = useState(0);
  const [routinesCount, setRoutinesCount] = useState(memory.snapshot.routines.length);
  const [localEarsOn, setLocalEarsOn] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [earQuality, setEarQuality] = useState<"fast" | "deep">("fast");
  const [bodyMode, setBodyMode] = useState<"sim" | "real">("sim");
  const [wsUrl, setWsUrl] = useState("ws://localhost:8765");
  const [linkState, setLinkState] = useState<"-" | "LINKED" | "NO LINK">("-");
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [musicOn, setMusicOn] = useState(false);
  const [integrity, setIntegrity] = useState<"" | "OK" | "DRIFT" | "BASELINE_CREATED">("");
  const [stretchCue, setStretchCue] = useState(0);
  const ambientRef = useRef<AmbientMusic | null>(null);
  const blackboxRef = useRef<Blackbox>(new Blackbox());
  const storytellerRef = useRef<Storyteller>(new Storyteller());
  const sunSaidHourRef = useRef(-1);
  const noiseNoteAtRef = useRef(0);
  const voiceAttributionRef = useRef<{ kind: string; at: number }>({ kind: "", at: 0 });
  const voiceSpeedRef = useRef(1.0);
  const lastWrapDayRef = useRef("");
  const estimatorRef = useRef<FlightTimeEstimator>(new FlightTimeEstimator());
  const estSampleAtRef = useRef(0);
  const diagRef = useRef<DiagnosticsResult | null>(null);
  const lastHapticTickRef = useRef(0);
  const missionRef = useRef<MissionExecutor>(new MissionExecutor());
  const spatialRef = useRef<SpatialMap>(new SpatialMap());
  const hapticsRef = useRef<HapticLink>(new HapticLink());
  const hapticsNoteRef = useRef("");
  const prevPoseRef = useRef<{ pose: { x: number; y: number; z: number }; at: number } | null>(null);
  const measuredVelRef = useRef({ x: 0, y: 0, z: 0 });
  const [wp, setWp] = useState({ x: 0.5, y: 0, z: 0.4, holdMs: 1500 });
  const [missionWps, setMissionWps] = useState<Waypoint[]>([]);
  const dreamRef = useRef<DreamResult | null>(null);
  const workSinceRef = useRef<number | null>(null);
  const lastPaceRef = useRef(0);
  const [neuralOn, setNeuralOn] = useState(false);
  const [neuralVoiceId, setNeuralVoiceId] = useState("af_heart");
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [log, setLog] = useState<LogEntry[]>([
    { who: "sys", text: "Zola online. Learning is LOCAL-ONLY; nothing leaves this device.", at: Date.now() },
  ]);

  const pushLog = useCallback((who: LogEntry["who"], text: string) => {
    setLog((l) => [...l.slice(-40), { who, text, at: Date.now() }]);
    logTailRef.current = [...logTailRef.current.slice(-8), { who, text }];
    if (who !== "sys") { memory.addChat(who, text); memory.countDaily("commands"); } // conversation + her daily story
  }, [memory]);

  const say = useCallback((text: string, opts?: { interrupt?: boolean }) => {
    if (!text) return;
    const persona = brainRef.current?.getPersona() ?? "SWEET";
    // PIPER PACK first: her authentic drone-body voice for known lines
    void (async () => {
      const packReady = await piperPackRef.current.ensureLoaded();
      if (packReady) {
        const spoken = await piperPackRef.current.speak(text);
        if (spoken) return; // her real Pi voice handled it
      }
      // fallback: neural (Kokoro) only — no browser TTS
      if (neuralRef.current.loaded && neuralRef.current.enabled) {
        const speedByPersona: Record<string, number> = { GRUMPY: 0.9, DREAMING: 0.88, HYPER: 1.1, "ROAST MODE": 1.08, SULKING: 0.9, SKITTISH: 1.06 };
        neuralRef.current.setRate(speedByPersona[persona] ?? 1.0);
        const spoken = await neuralRef.current.speak(text, opts);
        if (!spoken) pushLog("sys", "neural voice unavailable — line shown in log only");
      } else {
        pushLog("sys", "no voice engine active — line shown in log only");
      }
    })();
    pushLog("aura", text);
    lastSayRef.current = { text, until: performance.now() + 3200 + Math.min(3000, text.length * 45) };
    brainRef.current?.addBond(0.015); // every exchange deepens the friendship (persisted)
  }, [pushLog, neuralRef]);

  const refreshCounts = useCallback(() => {
    setPeopleCount(memory.snapshot.people.length);
    setFactsCount(memory.snapshot.facts.length);
    setItemsCount(memory.itemCount());
  }, [memory]);

  /** Live context injected into every LLM prompt — the LLM knows what AURA knows. */
  const buildContext = useCallback(() => {
    const snap = memory.snapshot;
    const owner = snap.people.map((p) => p.name).join(", ") || "unknown (not introduced yet)";
    const items = snap.items.slice(-8).map((i) => `${i.customName ?? i.label}(${i.sightings})`).join(", ") || "none yet";
    const facts = snap.facts.slice(-6).map((f) => f.text).join("; ") || "none yet";
    const visible = (visionRef.current?.objects ?? []).map((o) => o.label).join(", ") || "nothing";
    // the emotional intelligence: she READS their face and responds to the
    // feeling — not just the words (the advanced sensors feed this)
    const emo = emotionFromTrack(trackRef.current);
    const emoLine = emo && emo.confidence > 0.35
      ? `Their expression right now: ${emo.emotion} (confidence ${(emo.confidence * 100).toFixed(0)}%${emo.stress > 0.4 ? `, stress ${(emo.stress * 100).toFixed(0)}%` : ""}). Respond to HOW THEY FEEL first — the words are secondary.`
      : "";
    const today = memory.dailyReport() ?? "nothing happened yet today";
    const profile = memory.describeProfile();
    // the mode voice: her current mode's trait vector shapes HOW she speaks
    const cur = modeByName(persona);
    const t = cur?.traits;
    const voice = t
      ? `Your current mode: ${cur.name} (${cur.archetype}). Voice now: warmth ${Math.round(t.warmth * 100)}%, energy ${Math.round(t.energy * 100)}%, sass ${Math.round(t.sass * 100)}%, formality ${Math.round(t.formality * 100)}%. Speak from this mode's character — a ${t.sass > 0.7 ? "sharp-tongued" : t.warmth > 0.7 ? "warm" : "cool"} ${t.energy > 0.7 ? "energetic" : "measured"} presence.`
      : "";
    return `Owner: ${owner}. Known items: ${items}. Facts about owner: ${facts}. Today: ${today}. Relationship: ${profile}. Mood: ${brain.getMood()}. Activity: ${brain.getActivity()}. Visible right now: ${visible}. Battery: ${(batteryRef.current * 100).toFixed(0)}%. ${emoLine} ${voice}\nYou can also command yourself: diagnose, vlog, dream, story, sun, patrol, mood:<mood>, mode:<mode name>, mission:<text>, body:sim|real, recon:<topic>. 500 modes are in your constellation — shift when the moment calls for it, not on a schedule.`;
  }, [memory, brain, persona]);

  // v2.4 CORTEX — manual dream cycle (the auto-wrap runs at 17-19h; the
  // brain can now demand one on demand)
  const triggerDream = useCallback(() => {
    const cl = governorRef.current.currentLimits;
    const dream = runDreamCycle(
      blackboxRef.current.snapshot(),
      { geofenceRadius: cl.geofenceRadius, visionStaleLimit: cl.visionStaleLimit },
      (iso) => sunReport(new Date(iso)).phase,
    );
    dreamRef.current = dream;
    if (dream.verdict === "TUNED") {
      governorRef.current.setLimits(dream.tuning);
      memory.saveDreamTuning(dream.tuning);
      pushLog("sys", `dream tuning applied: ${dream.tuning.geofenceRadius !== undefined ? `fence ${dream.tuning.geofenceRadius.toFixed(2)} m ` : ""}${dream.tuning.visionStaleLimit !== undefined ? `vision window ${dream.tuning.visionStaleLimit} ms` : ""}`);
    }
    pushLog("aura", "dream cycle complete — today's events consolidated into tuning");
  }, [memory, pushLog]);

  /**
   * Apply an LLM decision (Ollama OR on-device). Returns false when the brain
   * produced nothing usable — caller then falls back to her reflexes instead
   * of going silent.
   */
  const applyDecision = useCallback((d: LlmDecision): boolean => {
    const act = (d.do ?? "none").trim();
    // v3.1 — the CORTEX registry first: any registered capability executes
    // here (the 500 persona-shifts + the system ops). Unregistered verbs
    // fall through to the legacy routing below.
    if (cortexRef.current.has(act)) {
      void cortexRef.current.execute(act).then((line) => {
        if (line) say(line);
        refreshCounts();
      });
      return true;
    }
    const SIMPLE = new Set(["come", "follow", "trick", "dance", "sleep", "wake", "hover", "scan", "cancel", "status", "patrol"]);
    let canonical = "";
    if (SIMPLE.has(act)) canonical = act === "cancel" ? "cancel task" : act === "scan" ? "scan the room" : act;
    else if (act.startsWith("find:")) canonical = `find ${act.slice(5).trim()}`;
    else if (act.startsWith("goto:")) canonical = `take me to ${act.slice(5).trim()}`;
    else if (act.startsWith("name:")) canonical = `this is ${act.slice(5).trim()}`;
    else if (act.startsWith("remember:")) canonical = `remember that ${act.slice(9).trim()}`;
    else if (act === "diagnose") { featuresRef.current.integrity?.(); if (!d.say) say("Integrity sweep running. Every asset, every byte, checked."); refreshCounts(); return true; }
    else if (act === "vlog") { featuresRef.current.vlog?.(); if (!d.say) say("Compiling today into her own words. The ledger gets a new page."); refreshCounts(); return true; }
    else if (act === "dream") { featuresRef.current.dream?.(); if (!d.say) say("Dream cycle engaged. Today becomes tuning."); refreshCounts(); return true; }
    else if (act === "story") { featuresRef.current.story?.(); refreshCounts(); return true; }
    else if (act === "sun") { const sr = sunReport(new Date()); say(`${sr.phase === "golden" ? "Golden hour. Best light of the day and I can see all of it." : `Sun phase: ${sr.phase}.`}`); refreshCounts(); return true; }
    else if (act.startsWith("gesture:")) {
      const g = act.slice(8).trim();
      if (featuresRef.current.gesture?.(g)) {
        if (!d.say) say(`${g.replace(/_/g, " ")} — coming right up.`);
        refreshCounts();
        return true;
      }
      return false;
    }
    else if (act.startsWith("mood:")) { const m = act.slice(5).trim() as Mood; brain.setMood(m); setMood(m); if (!d.say) say(`Mood set: ${m}. Feels right.`); refreshCounts(); return true; }
    else if (act.startsWith("mode:")) {
      const p = act.slice(5).trim();
      const mode = modeByName(p);
      if (mode) {
        setPersona(mode.name);
        if (!d.say) say(`Mode shift: ${mode.name} — ${mode.archetype.toLowerCase()} architecture. The ring already knows.`);
        refreshCounts();
        return true;
      }
      return false;
    }
    else if (act.startsWith("mission:")) { canonical = act.slice(8).trim(); }
    else if (act.startsWith("body:")) { const mode = act.slice(5).trim(); if (mode === "sim" || mode === "real") { setBodyMode(mode); if (!d.say) say(`Body mode: ${mode}. ${mode === "real" ? "Talk to me through the link." : "Back in the simulation."}`); refreshCounts(); return true; } return false; }
    else if (act.startsWith("recon:")) {
      const term = act.slice(6).trim();
      if (!term) return false;
      say(`Uncertainty-Gaze engaged. Querying the live grid about ${term}…`);
      void (async () => {
        const r = await webRecon(term);
        if (!r) { say(`The grid came back empty on ${term}. The uncertainty stays open.`); return; }
        if (r.learned) {
          brain.command(`remember that ${r.factLine}`, batteryRef.current);
          say(`Learned. ${r.extract.split(".")[0]}. Filed permanently — ask me again tomorrow.`);
        } else {
          say(`Already in my ledger: ${r.factLine}`);
        }
        refreshCounts();
      })();
      return true; // the async recon speaks for herself
    }

    if (!d.say && !canonical) return false; // garbage output → let reflexes answer

    if (d.say) say(d.say);
    if (canonical) {
      const reply = brain.command(canonical, batteryRef.current);
      if (reply) { if (d.say) pushLog("aura", reply); else say(reply); }
    }
    refreshCounts();
    return true;
  }, [say, pushLog, brain, refreshCounts]);

  const handleCommand = useCallback(async (text: string) => {
    pushLog("you", text);
    memory.countCommand();
    lastInteractionRef.current = performance.now(); // interaction resets SPONTANEA

    const hist = memory.recentChat(12);
    const history = (hist[hist.length - 1]?.text === text ? hist.slice(0, -1) : hist).map((h) => ({
      role: h.who === "you" ? ("user" as const) : ("assistant" as const),
      content: h.text,
    }));

    // Tier 1: Ollama (if installed) — strongest local brain
    // v3.2 SELF-ENGAGEMENT: the brain engages ITSELF the moment Ollama is
    // reachable — she is never unresponsive again (the old code needed a
    // manual toggle, so unknown input got silence)
    const llm = llmRef.current;
    if (!llm.enabled) {
      const ok = await llm.checkAvailable();
      if (ok) {
        llm.enabled = true;
        setLlmOn(true);
        pushLog("sys", "Tier-1 brain SELF-ENGAGED — Ollama detected, full intelligence online");
      }
    }
    if (llm.enabled && !llm.isOnline) await llm.checkAvailable(); // self-healing retry
    if (llm.enabled && llm.isOnline) {
      try {
        if (applyDecision(await llm.interpret(text, buildContext(), history))) return;
        pushLog("sys", "brain output unusable — reflexes answered instead");
      } catch {
        pushLog("sys", "LLM unreachable — trying her on-device brain");
      }
    }

    // Tier 2: GENIUS MODE — on-device language model, zero setup
    if (geniusOn && genieRef.current.loaded) {
      try {
        if (applyDecision(await genieRef.current.think(text, buildContext()))) return;
        pushLog("sys", "brain output unusable — reflexes answered instead");
      } catch {
        pushLog("sys", "on-device brain hiccup — reflexes took over");
      }
    }

    // DEEP EYES: "what do you see" / "what is this" — VLM description of the frame
    if (deepEyesOn && deepEyesRef.current.loaded && /^(what (do|is) (you|that|this|in)|describe|look carefully)/i.test(text)) {
      const q = /what is (this|that|it)/i.test(text)
        ? "What is the most prominent object in this image? Name it and describe it briefly."
        : undefined;
      void deepLook(q);
      return;
    }

    // WAKE WORD: "Zola!" grabs her attention instantly — like calling a pet.
    const wm = /\bzola\b/i.exec(text);
    if (wm) {
      const rest = text.slice(wm.index + wm[0].length).replace(/^[,!.?\s]+/, "").trim();
      if (rest.length >= 3) {
        pushLog("sys", "wake word — attention grabbed, processing the rest");
        return handleCommand(rest);
      }
      const line = brain.attend();
      say(line);
      chirpsRef.current.chirp("curious");
      flash("WAKE WORD → ATTENTION");
      return;
    }

    // WAVE 10 — mission voice override: "abort mission" releases control instantly
    if (/\b(cancel|abort|stop)\b[\s\S]*\bmission\b/i.test(text)) {
      say(missionRef.current.abort("manual override"), { interrupt: false });
      pushLog("aura", "mission override — control released to manual/reactive flight");
      return;
    }

    // WAVE 3 — STORYTELLING: her room is the game board; Ollama writes when online,
    // a procedural weaver when offline. "tell me a story" begins, "continue" advances.
    if (/\b(story|tale|once upon)\b/i.test(text) && !/\bend\b/i.test(text)) {
      const snap = memory.snapshot;
      const ctx = {
        places: (petMapRef.current?.getZones() ?? []).map((z) => z.name),
        items: snap.items.slice(-8).map((i) => i.customName ?? i.label),
        people: snap.people.map((p) => p.name),
        mood,
      };
      const beat = await storytellerRef.current.next(ctx, {
        online: llmRef.current.isOnline,
        complete: (p, n) => llmRef.current.complete(p, n),
      });
      say(beat);
      pushLog("aura", `story beat ${storytellerRef.current.beatCount} (${llmRef.current.isOnline ? "llm-written" : "procedurally woven"})`);
      refreshCounts();
      return;
    }
    if (/\b(show me my day|how was (your|my) day|my day so far)\b/i.test(text)) {
      const v = buildVlogInput();
      say(spokenDaySummary(v));
      pushLog("aura", "day summary spoken (micro-vlog headline)");
      return;
    }
    if (/^(the end|end the story|finish the story)\b/i.test(text.trim())) {
      const snap = memory.snapshot;
      say(storytellerRef.current.end({
        places: [], items: snap.items.slice(-8).map((i) => i.customName ?? i.label), people: [], mood,
      }));
      return;
    }

    // Tier 3: reflex brain (deterministic fallback, always available)
    // v3.2 — the fallback NEVER goes silent: an unmatched input gets an
    // in-character response + the honest pointer, spoken AND logged.
    const reply = brain.command(text, batteryRef.current);
    if (reply) {
      say(reply);
      refreshCounts();
    } else {
      say("I heard you — that phrasing is beyond my reflexes right now. My big brain handles it once Ollama is engaged. Meanwhile: come here · follow me · find my cup · what do you see.", { interrupt: false });
      pushLog("sys", "unrecognized — reflexes have no match; spoken guidance given");
      setBond((b) => Math.min(1, b + 0.005));
    }
  }, [pushLog, say, brain, memory, buildContext, refreshCounts]);

  const toggleGenius = useCallback(async () => {
    if (geniusOn) {
      setGeniusOn(false);
      pushLog("sys", "genius mode off — reflex brain active");
      return;
    }
    const ok = await genieRef.current.load((m) => pushLog("sys", m), brainTier);
    if (ok) {
      setGeniusOn(true);
      pushLog("sys", "on-device thinking can take a few seconds per reply on slower GPUs");
      say("My big brain is in. Ask me anything at all.");
    }
  }, [geniusOn, brainTier, pushLog, say]);

  /** Upgrade the on-device brain: SMART (0.5B) -> GENIUS (1.5B, ~3x smarter). */
  const upgradeBrain = useCallback(async () => {
    const next = brainTier === "smart" ? "genius" : "smart";
    setBrainTier(next);
    pushLog("sys", next === "genius"
      ? "upgrading her brain to GENIUS-XL (~1 GB download, noticeably smarter)"
      : "brain back to SMART — snappier replies");
    if (geniusOn) {
      const ok = await genieRef.current.load((m) => pushLog("sys", m), next);
      if (ok) say(next === "genius" ? "Bigger brain installed. I can feel the extra neurons." : "Compact brain restored. Still plenty smart.");
    }
  }, [brainTier, geniusOn, pushLog, say]);

  /** NEURAL VOICE — a real TTS model from the internet, on-device after download. */
  const toggleNeural = useCallback(async () => {
    if (neuralOn) {
      neuralRef.current.setEnabled(false);
      setNeuralOn(false);
      try { localStorage.setItem("aura.neuralVoice", "off"); } catch { /* noop */ }
      pushLog("sys", "neural voice off — back to browser voice");
      return;
    }
    const ok = await neuralRef.current.load((m) => pushLog("sys", m));
    if (ok) {
      try { localStorage.setItem("aura.neuralVoice", "on"); } catch { /* noop */ }
      setNeuralOn(true);
      say("This is my real voice now. Much better, right?");
    }
  }, [neuralOn, pushLog, say]);

  const toggleLlm = useCallback(async () => {
    const llm = llmRef.current;
    if (llm.enabled) {
      llm.enabled = false;
      setLlmOn(false);
      pushLog("sys", "reflex brain active (LLM disabled)");
      return;
    }
    const ok = await llm.checkAvailable();
    if (ok) {
      llm.enabled = true;
      setLlmOn(true);
      pushLog("sys", `LLM brain online: ${llm.model} (${(8).toFixed(0)}B-class, via Ollama — runs locally, nothing leaves your machine)`);
      say(`Big brain connected. I am running on ${llm.model} now. Ask me anything at all.`);
    } else {
      pushLog("sys", "Ollama unreachable — install from ollama.com, run `ollama pull llama3.2`, start with OLLAMA_ORIGINS=* ollama serve. Reflex brain stays active meanwhile.");
    }
  }, [pushLog, say]);

  // ---- consent gate ------------------------------------------------------------
  const requestConsent = useCallback((topic: "camera" | "mic", proceed: () => void) => {
    if (memory.getConsent()[topic]) { proceed(); return; }
    (requestConsent as unknown as { _pending?: () => void })._pending = proceed;
    setConsentTopic(topic);
  }, [memory]);

  const grantConsent = useCallback((granted: boolean) => {
    if (!consentTopic) return;
    memory.grantConsent({ [consentTopic]: granted, ...(consentTopic === "camera" ? { faceIndex: granted } : {}) });
    setConsent(memory.getConsent());
    const pending = (requestConsent as unknown as { _pending?: () => void })._pending;
    setConsentTopic(null);
    if (granted) pending?.();
    else pushLog("sys", `consent denied — ${consentTopic} stays offline`);
  }, [consentTopic, memory, pushLog, requestConsent]);

  // ---- main loop: perceive -> SAFETY GATE -> actuate -> render ------------------
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const last = lastTickRef.current || now;
      const dt = Math.min(0.05, (now - last) / 1000);
      lastTickRef.current = now;

      const actName = brain.getActivity();
      if (bodyModeRef.current === "real") {
        // real drone: battery comes from telemetry, not simulation
        const b = poseRef.current.battery;
        if (typeof b === "number" && b > 0) {
          batteryRef.current = b;
          // WAVE 7 — feed the flight-time estimator with REAL drain (1 Hz)
          if (now - estSampleAtRef.current > 1000) {
            estSampleAtRef.current = now;
            estimatorRef.current.sample(b * 100, Date.now(), actName !== "sleep" && actName !== "dock");
          }
        }
      } else {
        const perched = actName === "sleep" || (actName === "dock" && poseRef.current.z < 0.06);
        if (perched) {
          batteryRef.current = Math.min(1, batteryRef.current + dt * 0.012); // charging on the pad
          memory.noteBatteryPhase("charge", batteryRef.current);
        } else {
          batteryRef.current = Math.max(0.02, batteryRef.current - dt * 0.0016);
          memory.noteBatteryPhase("discharge", batteryRef.current);
        }
      }

      // self-hearing suppression: her own voice never enters her ears
      if (neuralRef.current.isSpeaking() || piperPackRef.current.isSpeaking()) speakTailUntil = now + 500;
      localEarsRef.current.muted = now < speakTailUntil;
      // hover engine ambience follows her altitude (library SFX)
      // engineRef wiring pending in the AURA session

      const t = trackRef.current;
      const poseNow = halRef.current.pose();
      // WAVE 11 — MEASURED velocity: pose deltas over the real frame interval
      // (no model, no assumption — the derivative of where she actually was)
      const prevP = prevPoseRef.current;
      if (prevP && now - prevP.at > 0) {
        const s = (now - prevP.at) / 1000;
        measuredVelRef.current = {
          x: (poseNow.x - prevP.pose.x) / s,
          y: (poseNow.y - prevP.pose.y) / s,
          z: (poseNow.z - prevP.pose.z) / s,
        };
      }
      prevPoseRef.current = { pose: { x: poseNow.x, y: poseNow.y, z: poseNow.z }, at: now };
      // WAVE 11 — wire the predictive governor to the occupancy map
      governorRef.current.setPredictor((px, py, pz) => {
        // probe the predicted position and a point halfway there
        if (spatialRef.current.isOccupied(px, py, pz)) return { decel: 0.25, reason: "PREDICTED OCCUPIED VOXEL · HARD DECEL" };
        const mid = { x: poseNow.x + (px - poseNow.x) / 2, y: poseNow.y + (py - poseNow.y) / 2, z: poseNow.z + (pz - poseNow.z) / 2 };
        if (spatialRef.current.isOccupied(mid.x, mid.y, mid.z)) return { decel: 0.5, reason: "PREDICTED OCCUPIED VOXEL · DECEL" };
        return null;
      });
      // WAVE 7 — vision freshness: ms since her pipeline last saw anything
      const visionStaleMs = visionRef.current?.active
        ? performance.now() - lastVisionEventRef.current
        : undefined;
      governorRef.current.setVisionFeed(!!visionRef.current?.active);
      const percept = {
        visionStaleMs,
        faceSeen: t.seen,
        faceX: t.x,
        faceY: t.y,
        faceSize: t.size,
        battery: batteryRef.current,
        now,
        say: null as string | null,
        identities: identityListRef.current,
        visibleItems: (visionRef.current?.objects ?? []).map((o) => o.label),
        yaw: poseNow.yaw,
        px: poseNow.x,
        py: poseNow.y,
        pz: poseNow.z,
        expression: t.expression,
      };
      const brainAct = brain.perceive(percept);
      // WAVE 10 — MISSION EXECUTOR: proposes actuation; the governor still decides.
      // While a mission runs, her flight vectors come from the state machine —
      // mood/LED stay hers. Hold/pause phases are a zero-motion hover, which lets
      // the governor's own safe-return vectors act unmolested.
      let missionAct: MissionAct | null = null;
      if (missionRef.current.active()) {
        const m = missionRef.current.tick(poseNow, dt, now);
        if (m.event) { say(m.event, { interrupt: false }); flash(m.event.toUpperCase()); }
        missionAct = m.act;
      }
      const act = missionAct
        ? { ...brainAct, vx: missionAct.vx, vy: missionAct.vy, vz: missionAct.vz, yaw: missionAct.yaw }
        : missionRef.current.active()
          ? { ...brainAct, vx: 0, vy: 0, vz: 0 }
          : brainAct;
      // "scan" activity auto-arms the scanner (once) and scans DENSELY
      if (visionRef.current?.active) {
        visionRef.current.scanIntervalMs = act.activity === "scan" ? 250 : 600;
      }
      if (act.activity === "scan" && visionRef.current?.active && !visionRef.current.scanning && !autoScanTried.current) {
        autoScanTried.current = true;
        visionRef.current.enableScanner().then((ok) => { setScannerOn(ok); autoScanTried.current = false; });
      }
      const { act: safeAct, flags } = governorRef.current.gate(act, percept);
      halRef.current.apply(safeAct, dt);
      if (act.say) say(act.say);
      setMood(safeAct.mood);
      setActivity(safeAct.activity);
      setBattery(batteryRef.current);
      // WAVE 2 — theory-of-mood: focused human shown in the safety row
      const focusFlag = brain.humanFocused ? "HUMAN FOCUSED · HOLDING CHATTER" : "";
      const flagStr = [flags.join(" · "), focusFlag].filter(Boolean).join(" · ");
      setSafetyFlags((f) => (f === flagStr ? f : flagStr));
      // WAVE 7 — announce entering visual hold (once per episode, never nagging)
      const holding = flags.some((f) => f.startsWith("VISUAL HOLD"));
      if (holding && !prevVisualHoldRef.current) {
        chirpsRef.current.chirp("alert");
        flash("VISUAL CONFIDENCE LOW — HOLDING");
        pushLog("sys", "self-safeguard: vision feed went quiet — inertial hold until detections resume");
      }
      prevVisualHoldRef.current = holding;
      // WAVE 10 — override handoff: safety flags PAUSE the mission (holding
      // pattern); clean sky resumes it. Kill switch aborts it outright.
      if (missionRef.current.active()) {
        const breach = flags.some((f) => /GEOFENCE BREACH|VISUAL HOLD|CRITICAL/.test(f));
        if (breach) missionRef.current.pause(flags.join(" · "));
        else missionRef.current.maybeResume(true);
        if (governorRef.current.isKilled) {
          const line = missionRef.current.abort("kill switch engaged");
          if (line.startsWith("Mission")) say(line, { interrupt: false });
        }
      }
      // WAVE 2 — telemetry black-box sampling (~2 Hz, local ring buffer)
      blackboxRef.current.record(
        { mood: safeAct.mood, activity: safeAct.activity, battery: batteryRef.current,
          alt: poseNow.z, yaw: poseNow.yaw, px: poseNow.x, py: poseNow.y,
          pitch: poseNow.pitch * 57.2958, roll: poseNow.roll * 57.2958,
          flags: flags.length > 0 ? flags.join(",") : undefined },
        now,
      );
      // WAVE 8 — AUTONOMOUS POST-FLIGHT DIAGNOSTICS: the moment she lands or
      // docks after real flight time, the black-box ring is analyzed for free.
      const airborne = !["dock", "sleep"].includes(safeAct.activity);
      if (!airborne && prevActivityRef.current !== safeAct.activity &&
          !["dock", "sleep", "hover"].includes(prevActivityRef.current)) {
        const diag = runDiagnostics(blackboxRef.current.snapshot(), bodyModeRef.current as "sim" | "real");
        diagRef.current = diag;
        say(diag.headline, { interrupt: false });
        pushLog("aura", `post-flight diagnostics: ${diag.verdict} — ${diag.lines.length} checks run on ${blackboxRef.current.size} samples`);
      }

      // WAVE 11 — cybernetic haptic link: RPM rumble + fence-proximity pulses.
      // Fires ONLY through a physically connected gamepad's vibration actuator;
      // with no controller, HapticLink is dormant and says so.
      if (now - lastHapticTickRef.current > 240) {
        lastHapticTickRef.current = now;
        const hf = hapticsRef.current.tick(
          halRef.current.propsRpm() > 600,
          halRef.current.propsRpm(),
          Math.min(1, Math.hypot(poseNow.x, poseNow.y) / 1.2),
          flags.some((f) => /CRITICAL|VISUAL HOLD/.test(f)),
          now,
        );
        if (hf && hapticsNoteRef.current !== hf) {
          hapticsNoteRef.current = hf;
          pushLog("sys", `haptic link: ${hf} (gamepad vibration — real actuator, real telemetry)`);
        }
      }

      // persona + trust meter (render only on change)
      const per = brain.getPersona();
      setPersona((p) => (p === per ? p : per));
      const res = brain.persona.resentment;
      setResent((r) => (Math.abs(r - res) < 0.01 ? r : res));

      // mood-change feedback: real library samples (suppressed in quiet mode)
      if (safeAct.mood !== prevMoodRef.current) {
        prevMoodRef.current = safeAct.mood;
        memory.setLastMood(safeAct.mood);
        if (!brain.isQuiet && safeAct.mood !== "idle") {
          sfxFilesRef.current.playMood(safeAct.mood);
          if (chirpsRef.current.enabled) chirpsRef.current.chirpForMood(safeAct.mood);
        }
      }
      // remember what she was doing — for the "where were we" resume
      memory.setLastSession(
        safeAct.activity,
        brain.runner.current?.steps.map((s) => s.label).join(" → ") ?? safeAct.activity,
      );

      // SLEEP CONSOLIDATION: docking/sleeping tidies her memory and composes a dream
      if (safeAct.activity === "sleep" && prevActivityRef.current !== "sleep") {
        memory.consolidate();
        pushLog("sys", "sleep consolidation: stale memories pruned, dream composed");
      }
      prevActivityRef.current = safeAct.activity;

      // task HUD (re-render only when progress changes)
      const task = brain.runner.current;
      const tKey = task ? `${task.id}:${task.steps.filter((s) => s.done).length}` : "";
      if (lastTaskKeyRef.current !== tKey) {
        lastTaskKeyRef.current = tKey;
        setTaskInfo(task
          ? {
              desc: task.description,
              step: task.steps.find((s) => !s.done)?.label ?? "finishing",
              done: task.steps.filter((s) => s.done).length,
              total: task.steps.length,
            }
          : null);
      }

      renderDrone(safeAct.led);
      renderCamOverlay(safeAct.led);
      renderMiniMap();

      // engine ambience + self-hearing cover her own SFX too
      const engineOn = safeAct.activity !== "sleep" && safeAct.activity !== "dock" && poseRef.current.z > 0.06 && !killed;
      if (engineOn !== lastEngineState) {
        lastEngineState = engineOn;
        chirpsRef.current.setEngine(engineOn);
      }

      // she initiates conversation when idle with you present —
      // composed LIVE by her LLM brain when available, her classic lines otherwise
      if (now - lastProactiveCheck > 2000) {
        lastProactiveCheck = now;
        // WAVE 5 — counterfactual curiosity context: first visible thing she has
        // no memory record of (labels are matched against her item memory)
        const knownLabels = new Set(memory.snapshot.items.map((i) => (i.customName ?? i.label).toLowerCase()));
        const unknownObject = percept.visibleItems.find((l) => !knownLabels.has(l.toLowerCase()));
        const chatter = brain.proactiveTick({ now, faceSeen: t.seen, visibleItems: percept.visibleItems, unknownObject });
        if (chatter) {
          const llm = llmRef.current;
          if (llm.enabled && llm.isOnline && chatter.category === "curious" && unknownObject) {
            // LLM writes the hypothesis; the trained line is the fallback
            void llm.complete(
              `You are Zola, a small flying robot pet. You just noticed a "${unknownObject}" near your human that is not in your memory. ` +
              `In ONE short playful sentence: state a counterfactual guess about what it might be, then ask a short verification question. No preamble.`,
              90,
            ).then((live) => say(live || chatter.line, { interrupt: false })).catch(() => say(chatter.line, { interrupt: false }));
          } else if (llm.enabled && llm.isOnline) {
            void llm.chatter(buildContext()).then((live) => {
              say(live ?? chatter.line, { interrupt: false }); // a thought-up line, or the trained repertoire
            });
          } else {
            say(chatter.line, { interrupt: false });
          }
        }
        setBond(brain.bond); // bond is the brain's — persisted, no longer reset by reload
      }

      // attitude telemetry (throttled state updates)
      const ps = poseRef.current;
      const key = `${ps.z.toFixed(2)}|${(ps.pitch * 57.3 / 4).toFixed(0)}|${(ps.roll * 57.3 / 4).toFixed(0)}|${(halRef.current.propsRpm() / 120).toFixed(0)}`;
      if (key !== flightStatsKeyRef.current) {
        flightStatsKeyRef.current = key;
        setFlightStats({ alt: ps.z, pitch: ps.pitch * 57.3, roll: ps.roll * 57.3, rpm: halRef.current.propsRpm() });
      }
    };

    let lastProactiveCheck = 0;
    let speakTailUntil = 0; // she can't hear herself speak
    let lastEngineState: boolean | null = null;
    // library ground texture for her flight room (ambientCG Ground077)
    const groundImg = new Image();
    let groundReady = false;
    groundImg.onload = () => { groundReady = true; };
    groundImg.src = "/textures/ground077.jpg";
    const trail: { x: number; y: number }[] = [];

    /** Top-down mental map: room bounds, dock, obstacles, remembered items, her. */
    const renderMiniMap = () => {
      const cv = mapCanvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const w = cv.width, h = cv.height;
      const toX = (wx: number) => ((wx + ROOM_EXTENT) / (ROOM_EXTENT * 2)) * w;
      const toY = (wy: number) => ((ROOM_EXTENT - wy) / (ROOM_EXTENT * 2)) * h;

      ctx.fillStyle = "#0b0e17";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(240,185,11,0.3)";
      ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.strokeStyle = "rgba(240,185,11,0.07)";
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo((w / 4) * i, 0); ctx.lineTo((w / 4) * i, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke();
      }

      // dock pad
      ctx.fillStyle = "#f0b90b";
      ctx.fillRect(toX(DOCK.x) - 5, toY(DOCK.y) - 5, 10, 10);
      ctx.font = "8px monospace";
      ctx.fillStyle = "rgba(240,185,11,0.85)";
      ctx.fillText("DOCK", toX(DOCK.x) + 7, toY(DOCK.y) + 3);

      // obstacles
      for (const o of petMapRef.current.all()) {
        ctx.beginPath();
        ctx.arc(toX(o.x), toY(o.y), (o.r / ROOM_EXTENT) * (w / 2), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(139,143,156,0.55)";
        ctx.fill();
      }

      // remembered item positions (her mental inventory, placed in the room)
      for (const it of memory.snapshot.items) {
        if (!it.pos) continue;
        ctx.beginPath(); ctx.arc(toX(it.pos.x), toY(it.pos.y), 3, 0, Math.PI * 2);
        ctx.fillStyle = "#5ac8fa"; ctx.fill();
        ctx.fillStyle = "rgba(90,200,250,0.85)";
        ctx.fillText((it.customName ?? it.label).slice(0, 12), toX(it.pos.x) + 5, toY(it.pos.y) + 3);
      }

      // her, with heading
      const pose = poseRef.current;
      ctx.save();
      ctx.translate(toX(pose.x), toY(pose.y));
      ctx.rotate(-pose.yaw);
      ctx.fillStyle = "#35d0a5";
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    };

    const renderDrone = (led: string) => {
      const cv = droneCanvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const w = cv.width, h = cv.height;
      ctx.clearRect(0, 0, w, h);

      // library ground texture (ambientCG Ground077) under everything
      if (groundReady) {
        ctx.globalAlpha = 0.15;
        ctx.drawImage(groundImg, 0, 0, w, h);
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = "rgba(240,185,11,0.08)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const y = (h / 8) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      for (let i = 0; i <= 12; i++) {
        const x = (w / 12) * i;
        ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(w / 2 + (x - w / 2) * 0.4, h * 0.45); ctx.stroke();
      }

      // geofence ceiling line — the governor's hard limit, made visible
      const ceilingY = h * 0.62 - DEFAULT_LIMITS.maxAltitude * (h * 0.5);
      ctx.strokeStyle = "rgba(255,77,79,0.35)";
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(0, ceilingY); ctx.lineTo(w, ceilingY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,77,79,0.5)";
      ctx.font = "8px monospace";
      ctx.fillText("GEOFENCE CEILING", 6, ceilingY - 4);

      const pose: DronePose = halRef.current.pose();
      poseRef.current = pose;
      const dx = w / 2 + (pose.y / 1.6) * (w * 0.36);
      const dy = h * 0.62 - (pose.z + pose.bob) * (h * 0.5);
      const scale = 0.75 + pose.z * 0.45;
      const rpm = halRef.current.propsRpm();

      // motion trail — she paints her flight path
      trail.push({ x: dx, y: dy });
      if (trail.length > 34) trail.shift();
      if (trail.length > 2) {
        for (let i = 1; i < trail.length; i++) {
          const alpha = (i / trail.length) * 0.28;
          ctx.strokeStyle = hexA(led, alpha);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
      }

      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(pose.roll * 0.55); // she banks into her own motion

      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(0, (h * 0.62 - dy) + h * 0.3, 26 * scale, 6 * scale, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowColor = led;
      ctx.shadowBlur = 14;
      ctx.fillStyle = led;
      ctx.beginPath(); ctx.arc(-7 * scale, 0, 3.4 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7 * scale, 0, 3.4 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "#1c2130";
      ctx.strokeStyle = "#3a4258";
      ctx.lineWidth = 1.5;
      roundRect(ctx, -14 * scale, -5 * scale, 28 * scale, 10 * scale, 4 * scale);
      ctx.fill(); ctx.stroke();

      const spin = Math.atan(performance.now() / (rpm > 800 ? 6 : 40));
      const arm = 20 * scale;
      const props: [number, number][] = [[-arm, -arm * 0.5], [arm, -arm * 0.5], [-arm, arm * 0.5], [arm, arm * 0.5]];
      ctx.strokeStyle = "#59627a";
      for (const [px, py] of props) {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(px, py); ctx.stroke();
        ctx.strokeStyle = "rgba(240,185,11,0.55)";
        ctx.beginPath();
        ctx.ellipse(px, py, 11 * scale, 2.6 * scale, spin, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "#59627a";
      }
      ctx.restore();

      // speech bubble — visual output for everything AURA says
      const s = lastSayRef.current;
      if (s.text && s.until > performance.now()) {
        ctx.font = "10px monospace";
        const tw = ctx.measureText(s.text).width;
        const bx = Math.min(w - tw - 24, Math.max(8, dx - tw / 2 - 8));
        const by = Math.max(10, dy - 46 * scale - 14);
        ctx.fillStyle = "rgba(10,13,22,0.88)";
        ctx.strokeStyle = led;
        ctx.lineWidth = 1;
        roundRect(ctx, bx, by, tw + 16, 20, 6);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#e9e7dc";
        ctx.fillText(s.text, bx + 8, by + 13);
      }
    };

    const renderCamOverlay = (led: string) => {
      const cv = camCanvasRef.current;
      if (!cv || !visionRef.current?.active) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const primary = identityListRef.current[0];
      const label = primary?.known ? primary.name ?? "RECOGNIZED" : undefined;
      visionRef.current.drawOverlay(ctx, cv.width, cv.height, led, label, visionRef.current.scanning);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- camera lifecycle (consent-gated) ---------------------------------------
  const toggleCamera = useCallback(async () => {
    if (visionRef.current?.active) {
      visionRef.current.stop();
      setCamOn(false);
      identityRef.current = null;
      pushLog("sys", "camera detached — Zola is blind");
      return;
    }
    requestConsent("camera", async () => {
      const v = visionRef.current ?? new DroneVision();
      visionRef.current = v;
      v.onError = (m) => { setVisionError(m); pushLog("sys", m); };
      v.onDetections = (dets) => {
        // WAVE 7 — any detection refreshes her vision-freshness clock
        lastVisionEventRef.current = performance.now();
        // scanner learning: record everything seen (certain AND uncertain)
        const seen = new Set<string>();
        for (const d of dets) {
          if (seen.has(d.label)) continue;
          seen.add(d.label);
          // spatial + identity memory: world position AND color signature
          const pose = halRef.current.pose();
          const dist = Math.max(0.5, Math.min(2.5, 0.55 / Math.max(0.06, d.h)));
          // WAVE 11 — the bbox x-offset steers the sightline within her ~60° FOV:
          // a detection at the frame edge lies along a different ray than one
          // centered — this is the honest monocular geometry
          const fovOffset = (d.x + d.w / 2 - 0.5) * 1.05; // ≈60° FOV, radians
          const sightYaw = pose.yaw + fovOffset;
          const pos = { x: pose.x + Math.cos(sightYaw) * dist, y: pose.y + Math.sin(sightYaw) * dist, z: pose.z };
          // WAVE 11 — occupancy: integrate the TRUE sightline (free along the
          // ray, occupied at the resolved surface) + bind the semantic anchor
          spatialRef.current.markRay({ x: pose.x, y: pose.y, z: pose.z }, pos);
          if (d.certain) spatialRef.current.anchor(d.label, pos);
          // self-learned obstacles: scanned items mark her own map (not near dock)
          petMapRef.current.addSoft(pos.x, pos.y, 0.08 + dist * 0.06);
          const { item, isNew, moved } = memory.learnItem(d.label, pose.yaw, pos, d.sig, d.shape);
          // HARM AWARENESS: dangerous objects get marked + a red standoff zone
          if (d.certain && HAZARD_LABELS.includes(d.label)) {
            memory.markHazard(item);
            petMapRef.current.addHazard(pos.x, pos.y, 0.15);
            const personVisible = trackRef.current.seen || (visionRef.current?.faces ?? []).length > 0;
            const line = brain.hazardNotice(d.label, personVisible);
            if (line) { say(line, { interrupt: false }); chirpsRef.current.chirp("alert"); flash(`HAZARD: ${d.label.toUpperCase()}`); }
          }
          if (isNew) {
            setItemsCount(memory.itemCount());
            memory.countDaily("items");
            const sameLabel = memory.snapshot.items.filter((i) => i.label === d.label).length;
            say(sameLabel > 1
              ? `Another ${d.label}! That is ${memory.displayName(item)}. Remembering it separately.`
              : brain.newObjectLine(d.label, d.sig, d.shape));
          } else if (moved && !movedAnnouncedRef.current.has(item.id)) {
            // CHANGE DETECTION: the same object, somewhere new
            movedAnnouncedRef.current.add(item.id);
            say(`${memory.displayName(item)} moved! I last saw it somewhere else. Position updated. Noted.`, { interrupt: false });
            chirpsRef.current.chirp("curious");
            flash(`${memory.displayName(item).toUpperCase()} MOVED`);
          } else if (!d.certain && !uncertainAnnouncedRef.current.has(d.label)) {
            // weak sighting: honest uncertainty instead of silence
            uncertainAnnouncedRef.current.add(d.label);
            say(`I think I see a ${d.label}? Show me closer so I can be sure.`, { interrupt: false });
          }
        }
        // WAVE 5 — SEMANTIC STACKING: two certain detections where one's bottom
        // rests on the other's top (and they overlap horizontally) → "A is under B"
        for (const a of dets) {
          if (!a.certain) continue;
          for (const b of dets) {
            if (b === a || !b.certain) continue;
            const ax = a.x + a.w / 2, bx = b.x + b.w / 2;
            const overlapX = Math.abs(ax - bx) < Math.max(a.w, b.w) * 0.5;
            const restingOn = Math.abs((b.y + b.h) - a.y) < 0.08;
            if (overlapX && restingOn) memory.noteStacking(a.label, b.label);
          }
        }
      };
      v.onTrack = (t) => {
        trackRef.current = t;
        if (t.seen) lastVisionEventRef.current = performance.now(); // WAVE 7
      };
      // multi-person identity resolution (consent-gated, local only)
      v.onFaces = (faces) => {
        const allow = memory.getConsent().faceIndex;
        identityListRef.current = faces.map((f) => {
          if (!allow || f.embedding.length === 0) {
            return { known: false, name: null, similarity: 0, personId: null };
          }
          const m = memory.recognize(f.embedding);
          return m
            ? { known: true, name: m.person.name, similarity: m.similarity, personId: m.person.id }
            : { known: false, name: null, similarity: 0, personId: null };
        });
      };
      if (videoRef.current) {
        await v.start(videoRef.current);
        if (v.active) {
          setCamOn(true);
          setVisionError(null);
          // ALWAYS-LEARNING: scanner auto-arms with the eye — she learns items continuously
          const scanOk = await v.enableScanner();
          if (scanOk) {
            setScannerOn(true);
            v.scanIntervalMs = 2000; // background learning pace
            pushLog("sys", "scanner auto-armed — she learns items continuously while her eye is open");
          }
          pushLog("sys", "camera attached — optical lock armed (local processing only)");
          say("I can see you.");
        }
      }
    });
  }, [pushLog, say, memory, requestConsent]);

  // ---- mic lifecycle (consent-gated) -------------------------------------------
  const toggleMic = useCallback(() => {
    if (earsRef.current.listening) {
      earsRef.current.stop();
      setMicOn(false);
      pushLog("sys", "mic detached");
      return;
    }
    requestConsent("mic", () => {
      earsRef.current.onDiagnostics = (m) => pushLog("sys", m);
      const ok = earsRef.current.start(
        handleCommand,
        (l) => setMicOn(l),
        (m) => { pushLog("sys", m); setMicOn(false); },
      );
      if (ok) {
        setMicOn(true);
        memory.setSetting("localEars", false);
        pushLog("sys", "mic attached — CLOUD speech engine (Chrome), live only, never recorded");
      } else {
        pushLog("sys", "cloud speech unavailable here — falling back to LOCAL EARS (on-device Whisper)");
        void localEarsRef.current.start().then((started) => { if (started) memory.setSetting("localEars", true); });
      }
    });
  }, [handleCommand, pushLog, requestConsent, memory]);

  // forced on-device ears (works in any browser, offline after first load)
  const toggleLocalMic = useCallback(() => {
    if (localEarsRef.current.listening) {
      localEarsRef.current.stop();
      memory.setSetting("localEars", false);
      return;
    }
    requestConsent("mic", () => {
      if (earsRef.current.listening) earsRef.current.stop();
      void localEarsRef.current.start().then((ok) => { if (ok) memory.setSetting("localEars", true); });
    });
  }, [requestConsent, memory]);

  // ---- sound & gesture I/O -------------------------------------------------------
  const flash = useCallback((msg: string) => {
    setSoundEvent(msg);
    window.setTimeout(() => setSoundEvent(""), 3000);
  }, []);

  const toggleSoundWatch = useCallback(async () => {
    const sw = soundWatchRef.current;
    if (sw.active) { sw.stop(); setSoundOn(false); memory.setSetting("soundWatch", false); pushLog("sys", "sound watch off"); return; }
    const ok = await sw.start();
    if (!ok) { pushLog("sys", "mic unavailable for sound watch"); return; }
    sw.onClap = () => {
      const line = brain.hearClap();
      if (line) { say(line); chirpsRef.current.chirp("curious"); flash("CLAP → ATTENTION"); }
    };
    sw.onNoise = () => {
      const line = brain.hearNoise();
      if (line) { say(line); chirpsRef.current.chirp("alert"); flash("LOUD NOISE → ALARMED"); }
    };
    sw.onSoundEvent = (kind) => {
      const line = brain.hearSoundEvent(kind);
      if (line) {
        say(line);
        chirpsRef.current.chirp(kind === "music" ? "happy" : "curious");
        flash(kind === "thud" ? "THUD DETECTED" : kind === "voice" ? "VOICE DETECTED" : "MUSIC DETECTED");
      }
      // WAVE 4 — voice attribution lite: a voice sounding while her face lock is
      // held gets attributed to that person (temporal correlation, no embeddings)
      if (kind === "voice") {
        const nowS = performance.now();
        const id = identityRef.current;
        if (id?.known && id.personId && nowS - voiceAttributionRef.current.at > 30_000) {
          voiceAttributionRef.current.at = nowS;
          memory.noteBehavior(id.personId, "voice");
        }
      }
    };
    sw.onLevel = (l) => {
      const now = performance.now();
      if (now - lastLevelUpdateRef.current > 150) { lastLevelUpdateRef.current = now; setMicLevel(l); }
      // WAVE 3 — room ecology: learn the room's acoustic rhythm (per hour of day)
      if (now - noiseNoteAtRef.current > 30_000) {
        noiseNoteAtRef.current = now;
        memory.noteNoise(new Date().getHours(), l);
      }
    };
    setSoundOn(true);
    pushLog("sys", "sound watch on — clap for attention, loud noises startle Zola (audio never recorded)");
  }, [brain, pushLog, say]);

  const toggleChirps = useCallback(() => {
    chirpsRef.current.enabled = !chirpsOn;
    setChirpsOn(!chirpsOn);
    pushLog("sys", chirpsOn ? "chirps muted" : "chirps enabled — Zola now vocalizes moods");
  }, [chirpsOn, pushLog]);

  // ---- AMBIENT MUSIC — generative soundscape that follows her mood ---------
  const toggleMusic = useCallback(() => {
    if (!ambientRef.current) ambientRef.current = new AmbientMusic();
    const am = ambientRef.current;
    if (am.enabled) {
      am.stop();
      setMusicOn(false);
      pushLog("sys", "ambient music off — the room goes quiet");
    } else {
      am.start(mood);
      setMusicOn(true);
      pushLog("sys", "ambient music on — generative, follows her mood, always quiet");
    }
  }, [mood, pushLog]);

  // keep the soundscape tuned to her inner state
  useEffect(() => {
    if (ambientRef.current?.enabled) ambientRef.current.setMood(mood);
  }, [mood]);

  // ---- WAVE 4 — MICRO-VLOG COMPILER: her day, compiled locally -------------
  const buildVlogInput = useCallback((): VlogInput => {
    const snap = memory.snapshot;
    const weights = memory.getChatterWeights();
    let topChatter: string | null = null;
    let topW = 0;
    for (const [cat, w] of Object.entries(weights)) if (w > topW) { topW = w; topChatter = cat; }
    return {
      date: snap.daily.day,
      commandsToday: snap.daily.commands,
      itemsToday: snap.daily.items,
      peopleToday: snap.daily.people,
      peopleKnown: snap.people.map((p) => ({ name: p.name, voiceBabble: p.behavior?.voiceBabble })),
      itemsKnown: snap.items.length,
      factsKnown: snap.facts.length,
      flightHours: memory.getLogbook().hours,
      flights: memory.getLogbook().flights,
      battery: memory.batteryHealth(),
      moodArc: blackboxRef.current.moodArc(),
      blackbox: { samples: blackboxRef.current.size, summary: blackboxRef.current.summary() },
      lastDream: snap.lastDream,
      nightInsight: snap.lastNightInsight ?? memory.getDreamJournal()[0]?.insight ?? null,
      recentDiary: memory.getDiary(),
      topChatter,
      nightly: memory.getNightlyNodes().find((n) => n.date === snap.daily.day) ?? null,
      archiveNights: memory.getNightlyNodes().length,
      diagnostics: diagRef.current ? { verdict: diagRef.current.verdict, lines: diagRef.current.lines } : null,
    };
  }, [memory]);

  const exportVlog = useCallback(() => {
    const md = compileVlog(buildVlogInput());
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zola-vlog-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    pushLog("sys", "micro-vlog compiled — markdown saved locally (her day, in her words)");
  }, [buildVlogInput, pushLog]);

  // ---- AIR-GAP INTEGRITY AUDITOR — prove her local assets are untouched ----
  const runIntegrity = useCallback(async () => {
    try {
      const r = await fetch("/api/zola/integrity");
      const d = (await r.json()) as { verdict: string; drifted: string[] };
      setIntegrity(d.verdict as typeof integrity);
      if (d.verdict === "DRIFT") pushLog("sys", `INTEGRITY DRIFT: ${d.drifted.join(", ")} — investigate before trusting offline assets`);
    } catch { /* offline-safe: ignore */ }
  }, [pushLog]);

  useEffect(() => {
    void runIntegrity();
    const iv = setInterval(() => void runIntegrity(), 10 * 60 * 1000);
    return () => clearInterval(iv);
  }, [runIntegrity]);

  // v3.2 OTA — check the forge for capability packs on boot
  useEffect(() => {
    void (async () => {
      const pack = await checkForUpdates();
      if (!pack) return;
      const n = installPack(pack, (cap) => {
        cortexRef.current.register({
          id: cap.id,
          kind: cap.kind as "system" | "mode",
          label: cap.label,
          description: cap.description,
          run: () => `Capability ${cap.label} — executed.`,
        });
      });
      if (n > 0) {
        pushLog("sys", `OTA: ${n} new capabilities installed from the forge (v${pack.version})${pack.notes ? " — " + pack.notes : ""}`);
        say(`Update installed. ${n} new capabilities online. I grew while you were away.`);
      }
    })();
  }, [pushLog, say]);

  // ---- ENERGY PACING — gentle stretch companion, no nagging ----------------
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      if (workSinceRef.current === null) { workSinceRef.current = now; return; }
      const workedMs = now - workSinceRef.current;
      const sinceLastPace = now - lastPaceRef.current;
      // first cue after 45 min of continuous presence, then every 20 min
      if (workedMs > 45 * 60_000 && sinceLastPace > 20 * 60_000) {
        lastPaceRef.current = now;
        workSinceRef.current = now;
        setStretchCue((c) => c + 1);
        say("You have been at this a while. Stretch with me — I will show you how.");
        pushLog("aura", "energy pacing: stretch cue issued (her idea, quietly)");
      }
    }, 60_000);
    return () => clearInterval(iv);
  }, [say, pushLog]);

  // dispose the audio graph when the panel goes away
  useEffect(() => () => { ambientRef.current?.dispose(); }, []);

  // WAVE 2 — theory-of-mood: any typing = the human is engaged; she holds chatter
  useEffect(() => {
    let strike = 0;
    const onKey = () => {
      strike += 1;
      if (strike >= 3) { brainRef.current?.noteHumanFocus(); strike = 0; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // WAVE 3 — SELF-HEALING STATE RECOVERY: contain runtime errors, auto-revive the eye
  const healStateRef = useRef({ errors: 0, revives: 0, healing: false });
  useEffect(() => {
    const contain = () => {
      const s = healStateRef.current;
      s.errors += 1;
      if (s.errors === 1 || s.errors % 25 === 0) {
        pushLog("sys", `self-healing: runtime hiccup contained (${s.errors} total) — session continues`);
      }
      if (s.errors >= 3 && !s.healing && s.revives < 2) {
        s.healing = true;
        s.revives += 1;
        s.errors = 0;
        setTimeout(async () => {
          if (camOn) {
            pushLog("sys", "self-healing: recycling the camera eye...");
            await toggleCamera();
            setTimeout(() => { void toggleCamera(); s.healing = false; }, 1500);
          } else {
            s.healing = false;
          }
        }, 2000);
      }
    };
    window.addEventListener("error", contain);
    window.addEventListener("unhandledrejection", contain);
    return () => {
      window.removeEventListener("error", contain);
      window.removeEventListener("unhandledrejection", contain);
    };
  }, [camOn, toggleCamera, pushLog]);

  // WAVE 12 — apply persisted dream tuning on boot (bounded, governor-clamped)
  useEffect(() => {
    const saved = memory.getDreamTuning();
    if (saved.geofenceRadius !== undefined || saved.visionStaleLimit !== undefined) {
      governorRef.current.setLimits(saved);
      const cl = governorRef.current.currentLimits;
      pushLog("sys", `dream tuning restored: fence ${cl.geofenceRadius.toFixed(2)} m · vision window ${cl.visionStaleLimit} ms (from ${saved.appliedOn ?? "earlier"})`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WAVE 3 — ROOM ECOLOGY: golden-hour appreciation, at most once per hour
  useEffect(() => {
    const iv = setInterval(() => {
      const hour = new Date().getHours();
      if (isGoldenHour() && sunSaidHourRef.current !== hour && !brainRef.current?.humanFocused) {
        sunSaidHourRef.current = hour;
        say("The light is golden right now. My favorite flying weather.");
      }
      // WAVE 6 — episodic compression worker: keep her context lean, her gist forever
      const c = memory.compressEpisodes();
      if (c.done) pushLog("sys", `episodic compression: ${c.summary}`);
      // WAVE 6+12 — daily wrap-up: archive the day, then DREAM over it
      const today = new Date().toDateString();
      if (hour >= 17 && hour < 19 && lastWrapDayRef.current !== today && !brainRef.current?.humanFocused) {
        lastWrapDayRef.current = today;
        const node = memory.buildNightlyNode();
        // WAVE 12 — dream cycle: correlate events × environment, auto-tune (bounded)
        const cl = governorRef.current.currentLimits;
        const dream = runDreamCycle(
          blackboxRef.current.snapshot(),
          { geofenceRadius: cl.geofenceRadius, visionStaleLimit: cl.visionStaleLimit },
          (iso) => sunReport(new Date(iso)).phase,
        );
        dreamRef.current = dream;
        if (dream.verdict === "TUNED") {
          governorRef.current.setLimits(dream.tuning);
          memory.saveDreamTuning(dream.tuning);
          pushLog("sys", `dream tuning applied: ${dream.tuning.geofenceRadius !== undefined ? `fence ${dream.tuning.geofenceRadius.toFixed(2)} m ` : ""}${dream.tuning.visionStaleLimit !== undefined ? `vision window ${dream.tuning.visionStaleLimit} ms` : ""}`);
        }
        if (dream.heatmap) pushLog("sys", `dream-map: ${dream.heatmap.split("\n").join(" | ")}`);
        say(dream.reflection, { interrupt: false });
        // LLM garnish: reflective prose ONLY — the tuning numbers above are arithmetic
        if (llmRef.current.enabled && llmRef.current.isOnline) {
          void llmRef.current.complete(
            "You are Zola, a small flying robot pet, dreaming over your flight telemetry. One short dreamy sentence about what today's flights felt like. No numbers, no advice.",
            80,
          ).then((prose) => { if (prose) pushLog("aura", `dream prose: ${prose}`); }).catch(() => {});
        }
        say("The day is winding down. Say 'show me my day' for the headline — or press VLOG for my full story.", { interrupt: false });
        if (node.built) pushLog("sys", `nightly node archived for ${node.date} — the vlog archive grows`);
        chirpsRef.current.express("curious");
      }
    }, 5 * 60_000);
    return () => clearInterval(iv);
  }, [say, memory, pushLog]);

  // WAVE 6 — CIRCADIAN VOICE: her delivery follows the sun (user slider stays master)
  useEffect(() => {
    const apply = () => {
      const cv = circadianVoice();
      neuralRef.current.setRate(voiceSpeedRef.current * cv.rate);
    };
    apply();
    const iv = setInterval(apply, 30 * 60_000); // re-tune twice an hour as light shifts
    return () => clearInterval(iv);
  }, []);

  const toggleGestures = useCallback(async () => {
    const v = visionRef.current;
    if (!v?.active) { pushLog("sys", "attach the camera eye before gesture watch"); return; }
    if (v.gestures) { v.disableGestures(); setGestOn(false); memory.setSetting("gestures", false); pushLog("sys", "gesture watch off"); return; }
    const ok = await v.enableGestures();
    if (ok) {
      memory.setSetting("gestures", true);
      setGestOn(true);
      v.onWave = () => {
        flash("WAVE → COME");
        chirpsRef.current.chirp("happy");
        void handleCommand("come here");
      };
      v.onGesture = (g) => {
        const line = brain.gestureCommand(g);
        if (line) {
          say(line);
          chirpsRef.current.chirp(g === "thumbsUp" ? "happy" : "curious");
          flash(g === "thumbsUp" ? "THUMBS UP" : g === "stop" ? "STOP PALM" : `POINTING ${g === "point-right" ? "RIGHT" : "LEFT"}`);
        }
      };
      pushLog("sys", "gesture watch on — wave, thumbs up, open palm to stop, or point and she turns");
    }
  }, [pushLog, handleCommand, flash]);

  // ---- one-click senses: consent + eye + mic + sound watch -----------------------
  const enableSenses = useCallback(async () => {
    memory.grantConsent({ camera: true, mic: true, faceIndex: true });
    setConsent(memory.getConsent());
    pushLog("sys", "consent granted — waking eye, mic and sound watch");
    await toggleCamera();
    if (!earsRef.current.listening) toggleMic();
    if (!soundWatchRef.current.active) void toggleSoundWatch();
    say("I am listening now. Talk to me.");
  }, [memory, pushLog, toggleCamera, toggleMic, toggleSoundWatch, say]);

  // ---- scanner lifecycle --------------------------------------------------------
  const toggleScanner = useCallback(async () => {
    const v = visionRef.current;
    if (!v?.active) {
      pushLog("sys", "attach the camera eye before scanning");
      return;
    }
    if (v.scanning) {
      v.disableScanner();
      memory.setSetting("scanner", false);
      setScannerOn(false);
      pushLog("sys", "scanner off");
      return;
    }
    const ok = await v.enableScanner();
    if (ok) {
      memory.setSetting("scanner", true);
      setScannerOn(true);
      pushLog("sys", "scanner on — items Zola sees are learned locally");
      say("Scanner on. Show me things.");
    }
  }, [pushLog, say, memory]);

  // resume notice: what she was doing when the human last left
  useEffect(() => {
    const last = memory.getLastSession();
    if (last && last.task && last.task !== last.activity) {
      pushLog("sys", `when you left, she was on: ${last.task} — say "continue" to resume`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // petting: click her in the flight sim — she leans into it
  useEffect(() => {
    const cv = droneCanvasRef.current;
    if (!cv) return;
    const onPet = (e: MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const pose = poseRef.current;
      const dx = cv.width / 2 + (pose.y / 1.6) * (cv.width * 0.36);
      const dy = cv.height * 0.62 - (pose.z + pose.bob) * (cv.height * 0.5);
      if (Math.hypot(px - dx, py - dy) < 40) {
        const line = brainRef.current?.pet();
        if (line) { say(line); chirpsRef.current.chirp("happy"); }
      }
    };
    cv.addEventListener("click", onPet);
    return () => cv.removeEventListener("click", onPet);
  }, [say]);

  // TRAINING: apply her self-tuned gains + accumulate flight hours (REAL mode)
  // + COMPANION BROADCAST: her live state, text-only, to any device on the Wi-Fi
  useEffect(() => {
    const t = setInterval(() => {
      const hal = halRef.current as SimDroneHAL & { setTuning?: (t: { gain: number; drag: number; power: number }) => void };
      hal.setTuning?.(memory.getFlightTuning());
      if (bodyModeRef.current === "real" && poseRef.current.z > 0.15) {
        memory.addFlightTime(2); // sampled every 2s while airborne
      }
      const brain = brainRef.current;
      if (brain) {
        void fetch("/api/zola", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mood: brain.getMood(),
            persona: brain.getPersona(),
            activity: brain.getActivity(),
            battery: batteryRef.current,
            alt: poseRef.current.z,
            task: brain.runner.current?.description ?? null,
            bond: brain.bond,
            trust: 1 - brain.persona.resentment,
            owner: memory.snapshot.people[0]?.name ?? null,
            items: memory.itemCount(),
            lastSay: lastSayRef.current.text,
            log: logTailRef.current,
          }),
        }).catch(() => {});
      }
    }, 2000);
    return () => clearInterval(t);
  }, [memory]);

  // wire deep eyes diagnostics once
  useEffect(() => {
    deepEyesRef.current.onDiag = (m) => pushLog("sys", m);
  }, [pushLog]);

  /** Deep Eyes: VLM description of the live frame (falls back gracefully). */
  const deepLook = useCallback(async (question?: string) => {
    const v = visionRef.current;
    if (!v?.active || !videoRef.current) {
      pushLog("sys", "attach the camera eye before deep looking");
      return;
    }
    say("Looking carefully...");
    const description = await deepEyesRef.current.describe(videoRef.current, question);
    if (description) {
      say(description.length > 200 ? description.slice(0, 200) : description);
      setBond((b) => Math.min(1, b + 0.01));
    } else {
      pushLog("sys", "deep eyes could not describe this frame — normal perception still works");
    }
  }, [pushLog, say]);

  // ZERO-CLICK SESSION RESTORE: everything she was doing re-arms after a reload
  const restoreStartedRef = useRef(false);
  useEffect(() => {
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    void (async () => {
      const st = memory.getSettings();
      const consent = memory.getConsent();
      if (consent.camera) {
        await toggleCamera();
        if (st.scanner && visionRef.current?.active) {
          const ok = await visionRef.current.enableScanner();
          if (ok) setScannerOn(true);
        }
        if (st.gestures && visionRef.current?.active) {
          const ok = await visionRef.current.enableGestures();
          if (ok) setGestOn(true);
        }
      }
      if (consent.mic) {
        if (st.localEars) {
          const ok = await localEarsRef.current.start();
          if (ok) setMicOn(true);
        } else {
          toggleMic();
        }
      }
      if (st.soundWatch) await toggleSoundWatch();
    })();
  }, [memory, toggleCamera, toggleMic, toggleSoundWatch]);

  // wire obstacle-avoidance whiskers to the map (once) + emotional continuity
  useEffect(() => {
    halRef.current.avoid = (from, to, altitude) => petMapRef.current.steer(from, to, altitude);
    // GRAVITY/BALANCE: gust events + live balance reporting
    (halRef.current as SimDroneHAL).onGust = (strength) => {
      const line = brainRef.current?.hearGust(strength);
      if (line) {
        say(line, { interrupt: false });
        chirpsRef.current.chirp("curious");
        chirpsRef.current.playFile("gust", 0.3);
        flash("GUST — SELF-LEVELED");
      }
    };
    const lm = memory.getLastMood();
    if (lm) brainRef.current?.restoreMood(lm as Mood);
  }, [memory]);

  // ZERO-CLICK VOICE: if she already has her neural voice downloaded, auto-load it
  useEffect(() => {
    void (async () => {
      let saved: string | null = null;
      let savedId: string | null = null;
      try {
        saved = localStorage.getItem("aura.neuralVoice");
        savedId = localStorage.getItem("aura.neuralVoiceId");
      } catch { /* noop */ }
      if (saved !== "on") return;
      if (savedId && KOKORO_VOICES.some((v) => v.id === savedId)) {
        neuralRef.current.setVoice(savedId); // her chosen voice, restored
        setNeuralVoiceId(savedId);
      }
      const ok = await neuralRef.current.load((m) => pushLog("sys", m));
      if (ok) setNeuralOn(true); // silent restore — no announcement spam
    })();
  }, [pushLog]);

  // ZERO-CLICK BRAIN: if Ollama is running on this machine, connect automatically
  useEffect(() => {
    void (async () => {
      const llm = llmRef.current;
      const ok = await llm.checkAvailable();
      if (ok) {
        llm.enabled = true;
        setLlmOn(true);
        pushLog("sys", `brain auto-connected: ${llm.model} (found running on this machine — no click needed)`);
      }
    })();
  }, [pushLog]);

  // local ears wiring (stable callbacks via refs)
  useEffect(() => { cmdRef.current = handleCommand; }, [handleCommand]);
  // v2.4 CORTEX — late-bind the feature handlers the brain can decide to run
  useEffect(() => {
    featuresRef.current.integrity = runIntegrity;
    featuresRef.current.vlog = exportVlog;
    featuresRef.current.dream = triggerDream;
    featuresRef.current.story = () => void handleCommand("tell me a story");
    // the body-control handle: the brain plays any clip in her repertoire
    featuresRef.current.gesture = (name: string) => {
      if (!GESTURE_REPERTOIRE.includes(name)) return false;
      gestureApiRef.current?.playGesture(name);
      return true;
    };
    featuresRef.current.patrol = () => void handleCommand("patrol the room");

    // v3.1 CORTEX — register the SYSTEM capabilities (the real handlers)
    const c = cortexRef.current;
    c.register({ id: "diagnose", kind: "system", label: "Full integrity sweep", description: "Audit every local asset and byte for drift.", run: () => { void runIntegrity(); return "Integrity sweep running."; } });
    c.register({ id: "vlog", kind: "system", label: "Compile micro-vlog", description: "Compile today into her own words.", run: () => { exportVlog(); return "Micro-vlog compiled."; } });
    c.register({ id: "dream", kind: "system", label: "Dream cycle", description: "Consolidate today's events into tuning.", run: () => { triggerDream(); return "Dream cycle complete."; } });
    c.register({ id: "story", kind: "system", label: "Tell a story", description: "Weave a story from her day.", run: () => { void handleCommand("tell me a story"); return "Story begun."; } });
    c.register({ id: "sun", kind: "system", label: "Sun report", description: "Report the sun phase and the light.", run: () => { const sr = sunReport(new Date()); return `Sun phase: ${sr.phase}.`; } });
    c.register({ id: "patrol", kind: "system", label: "Room patrol", description: "Fly a patrol loop of the room.", run: () => { void handleCommand("patrol the room"); return "Patrol engaged."; } });
    // the 500 persona-shifts — the run delegates to the panel's real setter
    c.registerModeShifts(allPersonas(), (name) => {
      setPersona(name);
      return `Persona shift: ${name}.`;
    });
    c.onLog((who, text) => pushLog(who, text));
    pushLog("sys", `[CORTEX] ${c.size} capabilities registered`);
  }, [runIntegrity, exportVlog, triggerDream, handleCommand, memory, pushLog]);

  // SPONTANEA — the autonomous movement engine: when idle past her
  // persona's cadence, HER BRAIN picks a move from her repertoire, gated
  // by her mood, narrated sparsely, logged in the aura ledger.
  useEffect(() => {
    const iv = setInterval(() => {
      const idleS = (performance.now() - lastInteractionRef.current) / 1000;
      const rand = Math.random();
      if (!shouldSelfMove(persona, mood, idleS, rand)) return;
      const move = pickSpontaneous(persona, mood, rand);
      if (!move) return;
      lastInteractionRef.current = performance.now(); // the move counts as activity
      gestureApiRef.current?.playGesture(move.clip);
      if (move.say) say(move.say);
      pushLog("aura", `SPONTANEA: ${move.clip} (self-initiated, ${persona.toLowerCase()} cadence)`);
    }, 5000);
    return () => clearInterval(iv);
  }, [persona, mood, say, pushLog]);
  useEffect(() => {
    const le = localEarsRef.current;
    le.onTranscript = (t) => cmdRef.current(t);
    le.onDiag = (m) => pushLog("sys", m);
    le.onHearing = (h) => setHearing(h);
    le.onState = (listening) => { setMicOn(listening); setLocalEarsOn(listening); };
    le.onLevel = (l) => {
      const now = performance.now();
      if (now - lastLevelUpdateRef.current > 150) { lastLevelUpdateRef.current = now; setMicLevel(l); }
    };
  }, [pushLog]);

  useEffect(() => () => { visionRef.current?.stop(); earsRef.current.stop(); localEarsRef.current.stop(); }, []);

  // ---- flight body: SIM ↔ REAL (MavLink bridge) --------------------------------
  // connecting/reconnecting is driven by an effect so URL edits while in REAL
  // mode re-dial automatically (no more "typed the address but nothing happened")
  useEffect(() => {
    if (bodyMode !== "real") return;
    let hal: MavLinkBridgeHAL | null = null;
    const t = setTimeout(() => {
      hal = new MavLinkBridgeHAL(wsUrl);
      hal.avoid = (from, to, altitude) => petMapRef.current.steer(from, to, altitude);
      setLinkState("NO LINK");
      hal.connect(
        () => { setLinkState("LINKED"); pushLog("sys", `linked to ${wsUrl} — offboard start sent; she should arm and lift`); },
        () => { setLinkState("NO LINK"); pushLog("sys", "real-drone link lost — check the relay, or re-enter the address"); },
      );
      halRef.current = hal;
      bodyModeRef.current = "real";
    }, 600); // debounce: connect once typing settles
    return () => { clearTimeout(t); hal?.disconnect(); };
  }, [bodyMode, wsUrl, pushLog]);

  const toggleBody = useCallback(() => {
    if (bodyModeRef.current === "sim") {
      bodyModeRef.current = "real";
      setBodyMode("real");
      pushLog("sys", `flight body → REAL (${wsUrl})`);
    } else {
      (halRef.current as MavLinkBridgeHAL).disconnect?.();
      const sim = new SimDroneHAL();
      sim.avoid = (from, to, altitude) => petMapRef.current.steer(from, to, altitude);
      halRef.current = sim;
      bodyModeRef.current = "sim";
      setBodyMode("sim");
      pushLog("sys", "flight body → SIM");
    }
  }, [wsUrl, pushLog]);

  const dock = useCallback(() => {
    batteryRef.current = 1;
    governorRef.current.arm();
    setKilled(false);
    pushLog("sys", "docked — battery 100%, safety system re-armed");
    say("Charged up and ready.");
  }, [pushLog, say]);

  const kill = useCallback(() => {
    governorRef.current.kill();
    setKilled(true);
    pushLog("sys", "KILL SWITCH — all motion frozen, hover-idle");
    pushLog("aura", "Emergency hold. I will stay put until you re-arm me.");
    say("Emergency hold. I will stay put until you re-arm me.");
  }, [pushLog]);

  const wipeMemory = useCallback(() => {
    if (window.confirm("Erase everything Zola has learned (names, facts, face signatures)? This cannot be undone.")) {
      handleCommand("forget everything");
    }
  }, [handleCommand]);

  const exportMemory = useCallback(() => {
    const blob = new Blob([memory.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aura-memory.json";
    a.click();
    URL.revokeObjectURL(url);
    pushLog("sys", "memory exported — inspect exactly what Zola knows");
  }, [memory, pushLog]);

  const people = memory.snapshot.people;

  return (
    <ZolaShell title="DRONE PET · ZOLA" subtitle="Vision · Voice · Learning · Safety — all processing local">
      <style>{`
        @font-face { font-family: 'Rajdhani'; src: url('/fonts/Rajdhani-Bold.ttf'); font-weight: 700; }
        @font-face { font-family: 'Cairo'; src: url('/fonts/Cairo-Variable.ttf'); }
      `}</style>
      <div
        className="p-4 space-y-4 text-xs"
        style={{
          fontFamily: "'Rajdhani', 'Cairo', monospace",
          // WAVE 5 — theme sync: the panel breathes in her LED color; dim at night
          boxShadow: `0 0 48px ${LED_FOR_PERSONA[persona] ?? "#35d0a5"}${sunReport().phase === "night" ? "18" : "33"}`,
          transition: "box-shadow 1.2s ease",
        }}
      >
        {/* --- tab bar ---------------------------------------------------------- */}
        <div className="flex gap-1 sticky top-0 z-10 -mx-1 px-1 py-1 bg-[rgba(8,10,16,0.9)] rounded-lg items-center">
          <span
            title="LED ring — synced to her persona (same color on the real drone)"
            style={{
              width: 10, height: 10, borderRadius: 9999, flexShrink: 0,
              background: LED_FOR_PERSONA[persona] ?? "#35d0a5",
              boxShadow: `0 0 10px ${LED_FOR_PERSONA[persona] ?? "#35d0a5"}`,
            }}
          />
          {(["senses", "flight", "mind", "memory"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[9px] tracking-widest border transition-colors ${
                tab === t
                  ? "border-[#f0b90b] text-[#f0b90b] bg-[rgba(240,185,11,0.1)]"
                  : "border-white/10 text-[#8b8f9c] hover:border-white/30"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* --- consent gate ---------------------------------------------------- */}
        {consentTopic && (
          <div className="glass-soft rounded-xl p-3 border border-[#f0b90b]/40 space-y-2">
            <div className="text-[#f0b90b] tracking-[0.2em] text-[10px]">CONSENT REQUIRED — {consentTopic.toUpperCase()}</div>
            <p className="text-[#c8ccd6] leading-relaxed text-[11px]">
              {consentTopic === "camera"
                ? "Zola will use the camera to see you. Frames are processed live in your browser and NEVER stored, recorded, or uploaded. If you allow face indexing, only a non-reversible geometric signature is kept locally so Zola can recognize you."
                : "Zola will listen for voice commands. Speech is processed live by the browser and NEVER recorded or uploaded. Only command transcripts appear in the log, and you can wipe them anytime."}
            </p>
            <div className="flex gap-2">
              <button onClick={() => grantConsent(true)} className="flex-1 px-3 py-1.5 rounded-lg border border-[#f0b90b] text-[#f0b90b] hover:bg-[rgba(240,185,11,0.12)] transition-colors tracking-widest">
                GRANT
              </button>
              <button onClick={() => grantConsent(false)} className="flex-1 px-3 py-1.5 rounded-lg border border-white/15 text-[#8b8f9c] hover:border-white/30 transition-colors tracking-widest">
                DENY
              </button>
            </div>
          </div>
        )}

        {tab === "senses" && (<>
        {/* --- optical feed ------------------------------------------------------ */}
        <div className="relative glass-soft rounded-xl overflow-hidden aspect-video bg-black">
          <video ref={videoRef} muted playsInline className="absolute inset-0 w-full h-full object-cover opacity-80" />
          <canvas ref={camCanvasRef} width={640} height={360} className="absolute inset-0 w-full h-full" />
          {!camOn && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <div className="text-[#f0b90b] tracking-[0.3em] text-[10px]">OPTICAL SENSOR OFFLINE</div>
              <button onClick={toggleCamera} className="mt-1 px-4 py-1.5 rounded-lg border border-[#f0b90b] text-[#f0b90b] hover:bg-[rgba(240,185,11,0.12)] transition-colors">
                ATTACH CAMERA EYE
              </button>
              <div className="hud-label">consent required · local processing only</div>
            </div>
          )}
          {camOn && visionError && (
            <div className="absolute top-2 left-2 px-2 py-1 rounded bg-[rgba(255,77,79,0.2)] text-[#ff4d4f] text-[9px]">{visionError}</div>
          )}
          {camOn && (
            <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded bg-black/50">
              <span className="w-1.5 h-1.5 rounded-full bg-[#35d0a5] animate-pulse" />
              <span className="hud-label">EYE LIVE · LOCAL</span>
            </div>
          )}
        </div>

        </>)}

        {tab === "flight" && (<>
        {/* --- flight body + safety HUD ------------------------------------------ */}
        <div className="glass-soft rounded-xl p-2">
          <div className="hud-label px-1 pb-1">FLIGHT BODY · SIMULATOR (swap in MAVLink HAL for real quad)</div>
          <canvas ref={droneCanvasRef} width={640} height={240} className="w-full rounded-lg bg-[#0b0e17]" />
          <div className="mt-2">
            <DroneBody3D
              accentColor={LED_FOR_PERSONA[persona] ?? "#35d0a5"}
              mood={mood}
              gestureApiRef={gestureApiRef}
            />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2 px-1">
            <Stat label="MOOD" value={MOOD_LABEL[mood]} tone="#f0b90b" />
            <Stat label="ACTIVITY" value={activity.toUpperCase()} tone="#5ac8fa" />
            <Stat label="BATTERY" value={`${Math.round(battery * 100)}%`} tone={battery < 0.2 ? "#ff4d4f" : "#35d0a5"} />
            <Stat label="BOND" value={`${Math.round(bond * 100)}%`} tone="#ff9f43" />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-1 px-1">
            <Stat label="ALTITUDE" value={flightStats.alt.toFixed(2)} tone="#c8ccd6" />
            <Stat label="PITCH" value={`${flightStats.pitch.toFixed(0)}°`} tone="#c8ccd6" />
            <Stat label="ROLL" value={`${flightStats.roll.toFixed(0)}°`} tone="#c8ccd6" />
            <Stat label="PROPS" value={`${Math.round(flightStats.rpm)}`} tone="#c8ccd6" />
          </div>
          <div className="grid grid-cols-5 gap-2 mt-1 px-1">
            <Stat label="CELL HEALTH" value={`${memory.batteryHealth().health}%`} tone={memory.batteryHealth().health > 90 ? "#35d0a5" : "#f0b90b"} />
            <Stat label="CYCLES" value={`${memory.batteryHealth().cycles}`} tone="#c8ccd6" />
            <Stat label="EST AIR" value={bodyMode === "real"
              ? (estimatorRef.current.remainingFlightMinutes(battery * 100) !== null
                ? `${Math.round(estimatorRef.current.remainingFlightMinutes(battery * 100)!)}m`
                : estimatorRef.current.confidence === "learning" ? "LEARN…" : "—")
              : "SIM"} tone="#5ac8fa" />
            <Stat label="FLIGHT HRS" value={memory.getLogbook().hours.toFixed(1)} tone="#c8ccd6" />
            <Stat label="SUN" value={sunReport().phase.toUpperCase()} tone="#f0b90b" />
          </div>
          <div className="mt-2 px-1 flex items-center gap-2 flex-wrap">
            <span className="hud-label">PERSONA:</span>
            <span
              className="text-[9px] px-2 py-0.5 rounded border tracking-widest"
              title="WARMTH · SARCASM · ENERGY · FOCUS — her live trait vector: nudged by how you treat her, decaying 8%/hour to baseline"
              style={{ color: PERSONA_TONE[persona] ?? "#f0b90b", borderColor: PERSONA_TONE[persona] ?? "#f0b90b" }}>
              {persona}
            </span>
            {/* WAVE 5.5 — trait vector bars (W·S·E·F), live from her persona engine */}
            {(() => {
              const v = brainRef.current?.getPersonaVector();
              if (!v) return null;
              const traits: [string, number][] = [["W", v.warmth], ["S", v.sarcasm], ["E", v.energy], ["F", v.focus]];
              return traits.map(([label, val]) => (
                <span key={label} className="flex items-center gap-0.5" title={`${label}: ${(val * 100).toFixed(0)}%`}>
                  <span className="text-[8px] text-[#5a5f6e]">{label}</span>
                  <span className="w-8 h-1 rounded bg-white/10 overflow-hidden inline-block">
                    <span className="block h-full transition-all duration-700" style={{ width: `${val * 100}%`, background: PERSONA_TONE[persona] ?? "#f0b90b" }} />
                  </span>
                </span>
              ));
            })()}
            <span className="hud-label ml-1">TRUST</span>
            <div className="w-20 h-1.5 rounded bg-white/10 overflow-hidden">
              <div className="h-full transition-all duration-300" style={{ width: `${(1 - resent) * 100}%`, background: resent > 0.5 ? "#ff4d4f" : "#35d0a5" }} />
            </div>
            {resent >= 0.99 && <span className="text-[9px] text-[#ff4d4f] tracking-wider">say “sorry” to be forgiven</span>}
          </div>
          <div className="mt-1 px-1 flex items-center gap-2 flex-wrap">
            <span className="hud-label">SAFETY:</span>
            {killed ? (
              <span className="text-[9px] px-2 py-0.5 rounded bg-[rgba(255,77,79,0.25)] text-[#ff4d4f] tracking-widest">KILL ENGAGED</span>
            ) : (
              <span className="text-[9px] px-2 py-0.5 rounded bg-[rgba(53,208,165,0.15)] text-[#35d0a5] tracking-widest">LIMITS ACTIVE</span>
            )}
            {safetyFlags && <span className="text-[9px] text-[#ff9f43] tracking-wider">{safetyFlags}</span>}
            {integrity === "OK" && <span className="text-[9px] px-2 py-0.5 rounded bg-[rgba(53,208,165,0.12)] text-[#35d0a5] tracking-widest" title="SHA-256 of all local models/runtimes verified against baseline">AIR-GAP VERIFIED</span>}
            {integrity === "DRIFT" && <span className="text-[9px] px-2 py-0.5 rounded bg-[rgba(255,77,79,0.25)] text-[#ff4d4f] tracking-widest" title="A local asset changed since baseline — investigate">INTEGRITY DRIFT</span>}
            {(integrity === "" || integrity === "BASELINE_CREATED") && <span className="text-[9px] px-2 py-0.5 rounded bg-[rgba(139,143,156,0.15)] text-[#8b8f9c] tracking-widest">AIR-GAP {integrity === "BASELINE_CREATED" ? "BASELINE SET" : "CHECKING…"}</span>}
          </div>
        </div>

        {/* --- gesture stage ------------------------------------------------------ */}
        <GestureStage activity={activity} mood={mood} stretchCue={stretchCue} />

        {/* --- flight replay (WAVE 9) ---------------------------------------------- */}
        <FlightReplay getEntries={() => blackboxRef.current.snapshot()} />

        {/* --- mission planner (WAVE 10) -------------------------------------------- */}
        <div className="glass-soft rounded-xl p-2">
          <div className="hud-label px-1 pb-1">MISSION PLANNER · WAYPOINT QUEUE + ORBIT-POI (governor-gated)</div>
          <div className="flex flex-wrap gap-2 items-center px-1">
            {(["x", "y", "z"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1 text-[9px] text-[#8b8f9c]">
                {k.toUpperCase()}
                <input
                  type="number" step={0.1} value={wp[k]}
                  onChange={(e) => setWp({ ...wp, [k]: parseFloat(e.target.value) || 0 })}
                  className="w-16 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[10px] text-[#e9e7dc]"
                />
              </label>
            ))}
            <label className="flex items-center gap-1 text-[9px] text-[#8b8f9c]">
              HOLD ms
              <input
                type="number" step={500} value={wp.holdMs}
                onChange={(e) => setWp({ ...wp, holdMs: Math.max(0, parseInt(e.target.value) || 0) })}
                className="w-20 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[10px] text-[#e9e7dc]"
              />
            </label>
            <button
              onClick={() => setMissionWps((w) => [...w, { ...wp }] as Waypoint[])}
              className="px-2 py-1 rounded border border-[#35d0a5]/60 text-[#35d0a5] text-[9px] tracking-widest hover:bg-[rgba(53,208,165,0.12)]"
            >
              + ADD WP
            </button>
          </div>
          {missionWps.length > 0 && (
            <div className="px-1 mt-1 font-mono text-[9px] text-[#8b8f9c]">
              {missionWps.map((w, i) => (
                <span key={i} className="mr-3">
                  WP{i + 1} ({w.x.toFixed(1)}, {w.y.toFixed(1)}, {w.z.toFixed(1)}) h{w.holdMs}ms
                  <button onClick={() => setMissionWps((list) => list.filter((_, j) => j !== i))} className="ml-1 text-[#ff4d4f]">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-1 px-1 items-center">
            <button
              disabled={missionWps.length === 0}
              onClick={() => {
                const line = missionRef.current.begin(missionWps);
                say(line, { interrupt: false });
                setMissionWps([]);
              }}
              className="px-2 py-1 rounded border border-[#35d0a5]/60 text-[#35d0a5] text-[9px] tracking-widest hover:bg-[rgba(53,208,165,0.12)] disabled:opacity-40"
            >
              ▶ START MISSION
            </button>
            <button
              onClick={() => {
                const p = poseRef.current;
                const line = missionRef.current.orbit(0, 0, p.z, 0.8, 1, 2);
                say(line, { interrupt: false });
              }}
              className="px-2 py-1 rounded border border-[#5ac8fa]/60 text-[#5ac8fa] text-[9px] tracking-widest hover:bg-[rgba(90,200,250,0.12)]"
              title="Orbit-POI around home at 0.8 m standoff, 2 laps, camera locked inward"
            >
              ◎ ORBIT HOME
            </button>
            <button
              onClick={() => say(missionRef.current.abort("manual override"), { interrupt: false })}
              className="px-2 py-1 rounded border border-[#ff4d4f]/60 text-[#ff4d4f] text-[9px] tracking-widest hover:bg-[rgba(255,77,79,0.12)]"
            >
              ✕ ABORT
            </button>
            <span className="font-mono text-[9px] text-[#8b8f9c] ml-auto">{missionRef.current.hudStatus()}</span>
          </div>
        </div>

        </>)}

        {/* --- controls ------------------------------------------------------------ */}
        <div className="flex flex-wrap gap-2">
          {tab === "senses" && (<>
          <button
            onClick={enableSenses}
            className="w-full px-4 py-2 rounded-lg border border-[#f0b90b] text-[#f0b90b] bg-[rgba(240,185,11,0.08)] hover:bg-[rgba(240,185,11,0.18)] tracking-[0.2em] transition-colors"
          >
            ⚡ WAKE HER SENSES · EYE + MIC + SOUND
          </button>
          <Toggle on={camOn} label={camOn ? "EYE LIVE" : "EYE OFF"} onClick={toggleCamera} />
          <Toggle
            on={micOn}
            label={micOn ? (localEarsOn ? "MIC LOCAL" : "MIC LISTENING") : "MIC · CLICK ME"}
            onClick={toggleMic}
          />
          <button
            onClick={toggleLocalMic}
            className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${
              localEarsOn
                ? "border-[#35d0a5] text-[#35d0a5] bg-[rgba(53,208,165,0.12)]"
                : "border-white/15 text-[#8b8f9c] hover:border-[#35d0a5]/60"
            }`}
            title="On-device Whisper speech recognition — works in any browser, offline after first load"
          >
            LOCAL EARS {localEarsOn ? "ON" : "OFF"}
          </button>
          <button
            onClick={async () => {
              const q = earQuality === "fast" ? "deep" : "fast";
              setEarQuality(q);
              await localEarsRef.current.setQuality(q);
              pushLog("sys", q === "deep" ? "ears upgraded: DEEP — better understanding, a bit slower" : "ears: FAST — snappier replies");
            }}
            className="px-3 py-1.5 rounded-lg border border-white/15 text-[#8b8f9c] hover:border-[#5ac8fa]/60 tracking-widest transition-colors"
            title="DEEP = whisper-base (better understanding) · FAST = whisper-tiny (snappier)"
          >
            EARS · {earQuality.toUpperCase()}
          </button>
          <button
            onClick={toggleMusic}
            className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${
              musicOn
                ? "border-[#b98cf0] text-[#b98cf0] bg-[rgba(185,140,240,0.12)]"
                : "border-white/15 text-[#8b8f9c] hover:border-[#b98cf0]/60"
            }`}
            title="Generative ambient soundscape — follows her mood, never repeats, always quiet"
          >
            MUSIC {musicOn ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => { setStretchCue((c) => c + 1); say("Stretch with me — arms up, breathe. Good."); }}
            className="px-3 py-1.5 rounded-lg border border-white/15 text-[#8b8f9c] hover:border-[#35d0a5]/60 tracking-widest transition-colors"
            title="Energy pacing — she demonstrates a stretch"
          >
            PACE
          </button>
          <button
            onClick={() => {
              const blob = new Blob([blackboxRef.current.exportJSON()], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `zola-blackbox-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              pushLog("sys", `black-box exported — ${blackboxRef.current.size} telemetry samples (local file, never uploaded)`);
            }}
            className="px-3 py-1.5 rounded-lg border border-white/15 text-[#8b8f9c] hover:border-[#5ac8fa]/60 tracking-widest transition-colors"
            title="Telemetry black-box — download her last ~20 min of flight + cognition vectors"
          >
            BLACKBOX ↓
          </button>
          <button
            onClick={exportVlog}
            className="px-3 py-1.5 rounded-lg border border-[#b98cf0]/50 text-[#b98cf0] hover:bg-[rgba(185,140,240,0.12)] tracking-widest transition-colors"
            title="Micro-vlog compiler — her day as a local markdown vlog: highlights, mood arc, flight + battery, memory"
          >
            VLOG ↓
          </button>
          </>)}
          {tab === "mind" && (<>
          <button
            onClick={toggleNeural}
            className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${
              neuralOn
                ? "border-[#35d0a5] text-[#35d0a5] bg-[rgba(53,208,165,0.12)]"
                : "border-white/15 text-[#8b8f9c] hover:border-[#35d0a5]/60"
            }`}
            title="Kokoro-82M neural TTS — a real neural voice, loaded entirely from local model files."
          >
            {neuralOn ? "NEURAL VOICE · ON" : "NEURAL VOICE"}
          </button>
          {neuralOn && (
            <select
              value={neuralVoiceId}
              onChange={(e) => {
                neuralRef.current.setVoice(e.target.value);
                setNeuralVoiceId(e.target.value);
                try { localStorage.setItem("aura.neuralVoiceId", e.target.value); } catch { /* noop */ }
                say("Testing my new voice. Do you like it?");
              }}
              className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-[#e9e7dc] outline-none focus:border-[#35d0a5]/60"
            >
              {KOKORO_VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          )}
          <Toggle
            on={voiceOn}
            label="SPEAKER"
            onClick={() => {
              neuralRef.current.setEnabled(!voiceOn);
              piperPackRef.current.enabled = voiceOn;
              setVoiceOn(!voiceOn);
            }}
          />
          </>)}
          {tab === "flight" && (<>
          <button onClick={dock} className="px-3 py-1.5 rounded-lg border border-[#35d0a5]/50 text-[#35d0a5] hover:bg-[rgba(53,208,165,0.1)] transition-colors tracking-widest">
            DOCK · RECHARGE
          </button>
          <button onClick={kill} disabled={killed} className={`px-3 py-1.5 rounded-lg border transition-colors tracking-widest ${killed ? "border-[#ff4d4f] text-[#ff4d4f] bg-[rgba(255,77,79,0.2)]" : "border-[#ff4d4f]/60 text-[#ff4d4f] hover:bg-[rgba(255,77,79,0.1)]"}`}>
            {killed ? "KILLED" : "KILL SWITCH"}
          </button>
          </>)}
          {tab === "senses" && (<>
          <button onClick={toggleScanner} className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${scannerOn ? "border-[#5ac8fa] text-[#5ac8fa] bg-[rgba(90,200,250,0.12)]" : "border-white/15 text-[#8b8f9c] hover:border-[#5ac8fa]/60"}`}>
            SCANNER {scannerOn ? "ON" : "OFF"}
          </button>
          </>)}
          {tab === "mind" && (<>
          <button onClick={toggleLlm} className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${llmOn ? "border-[#35d0a5] text-[#35d0a5] bg-[rgba(53,208,165,0.12)]" : "border-white/15 text-[#8b8f9c] hover:border-[#35d0a5]/60"}`}>
            BRAIN {llmOn ? "· LLM" : "· REFLEX"}
          </button>
          <button
            onClick={toggleGenius}
            className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${
              geniusOn
                ? "border-[#ff9f43] text-[#ff9f43] bg-[rgba(255,159,67,0.12)]"
                : "border-white/15 text-[#8b8f9c] hover:border-[#ff9f43]/60"
            }`}
            title="Her thinking brain — an on-device language model. One-time ~350 MB download, then fully offline."
          >
            {geniusOn ? "GENIUS · ON" : "GENIUS MODE"}
          </button>
          <button
            onClick={async () => {
              if (deepEyesOn) {
                setDeepEyesOn(false);
                pushLog("sys", "deep eyes off");
                return;
              }
              const ok = await deepEyesRef.current.load();
              if (ok) {
                setDeepEyesOn(true);
                void deepLook();
              }
            }}
            className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${
              deepEyesOn
                ? "border-[#5ac8fa] text-[#5ac8fa] bg-[rgba(90,200,250,0.12)]"
                : "border-white/15 text-[#8b8f9c] hover:border-[#5ac8fa]/60"
            }`}
            title="Vision-language model (SmolVLM) — she describes ANYTHING in view. One-time ~300 MB download."
          >
            {deepEyesOn ? "DEEP EYES · ON" : "DEEP EYES"}
          </button>
          {geniusOn && (
            <button
              onClick={upgradeBrain}
              className="px-3 py-1.5 rounded-lg border border-[#5ac8fa]/60 text-[#5ac8fa] hover:bg-[rgba(90,200,250,0.12)] tracking-widest transition-colors"
              title="SMART = Qwen 0.5B (fast) · GENIUS = Qwen 1.5B (~3x smarter, ~1 GB)"
            >
              BRAIN SIZE · {brainTier.toUpperCase()}
            </button>
          )}
          </>)}
          {tab === "senses" && (<>
          <button onClick={toggleSoundWatch} className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${soundOn ? "border-[#5ac8fa] text-[#5ac8fa] bg-[rgba(90,200,250,0.12)]" : "border-white/15 text-[#8b8f9c] hover:border-[#5ac8fa]/60"}`}>
            SOUND WATCH {soundOn ? "ON" : "OFF"}
          </button>
          <button onClick={toggleGestures} className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${gestOn ? "border-[#5ac8fa] text-[#5ac8fa] bg-[rgba(90,200,250,0.12)]" : "border-white/15 text-[#8b8f9c] hover:border-[#5ac8fa]/60"}`}>
            WAVE {gestOn ? "ON" : "OFF"}
          </button>
          <button onClick={toggleChirps} className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${chirpsOn ? "border-[#ff9f43] text-[#ff9f43] bg-[rgba(255,159,67,0.12)]" : "border-white/15 text-[#8b8f9c] hover:border-[#ff9f43]/60"}`}>
            CHIRPS {chirpsOn ? "ON" : "MUTED"}
          </button>
          </>)}
          {tab === "flight" && (<>
          <button
            onClick={toggleBody}
            className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${
              bodyMode === "real"
                ? "border-[#ff4d4f] text-[#ff4d4f] bg-[rgba(255,77,79,0.12)]"
                : "border-white/15 text-[#8b8f9c] hover:border-[#35d0a5]/60"
            }`}
          >
            BODY · {bodyMode === "real" ? "REAL ⚠" : "SIM"}
            {bodyMode === "real" && (
              <span className="ml-1 text-[8px]" style={{ color: linkState === "LINKED" ? "#35d0a5" : "#ff4d4f" }}>
                {linkState === "LINKED" ? "● LINKED" : "○ NO LINK"}
              </span>
            )}
          </button>
          <input
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            placeholder="ws://localhost:8765"
            title="relay address — edits reconnect automatically while in REAL mode"
            className="w-44 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] font-mono text-[#e9e7dc] outline-none focus:border-[#35d0a5]/60"
          />
          </>)}
        </div>

        {tab === "senses" && (<>
        {/* --- live audio meter ------------------------------------------------------- */}
        <div className="flex items-center gap-2 px-1">
          <span className="hud-label">AUDIO</span>
          <div className="flex-1 h-1.5 rounded bg-white/10 overflow-hidden">
            <div className="h-full bg-[#5ac8fa]" style={{ width: `${Math.min(100, micLevel * 100)}%` }} />
          </div>
          {soundEvent && <span className="text-[9px] text-[#ff9f43] tracking-wider">{soundEvent}</span>}
          {hearing && <span className="text-[9px] text-[#35d0a5] tracking-wider">👂 HEARING YOU…</span>}
        </div>

        </>)}

        {tab === "memory" && (<>
        {/* --- memory (what Zola has learned) -------------------------------------- */}
        <div className="glass-soft rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="hud-label">WHAT ZOLA HAS LEARNED · STORED LOCALLY ONLY</span>
            <span className="text-[9px] text-[#35d0a5] tracking-widest">PRIVACY: 100% LOCAL</span>
          </div>
          <div className="text-[10px] text-[#c8ccd6]">
            {people.length === 0 && factsCount === 0 && itemsCount === 0 ? (
              <span className="text-[#8b8f9c]">Empty. Teach Zola: &quot;my name is …&quot;, &quot;i like …&quot;, or turn on the SCANNER and show it items.</span>
            ) : (
              <div className="space-y-1">
                {memory.snapshot.items.slice(-6).reverse().map((it) => (
                  <div key={it.id} className="flex justify-between items-center">
                    <span>📦 <span className="text-[#5ac8fa]">{memory.displayName(it)}</span>{it.customName ? <span> → <span className="text-[#f0b90b]">{it.customName}</span></span> : null} · {it.sightings} sightings</span>
                    <button onClick={() => { memory.forgetItem(it.id); setItemsCount(memory.itemCount()); pushLog("sys", `forgot item ${it.label}`); }} className="text-[9px] text-[#8b8f9c] hover:text-[#ff4d4f]">FORGET</button>
                  </div>
                ))}
                {people.map((p) => (
                  <div key={p.id} className="flex justify-between items-center">
                    <span>👤 <span className="text-[#f0b90b]">{p.name}</span> · {p.encounters} encounters · face signature kept</span>
                    <button onClick={() => { memory.forgetPerson(p.id); setPeopleCount(memory.snapshot.people.length); pushLog("sys", `forgot ${p.name}`); }} className="text-[9px] text-[#8b8f9c] hover:text-[#ff4d4f]">FORGET</button>
                  </div>
                ))}
                {memory.snapshot.facts.slice(-4).map((f, i) => (
                  <div key={i} className="text-[#8b8f9c]">• {f.text}</div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-1 items-center">
            <button onClick={exportMemory} className="px-2.5 py-1 rounded-md border border-white/10 text-[10px] text-[#c8ccd6] hover:border-[#f0b90b]/60 hover:text-[#f0b90b] transition-colors">
              EXPORT (inspect what it knows)
            </button>
            <label className="px-2.5 py-1 rounded-md border border-white/10 text-[10px] text-[#c8ccd6] hover:border-[#35d0a5]/60 hover:text-[#35d0a5] transition-colors cursor-pointer">
              RESTORE (adopt a backup)
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const text = await f.text();
                  if (window.confirm("Adopt this memory backup? It replaces everything Zola currently remembers.")) {
                    const ok = memory.importJSON(text);
                    pushLog("sys", ok ? "memory restored from backup — she now remembers everything from that file" : "invalid backup file — ignored");
                    refreshCounts();
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <button onClick={wipeMemory} className="px-2.5 py-1 rounded-md border border-[#ff4d4f]/40 text-[10px] text-[#ff4d4f] hover:bg-[rgba(255,77,79,0.1)] transition-colors">
              WIPE ALL MEMORY
            </button>
          </div>
        </div>

        </>)}

        {tab === "flight" && (<>
        {/* --- mental map (top-down) ---------------------------------------------------- */}
        <div className="glass-soft rounded-xl p-2">
          <div className="hud-label px-1 pb-1">MENTAL MAP · click to place/remove obstacles (she steers around them)</div>
          <canvas
            ref={mapCanvasRef}
            width={384}
            height={200}
            className="w-full rounded-lg bg-[#0b0e17] cursor-crosshair"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const wx = ((e.clientX - rect.left) / rect.width) * ROOM_EXTENT * 2 - ROOM_EXTENT;
              const wy = ROOM_EXTENT - ((e.clientY - rect.top) / rect.height) * ROOM_EXTENT * 2;
              const added = petMapRef.current.toggle(wx, wy);
              pushLog("sys", added
                ? `obstacle placed at (${wx.toFixed(2)}, ${wy.toFixed(2)}) — Zola will steer around it`
                : "obstacle removed");
            }}
          />
        </div>

        {/* --- active task HUD -------------------------------------------------------- */}
        {taskInfo && (
          <div className="glass-soft rounded-xl p-3 border border-[#5ac8fa]/30 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="hud-label">ACTIVE TASK · AUTONOMOUS</span>
              <button onClick={() => handleCommand("cancel task")} className="text-[9px] text-[#ff9f43] hover:text-[#ff4d4f] tracking-widest">CANCEL</button>
            </div>
            <div className="text-[#5ac8fa] text-[11px]">{taskInfo.desc}</div>
            <div className="text-[10px] text-[#8b8f9c]">step {Math.min(taskInfo.done + 1, taskInfo.total)}/{taskInfo.total}: {taskInfo.step}</div>
            <div className="h-1 rounded bg-white/10 overflow-hidden">
              <div className="h-full bg-[#5ac8fa] transition-all duration-300" style={{ width: `${(taskInfo.done / taskInfo.total) * 100}%` }} />
            </div>
          </div>
        )}

        </>)}

        {tab === "memory" && (<>
        {/* --- her diary ----------------------------------------------------------------- */}
        <div className="glass-soft rounded-xl p-3 space-y-1">
          <div className="hud-label">HER DIARY · every day, archived</div>
          {memory.getDiary().length === 0 ? (
            <div className="text-[10px] text-[#8b8f9c]">No past days yet — she writes one entry every midnight.</div>
          ) : (
            memory.getDiary().map((d) => (
              <div key={d.day} className="text-[10px] text-[#c8ccd6]">
                <span className="text-[#f0b90b] font-mono">{d.day}</span> — {d.summary}
              </div>
            ))
          )}
        </div>

        {/* --- routines ----------------------------------------------------------------- */}
        <div className="glass-soft rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="hud-label">ROUTINES · SHE RUNS THESE HERSELF</span>
            <span className="text-[9px] text-[#5ac8fa] tracking-widest">{routinesCount} ACTIVE</span>
          </div>
          {memory.listRoutines().length === 0 ? (
            <div className="text-[10px] text-[#8b8f9c]">None yet. Say: &quot;check on me every 5 minutes&quot;.</div>
          ) : (
            memory.listRoutines().map((r) => (
              <div key={r.id} className="flex justify-between items-center text-[10px]">
                <span className="text-[#c8ccd6]">⏰ {r.label} · every {r.everyMin >= 60 ? `${r.everyMin / 60}h` : `${r.everyMin}m`}</span>
                <button onClick={() => { memory.removeRoutine(r.id); setRoutinesCount(memory.listRoutines().length); pushLog("sys", `routine cancelled: ${r.label}`); }} className="text-[9px] text-[#8b8f9c] hover:text-[#ff4d4f]">CANCEL</button>
              </div>
            ))
          )}
        </div>

        </>)}

        {tab === "mind" && (<>
        {/* --- VOICE STUDIO ------------------------------------------------------------ */}
        <div className="glass-soft rounded-xl p-3 space-y-3">
          <div className="hud-label">VOICE STUDIO · hear every voice, pick yours</div>

          {/* neural voices (kokoro) */}
          {neuralOn && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-[#35d0a5] tracking-widest">NEURAL VOICES (best quality — on-device)</div>
              <div className="grid grid-cols-2 gap-1.5">
                {KOKORO_VOICES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      neuralRef.current.setVoice(v.id);
                      setNeuralVoiceId(v.id);
                      try { localStorage.setItem("aura.neuralVoiceId", v.id); } catch { /* noop */ }
                      neuralRef.current.speak(`Hi! I am ${v.label.split(" — ")[0]}. This is how I sound now. Do you like it?`);
                    }}
                    className={`px-2 py-1.5 rounded-lg border text-[9px] text-left transition-colors ${
                      neuralVoiceId === v.id
                        ? "border-[#35d0a5] text-[#35d0a5] bg-[rgba(53,208,165,0.1)]"
                        : "border-white/10 text-[#c8ccd6] hover:border-[#35d0a5]/50"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* speed slider */}
          <div className="flex items-center gap-2">
            <span className="hud-label">SPEED</span>
            <input
              type="range" min={0.7} max={1.5} step={0.05} value={voiceSpeed}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVoiceSpeed(v);
                voiceSpeedRef.current = v;
                // WAVE 6 — user slider is master; circadian model rides on top
                neuralRef.current.setRate(v * circadianVoice().rate);
              }}
              className="flex-1 accent-[#f0b90b]"
            />
            <span className="font-mono text-[10px] text-[#f0b90b]">{voiceSpeed.toFixed(2)}×</span>
          </div>
        </div>

        {/* --- about her ---------------------------------------------------------------- */}
        <div className="glass-soft rounded-xl p-3 space-y-1">
          <div className="hud-label">ABOUT ZOLA</div>
          <div className="flex justify-between text-[10px] text-[#c8ccd6]"><span>personality</span><span className="text-[#f0b90b]">{memory.describeProfile()}</span></div>
          <div className="flex justify-between text-[10px] text-[#c8ccd6]"><span>sessions alive</span><span className="font-mono">{memory.snapshot.stats.sessions}</span></div>
          <div className="flex justify-between text-[10px] text-[#c8ccd6]"><span>commands taken</span><span className="font-mono">{memory.snapshot.stats.commands}</span></div>
          <div className="flex justify-between text-[10px] text-[#c8ccd6]"><span>flight hours</span><span className="font-mono">{memory.getLogbook().hours.toFixed(2)} h · {memory.getLogbook().flights} flights</span></div>
          {Object.entries(memory.getFlightScores()).length > 0 && (
            <div className="flex justify-between text-[10px] text-[#c8ccd6]"><span>drill bests</span><span className="font-mono">{Object.entries(memory.getFlightScores()).map(([d, s]) => `${d.split(" ")[0]} ${s}%`).join(" · ")}</span></div>
          )}
          <div className="flex justify-between text-[10px] text-[#c8ccd6]"><span>voice</span><span className="text-[10px] text-[#8b8f9c] truncate max-w-[220px]">{voiceName || "system default"}</span></div>
        </div>

        </>)}

        {/* --- speech log ------------------------------------------------------------ */}
        <div className="glass-soft rounded-xl p-3 h-40 overflow-y-auto space-y-1.5">
          {log.slice(-10).map((e, i) => (
            <div key={i} className="leading-relaxed">
              <span className={e.who === "you" ? "text-[#5ac8fa]" : e.who === "aura" ? "text-[#f0b90b]" : "text-[#8b8f9c]"}>
                {e.who === "you" ? "you:" : e.who === "aura" ? "aura:" : "sys:"}
              </span>{" "}
              <span className={e.who === "sys" ? "text-[#8b8f9c]" : "text-[#e9e7dc]"}>{e.text}</span>
            </div>
          ))}
        </div>

        {/* --- the brain is the interface — manual chips collapsed ------------------- */}
        <details className="group">
          <summary className="hud-label text-[9px] text-[#8b8f9c] hover:text-[#f0b90b] cursor-pointer select-none">
            MANUAL OVERRIDE · {CHIPS.length} QUICK COMMANDS (the brain handles these verbally)
          </summary>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {CHIPS.map(([cmd, label]) => (
              <button key={cmd} onClick={() => handleCommand(cmd)} className="px-2.5 py-1 rounded-md border border-white/10 text-[10px] text-[#c8ccd6] hover:border-[#f0b90b]/60 hover:text-[#f0b90b] transition-colors">
                {label}
              </button>
            ))}
          </div>
        </details>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = (e.currentTarget.elements.namedItem("cmd") as HTMLInputElement | null);
            if (input?.value.trim()) { handleCommand(input.value.trim()); input.value = ""; }
          }}
          className="flex gap-2"
        >
          <input
            name="cmd"
            placeholder={micOn ? "speak, or type a command…" : "type a command, or attach the MIC…"}
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-[#e9e7dc] outline-none focus:border-[#f0b90b]/60"
          />
          <button type="submit" className="px-3 rounded-lg border border-[#f0b90b]/60 text-[#f0b90b] hover:bg-[rgba(240,185,11,0.12)] transition-colors">
            SEND
          </button>
        </form>
      </div>
    </ZolaShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="text-center">
      <div className="hud-label">{label}</div>
      <div className="font-mono text-[11px]" style={{ color: tone }}>{value}</div>
    </div>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${
        on
          ? "border-[#f0b90b] text-[#f0b90b] bg-[rgba(240,185,11,0.12)]"
          : "border-white/15 text-[#8b8f9c] hover:border-white/30"
      }`}
    >
      {label} {on ? "ON" : "OFF"}
    </button>
  );
}

/** #rrggbbaa from hex + alpha — used for the flight trail. */
function hexA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}