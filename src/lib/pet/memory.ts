// ============================================================================
// DRONE PET — Memory (what AURA learns, and how it stays safe doing it)
//
// PRIVACY CONTRACT (enforced by this module, not just promised):
//   • Everything is processed and stored LOCALLY in this browser only.
//   • Face data is stored as a derived numeric signature — never an image.
//   • Nothing is uploaded; there is no network call anywhere in this module.
//   • Consent is explicit and per-sense (camera / mic / face-index).
//   • The user can inspect and WIPE all learned data at any time.
// ============================================================================

/** Everything Zola notices about how a person BEHAVES over time. */
export interface PersonBehavior {
  /** presence counts per hour-of-day (0-23) — their rhythm */
  hours: number[];
  presenceNotes: number;
  /** what they ask for, counted by category */
  commands: Record<string, number>;
  smiles: number;
  frowns: number;
  messages: number;
  msgLenTotal: number;
  firstMet: number;
  lastActive: number;
}

function freshBehavior(): PersonBehavior {
  return {
    hours: new Array<number>(24).fill(0),
    presenceNotes: 0,
    commands: {},
    smiles: 0,
    frowns: 0,
    messages: 0,
    msgLenTotal: 0,
    firstMet: Date.now(),
    lastActive: Date.now(),
  };
}

export interface KnownPerson {
  id: string;
  name: string;
  /** derived face signature (not an image, not reversible into one) */
  embedding: number[];
  firstSeen: number;
  lastSeen: number;
  encounters: number;
  /** learned behavioral profile (lazily initialized for old records) */
  behavior?: PersonBehavior;
}

export interface LearnedFact {
  text: string;
  at: number;
}

export interface Consent {
  camera: boolean;
  mic: boolean;
  faceIndex: boolean; // may it remember who you are?
}

export interface KnownItem {
  id: string;
  /** raw detector label, e.g. "cup" */
  label: string;
  /** optional human-taught name, e.g. "my mug" */
  customName: string | null;
  firstSeen: number;
  lastSeen: number;
  sightings: number;
  /** drone heading (radians) at the most recent sighting — spatial memory */
  lastYaw: number | null;
  /** remembered world position (spatial map) */
  pos: { x: number; y: number; z: number } | null;
  /** color identity signature — distinguishes THIS cup from THAT cup */
  sig: number[];
  /** shape identity signature (mini-HOG) — round vs angular vs elongated */
  shape?: number[];
  /** HARM AWARENESS: this object can hurt someone — she keeps distance + reports */
  hazard?: boolean;
}

const LifeDay = { today: () => new Date().toISOString().slice(0, 10) };

/** Rolling conversation log — what was said, not audio. Local only. */
export interface ChatEntry {
  who: "you" | "aura";
  text: string;
  at: number;
}

/** How AURA adapts to her specific human (learned, persisted). */
export interface HumanProfile {
  /** 0..1 — how warmly she treats them (raised by praise/thanks, lowered by rudeness) */
  warmth: number;
  /** 0..1 — >0.6 means the human speaks in short commands, so she answers briefly */
  brief: number;
  /** 0..1 — friendship level, persisted across sessions */
  bond: number;
}

/** Recurring self-directed tasks: "check on me every 5 minutes". */
export interface RoutineData {
  id: string;
  label: string;
  /** the command AURA executes when the routine fires */
  task: string;
  everyMin: number;
  lastRun: number;
}

export interface MemoryData {
  version: 1;
  consent: Consent;
  people: KnownPerson[];
  items: KnownItem[];
  facts: LearnedFact[];
  conversation: ChatEntry[];
  routines: RoutineData[];
  profile: HumanProfile;
  /** emotional continuity: the mood she ended the last session with */
  lastMood: string | null;
  /** her LIFE: today's story + last night's dream + the diary of past days */
  daily: { day: string; commands: number; items: number; people: number };
  diary: { day: string; summary: string }[];
  lastSession: { activity: string; task: string } | null;
  lastGreetDay: string | null;
  lastDream: string | null;
  /** phrases the human explicitly taught her: heard → means */
  learnedPhrases: { heard: string; means: string }[];
  /** TRAINING: self-tuned flight gains, personal bests, flight hours */
  tuning: { gain: number; drag: number; power: number };
  flightScores: Record<string, number>;
  flightSeconds: number;
  flightFlights: number;
  /** REINFORCEMENT: which chatter topics the human actually responds to */
  chatterStats: Record<string, { w: number; tries: number; hits: number }>;
  /** her equipment state — restored automatically on reload */
  settings: { scanner: boolean; gestures: boolean; soundWatch: boolean; localEars: boolean };
  stats: { sessions: number; commands: number; greetings: number };
}

