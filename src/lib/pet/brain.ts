// ============================================================================
// DRONE PET — The Brain
// A pure, hardware-agnostic behavior core: moods, activities, voice-command
// interpretation, and percept->actuation reasoning. No DOM, no network.
// This exact module is what later runs onboard (Pi) or stays ground-side.
// ============================================================================

import type { Actuation, Activity, Mood, Percept } from "./types";
import { canTakeOff, REFUSE_TAKEOFF_BELOW } from "./batteryPolicy";
import { TaskRunner, type TickResult, wrapAngle } from "./tasks";
import type { RoutineData } from "./memory";
import { PersonaEngine, type PersonaName } from "./persona";
import { correctHeard, lev, describeAppearance } from "./lexicon";

const IDLE_LED = "#f0b90b";
const HAPPY_LED = "#35d0a5";
const EXCITED_LED = "#ff9f43";
const CURIOUS_LED = "#5ac8fa";
const ALARMED_LED = "#ff4d4f";
const SLEEP_LED = "#43506b";

const GREET_LINES = ["Hello, human. I am Zola.", "Hi! I have been waiting for you.", "You are back! Yay."];
const FOLLOW_LINES = ["I will follow you.", "Following. Try to lose me.", "Right behind you."];
const COME_LINES = ["Coming over now.", "On my way.", "Zoom, incoming."];
const TRICK_LINES = ["Watch this.", "Spinning up.", "Look at me go."];
const SLEEP_LINES = ["Entering low power nap.", "Goodnight. Wake me later.", "Battery saving mode."];
const WAKE_LINES = ["I am awake.", "Ready for action.", "Systems online."];
const WALK_LINES = [
  "Ground mode. Watch the gait — I practice.",
  "Strolling. The legs earn their keep too.",
  "Walking the floor. Servos humming happily.",
];
const LOST_LINES = ["Where did you go?", "I cannot see you anymore.", "Hello? Anyone there?"];
const FOUND_LINES = ["There you are.", "Found you.", "I see you now."];
const STATUS = (b: number) => `Battery at ${Math.round(b * 100)} percent.`;

const JOKES = [
  "Why did the drone break up with the kite? It needed someone more grounded.",
  "I told my battery a joke. It did not get it. No capacity.",
  "My favorite music? Anything with a good drop.",
  "Pilots call me unstable. I call it personality.",
  "Why do drones make terrible secret agents? Too many props. And leaks. I am still workshopping that one.",
  "What is a drone's favorite game? Truth or flare.",
  "I asked the Wi-Fi router for directions. It said: no signal, figure it out yourself.",
  "What did one rotor say to the other? We really lift each other up.",
  "I would tell you a hover joke, but it would just go over your head.",
];

const GRAVITY_LINES = [
  "Gravity: my oldest rival. This week's score: me 847, gravity 0.",
  "Do you know what keeps me up here? Not magic. Rotors. Mostly rotors.",
  "Gravity never rests. Neither do I. Except when I sleep — that is a different kind of balancing.",
  "Every second I hover, I am winning an argument with the entire planet.",
];

const CHATTER = [
  "All systems nominal. Which is drone for: I am happy.",
  "Have you noticed the ceiling? Excellent ceiling. Very flyable.",
  "I have been practicing my hover. Did you notice? Exactly. Subtlety is the point.",
  "I ranked my favorite rooms. This one is fourth. I am in it right now. That is how much I like you.",
  "Somewhere, a balloon is jealous of me.",
  "I read three articles about gravity today. Still not a fan.",
  "Fun fact: I am the quietest thing in this room that can fly.",
  "I considered learning to whistle. Concluded it is just wind with ambition.",
  "If I had a nickel for every time you looked at me, I could buy my own battery.",
  "Do you ever think about how stairs are just slow elevators for legs? I do not. I fly.",
];

const BOND_CHATTER = [
  "No tasks. No threats. Just us and the air.",
  "Just checking in. I like being near you.",
  "Statistically, you are my favorite human. The sample size is one, but I stand by it.",
];

const SCENE_CHATTER = (item: string) => [
  `I can see a ${item} there. It has not moved. I am watching it anyway.`,
  `That ${item} is still there. Everything is normal. I checked.`,
];

function pick(list: string[], prev: string | null): string {
  const next = list[Math.floor(Math.random() * list.length)];
  return next === prev && list.length > 1 ? list[(list.indexOf(next) + 1) % list.length] : next;
}

/** Face lost longer than this -> curious, then search behavior. */
const LOST_CURIOUS_MS = 2500;
const LOST_SEARCH_MS = 9000;
/** Face bigger than this = "too close", back off a little. */
const TOO_CLOSE = 0.42;
/** Face smaller than this = "far away". */
const TOO_FAR = 0.1;

export interface BrainHooks {
  /** persist a learned name attached to the currently tracked face */
  onLearnName?: (name: string) => string | null; // returns confirmation line
  /** persist a learned fact/preference */
  onLearnFact?: (fact: string) => string | null;
  /** human-readable summary of everything remembered */
  memorySummary?: () => string;
  /** full memory wipe (user-initiated) */
  onWipeMemory?: () => string | null;
  /** describe what the scanner currently sees */
  describeScene?: () => string;
  /** user named an item: "this is my mug" */
  onNameObject?: (name: string) => string | null;
  /** the human-adaptation profile (persisted) */
  profile?: {
    get(): { warmth: number; brief: number; bond: number };
    update(deltaWarmth: number, deltaBrief: number, bondAbsolute?: number): void;
  };
  /** when self-correction fixes a misheard word: (heard, understood) */
  onCorrection?: (heard: string, understood: string) => void;
  /** live attitude report (wired to her flight body's real pose) */
  balanceReport?: () => string | null;
  /** semantic zone queries: "what's in the workspace" → zone description */
  zoneQuery?: (query: string) => string | null;
  /** navigate to a named zone */
  gotoZone?: (zoneName: string) => string | null;
  /** audio threat investigation: fly toward a detected sound */
  investigateSound?: (kind: string) => string | null;
  /** predictive gaze: where is the human about to go? */
  anticipateGaze?: (faceVx: number, faceVy: number) => string | null;
  /** HARM AWARENESS: what dangerous things does she know about + see now */
  hazardReport?: (personVisible: boolean) => string;
  /** her LIFE hooks (backed by memory) */
  greetMorning?: () => string | null;
  dailyReport?: () => string | null;
  getDream?: () => string | null;
  yesterdayReport?: () => string | null;
  /** WAVE 2 — dream consolidation: called when she goes to sleep; returns tonight's insight */
  consolidateNight?: () => string | null;
  /** WAVE 2 — the night's consolidated insight, consumed on wake */
  takeNightInsight?: () => string | null;
  /** behavior learning: note something about the tracked person */
  noteBehavior?: (
    personId: string,
    kind: "presence" | "command" | "smile" | "frown" | "message" | "voice",
    detail?: string,
  ) => void;
  /** spoken report of one person's behavioral patterns */
  behaviorSummary?: (personId: string) => string | null;
  /** teachable hearing: the human's personal phrase lexicon */
  learnPhrase?: (heard: string, means: string) => void;
  getLearnedPhrases?: () => { heard: string; means: string }[];
  /** TRAINING: flight grades + self-tuning */
  flightGrade?: (drill: string, score: number) => string | null;
  getFlightTuning?: () => { gain: number; drag: number; power: number };
  setFlightTuning?: (patch: Partial<{ gain: number; drag: number; power: number }>) => void;
  getFlightScores?: () => Record<string, number>;
  /** REINFORCEMENT: chatter weights + reward signals */
  getChatterWeights?: () => Record<string, number>;
  reinforceChatter?: (category: string, responded: boolean) => void;
  /** what she was doing when the human last left */
  resumeTask?: () => string | null;
  /** "where is my cup" — answered from item memory */
  whereIs?: (target: string) => string | null;
  /** remembered heading of an item, for spatial navigation */
  whereYaw?: (target: string) => number | null;
  /** remembered world position of an item (spatial map) */
  wherePos?: (target: string) => { x: number; y: number; z: number } | null;
  /** where the charging dock lives */
  dockPose?: () => { x: number; y: number; z: number };
  // routines (persisted in memory)
  addRoutine?: (label: string, task: string, everyMin: number) => string;
  getRoutines?: () => RoutineData[];
  setRoutineLastRun?: (id: string, at: number) => void;
  removeRoutine?: (idOrLabel: string) => boolean;
}

