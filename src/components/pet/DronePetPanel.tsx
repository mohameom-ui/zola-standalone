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
import ZolaShell from "@/components/pet/ZolaShell";
import { PetBrain } from "@/lib/pet/brain";
import { DroneVision } from "@/lib/pet/vision";
import { DroneEars } from "@/lib/pet/ears";
import { DroneVoice } from "@/lib/pet/voice";
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
import { PetMap, DOCK, ROOM_EXTENT } from "@/lib/pet/map";
import type { FaceTrack } from "@/lib/pet/vision";
import type { DronePose, FaceIdentity, Mood } from "@/lib/pet/types";

const PERSONA_TONE: Record<string, string> = {
  SWEET: "#35d0a5", EXPLORER: "#5ac8fa", HYPER: "#ff9f43", SKITTISH: "#ff4d4f",
  GRUMPY: "#b58a2e", DREAMING: "#43506b", "ROAST MODE": "#ff9f43", SULKING: "#ff4d4f",
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
  const voiceRef = useRef<DroneVoice>(new DroneVoice());
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
  const [neuralOn, setNeuralOn] = useState(false);
  const [neuralVoiceId, setNeuralVoiceId] = useState("af_heart");
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
    voiceRef.current.setPersonaStyle(persona); // delivery matches her mood
    // PIPER PACK first: her authentic drone-body voice for known lines
    void (async () => {
      const packReady = await piperPackRef.current.ensureLoaded();
      if (packReady) {
        const spoken = await piperPackRef.current.speak(text);
        if (spoken) return; // her real Pi voice handled it
      }
      // fallback chain: neural (Kokoro) → browser TTS
      if (neuralRef.current.loaded && neuralRef.current.enabled) {
        const speedByPersona: Record<string, number> = { GRUMPY: 0.9, DREAMING: 0.88, HYPER: 1.1, "ROAST MODE": 1.08, SULKING: 0.9, SKITTISH: 1.06 };
        neuralRef.current.setRate(speedByPersona[persona] ?? 1.0);
        const spoken = await neuralRef.current.speak(text, opts);
        if (!spoken) voiceRef.current.speak(text, opts);
      } else {
        voiceRef.current.speak(text, opts);
      }
    })();
    pushLog("aura", text);
    lastSayRef.current = { text, until: performance.now() + 3200 + Math.min(3000, text.length * 45) };
    brainRef.current?.addBond(0.015); // every exchange deepens the friendship (persisted)
  }, [pushLog]);

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
    const today = memory.dailyReport() ?? "nothing happened yet today";
    const profile = memory.describeProfile();
    return `Owner: ${owner}. Known items: ${items}. Facts about owner: ${facts}. Today: ${today}. Relationship: ${profile}. Mood: ${brain.getMood()}. Activity: ${brain.getActivity()}. Visible right now: ${visible}. Battery: ${(batteryRef.current * 100).toFixed(0)}%.`;
  }, [memory, brain]);

  /**
   * Apply an LLM decision (Ollama OR on-device). Returns false when the brain
   * produced nothing usable — caller then falls back to her reflexes instead
   * of going silent.
   */
  const applyDecision = useCallback((d: LlmDecision): boolean => {
    const act = (d.do ?? "none").trim();
    const SIMPLE = new Set(["come", "follow", "trick", "dance", "sleep", "wake", "hover", "scan", "cancel", "status"]);
    let canonical = "";
    if (SIMPLE.has(act)) canonical = act === "cancel" ? "cancel task" : act === "scan" ? "scan the room" : act;
    else if (act.startsWith("find:")) canonical = `find ${act.slice(5).trim()}`;
    else if (act.startsWith("goto:")) canonical = `take me to ${act.slice(5).trim()}`;
    else if (act.startsWith("name:")) canonical = `this is ${act.slice(5).trim()}`;
    else if (act.startsWith("remember:")) canonical = `remember that ${act.slice(9).trim()}`;

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

    const hist = memory.recentChat(12);
    const history = (hist[hist.length - 1]?.text === text ? hist.slice(0, -1) : hist).map((h) => ({
      role: h.who === "you" ? ("user" as const) : ("assistant" as const),
      content: h.text,
    }));

    // Tier 1: Ollama (if installed) — strongest local brain
    const llm = llmRef.current;
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

    // Tier 3: reflex brain (deterministic fallback, always available)
    const reply = brain.command(text, batteryRef.current);
    if (reply) { say(reply); refreshCounts(); }
    else { pushLog("sys", "unrecognized — try: come here · follow me · my name is … · find my cup · what do you see"); setBond((b) => Math.min(1, b + 0.005)); }
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
        if (typeof b === "number" && b > 0) batteryRef.current = b;
      } else {
        const perched = actName === "sleep" || (actName === "dock" && poseRef.current.z < 0.06);
        if (perched) {
          batteryRef.current = Math.min(1, batteryRef.current + dt * 0.012); // charging on the pad
        } else {
          batteryRef.current = Math.max(0.02, batteryRef.current - dt * 0.0016);
        }
      }

      // self-hearing suppression: her own voice (either engine) never enters her ears
      if (voiceRef.current.isSpeaking() || neuralRef.current.isSpeaking()) speakTailUntil = now + 500;
      localEarsRef.current.muted = now < speakTailUntil;
      // hover engine ambience follows her altitude (library SFX)
      // engineRef wiring pending in the AURA session

      const t = trackRef.current;
      const poseNow = halRef.current.pose();
      const percept = {
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
      const act = brain.perceive(percept);
      // "scan" activity auto-arms the scanner (once) and scans DENSELY
      if (visionRef.current?.active) {
        visionRef.current.scanIntervalMs = act.activity === "scan" ? 500 : 1200;
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
      const flagStr = flags.join(" · ");
      setSafetyFlags((f) => (f === flagStr ? f : flagStr));

      // persona + trust meter (render only on change)
      const per = brain.getPersona();
      setPersona((p) => (p === per ? p : per));
      const res = brain.persona.resentment;
      setResent((r) => (Math.abs(r - res) < 0.01 ? r : res));

      // mood-change feedback: real library samples first, synth chirp fallback
      if (safeAct.mood !== prevMoodRef.current) {
        prevMoodRef.current = safeAct.mood;
        memory.setLastMood(safeAct.mood);
        if (safeAct.mood !== "idle") sfxFilesRef.current.playMood(safeAct.mood);
        if (chirpsRef.current.enabled && safeAct.mood !== "idle") chirpsRef.current.chirpForMood(safeAct.mood);
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
        const chatter = brain.proactiveTick({ now, faceSeen: t.seen, visibleItems: percept.visibleItems });
        if (chatter) {
          const llm = llmRef.current;
          if (llm.enabled && llm.isOnline) {
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
        // scanner learning: record everything seen (certain AND uncertain)
        const seen = new Set<string>();
        const uncertainSeen = new Set<string>();
        for (const d of dets) {
          if (seen.has(d.label)) continue;
          seen.add(d.label);
          // spatial + identity memory: world position AND color signature
          const pose = halRef.current.pose();
          const dist = Math.max(0.5, Math.min(2.5, 0.55 / Math.max(0.06, d.h)));
          const pos = { x: pose.x + Math.cos(pose.yaw) * dist, y: pose.y + Math.sin(pose.yaw) * dist, z: pose.z };
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
      };
      v.onTrack = (t) => {
        trackRef.current = t;
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
    };
    sw.onLevel = (l) => {
      const now = performance.now();
      if (now - lastLevelUpdateRef.current > 150) { lastLevelUpdateRef.current = now; setMicLevel(l); }
    };
    setSoundOn(true);
    pushLog("sys", "sound watch on — clap for attention, loud noises startle Zola (audio never recorded)");
  }, [brain, pushLog, say]);

  const toggleChirps = useCallback(() => {
    chirpsRef.current.enabled = !chirpsOn;
    setChirpsOn(!chirpsOn);
    pushLog("sys", chirpsOn ? "chirps muted" : "chirps enabled — Zola now vocalizes moods");
  }, [chirpsOn, pushLog]);

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

  // voice list population (browsers load voices async)
  useEffect(() => {
    let tries = 0;
    const pull = () => {
      const list = voiceRef.current.listVoices();
      if (list.length > 0 || tries > 10) {
        setVoices(list);
        setVoiceName(voiceRef.current.getVoiceName());
      } else { tries += 1; window.setTimeout(pull, 500); }
    };
    pull();
  }, []);

  // local ears wiring (stable callbacks via refs)
  useEffect(() => { cmdRef.current = handleCommand; }, [handleCommand]);
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
    voiceRef.current.speak("Emergency hold.");
    pushLog("aura", "Emergency hold. I will stay put until you re-arm me.");
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
      <div className="p-4 space-y-4 text-xs" style={{ fontFamily: "'Rajdhani', 'Cairo', monospace" }}>
        {/* --- tab bar ---------------------------------------------------------- */}
        <div className="flex gap-1 sticky top-0 z-10 -mx-1 px-1 py-1 bg-[rgba(8,10,16,0.9)] rounded-lg">
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
          <div className="mt-2 px-1 flex items-center gap-2 flex-wrap">
            <span className="hud-label">PERSONA:</span>
            <span className="text-[9px] px-2 py-0.5 rounded border tracking-widest" style={{ color: PERSONA_TONE[persona] ?? "#f0b90b", borderColor: PERSONA_TONE[persona] ?? "#f0b90b" }}>
              {persona}
            </span>
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
          </>)}
          {tab === "mind" && (<>
          <button
            onClick={toggleNeural}
            className={`px-3 py-1.5 rounded-lg border tracking-widest transition-colors ${
              neuralOn
                ? "border-[#35d0a5] text-[#35d0a5] bg-[rgba(53,208,165,0.12)]"
                : "border-white/15 text-[#8b8f9c] hover:border-[#35d0a5]/60"
            }`}
            title="Kokoro-82M neural TTS — a real voice from the internet. One-time ~90 MB download, then offline."
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
              voiceRef.current.setEnabled(!voiceOn);
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
        {/* --- voice picker ------------------------------------------------------------ */}
        <div className="glass-soft rounded-xl p-3 space-y-2">
          <div className="hud-label">VOICE · her sound, your choice (persisted)</div>
          <div className="flex gap-2 items-center">
            <select
              value={voiceName}
              onChange={(e) => {
                voiceRef.current.setVoiceByName(e.target.value);
                setVoiceName(e.target.value);
                voiceRef.current.speak("Hello. This is my voice now. Do you like it?");
              }}
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-[#e9e7dc] outline-none focus:border-[#f0b90b]/60"
            >
              {voices.length === 0 && <option>loading voices…</option>}
              {voices.map((v) => (
                <option key={v.name} value={v.name}>{v.name.slice(0, 44)}</option>
              ))}
            </select>
            <button
              onClick={() => voiceRef.current.speak("Hello. This is my voice. Do you like it?")}
              className="px-3 py-1.5 rounded-lg border border-[#f0b90b]/60 text-[#f0b90b] hover:bg-[rgba(240,185,11,0.12)] transition-colors tracking-widest"
            >
              TEST
            </button>
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

        {/* --- command chips + input --------------------------------------------------- */}
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map(([cmd, label]) => (
            <button key={cmd} onClick={() => handleCommand(cmd)} className="px-2.5 py-1 rounded-md border border-white/10 text-[10px] text-[#c8ccd6] hover:border-[#f0b90b]/60 hover:text-[#f0b90b] transition-colors">
              {label}
            </button>
          ))}
        </div>
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