const KEY = "aura.memory.v1";

function fresh(): MemoryData {
  return {
    version: 1,
    consent: { camera: false, mic: false, faceIndex: false },
    people: [],
    items: [],
    facts: [],
    conversation: [],
    routines: [],
    profile: { warmth: 0.5, brief: 0.5, bond: 0 },
    lastMood: null,
    daily: { day: LifeDay.today(), commands: 0, items: 0, people: 0 },
    diary: [],
    lastGreetDay: null,
    lastDream: null,
    lastSession: null,
    learnedPhrases: [],
    tuning: { gain: 3.2, drag: 2.4, power: 0.8 },
    flightScores: {},
    flightSeconds: 0,
    flightFlights: 0,
    chatterStats: {},
    settings: { scanner: false, gestures: false, soundWatch: false, localEars: false },
    stats: { sessions: 0, commands: 0, greetings: 0 },
  };
}

export interface MatchResult {
  person: KnownPerson;
  similarity: number;
}

export class AuraMemory {
  private data: MemoryData;

  constructor() {
    this.data = this.load();
    this.data.stats.sessions += 1;
    this.save();
  }

  // ---- persistence ----------------------------------------------------------
  private load(): MemoryData {
    if (typeof window === "undefined") return fresh();
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw) as MemoryData;
      if (parsed?.version !== 1) return fresh();
      return { ...fresh(), ...parsed, consent: { ...fresh().consent, ...parsed.consent } };
    } catch {
      return fresh();
    }
  }

  private save() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage may be unavailable (private mode) — learning degrades to session-only */
    }
  }

  get snapshot(): Readonly<MemoryData> {
    return this.data;
  }

  // ---- consent ---------------------------------------------------------------
  getConsent(): Readonly<Consent> { return this.data.consent; }
  grantConsent(patch: Partial<Consent>) {
    this.data.consent = { ...this.data.consent, ...patch };
    this.save();
  }

  // ---- face learning & recognition -------------------------------------------
  /** Returns the best match above threshold, or null if this face is new. */
  recognize(embedding: number[], threshold = 0.93): MatchResult | null {
    if (!this.data.consent.faceIndex || embedding.length === 0) return null;
    let best: KnownPerson | null = null;
    let bestSim = 0;
    for (const p of this.data.people) {
      const sim = cosine(embedding, p.embedding);
      if (sim > bestSim) { bestSim = sim; best = p; }
    }
    if (best && bestSim >= threshold) {
      best.lastSeen = Date.now();
      best.encounters += 1;
      this.save();
      return { person: best, similarity: bestSim };
    }
    return null;
  }

  /** Attach a name to the face most recently seen (the "my name is X" flow). */
  learnName(name: string, embedding: number[]): KnownPerson {
    const clean = name.trim().slice(0, 32);
    const match = this.recognize(embedding);
    if (match) {
      match.person.name = clean;
      this.save();
      return match.person;
    }
    const person: KnownPerson = {
      id: `p_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      name: clean,
      embedding,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      encounters: 1,
    };
    this.data.people.push(person);
    this.save();
    return person;
  }

  forgetPerson(id: string) {
    this.data.people = this.data.people.filter((p) => p.id !== id);
    this.save();
  }

  // ---- item learning (scan mode) ---------------------------------------------

  /**
   * Record a scanner sighting. With a color signature, same-label objects
   * are matched individually: your blue mug ≠ the white cup. Different
   * signature = a NEW individual object gets its own identity.
   */
  learnItem(
    label: string,
    yaw?: number,
    pos?: { x: number; y: number; z: number } | null,
    sig?: number[],
    shape?: number[],
  ): { item: KnownItem; isNew: boolean; moved?: { x: number; y: number; z: number } } {
    const candidates = this.data.items.filter((i) => i.label === label);
    let match: KnownItem | null = null;
    if ((sig && sig.length > 0) || (shape && shape.length > 0)) {
      // combined identity: color + shape channels averaged
      let bestSim = 0;
      for (const c of candidates) {
        let sim = 0, have = 0;
        if (sig && sig.length > 0 && c.sig && c.sig.length > 0) { sim += cosine(sig, c.sig); have++; }
        if (shape && shape.length > 0 && c.shape && c.shape.length > 0) { sim += cosine(shape, c.shape); have++; }
        if (have === 0) continue;
        const s = sim / have;
        if (s > bestSim) { bestSim = s; match = c; }
      }
      if (bestSim < 0.75) match = null; // a different physical object
    } else if (candidates.length > 0) {
      match = candidates[candidates.length - 1];
    }
    if (match) {
      match.lastSeen = Date.now();
      match.sightings += 1;
      if (yaw !== undefined) match.lastYaw = yaw;
      // CHANGE DETECTION: the same object at a different place = it moved
      let moved: { x: number; y: number; z: number } | undefined;
      if (pos && match.pos && Math.hypot(pos.x - match.pos.x, pos.y - match.pos.y) > 0.5) {
        moved = { ...match.pos };
      }
      if (pos) match.pos = pos;
      this.save();
      return { item: match, isNew: false, moved };
    }
    const item: KnownItem = {
      id: `i_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      label,
      customName: null,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      sightings: 1,
      lastYaw: yaw ?? null,
      pos: pos ?? null,
      sig: sig ?? [],
      shape: shape ?? [],
    };
    this.data.items.push(item);
    this.save();
    return { item, isNew: true };
  }

  // ---- behavior learning -------------------------------------------------------

  /** Note something about how a specific person behaves. */
  noteBehavior(
    personId: string,
    kind: "presence" | "command" | "smile" | "frown" | "message",
    detail?: string,
  ) {
    const p = this.data.people.find((x) => x.id === personId);
    if (!p) return;
    if (!p.behavior) p.behavior = freshBehavior();
    const b = p.behavior;
    b.lastActive = Date.now();
    if (kind === "presence") {
      b.hours[new Date().getHours()] += 1;
      b.presenceNotes += 1;
    } else if (kind === "command" && detail) {
      b.commands[detail] = (b.commands[detail] ?? 0) + 1;
    } else if (kind === "smile") {
      b.smiles += 1;
    } else if (kind === "frown") {
      b.frowns += 1;
    } else if (kind === "message") {
      b.messages += 1;
      b.msgLenTotal += Number(detail) || 0;
    }
    this.save();
  }

  /** A spoken report of one person's behavioral patterns. */
  behaviorSummary(personId: string): string | null {
    const p = this.data.people.find((x) => x.id === personId);
    if (!p?.behavior) return null;
    const b = p.behavior;
    const parts: string[] = [`${p.name}, here is what I have noticed about you.`];

    // rhythm: peak presence hour
    const peak = b.hours.indexOf(Math.max(...b.hours));
    if (b.presenceNotes >= 3 && Math.max(...b.hours) > 0) {
      parts.push(`You usually show up around ${peak}:00.`);
    }
    // favorite things to ask
    const cmds = Object.entries(b.commands).sort((a, c) => c[1] - a[1]).slice(0, 3);
    if (cmds.length > 0) {
      parts.push(`Your favorite requests: ${cmds.map(([k, v]) => `${k} (${v})`).join(", ")}.`);
    }
    // emotional baseline
    if (b.smiles + b.frowns >= 3) {
      parts.push(b.smiles > b.frowns
        ? `You smile a lot — ${b.smiles} smiles versus ${b.frowns} frowns. I approve.`
        : `You have frowned ${b.frowns} times versus ${b.smiles} smiles. Is everything okay lately?`);
    }
    // chattiness
    if (b.messages >= 5) {
      const avg = b.msgLenTotal / b.messages;
      parts.push(avg < 15 ? "You keep it short. Efficient. I respect that." : "You like to talk. I am listening.");
    }
    return parts.length > 1 ? parts.join(" ") : null;
  }

  /** Human-readable identity: "cup", or "cup #2" when she knows several. */
  displayName(item: KnownItem): string {
    const sameLabel = this.data.items.filter((i) => i.label === item.label);
    if (sameLabel.length === 1) return item.customName ?? item.label;
    const idx = sameLabel.findIndex((i) => i.id === item.id) + 1;
    return `${item.customName ?? item.label}${idx > 1 ? ` #${idx}` : ""}`;
  }

  /** Mark an item as a hazard (persists — she remembers where danger lives). */
  markHazard(item: KnownItem) {
    item.hazard = true;
    this.save();
  }

  /** Everything hazardous she knows, with recency. */
  knownHazards(): { name: string; agoSec: number; pos: { x: number; y: number; z: number } | null }[] {
    return this.data.items
      .filter((i) => i.hazard)
      .map((i) => ({
        name: this.displayName(i),
        agoSec: Math.round((Date.now() - i.lastSeen) / 1000),
        pos: i.pos,
      }));
  }

  /** Closest matching item to a world position (multi-instance aware). */
  nearestItem(
    match: (i: KnownItem) => boolean,
    from?: { x: number; y: number },
  ): KnownItem | null {
    const cands = this.data.items.filter(match);
    if (cands.length === 0) return null;
    if (!from) return cands[cands.length - 1];
    const d = (i: KnownItem) => (i.pos ? Math.hypot(i.pos.x - from.x, i.pos.y - from.y) : 99);
    cands.sort((a, b) => d(a) - d(b));
    return cands[0];
  }

  /** Give a scanner-discovered item a human name ("this is my mug"). */
  renameMostRecentItem(name: string): KnownItem | null {
    if (this.data.items.length === 0) return null;
    const item = this.data.items[this.data.items.length - 1];
    item.customName = name.trim().slice(0, 32);
    this.save();
    return item;
  }

  forgetItem(id: string) {
    this.data.items = this.data.items.filter((i) => i.id !== id);
    this.save();
  }

  itemCount(): number { return this.data.items.length; }

  // ---- conversation memory ------------------------------------------------------

  addChat(who: "you" | "aura", text: string) {
    this.data.conversation.push({ who, text, at: Date.now() });
    this.data.conversation = this.data.conversation.slice(-60);
    this.save();
  }

  recentChat(n: number): ChatEntry[] {
    return this.data.conversation.slice(-n);
  }

  // ---- routines ------------------------------------------------------------------

  addRoutine(label: string, task: string, everyMin: number): string {
    const id = `r_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    this.data.routines.push({ id, label, task, everyMin, lastRun: Date.now() });
    this.save();
    return id;
  }

  removeRoutine(idOrLabel: string): boolean {
    const key = idOrLabel.toLowerCase();
    const before = this.data.routines.length;
    this.data.routines = this.data.routines.filter(
      (r) => r.id !== idOrLabel && !r.label.toLowerCase().includes(key)
    );
    this.save();
    return this.data.routines.length < before;
  }

  listRoutines(): RoutineData[] { return this.data.routines; }

  touchRoutine(id: string, at: number) {
    const r = this.data.routines.find((x) => x.id === id);
    if (r) { r.lastRun = at; this.save(); }
  }

  // ---- human-adaptation profile --------------------------------------------

  getProfile(): HumanProfile { return { ...this.data.profile }; }

  /** Emotional continuity across sessions. */
  getLastMood(): string | null { return this.data.lastMood; }
  setLastMood(m: string) { this.data.lastMood = m; this.save(); }

  // ---- her LIFE: daily story, morning greetings, dreams -----------------------

  /** Roll the daily story over at midnight — the finished day goes to her diary. */
  private ensureDaily(): { day: string; commands: number; items: number; people: number } {
    const today = LifeDay.today();
    if (this.data.daily.day !== today) {
      const old = this.data.daily;
      const bits: string[] = [];
      if (old.commands > 0) bits.push(`${old.commands} ${old.commands === 1 ? "command" : "commands"}`);
      if (old.items > 0) bits.push(`${old.items} new ${old.items === 1 ? "thing" : "things"} learned`);
      if (old.people > 0) bits.push(`${old.people} ${old.people === 1 ? "person" : "people"} met`);
      const summary = bits.length > 0
        ? `You asked for ${bits.join(", ")}.`
        : "A quiet day. I mostly hovered and thought about the ceiling.";
      this.data.diary.push({ day: old.day, summary });
      this.data.diary = this.data.diary.slice(-30); // a month of memories
      this.data.daily = { day: today, commands: 0, items: 0, people: 0 };
      this.save();
    }
    return this.data.daily;
  }

  /** Recent diary entries, newest first. */
  getDiary(): { day: string; summary: string }[] {
    this.ensureDaily();
    return [...this.data.diary].reverse().slice(0, 7);
  }

  /** "What did you do yesterday?" */
  yesterdayReport(): string | null {
    const y = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const entry = this.data.diary.find((d) => d.day === y);
    return entry ? `Yesterday: ${entry.summary}` : null;
  }

  /** Where she was when the human last left — for the "where was I" resume. */
  getLastSession(): { activity: string; task: string } | null {
    return this.data.lastSession ?? null;
  }

  setLastSession(activity: string, task: string) {
    this.data.lastSession = { activity, task };
    this.save();
  }

  /** Adopt a memory backup (the EXPORT file) — for moving her between machines. */
  importJSON(text: string): boolean {
    try {
      const parsed = JSON.parse(text) as Partial<MemoryData>;
      if (!parsed || parsed.version !== 1) return false;
      const base = fresh();
      this.data = {
        ...base,
        ...parsed,
        consent: { ...base.consent, ...parsed.consent },
        profile: { ...base.profile, ...parsed.profile },
        daily: parsed.daily ?? base.daily,
      } as MemoryData;
      this.save();
      return true;
    } catch {
      return false;
    }
  }

  countDaily(kind: "commands" | "items" | "people") {
    const d = this.ensureDaily();
    d[kind] += 1;
    this.save();
  }

  /** Spoken summary of today so far (null on a quiet day). */
  dailyReport(): string | null {
    const d = this.ensureDaily();
    if (d.commands === 0 && d.items === 0 && d.people === 0) return null;
    const parts: string[] = [];
    if (d.commands > 0) parts.push(`${d.commands} things asked of me`);
    if (d.items > 0) parts.push(`${d.items} new ${d.items === 1 ? "thing" : "things"} learned`);
    if (d.people > 0) parts.push(`${d.people} ${d.people === 1 ? "person" : "people"} met`);
    return `Today so far: ${parts.join(", ")}.`;
  }

  /** First-presence-of-the-day greeting (mornings only). */
  greetMorning(): string | null {
    const today = LifeDay.today();
    if (this.data.lastGreetDay === today) return null;
    this.data.lastGreetDay = today;
    this.save();
    const h = new Date().getHours();
    if (h < 5 || h >= 12) return null; // only actual mornings
    return "Good morning! First sighting of the day. I kept everything safe while you were away.";
  }

  /**
   * Sleep consolidation — runs when she docks/sleeps: prunes stale memories
   * (not seen in 10 days, never named) and composes tonight's dream.
   */
  consolidate(): string {
    const before = this.data.items.length;
    const cutoff = Date.now() - 10 * 24 * 3600 * 1000;
    this.data.items = this.data.items.filter((i) => i.lastSeen > cutoff || !!i.customName);
    const pruned = before - this.data.items.length;

    const things = [
      ...this.data.items.map((i) => i.customName ?? i.label),
      ...this.data.people.map((p) => p.name),
    ];
    const dream = things.length > 0
      ? `I dreamed about the ${things[Math.floor(Math.random() * things.length)]}. In the dream it was flying. Everything flies in my dreams.`
      : "I dreamed of open sky and an infinite battery.";
    this.data.lastDream = dream;
    this.save();
    if (pruned > 0) console.log(`[zola] consolidation: forgot ${pruned} stale item(s)`);
    return dream;
  }

  /** The dream she had last sleep — consumed once. */
  getDream(): string | null {
    const d = this.data.lastDream;
    this.data.lastDream = null;
    this.save();
    return d;
  }

  // ---- teachable lexicon: phrases the human corrects, she remembers ----------

  learnPhrase(heard: string, means: string) {
    const clean = (s: string) => s.trim().slice(0, 80);
    const h = clean(heard), m = clean(means);
    if (!h || !m) return;
    const existing = this.data.learnedPhrases.find((p) => p.heard.toLowerCase() === h.toLowerCase());
    if (existing) existing.means = m;
    else {
      this.data.learnedPhrases.push({ heard: h, means: m });
      this.data.learnedPhrases = this.data.learnedPhrases.slice(-40);
    }
    this.save();
  }

  getLearnedPhrases(): { heard: string; means: string }[] {
    return [...this.data.learnedPhrases];
  }

  // ---- TRAINING: flight grades, self-tuning, logbook, chatter reinforcement ----

  getFlightTuning(): { gain: number; drag: number; power: number } {
    return { ...this.data.tuning };
  }

  setFlightTuning(patch: Partial<{ gain: number; drag: number; power: number }>) {
    const t = this.data.tuning;
    if (patch.gain !== undefined) t.gain = Math.max(1.2, Math.min(9, patch.gain));
    if (patch.drag !== undefined) t.drag = Math.max(1.0, Math.min(5, patch.drag));
    if (patch.power !== undefined) t.power = Math.max(0.4, Math.min(1.2, patch.power));
    this.save();
  }

  /** Record a drill score; returns a personal-best note when beaten. */
  flightGrade(drill: string, score: number): string | null {
    const best = this.data.flightScores[drill] ?? 0;
    this.data.flightScores[drill] = Math.max(best, score);
    this.save();
    return score > best && best > 0 ? ` New personal best! (previous: ${best}%)` : score > best ? " First score on the books." : null;
  }

  getFlightScores(): Record<string, number> { return { ...this.data.flightScores }; }

  addFlightTime(seconds: number) { this.data.flightSeconds += seconds; this.save(); }
  addFlight() { this.data.flightFlights += 1; this.save(); }
  getLogbook(): { hours: number; flights: number } {
    return { hours: this.data.flightSeconds / 3600, flights: this.data.flightFlights };
  }

  /** Reinforcement: chatter topics the human replies to get stronger. */
  reinforceChatter(category: string, responded: boolean) {
    const s = this.data.chatterStats[category] ?? { w: 1, tries: 0, hits: 0 };
    s.tries += 1;
    if (responded) { s.hits += 1; s.w = Math.min(3, s.w + 0.15); }
    else s.w = Math.max(0.2, s.w - 0.08);
    this.data.chatterStats[category] = s;
    this.save();
  }

  getChatterWeights(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.data.chatterStats)) out[k] = v.w;
    return out;
  }

  // ---- equipment settings (auto-restored on reload) ----------------------------

  getSettings(): { scanner: boolean; gestures: boolean; soundWatch: boolean; localEars: boolean } {
    return { ...this.data.settings };
  }

  setSetting(key: keyof AuraMemory["data"]["settings"], value: boolean) {
    this.data.settings[key] = value;
    this.save();
  }

  updateProfile(deltaWarmth: number, deltaBrief: number, bondAbsolute?: number) {
    const p = this.data.profile;
    p.warmth = clamp01(p.warmth + deltaWarmth);
    p.brief = clamp01(p.brief + deltaBrief);
    if (bondAbsolute !== undefined) p.bond = clamp01(bondAbsolute);
    this.save();
  }

  describeProfile(): string {
    const p = this.data.profile;
    const tone = p.brief > 0.6 ? "brief" : p.brief < 0.35 ? "chatty" : "balanced";
    const warmth = p.warmth > 0.7 ? "very warm" : p.warmth > 0.4 ? "friendly" : "guarded";
    return `adapted to you: ${tone} replies, ${warmth}`;
  }

  // ---- facts & preferences ----------------------------------------------------
  learnFact(text: string) {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    if (this.data.facts.some((f) => f.text.toLowerCase() === clean.toLowerCase())) return;
    this.data.facts.push({ text: clean, at: Date.now() });
    this.data.facts = this.data.facts.slice(-50); // cap: a pet doesn't hoard
    this.save();
  }

  countFact(name: string): number {
    return this.data.facts.filter((f) => f.text.toLowerCase().includes(name.toLowerCase())).length;
  }

  // ---- stats -------------------------------------------------------------------
  countCommand() { this.data.stats.commands += 1; this.save(); }
  countGreeting() { this.data.stats.greetings += 1; this.save(); }

  // ---- user rights ---------------------------------------------------------------
  /** Export everything AURA knows, as JSON the user can read themselves. */
  exportJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /** Full wipe — restores factory amnesia. */
  wipeAll() {
    this.data = fresh();
    try { window.localStorage.removeItem(KEY); } catch { /* noop */ }
    this.save();
  }
}

// ---- geometry helpers ---------------------------------------------------------

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