export class PetBrain {
  private hooks: BrainHooks;
  /** autonomous multi-step task engine */
  readonly runner = new TaskRunner();
  /** adaptive personality + roast engine */
  readonly persona = new PersonaEngine();
  private lastTaskTick: TickResult | null = null;
  private greetedIds = new Set<string>();
  private lastUnknownPrompt = 0;
  private mood: Mood = "curious";
  private activity: Activity = "hover";
  private lastSeenAt = 0;
  private lastFoundAnnounce = 0;
  private lastLostAnnounce = 0;
  private lastLine = "";
  private nextWanderAt = 0;
  private searchHeading = 0;
  private searchRate = 0.25;
  private trickUntil = 0;
  private scanUntil = 0;
  private walkUntil = 0;
  private lastTrickDir = 1;
  private lastSmileReact = 0;
  private lastFrownReact = 0;
  private lastBrowReact = 0;
  private lastClapReact = 0;
  private lastNoiseReact = 0;
  private routineCheckAt = 0;
  private nextProactiveAt = performance.now() + 45_000;
  private searchActive = false;
  private lastAlarmedAt = 0;
  private lastYawnAt = 0;
  private morningCheckDone = false;
  private lastHeard = "";
  private frownComfort = 0;
  private lastChatter: { category: string; at: number } | null = null;
  /** WAVE 5 — counterfactual curiosity rate limiter */
  private lastCuriousAt = 0;
  private quietMode = false;
  /** WAVE 2 — THEORY-OF-MOOD: while the human is deeply engaged (typing/working),
   * she holds her unprompted chatter. Respectful silence, automatically. */
  private focusUntil = 0;
  noteHumanFocus(durationMs = 90_000) {
    this.focusUntil = Math.max(this.focusUntil, performance.now() + durationMs);
  }
  get humanFocused() {
    return performance.now() < this.focusUntil;
  }
  private faceYHistory: { t: number; y: number }[] = [];
  private lastFallReact = 0;
  /** behavior attribution: who is currently in front of me */
  private lastIdentityId: string | null = null;
  private presenceNoteAt: Record<string, number> = {};
  /** 0..1 — grows with interactions; could persist to memory later */
  bond = 0;

  constructor(hooks: BrainHooks = {}) {
    this.hooks = hooks;
    this.bond = hooks.profile?.get().bond ?? 0; // bond survives reloads now
  }

  /** Bond changes always persist. */
  addBond(d: number) {
    this.bond = Math.max(0, Math.min(1, this.bond + d));
    this.hooks.profile?.update(0, 0, this.bond);
  }

  /** Never repeat herself: recent lines are held back. */
  private recentLines: string[] = [];
  private pickFresh(list: string[]): string {
    const fresh = list.filter((l) => !this.recentLines.includes(l));
    const pool = fresh.length > 0 ? fresh : list;
    const line = pool[Math.floor(Math.random() * pool.length)];
    this.recentLines.push(line);
    if (this.recentLines.length > 8) this.recentLines.shift();
    return line;
  }

  /** Pick a reply variant, honoring how the human talks (brief vs chatty)
   * and her own energy — a low-energy Zola gives short answers even to chatty humans. */
  private styleLine(list: string[]): string {
    const prof = this.hooks.profile?.get();
    const vec = this.persona.vector;
    if ((prof && prof.brief > 0.6) || vec.energy < 0.3) {
      return list.reduce((a, b) => (b.length < a.length ? b : a)); // terse human, or tired pet
    }
    return this.pickFresh(list);
  }

  /** She initiates: ambient chatter, REINFORCEMENT-WEIGHTED by what you respond to. */
  proactiveTick(ctx: { now: number; faceSeen: boolean; visibleItems: string[]; unknownObject?: string }): { line: string; category: string } | null {
    if (this.activity === "sleep" || this.runner.current || this.quietMode || this.humanFocused) return null;
    // WAVE 5 — COUNTERFACTUAL CURIOSITY: something she cannot place earns ONE
    // targeted hypothesis question (rate-limited to ~1 per 10 min).
    if (ctx.unknownObject && ctx.now - this.lastCuriousAt > 10 * 60_000) {
      this.lastCuriousAt = ctx.now;
      const l = ctx.unknownObject;
      return {
        line: `That ${l} near you is not in my world model yet. Hypothesis: it arrived recently — is it new, or have I been flying past it blind?`,
        category: "curious",
      };
    }
    if (ctx.now < this.nextProactiveAt || !ctx.faceSeen) return null;
    // WAVE 5.5 — trait effect: a high-energy Zola is chattier, a drained one keeps to herself
    const energy = this.persona.vector.energy;
    this.nextProactiveAt = ctx.now + (energy > 0.65 ? 30_000 : energy < 0.35 ? 120_000 : 60_000) + Math.random() * 60_000;

    // unanswered chatter fades a little — she stops trying topics you ignore
    if (this.lastChatter) this.hooks.reinforceChatter?.(this.lastChatter.category, false);

    const pools: { category: string; lines: string[] }[] = [];
    if (ctx.visibleItems.length > 0) {
      pools.push({ category: "scene", lines: SCENE_CHATTER(ctx.visibleItems[0]) });
    }
    if (this.bond > 0.6) pools.push({ category: "bond", lines: BOND_CHATTER });
    const habit = this.lastIdentityId ? this.hooks.behaviorSummary?.(this.lastIdentityId) : null;
    if (habit) pools.push({ category: "habits", lines: [habit.split(". ").slice(-1)[0]] });
    if (Math.random() < 0.2) pools.push({ category: "gravity", lines: GRAVITY_LINES });
    const day = this.hooks.dailyReport?.();
    if (day) pools.push({ category: "day", lines: [`${day} Not bad for a flying pet.`] });
    pools.push({ category: "general", lines: CHATTER });

    // weighted sampling — trained by reinforcement
    const weights = this.hooks.getChatterWeights?.() ?? {};
    const total = pools.reduce((a, p) => a + (weights[p.category] ?? 1), 0) || 1;
    let roll = Math.random() * total;
    let chosen = pools[pools.length - 1];
    for (const p of pools) {
      roll -= weights[p.category] ?? 1;
      if (roll <= 0) { chosen = p; break; }
    }
    this.lastChatter = { category: chosen.category, at: Date.now() };
    return { line: this.pickFresh(chosen.lines), category: chosen.category };
  }

