// CORTEX — the capability registry (v3.1)
// ONE registry: every feature of House Zola as a callable capability.
//   - SYSTEM capabilities: real operations across her subsystems
//   - MODE-SHIFT capabilities: 500 operational modes (one per persona —
//     each shifts her trait vector, LED, speech style, cadence)
// The brain (Ollama tier or the on-device Genie) routes intent → registry.
// Rule 2: no stubs, no inflation — every registered capability executes.

export interface Capability {
  id: string;           // the decision verb, e.g. "diagnose" or "persona:Aria Prime"
  kind: "system" | "mode";
  label: string;        // the human-readable name
  description: string;  // what it does — the brain reads this
  run: () => string | Promise<string>; // executes; returns her spoken line
}

export interface CortexState {
  persona: string;      // the current persona id (name)
  mood: string;
  battery: number;
}

export class Cortex {
  private systemCaps = new Map<string, Capability>();
  private modeShifts = new Map<string, Capability>();
  private log: (who: "aura" | "sys", text: string) => void = () => {};

  onLog(fn: (who: "aura" | "sys", text: string) => void) {
    this.log = fn;
  }

  /** Register a system capability. Duplicates overwrite (idempotent). */
  register(cap: Capability): void {
    this.systemCaps.set(cap.id, cap);
  }

  registerMany(caps: Capability[]): void {
    caps.forEach((c) => this.register(c));
  }

  /** Wire the 500 mode-shift capabilities from the constellation.
   *  onShift: the consumer's real persona-change handler (the run delegates). */
  registerModeShifts(
    personas: { name: string; archetype: string }[],
    onShift: (name: string) => string,
  ): void {
    for (const p of personas) {
      const id = `mode:${p.name}`;
      this.modeShifts.set(id, {
        id,
        kind: "mode",
        label: `Become ${p.name}`,
        description: `Shift into the ${p.name} persona (${p.archetype}) — her trait vector, LED hue, speech style, and cadence all follow.`,
        run: () => onShift(p.name),
      });
    }
  }

  get size(): number {
    return this.systemCaps.size + this.modeShifts.size;
  }

  /** The full registry, grouped — for the brain's capability index. */
  index(): { system: Capability[]; personas: { total: number; sample: string[] } } {
    return {
      system: [...this.systemCaps.values()],
      personas: {
        total: this.modeShifts.size,
        sample: [...this.modeShifts.keys()].slice(0, 8),
      },
    };
  }

  /** Execute a capability by id. Returns her spoken line, or null if unknown. */
  async execute(id: string, state?: CortexState): Promise<string | null> {
    const cap = this.systemCaps.get(id) ?? this.modeShifts.get(id);
    if (!cap) return null;
    this.log("aura", `[CORTEX] ${cap.label}`);
    const line = await cap.run();
    if (line) this.log("aura", line);
    return line ?? `${cap.label} — done.`;
  }

  has(id: string): boolean {
    return this.systemCaps.has(id) || this.modeShifts.has(id);
  }

  /** The brain-facing capability summary (compact, for the system prompt). */
  summary(): string {
    const sys = [...this.systemCaps.values()].map((c) => c.id).join(", ");
    return `${this.systemCaps.size} system capabilities: ${sys}. Plus ${this.modeShifts.size} persona modes (persona:<name> — say the name or describe the personality).`;
  }
}
