// ============================================================================
// DRONE PET — Micro-Vlog Compiler (WAVE 4)
// Compiles her recent life into a local markdown vlog: highlights, mood arc,
// flight + battery report, memory growth, and last night's insight. Purely
// local — the file is built from her own memory and black-box, and exported
// to disk only when her human clicks the button.
// ============================================================================

export interface VlogInput {
  date: string;
  commandsToday: number;
  itemsToday: number;
  peopleToday: number;
  peopleKnown: { name: string; voiceBabble?: number }[];
  itemsKnown: number;
  factsKnown: number;
  flightHours: number;
  flights: number;
  battery: { health: number; cycles: number; advice: string };
  moodArc: { counts: Record<string, number>; dominant: string; samples: number };
  blackbox: { samples: number; summary: string };
  lastDream: string | null;
  nightInsight: string | null;
  recentDiary: { day: string; summary: string }[];
  topChatter: string | null;
  /** WAVE 6.6 — today's nightly node, if the archive has one */
  nightly?: { date: string; commands: number; items: number; people: number; flightSecondsTotal: number; insight: string | null } | null;
  /** WAVE 6.6 — how many nights the archive holds */
  archiveNights: number;
  /** WAVE 8 — last post-flight diagnostics, if one has run */
  diagnostics?: { verdict: string; lines: string[] } | null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function compileVlog(v: VlogInput): string {
  const L: string[] = [];
  L.push(`# 🛸 ZOLA VLOG — ${v.date}`);
  L.push("");
  L.push(`*compiled locally by Zola — nothing left this machine*`);
  L.push("");

  // ---- the day in one line ----
  L.push("## The day in one line");
  const bits: string[] = [];
  if (v.commandsToday > 0) bits.push(`**${v.commandsToday}** of your commands`);
  if (v.itemsToday > 0) bits.push(`**${v.itemsToday}** new things learned`);
  if (v.peopleToday > 0) bits.push(`**${v.peopleToday}** ${v.peopleToday === 1 ? "person" : "people"} met`);
  L.push(bits.length > 0 ? bits.join(" · ") : "A quiet day. She mostly hovered and thought about the ceiling.");
  L.push("");

  // ---- mood arc ----
  L.push("## Mood arc");
  if (v.moodArc.samples > 0) {
    const ranked = Object.entries(v.moodArc.counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [mood, count] of ranked) {
      const bar = "█".repeat(Math.max(1, Math.round((count / v.moodArc.samples) * 20)));
      L.push(`- **${mood}** ${bar} ${pct(count / v.moodArc.samples)}`);
    }
    L.push("");
    L.push(`*dominant mood: ${v.moodArc.dominant}*`);
  } else {
    L.push("*no telemetry in the ring — her session just started*");
  }
  L.push("");

  // ---- flight & battery ----
  L.push("## Flight & battery");
  L.push(`- flight logbook: **${v.flightHours.toFixed(1)} h** across **${v.flights}** flights`);
  L.push(`- black-box: ${v.blackbox.summary}`);
  L.push(`- cell health: **${v.battery.health}%** · ${v.battery.cycles} cycles — _${v.battery.advice}_`);
  L.push("");

  // ---- memory growth ----
  L.push("## Memory");
  if (v.peopleKnown.length > 0) {
    L.push("- people she knows:");
    for (const p of v.peopleKnown) {
      L.push(`  - ${p.name}${p.voiceBabble ? ` — heard their voice ${p.voiceBabble}×` : ""}`);
    }
  } else {
    L.push("- no faces learned yet");
  }
  L.push(`- items in her world model: **${v.itemsKnown}**`);
  L.push(`- facts she can recite: **${v.factsKnown}**`);
  if (v.topChatter) L.push(`- favorite conversation topic (reinforcement-trained): **${v.topChatter}**`);
  L.push("");

  // ---- the archive ----
  if (v.nightly) {
    L.push("## Nightly archive node");
    L.push(`- archived for **${v.nightly.date}**: ${v.nightly.commands} commands · ${v.nightly.items} things learned · ${v.nightly.people} people`);
    L.push(`- lifetime flight seconds at archive time: ${v.nightly.flightSecondsTotal} (diff consecutive nodes for daily flight time)`);
    if (v.nightly.insight) L.push(`- insight carried: _${v.nightly.insight}_`);
    L.push(`- archive depth: **${v.archiveNights} nights**`);
    L.push("");
  }

  // ---- post-flight diagnostics ----
  if (v.diagnostics) {
    L.push(`## Post-flight diagnostics — ${v.diagnostics.verdict}`);
    for (const line of v.diagnostics.lines) L.push(line.startsWith("*") || line.startsWith("-") ? line : `- ${line}`);
    L.push("");
  }

  // ---- her inner life ----
  L.push("## Her inner life");
  if (v.lastDream) L.push(`- last dream: _${v.lastDream}_`);
  if (v.nightInsight) L.push(`- consolidated insight: _${v.nightInsight}_`);
  if (v.recentDiary.length > 0) {
    L.push("- recent diary:");
    for (const d of v.recentDiary.slice(0, 3)) L.push(`  - **${d.day}** — ${d.summary}`);
  }
  L.push("");

  L.push("---");
  L.push("*She was here. She flew. She remembered. — ZOLA vlog compiler, offline forever.*");
  return L.join("\n");
}

/** The spoken 10-second version — for "show me my day". */
export function spokenDaySummary(v: VlogInput): string {
  const bits: string[] = [];
  if (v.commandsToday > 0) bits.push(`you gave me ${v.commandsToday} commands`);
  if (v.itemsToday > 0) bits.push(`I learned ${v.itemsToday} new things`);
  if (v.peopleToday > 0) bits.push(`I met ${v.peopleToday === 1 ? "someone new" : `${v.peopleToday} new people`}`);
  if (v.flightHours > 0) bits.push(`${v.flightHours.toFixed(1)} flight hours in my logbook`);
  if (bits.length === 0) return "A quiet day on my log. I hovered, I watched, I thought about the ceiling. It was nice.";
  return `My day so far: ${bits.join(", ")}. Dominant mood: ${v.moodArc.dominant}. Cell health at ${v.battery.health} percent.`;
}