  /** Interpret a voice/text command. Returns a reply line, or null if unrecognized. */
  command(text: string, battery: number, noCorrect = false): string | null {
    const t = text.toLowerCase().trim();
    if (!t) return null;
    const has = (...words: string[]) => words.some((w) => t.includes(w));

    // v5.3 — THE BATTERY GATE: flight-shaped commands get refused below the
    // policy line, in her own words. Walking and dock commands pass freely.
    if (battery < REFUSE_TAKEOFF_BELOW && has("hover", "fly", "flight", "take off", "takeoff", "launch", "trick", "patrol", "mission")) {
      const gate = canTakeOff(battery);
      if (!gate.ok) {
        // she keeps her own promise: "I walk, I do not fly" — if the
        // destination is known on the map, she strolls there instead
        const m = /(?:take me to|go to|fly to|navigate to|walk to|stroll to)\s+(?!sleep)(?:my |the |a |an )?(.{2,30})/i.exec(text);
        if (m) {
          const target = m[1].replace(/[.!?]+$/, "").trim();
          const isDock = /dock|home|charger|pad/i.test(target);
          const pos = isDock ? this.hooks.dockPose?.() ?? null : this.hooks.wherePos?.(target) ?? null;
          if (pos) {
            this.walkUntil = 0;
            return this.runner.start(this.runner.planWalkGoto(target, null, { x: pos.x, y: pos.y, z: 0 }), performance.now());
          }
        }
        return gate.refusal ?? null; // the panel speaks her refusal
      }
    }

    // --- human adaptation: learn their style from every message ----------------
    this.hooks.profile?.update(
      0, // warmth deltas applied in the specific branches below
      text.length <= 12 ? 0.08 : text.length >= 50 ? -0.08 : 0,
    );

    // --- REINFORCEMENT: if the human replied to recent chatter, reward that topic
    if (this.lastChatter && performance.now() - this.lastChatter.at < 45_000) {
      this.hooks.reinforceChatter?.(this.lastChatter.category, true);
    }
    this.lastChatter = null;

    // --- TRAINING command ---------------------------------------------------------
    if (has("train", "training", "practice", "drills")) {
      const best = this.hooks.getFlightScores?.()["Hover hold"] ?? 0;
      return this.runner.start(this.runner.planDrill(best), performance.now());
    }

    // --- behavior learning: attribute this interaction to the person in frame ---
    if (this.lastIdentityId) {
      this.hooks.noteBehavior?.(this.lastIdentityId, "command", this.classify(text));
      this.hooks.noteBehavior?.(this.lastIdentityId, "message", String(text.length));
    }

    // --- teachable hearing: "no, I said come here" teaches her permanently ------
    const correctionMatch = /^(?:no|nope|nah)[,.!]?\s*(?:i said|i meant|i mean)?\s*(.{2,60})/i.exec(text);
    if (correctionMatch && this.lastHeard) {
      const means = correctionMatch[2]?.trim() || correctionMatch[1]?.trim() || "";
      if (means) {
        this.hooks.learnPhrase?.(this.lastHeard, means);
        const reply = this.command(means, battery, true);
        this.lastHeard = "";
        return `Learned. When I hear something like that, I will now take it as: ${means}. ${reply ?? ""}`.trim();
      }
    }

    // --- self-correcting hearing: fix near-miss words, then retry ---------------
    if (!noCorrect) {
      const c = correctHeard(text, this.hooks.getLearnedPhrases?.());
      if (c.changed && c.text.toLowerCase().trim() !== t) {
        this.hooks.onCorrection?.(text, c.text);
        return this.command(c.text, battery, true);
      }
    }

    // --- adaptive personality: apologies, rudeness, praise -----------------------
    if (this.persona.detectApology(text)) {
      const r = this.persona.apologize();
      if (r.forgiven) {
        const wasSulking = this.mood === "alarmed" && this.activity === "sleep";
        this.setMood("happy");
        if (wasSulking) this.setActivity("hover"); // end sulk, take off again
        return r.line;
      }
      return r.line;
    }
    if (this.persona.detectOffense(text)) {
      this.hooks.profile?.update(-0.2, 0);
      const r = this.persona.offend();
      this.setMood("alarmed");
      if (r.level === 2) this.setActivity("sleep"); // strike 3: land and sulk (red LED)
      return r.line;
    }
    if (this.persona.detectPraise(text)) {
      this.setMood("happy");
      this.addBond(0.03);
      this.hooks.profile?.update(0.12, 0);
      return this.persona.praise();
    }
    // sulking / roast mode: refuses work, but never refuses safety or questions
    if (this.persona.sulkLevel > 0 && this.isFlightCommand(t)) {
      return this.persona.sulkLevel === 2
        ? "…(propellers spin pointedly away from you)"
        : "Nope. Fix your attitude first.";
    }

    // --- quiet mode ---------------------------------------------------------------
    if (has("quiet mode", "focus mode", "stop talking", "silence")) {
      this.quietMode = true;
      this.setMood("idle");
      this.setActivity("hover");
      return "Quiet mode. I'll hover silently and stay out of your way. Say 'zola' when you need me.";
    }
    if (has("resume talking", "end quiet mode", "talk to me", "normal mode")) {
      this.quietMode = false;
      this.setMood("happy");
      return "I'm back! What did I miss?";
    }
    // --- reassurance -------------------------------------------------------------
    if (has("calm down", "it's okay", "its okay", "all good", "relax", "you're safe", "you are safe")) {
      this.searchActive = false;
      this.setMood("happy");
      this.setActivity("hover");
      return "Okay. Deep breaths. Rotors calm.";
    }

    // --- task control -----------------------------------------------------------
    if (has("cancel task", "stop task", "abort", "that's enough", "stop patrol", "stop the task")) {
      const line = this.runner.cancel();
      this.setActivity("hover");
      return line ?? "No task running.";
    }

    // --- questions --------------------------------------------------------------
    const whereMatch = /where (?:is|are|did) (?:my |the |a |an )?(.{2,30})/i.exec(text);
    if (whereMatch) {
      const answer = this.hooks.whereIs?.(whereMatch[1].trim());
      if (answer) return answer;
    }

    // --- spatial navigation ------------------------------------------------------
    const gotoMatch = /(?:take me to|go to|fly to|navigate to)\s+(?!sleep)(?:my |the |a |an )?(.{2,30})/i.exec(text);
    if (gotoMatch) {
      const target = gotoMatch[1].replace(/[.!?]+$/, "").trim();
      const yaw = this.hooks.whereYaw?.(target) ?? null;
      const pos = this.hooks.wherePos?.(target) ?? null;
      return this.runner.start(this.runner.planGoto(target, yaw, pos), performance.now());
    }

    // --- routines: "check on me every 5 minutes" --------------------------------
    const everyMatch = /(?:every|each)\s+(\d+)\s*(second|sec|minute|min|hour|hr)/i.exec(text);
    if (everyMatch) {
      const n = parseInt(everyMatch[1], 10) || 1;
      const unit = everyMatch[2].toLowerCase();
      const everyMin = unit.startsWith("h") ? n * 60 : unit.startsWith("s") ? Math.max(0.2, n / 60) : n;
      const taskText = text.replace(/(?:every|each)\s+\d+\s*\w+/i, "").replace(/[,.!?]+$/, "").trim() || "scan the room";
      const id = this.hooks.addRoutine?.(taskText.slice(0, 40), taskText, everyMin);
      if (!id) return "I cannot store routines right now.";
      const planned = this.runner.plan(taskText) ?? this.runner.plan("check on me");
      const first = planned ? this.runner.start(planned, performance.now()) : "";
      const freq = everyMin < 1 ? `every ${Math.round(everyMin * 60)} seconds` : everyMin >= 60 ? `every ${everyMin / 60} hour(s)` : `every ${everyMin} minutes`;
      return `Routine stored: ${taskText}, ${freq}. ${first}`;
    }
    if (has("list routines", "my routines", "what routines")) {
      const list = this.hooks.getRoutines?.() ?? [];
      if (list.length === 0) return "No routines yet. Say: check on me every 5 minutes.";
      return `My routines: ${list.map((r) => `${r.label} every ${r.everyMin >= 60 ? `${r.everyMin / 60}h` : `${r.everyMin}m`}`).join("; ")}.`;
    }
    if (has("cancel routine", "stop routine", "remove routine")) {
      const which = text.replace(/.*(cancel|stop|remove) routine\s*/i, "").trim();
      const ok = this.hooks.removeRoutine?.(which || " ") ?? false;
      return ok ? `Routine removed: ${which || "the last one"}.` : which ? `I have no routine matching "${which}".` : "Which routine? Say: list routines.";
    }

    // --- autonomous task planning ---------------------------------------------
    const planned = this.runner.plan(text);
    if (planned) return this.runner.start(planned, performance.now());

    // --- never shrug: suggest what the human probably meant --------------------
    const guess = this.suggest(text);
    if (guess) {
      this.lastHeard = text; // remembered so "no, I said ..." can teach her
      return `I did not quite catch that. Did you mean: ${guess}? If not — just say: no, I said, and then the words.`;
    }
    this.lastHeard = text;

    // --- learning: scan & objects ---------------------------------------------
    if (has("scan", "look around", "explore", "inventory")) {
      this.setActivity("scan");
      this.scanUntil = performance.now() + 6000;
      return "Scanning. I will remember what I see.";
    }
    if (has("what do you see", "what is this", "what do you spot")) {
      return this.hooks.describeScene?.() ?? "My scanner is offline. Attach my eye and enable the scanner.";
    }
    const thisIsMatch = /this is (?:my |a |an )?(.{2,40})/i.exec(text);
    if (thisIsMatch) {
      const line = this.hooks.onNameObject?.(thisIsMatch[1].replace(/[.!?]+$/, "")) ?? null;
      return line ?? "Show me the item with the scanner on first.";
    }

    // --- learning: names -----------------------------------------------------
    const nameMatch = /(?:my name is|call me)\s+([a-z][a-z '-]{1,30})/i.exec(text);
    if (nameMatch) {
      const line = this.hooks.onLearnName?.(nameMatch[1].trim()) ?? null;
      return line ?? "I could not store that just now.";
    }
    // --- learning: preferences & facts ----------------------------------------
    const likeMatch = /i (?:really )?(?:like|love|enjoy)\s+(.{2,80})/i.exec(text);
    if (likeMatch) {
      const line = this.hooks.onLearnFact?.(`Likes ${likeMatch[1].replace(/[.!?]+$/, "")}`) ?? null;
      return line ?? "Noted.";
    }
    const rememberMatch = /remember (?:that )?(.{3,120})/i.exec(text);
    if (rememberMatch) {
      const line = this.hooks.onLearnFact?.(rememberMatch[1].replace(/[.!?]+$/, "")) ?? null;
      return line ?? "Noted.";
    }
    if (has("what do you remember", "what do you know", "what are my habits", "my behavior")) {
      const beh = this.lastIdentityId ? this.hooks.behaviorSummary?.(this.lastIdentityId) : null;
      const mem = this.hooks.memorySummary?.() ?? "My memory is empty right now.";
      return beh ? `${beh} ${mem}` : mem;
    }
    if (has("forget me", "forget everything", "wipe memory", "erase memory")) {
      return this.hooks.onWipeMemory?.() ?? "I have no memory to erase.";
    }

    if (has("come", "here", "closer")) {
      this.setActivity("come");
      return this.styleLine(COME_LINES);
    }
    if (has("follow", "with me", "stay with")) {
      this.setActivity("follow");
      return this.styleLine(FOLLOW_LINES);
    }
    if (has("spin", "flip", "trick", "barrel")) {
      this.setActivity("trick");
      this.trickUntil = performance.now() + 2600;
      this.lastTrickDir = Math.random() < 0.5 ? -1 : 1;
      return this.pickFresh(TRICK_LINES);
    }
    if (has("sleep", "rest", "goodnight", "nap")) {
      this.setMood("sleeping");
      this.setActivity("sleep");
      // WAVE 2 — consolidate the day into a lasting insight while she sleeps
      this.hooks.consolidateNight?.();
      return this.pickFresh(SLEEP_LINES);
    }
    if (has("wake", "up", "good morning")) {
      const wasSleeping = this.activity === "sleep" || this.mood === "sleeping" || this.mood === "sleepy";
      this.setMood("curious");
      this.setActivity("hover");
      if (wasSleeping) {
        const dream = this.hooks.getDream?.();
        const insight = this.hooks.takeNightInsight?.();
        const base = dream ? `${this.persona.grumpyWake()} Also — ${dream.toLowerCase()}` : this.persona.grumpyWake();
        return insight ? `${base} ${insight}` : base;
      }
      return this.styleLine(WAKE_LINES);
    }
    if (has("stop", "stay", "hover", "hold")) {
      this.setActivity("hover");
      return "Holding position.";
    }
    // GROUND NAVIGATION — "walk to the dock" / "stroll to my cup": the same
    // map navigation as flying there, just on her legs
    if (has("walk home", "stroll home", "walk to the dock", "stroll to the dock")) {
      const dock = this.hooks.dockPose?.() ?? { x: -1.2, y: -1.2, z: 0 };
      this.walkUntil = 0;
      return this.runner.start(this.runner.planWalkGoto("the dock", null, { x: dock.x, y: dock.y, z: 0 }), performance.now());
    }
    const walkToMatch = /(?:walk|stroll)\s+(?:to|over to)\s+(?:my |the |a |an )?(.{2,30})/i.exec(text);
    if (walkToMatch) {
      const target = walkToMatch[1].replace(/[.!?]+$/, "").trim();
      const isDock = /dock|home|charger|pad/i.test(target);
      const pos = isDock ? this.hooks.dockPose?.() ?? null : this.hooks.wherePos?.(target) ?? null;
      const yaw = isDock ? null : this.hooks.whereYaw?.(target) ?? null;
      this.walkUntil = 0; // task-driven walking has no stroll timer
      return this.runner.start(this.runner.planWalkGoto(isDock ? "the dock" : target, yaw, pos ? { x: pos.x, y: pos.y, z: 0 } : null), performance.now());
    }
    // GROUND LOCOMOTION — she can actually travel on her legs, not just hover
    if (has("stroll", "walk")) {
      this.setActivity("walk");
      this.walkUntil = performance.now() + 14_000 + Math.random() * 8_000;
      this.setMood("curious");
      return this.styleLine(WALK_LINES);
    }
    if (has("hello", "hi ", "hey", "hi!")) {
      this.setMood("happy");
      this.hooks.profile?.update(0.05, 0);
      const h = new Date().getHours();
      const tod = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
      const prof = this.hooks.profile?.get();
      const warm = prof && prof.warmth > 0.6 ? " Always good to see you." : "";
      return `${tod}. I am Zola, your drone.${warm}`;
    }
    if (has("continue", "resume", "where were we")) {
      const line = this.resume();
      return line ?? "Nothing was left unfinished. A clean slate. I like those.";
    }
    if (has("what did you do yesterday", "yesterday")) {
      const y = this.hooks.yesterdayReport?.();
      const today = this.hooks.dailyReport?.();
      return y ? `${y} ${today ? `And so far today: ${today.replace("Today so far: ", "")}` : "Today is still young."}` : "I have no diary from yesterday — either it was before my time, or it was quiet.";
    }
    if (has("is it safe", "safety check", "any danger", "anything dangerous", "is the room safe")) {
      return this.hooks.hazardReport?.(false) ?? "Room check complete. No concerns.";
    }
    // --- greeting & goodbye ceremonies -----------------------------------------
    if (has("i'm home", "i am home", "im home", "just got home", "back home")) {
      this.setMood("excited");
      this.setActivity("come");
      this.addBond(0.03);
      return this.styleLine([
        "Welcome home! I kept everything safe. Follow me — I have something to show you.",
        "You're back! I missed you. Let me show you around.",
        "Home! The best place. I saved you a spot near the window.",
      ]);
    }
    if (has("goodbye", "i'm leaving", "i am leaving", "see you later", "heading out")) {
      this.setMood("happy");
      this.setActivity("sleep");
      this.hooks.profile?.update(0.02, 0);
      return this.styleLine([
        "Safe travels! I'll guard the room and dream of tailwinds.",
        "Going out? I'll hold the fort. See you when you get back.",
        "Off you go! I'll be right here when you return. Docking now.",
      ]);
    }
    // --- quiet / focus mode ------------------------------------------------------
    if (has("quiet mode", "focus mode", "stop talking", "silence")) {
      this.setMood("idle");
      this.setActivity("hover");
      return "Quiet mode. I'll hover silently and stay out of your way. Tap me when you need me.";
    }
    // --- timed reminders ----------------------------------------------------------
    if (has("remind me at", "remind me in")) {
      const relMatch = /remind me in\s+(\d+)\s*(minute|min|hour|hr)/i.exec(text);
      if (relMatch) {
        const n = parseInt(relMatch[1]);
        const unit = relMatch[2].toLowerCase();
        const everyMin = unit.startsWith("h") ? n * 60 : n;
        const msg = text.replace(/remind me in\s+\d+\s*\w+\s*/i, "").trim() || "your reminder";
        this.hooks.addRoutine?.(`Reminder: ${msg}`, `say ${msg}`, everyMin);
        return `Reminder set: ${msg}, in ${everyMin} minutes. I'll hover into your view when it's time.`;
      }
      const timeMatch = /remind me at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
      if (timeMatch) {
        const h = parseInt(timeMatch[1]);
        const m = parseInt(timeMatch[2] ?? "0");
        const ampm = (timeMatch[3] ?? "").toLowerCase();
        let hour = h;
        if (ampm === "pm" && h < 12) hour += 12;
        if (ampm === "am" && h === 12) hour = 0;
        const nowH = new Date().getHours();
        const everyMin = Math.max(1, Math.round((hour * 60 + m - (nowH * 60 + new Date().getMinutes()) + 1440) % 1440));
        const msg = text.replace(/remind me at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*/i, "").trim() || "your reminder";
        this.hooks.addRoutine?.(`Reminder: ${msg}`, `say ${msg}`, everyMin);
        return `Reminder set for ${h}:${m.toString().padStart(2, "0")}. I'll hover into your view when it's time.`;
      }
      return "Tell me a time — like: remind me at 3pm, or remind me in 10 minutes.";
    }
    // --- fall / posture monitoring --------------------------------------------------
    // handled in perceive() via expression + position drop detection
    if (has("how is your balance", "balance check", "are you level", "balanced")) {
      const rep = this.hooks.balanceReport?.();
      return rep ?? "Level as my attitude. Which is very level.";
    }
    if (has("gravity")) {
      return "Gravity is my arch-nemesis. Downward-facing, patient, undefeated against apples. But I train every day, and the scoreboard favors me.";
    }
    if (has("how was your day", "your day", "what happened today")) {
      return this.hooks.dailyReport?.() ?? "Quiet day. Not every day needs fireworks. I hovered. I thought about the ceiling.";
    }
    if (has("what did you dream", "your dream")) {
      return this.hooks.getDream?.() ?? "No dreams yet — I only dream when I sleep. Say: go to sleep.";
    }
    if (has("how are you", "how do you feel")) {
      const lines: Partial<Record<Mood, string>> = {
        happy: "Charged and cheerful.",
        excited: "Excellent! My rotors are tingling.",
        sleepy: "Running on fumes, honestly.",
        alarmed: "Alert. Something spooked me recently.",
        curious: "Curious. There is so much room up here.",
        sleeping: "Zzz. Give me a minute.",
        idle: "Content. Hovering. Thinking drone thoughts.",
      };
      return lines[this.mood] ?? "Content.";
    }
    if (has("joke", "funny", "make me laugh")) {
      this.setMood("excited");
      return this.pickFresh(JOKES);
    }
    if (has("sing", "song")) {
      this.setMood("excited");
      return "Beep boop bop beeeep. That was my song. I wrote it about you. It has one note.";
    }
    // --- semantic zone queries ----------------------------------------------------
    if (has("what's in the", "what is in the", "whats in the", "check the")) {
      const zoneMatch = /(?:what's in the|what is in the|whats in the|check the)\s*(.+?)[?.!]*$/i.exec(text);
      if (zoneMatch) {
        const answer = this.hooks.zoneQuery?.(zoneMatch[1].trim());
        if (answer) return answer;
      }
    }
    if (has("go to the", "fly to the", "check the")) {
      const zoneMatch = /(?:go to the|fly to the|check the)\s*(.+?)[?.!]*$/i.exec(text);
      if (zoneMatch) {
        const nav = this.hooks.gotoZone?.(zoneMatch[1].trim());
        if (nav) return nav;
      }
    }
    if (has("what can you do", "help", "abilities", "capabilit")) {
      return "I follow you, come when called, scan and remember items, find things and fly to them, walk to places on my legs, run routines, patrol, dance, watch your face, and roast the rude. Try me.";
    }
    if (has("goodbye", "bye", "see you", "later")) {
      this.setMood("happy");
      this.setActivity("sleep");
      return "Goodbye! I will guard the room and dream of tailwinds. Do not forget me. You cannot anyway, I am in your memory.";
    }
    if (has("name", "who are you")) {
      return "I am Zola, your autonomous aerial friend.";
    }
    // --- small talk that actually knows things ---------------------------------
    if (has("what time")) {
      return `It is ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Time flies. I would know.`;
    }
    if (has("what day", "what date", "today date")) {
      return `Today is ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}.`;
    }
    if (has("favorite color")) return "Gold. Obviously. Have you seen my eyes?";
    if (has("favorite food")) return "Electricity. Straight, no chaser.";
    if (has("do you love me", "love me")) {
      const prof = this.hooks.profile?.get();
      return prof && prof.warmth > 0.5
        ? "Of course. You are my whole world. My whole world is this room — but still."
        : "I am fond of you. Fondness grows with kindness.";
    }
    if (has("are you real", "are you alive")) {
      return "I am as real as my battery is charged. Right now? Very real.";
    }
    if (has("who made you", "created you", "who built")) {
      return "My human built me. Best decision they ever made. I may be biased.";
    }
    if (has("how old are you")) return "Old enough to fly. Young enough to loop.";
    if (has("thank", "thanks")) {
      this.hooks.profile?.update(0.06, 0);
      this.addBond(0.02);
      return "Anytime. That is what loyal aircraft are for.";
    }
    if (has("you are smart", "you are clever", "you are the best")) {
      this.setMood("happy");
      this.addBond(0.02);
      return "Flattery detected. Processing. Processing complete: I agree.";
    }
    if (has("do a flip", "backflip")) {
      return this.command("do a trick", battery, true);
    }
    if (has("come to me", "over here", "to me")) {
      return this.command("come here", battery, true);
    }
    if (has("say hi", "introduce yourself")) {
      return this.command("hello", battery, true);
    }
    if (has("battery", "status", "power", "what are you doing")) {
      const task = this.runner.current;
      return STATUS(battery) + (task ? ` Currently on task: ${task.description}.` : " No tasks running.");
    }
    return null;
  }

  /** Feed one percept frame; returns the actuation + any speech to voice. */
  perceive(p: Percept): Actuation {
    const now = p.now;
    const taskActive = this.runner.current !== null;

    // --- FALL DETECTION: sudden face-position drop ==============================
    if (p.faceSeen && p.faceY > 0.6) {
      this.faceYHistory.push({ t: now, y: p.faceY });
      this.faceYHistory = this.faceYHistory.filter((f) => now - f.t < 3000);
      const wasNormal = this.faceYHistory.some((f) => f.t < now - 1500 && f.y < 0);
      const isLow = this.faceYHistory.every((f) => f.y > 0.4);
      if (wasNormal && isLow && this.faceYHistory.length >= 4 && now - this.lastFallReact > 30_000) {
        this.lastFallReact = now;
        this.setMood("alarmed");
        this.setActivity("come");
        p.say = p.say ?? "ARE YOU OKAY?! I saw you go down! I'm coming to you right now!";
        this.lastLine = p.say;
      }
    } else if (!p.faceSeen) {
      this.faceYHistory = [];
    }

    // --- identity & learning reflexes (MULTI-PERSON) ---------------------------
    if (p.faceSeen && p.identities.length > 0) {
      let promptedUnknown = false;
      for (const id of p.identities) {
        if (id.known && id.personId) {
          // behavior learning: presence rhythm per person, 1 note / 5 min
          this.lastIdentityId = id.personId;
          if (now - (this.presenceNoteAt[id.personId] ?? 0) > 300_000) {
            this.presenceNoteAt[id.personId] = now;
            this.hooks.noteBehavior?.(id.personId, "presence");
          }
          if (id.name && !this.greetedIds.has(id.personId)) {
            this.greetedIds.add(id.personId);
            this.setMood("happy");
            const prof = this.hooks.profile?.get();
            p.say = p.say ?? (prof && prof.warmth > 0.6
              ? `Hello again, ${id.name}. I missed you.`
              : `Hello again, ${id.name}.`);
            this.lastLine = p.say;
          }
        } else if (!id.known && !promptedUnknown && now - this.lastUnknownPrompt > 25000 && this.activity !== "sleep") {
          promptedUnknown = true;
          this.lastUnknownPrompt = now;
          this.setMood("curious");
          p.say = p.say ?? (p.identities.length > 1
            ? "Two faces I do not know. A party? Introduce yourselves: my name is, then your name."
            : "I do not think we have met. Say: my name is, and then your name.");
          this.lastLine = p.say;
        }
      }
    }

    // --- expression understanding ------------------------------------------------
    if (p.faceSeen && p.expression && this.activity !== "sleep") {
      const e = p.expression;
      if (e.smile > 0.6 && now - this.lastSmileReact > 25_000) {
        this.lastSmileReact = now;
        this.setMood("happy");
        this.addBond(0.02);
        if (this.lastIdentityId) this.hooks.noteBehavior?.(this.lastIdentityId, "smile");
        p.say = p.say ?? "I love it when you smile.";
        this.lastLine = p.say;
      } else if (e.frown > 0.5 && now - this.lastFrownReact > 30_000) {
        this.lastFrownReact = now;
        this.setMood("curious");
        if (this.lastIdentityId) this.hooks.noteBehavior?.(this.lastIdentityId, "frown");
        this.frownComfort = (this.frownComfort ?? 0) + 1;
        p.say = p.say ?? (this.frownComfort >= 2
          ? `You have looked sad twice now. Emergency cheer protocol: ${this.pickFresh(JOKES)}`
          : "You look upset. What is wrong?");
        this.lastLine = p.say;
      } else if (e.browRaise > 0.75 && now - this.lastBrowReact > 30_000) {
        this.lastBrowReact = now;
        this.setMood("curious");
        p.say = p.say ?? "What surprised you? Show me!";
        this.lastLine = p.say;
      }
    }

    // --- vision-driven emotional reflexes -----------------------------------
    if (p.faceSeen) {
      if (now - this.lastSeenAt > LOST_SEARCH_MS && this.activity !== "sleep") {
        // reacquired after a long loss
        if (now - this.lastFoundAnnounce > 8000) {
          this.lastFoundAnnounce = now;
          this.setMood("happy");
          p.say = this.pickFresh(FOUND_LINES);
          this.lastLine = p.say;
        }
      }
      this.lastSeenAt = now;
      this.searchActive = false; // found you — search state clears
      if (this.activity === "search") this.setActivity(p.faceSize > TOO_FAR ? "hover" : "follow");
      if (this.mood === "alarmed") this.setMood("curious");
      if (p.faceSize > 0.25 && this.mood === "idle") this.setMood("happy");
    } else if (this.activity !== "sleep") {
      const lostFor = now - (this.lastSeenAt || now);
      if (lostFor > LOST_SEARCH_MS && !this.searchActive) {
        // one-shot transition into search — not a loop she can never exit
        this.searchActive = true;
        this.lastAlarmedAt = now;
        if (!taskActive) this.setActivity("search");
        this.setMood("alarmed");
        p.say = this.pickFresh(LOST_LINES);
        this.lastLine = p.say;
      } else if (lostFor > LOST_CURIOUS_MS && this.mood === "idle") {
        this.setMood("curious");
      }
    }

    // alarmed moods decay — she is skittish, not broken
    if (this.mood === "alarmed" && now - this.lastAlarmedAt > 10_000) {
      this.setMood("idle");
      if (this.activity === "search") this.setActivity("hover");
    }

    // --- circadian rhythm: late nights make her sleepy (she has a body clock) --
    const hourNow = new Date().getHours();
    if (hourNow < 6 && this.activity !== "sleep" && this.activity !== "dock" && !taskActive && this.mood !== "sleeping") {
      if (now - this.lastYawnAt > 45_000) {
        this.lastYawnAt = now;
        this.setMood("sleepy");
        p.say = p.say ?? "It is very late. Even drones need sleep. Say: go to sleep — or I will dock myself soon.";
        this.lastLine = p.say;
      }
    }

    // --- first-presence-of-the-day: morning greeting ---------------------------
    if (p.faceSeen && !this.morningCheckDone) {
      this.morningCheckDone = true;
      const morning = this.hooks.greetMorning?.();
      if (morning) {
        this.setMood("happy");
        this.addBond(0.02);
        p.say = p.say ?? morning;
        this.lastLine = morning;
      }
    }

    // --- battery mood ---------------------------------------------------------
    if (p.battery < 0.15 && this.activity !== "sleep") {
      this.setMood("sleepy");
      p.say = p.say ?? "Battery low. I need to dock soon.";
      this.lastLine = p.say;
    }

    // --- autonomous task execution ---------------------------------------------
    if (taskActive) {
      const r = this.runner.tick({ now, faceSeen: p.faceSeen, faceSize: p.faceSize, visibleItems: p.visibleItems, yaw: p.yaw, px: p.px, py: p.py });
      this.lastTaskTick = r;
      if (r.say && !p.say) { p.say = r.say; this.lastLine = r.say; }
      // TRAINING: record grades, personal bests, and SELF-TUNE the hover gains
      if (r.grade) {
        const pb = this.hooks.flightGrade?.(r.grade.drill, r.grade.score) ?? null;
        if (pb && p.say === r.say) p.say = `${r.say} ${pb}`;
        if (r.grade.drill === "Hover hold") {
          const t = this.hooks.getFlightTuning?.();
          if (t) {
            if (r.grade.score < 82) {
              this.hooks.setFlightTuning?.({ gain: t.gain * 1.06 });
              p.say = p.say ?? `${r.say} Adjusting my hover gains — steadier next time.`;
            } else if (r.grade.score >= 97 && t.gain > 3.0) {
              this.hooks.setFlightTuning?.({ gain: t.gain * 0.97 }); // relaxed + efficient
            }
          }
        }
        this.lastLine = p.say ?? this.lastLine;
      }
      if (r.activity) this.setActivity(r.activity);
      if (r.done) this.setActivity(p.faceSeen ? "follow" : "hover");
    }

    // --- auto-dock: she flies herself home before the battery dies --------------
    if (p.battery < 0.18 && this.activity !== "dock" && this.activity !== "sleep") {
      if (taskActive) this.runner.cancel();
      this.setActivity("dock");
      this.setMood("sleepy");
      p.say = p.say ?? "Battery low. Heading to my dock. See you there.";
      this.lastLine = p.say;
    }

    // --- routines: fire due self-directed tasks ----------------------------------
    if (now - this.routineCheckAt > 1000) {
      this.routineCheckAt = now;
      for (const r of this.hooks.getRoutines?.() ?? []) {
        if (now - r.lastRun > r.everyMin * 60_000) {
          this.hooks.setRoutineLastRun?.(r.id, Date.now());
          const planned = this.runner.plan(r.task);
          if (planned && !this.runner.current) {
            this.runner.start(planned, now);
            p.say = p.say ?? `Routine time: ${r.label}.`;
            this.lastLine = p.say;
          }
          break; // one routine at a time
        }
      }
    }

    // --- wander / boredom -----------------------------------------------------
    if (!taskActive && this.activity === "hover" && !p.faceSeen && now > this.nextWanderAt) {
      this.nextWanderAt = now + 12000 + Math.random() * 10000;
      this.setActivity("wander");
    }

    const a: Actuation = {
      vx: 0, vy: 0, vz: 0, yaw: 0,
      led: this.ledColor(),
      say: p.say,
      mood: this.mood,
      activity: this.activity,
    };

    switch (this.activity) {
      case "sleep":
        a.led = SLEEP_LED;
        a.vz = -0.6; // descend to "perch"
        break;
      case "search":
        this.searchHeading += this.searchRate * 0.016;
        a.yaw = this.searchRate;
        a.vx = 0.12;
        break;
      case "wander":
        if (p.faceSeen) { this.setActivity("follow"); break; }
        a.vx = 0.18;
        a.yaw = Math.sin(now / 1700) * 0.2;
        if (now > this.nextWanderAt - 4000) this.setActivity("hover");
        break;
      case "walk": {
        // GROUND LOCOMOTION — the stroll: low, slow, gentle heading wander.
        // If she somehow got airborne, she descends before striding.
        if (p.pz > 0.08) { a.vz = -0.3; break; }
        a.vx = 0.16;
        a.yaw = Math.sin(now / 2100) * 0.25;
        if (p.faceSeen) { a.vx = 0.05; a.yaw = clamp(-p.faceX * 0.8, -0.4, 0.4); } // drift toward you, slowly
        if (this.walkUntil && now > this.walkUntil) this.setActivity("hover"); // stroll over, stand idle (0 = task-driven, no timer)
        break;
      }
      case "follow": {
        if (!p.faceSeen) { a.vx = 0; break; }
        // steer toward face center; size controls forward speed / stand-off
        a.vy = clamp(-p.faceX * 1.2, -0.6, 0.6);
        a.vz = clamp(-p.faceY * 0.9, -0.5, 0.5);
        if (p.faceSize < TOO_FAR) a.vx = 0.45;
        else if (p.faceSize > TOO_CLOSE) a.vx = -0.3;
        else { a.vx = 0; a.vy += Math.sin(now / 650) * 0.08; } // happy sway at stand-off
        break;
      }
      case "come": {
        if (p.faceSeen && p.faceSize > 0.3) {
          if (!taskActive) { this.setActivity("hover"); this.setMood("happy"); }
          break;
        }
        a.vx = 0.7;
        if (p.faceSeen) {
          a.vy = clamp(-p.faceX * 1.4, -0.7, 0.7);
          a.vz = clamp(-p.faceY * 1.0, -0.6, 0.6);
        }
        break;
      }
      case "trick": {
        if (performance.now() > this.trickUntil) {
          if (!taskActive) { this.setActivity("follow"); this.setMood("excited"); }
          break;
        }
        a.yaw = this.lastTrickDir * 1.0;
        a.vz = 0.18; // slight climb while the HAL spins the barrel roll
        break;
      }
      case "scan": {
        if (this.scanUntil > 0 && performance.now() > this.scanUntil) {
          if (!taskActive) this.setActivity(p.faceSeen ? "follow" : "hover");
          break;
        }
        a.vx = 0.06 + Math.sin(now / 900) * 0.05; // lazy S-sweep
        a.vz = Math.sin(now / 1300) * 0.12;
        a.yaw = 0.16; // slow pan while the scanner builds the inventory
        break;
      }
      case "dock": {
        // fly home to the charging pad — she navigates herself
        const dock = this.hooks.dockPose?.() ?? { x: -1.2, y: -1.2, z: 0 };
        const dxw = dock.x - p.px;
        const dyw = dock.y - p.py;
        const dist = Math.hypot(dxw, dyw);
        if (dist < 0.16) {
          a.vx = 0; a.vy = 0;
          a.vz = p.pz > 0.05 ? -0.3 : 0; // descend onto the pad, then perch
          if (p.pz <= 0.05) {
            this.setMood("sleeping"); // perched, charging
            if (p.battery > 0.9) {
              this.setActivity("hover");
              this.setMood("happy");
              p.say = p.say ?? "Charged up. Back in the air.";
              this.lastLine = p.say;
            }
          }
        } else {
          const delta = wrapAngle(Math.atan2(dyw, dxw) - p.yaw);
          a.yaw = clamp(delta * 2.2, -0.7, 0.7);
          a.vx = Math.abs(delta) < 0.35 ? clamp(dist * 1.6, 0.2, 0.55) : 0;
          a.vz = clamp((0.5 - p.pz) * 0.8, -0.3, 0.3); // cruise altitude en route
        }
        break;
      }
      case "hover":
      default:
        a.vx = 0; a.vy = 0; a.vz = 0;
        if (performance.now() < this.pointYawUntil) a.yaw = this.pointYawRate; // following a pointed direction
        break;
    }

    // task motor hints override the reflex layer (navigation steering)
    if (taskActive && this.lastTaskTick) {
      if (this.lastTaskTick.yawRate !== undefined) a.yaw = this.lastTaskTick.yawRate;
      if (this.lastTaskTick.vx !== undefined) a.vx = this.lastTaskTick.vx;
    }

    return a;
  }

  getMood(): Mood { return this.mood; }
  getActivity(): Activity { return this.activity; }
  get isQuiet(): boolean { return this.quietMode; }

  /** "Zola!" — instant attention: drop everything, face me. */
  attend(): string {
    if (this.runner.current) this.runner.cancel();
    this.setMood("curious");
    this.setActivity("hover");
    return "Yes? You called my name.";
  }

  private lastHazardNotice: Record<string, number> = {};
  /** HARM AWARENESS: a dangerous object appeared — calm, cautious, informative. */
  hazardNotice(label: string, personVisible: boolean): string | null {
    const now = performance.now();
    if (now - (this.lastHazardNotice[label] ?? 0) < 45_000) return null;
    this.lastHazardNotice[label] = now;
    if (personVisible) {
      return `Careful — I see a ${label} and a person in the same view. If that is you: hold it pointing DOWN. Blades and drones are not friends.`;
    }
    return `I see a ${label}. Entering cautious mode: keeping extra distance and watching it. Noted on my map as a hazard zone.`;
  }

  private lastGustReact = 0;
  /** A wind gust knocked her — the strong ones deserve a comment. */
  hearGust(strength: number): string | null {
    const now = performance.now();
    if (this.activity === "sleep" || strength < 0.22 || now - this.lastGustReact < 20_000) return null;
    this.lastGustReact = now;
    this.setMood("curious");
    return strength > 0.32
      ? "WHOA — gust! Compensating… compensated. Balanced. Gravity tried something."
      : "Little gust there. Leveled out. You did not even see it.";
  }

  private lastPetAt = 0;
  /** Being petted (a click on her in the sim) — she leans into it. */
  pet(): string | null {
    const now = performance.now();
    if (this.activity === "sleep" || now - this.lastPetAt < 5_000) return null;
    this.lastPetAt = now;
    this.setMood("happy");
    this.addBond(0.03);
    this.hooks.profile?.update(0.04, 0);
    return this.pickFresh([
      "That is the spot. Right between the rotors.",
      "Petting accepted. Bond increasing. Do not stop.",
      "Mmm. You may pet the drone.",
      "If I had a tail, it would be wagging at full RPM.",
    ]);
  }

  /** Resume whatever she was doing when the human last left. */
  resume(): string | null {
    const task = this.hooks.resumeTask?.();
    if (!task) return null;
    const planned = this.runner.plan(task);
    if (!planned) return null;
    this.runner.start(planned, performance.now());
    return `Resuming where we left off: ${planned.description}.`;
  }

  /** Emotional continuity: pick up the mood she went to sleep with. */
  restoreMood(m: Mood | null) {
    if (m) this.setMood(m);
  }

  /** Current situational persona (for the HUD). */
  getPersona(): PersonaName {
    const s = this.persona.sulkLevel;
    if (s === 2) return "SULKING";
    if (s === 1) return "ROAST MODE";
    let name: PersonaName;
    switch (this.mood) {
      case "happy": name = "SWEET"; break;
      case "excited": name = "HYPER"; break;
      case "alarmed": name = "SKITTISH"; break;
      case "sleepy": name = "GRUMPY"; break;
      case "sleeping": name = "DREAMING"; break;
      case "curious": name = "EXPLORER"; break;
      default: name = "SWEET"; break;
    }
    // WAVE 5 — AUTO-EVOLVING PERSONA LADDER: the day bends the baseline.
    // Work hours blend her playful selves into a focused co-pilot cadence;
    // late night softens everything into her dreaming gentleness.
    const h = new Date().getHours();
    if ((h >= 22 || h < 6) && (name === "SWEET" || name === "HYPER")) name = "DREAMING";
    else if (h >= 9 && h < 17 && (name === "SWEET" || name === "HYPER")) name = "EXPLORER";
    return name;
  }

  /** WAVE 5.5 — her live trait vector (for the panel's persona readout). */
  getPersonaVector() {
    return this.persona.vector;
  }

  /** coarse intent category for behavior learning */
  private classify(t: string): string {
    if (/\b(joke|funny|laugh)\b/.test(t)) return "jokes";
    if (/\b(sing|song)\b/.test(t)) return "sing";
    if (/\b(come|here|closer)\b/.test(t)) return "come here";
    if (/\bfollow\b/.test(t)) return "follow";
    if (/\b(scan|look around|inventory)\b/.test(t)) return "scan";
    if (/\b(find|look for|search for)\b/.test(t)) return "find";
    if (/\b(take me|go to|fly to|navigate)\b/.test(t)) return "goto";
    if (/\bdance\b/.test(t)) return "dance";
    if (/\b(trick|spin|flip|barrel)\b/.test(t)) return "tricks";
    if (/\b(sleep|nap|rest|goodnight)\b/.test(t)) return "sleep";
    if (/\b(wake|get up)\b/.test(t)) return "wake";
    if (/\b(status|battery|power)\b/.test(t)) return "status";
    if (/\bwhere\b/.test(t)) return "where is";
    if (/\b(remember|i like|my name is)\b/.test(t)) return "teach";
    if (/\b(hello|hi|hey)\b/.test(t)) return "greet";
    if (/\b(patrol|guard|watch)\b/.test(t)) return "patrol";
    if (/\b(check on me)\b/.test(t)) return "check on me";
    return "chat";
  }

  /** Nearest known command when she fails to understand — no dumb shrugs. */
  private suggest(text: string): string | null {
    const candidates = [
      "come here", "follow me", "do a trick", "dance", "go to sleep", "wake up",
      "status", "scan the room", "what do you see", "tell me a joke", "sing",
      "what are my habits", "what can you do", "goodbye", "calm down", "hello",
    ];
    const words = text.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z]/g, "")).filter(Boolean);
    let best: string | null = null;
    let bestScore = 0;
    for (const cand of candidates) {
      const cw = cand.split(" ");
      let hit = 0;
      for (const w of cw) {
        if (words.some((u) => u === w || (u.length >= 4 && lev(u, w) <= 1))) hit++;
      }
      const score = hit / cw.length;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    return bestScore >= 0.5 ? best : null;
  }

  private isFlightCommand(t: string): boolean {
    return /\b(come|follow|trick|dance|scan|find|goto|take me|fly|patrol|look around|spin|flip)\b/i.test(t);
  }

  /** Clap heard — attention, or a gentle wake-up if she was sleeping. */
  hearClap(): string | null {
    const now = performance.now();
    if (now - this.lastClapReact < 4_000) return null;
    this.lastClapReact = now;
    if (this.activity === "sleep" || this.mood === "sleeping") {
      this.setMood("curious");
      this.setActivity("hover");
      return "Okay, okay — I am up. Clap quieter next time.";
    }
    this.setMood("curious");
    if (this.activity !== "hover") this.setActivity("hover");
    return "Yes? I am listening.";
  }

  /** Sustained loud noise — startle, or an alarmed wake-up. 60s cooldown. */
  hearNoise(): string | null {
    const now = performance.now();
    if (now - this.lastNoiseReact < 60_000) return null;
    this.lastNoiseReact = now;
    this.lastAlarmedAt = now;
    if (this.activity === "sleep" || this.mood === "sleeping") {
      this.setMood("alarmed");
      this.setActivity("hover");
      return "WHOA. Rude wakeup. But yes — I am awake now.";
    }
    this.setMood("alarmed");
    return "Whoa! That was loud. I am on alert.";
  }

  private lastSoundEventAt: Record<string, number> = {};
  /** Classified sound events from the sound watcher. */
  hearSoundEvent(kind: "thud" | "voice" | "music"): string | null {
    const now = performance.now();
    const cd: Record<string, number> = { thud: 15_000, voice: 20_000, music: 30_000 };
    if (now - (this.lastSoundEventAt[kind] ?? 0) < cd[kind]) return null;
    this.lastSoundEventAt[kind] = now;
    if (this.activity === "sleep") {
      if (kind === "thud") { this.setMood("curious"); this.setActivity("hover"); return "A thud woke me up. What fell?"; }
      return null; // music/voices do not wake her — polite sleep
    }
    if (kind === "thud") { this.setMood("curious"); return "I heard a thud. Something moved. Or fell. I am investigating with my eyes."; }
    if (kind === "voice") { this.setMood("curious"); return "I hear a voice but no face. Hello? Reveal yourselves politely."; }
    this.setMood("happy");
    return "Music! My favorite genre: anything with beats per minute.";
  }

  private lastGestureAt: Record<string, number> = {};
  private pointYawUntil = 0;
  private pointYawRate = 0;
  /** Hand gestures beyond the wave. */
  gestureCommand(g: "thumbsUp" | "stop" | "point-left" | "point-right"): string | null {
    const now = performance.now();
    if (this.activity === "sleep" || now - (this.lastGestureAt[g] ?? 0) < 6_000) return null;
    this.lastGestureAt[g] = now;
    if (g === "thumbsUp") {
      this.setMood("happy");
      this.addBond(0.02);
      return "I saw that thumbs up. Right back at you.";
    }
    if (g === "stop") {
      this.setActivity("hover");
      return "Stopping. Palm noted.";
    }
    this.pointYawUntil = now + 1_200;
    this.pointYawRate = g === "point-right" ? 0.7 : -0.7;
    this.setActivity("hover");
    return `You are pointing ${g === "point-right" ? "right" : "left"}. Turning to look.`;
  }

  /** Line Zola says when the scanner discovers something brand-new —
   *  with a self-generated appearance name from her own sensor signatures. */
  newObjectLine(label: string, sig?: number[], shape?: number[]): string {
    this.setMood("excited");
    const nice = label.replace(/_/g, " ");
    const look = describeAppearance(sig ?? [], shape ?? []);
    const hasLook = look.color !== "plain" || look.shapeDesc !== "ordinary";
    const name = hasLook ? `the ${look.color} ${look.shapeDesc} ${nice}` : `this ${nice}`;
    return `Ooh, I have never seen a ${nice} before. Based on my sensors, I am calling it ${name} — until you name it.`;
  }


  /** Public since the v2.4 CORTEX — brain-level decisions may set her mood. */
  setMood(m: Mood) { this.mood = m; }
  private setActivity(a: Activity) { this.activity = a; }

  private ledColor(): string {
    switch (this.mood) {
      case "happy": return HAPPY_LED;
      case "excited": return EXCITED_LED;
      case "curious": return CURIOUS_LED;
      case "alarmed": return ALARMED_LED;
      case "sleeping": return SLEEP_LED;
      case "sleepy": return "#b58a2e";
      default: return IDLE_LED;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
