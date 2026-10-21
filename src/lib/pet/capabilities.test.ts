// CAPABILITIES.TS — test suite
// The time parser, the reminder parser, the task list, the capability
// builders. Pure logic: every test is real.

import { describe, it, expect } from "vitest";
import { parseTimeExpression, parseReminder, TaskList, buildActionCapabilities } from "./capabilities";
import { Cortex } from "./cortex";

describe("the time parser", () => {
  const now = new Date(2026, 9, 20, 12, 0, 0); // Oct 20, noon

  it("parses 'in 10 minutes'", () => {
    const r = parseTimeExpression("remind me in 10 minutes", now);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("relative");
    expect(r!.at.getMinutes() - now.getMinutes()).toBe(10);
  });

  it("parses 'in 2 hours'", () => {
    const r = parseTimeExpression("in 2 hours", now);
    expect(r!.at.getHours() - now.getHours()).toBe(2);
  });

  it("parses 'in 30 seconds'", () => {
    const r = parseTimeExpression("in 30 seconds", now);
    expect(r!.at.getSeconds() - now.getSeconds()).toBe(30);
  });

  it("parses 'at 3pm'", () => {
    const r = parseTimeExpression("remind me at 3pm", now);
    expect(r!.kind).toBe("absolute");
    expect(r!.at.getHours()).toBe(15);
  });

  it("parses 'at 9:30am'", () => {
    const r = parseTimeExpression("at 9:30am", now);
    expect(r!.at.getHours()).toBe(9);
    expect(r!.at.getMinutes()).toBe(30);
  });

  it("pushes past times to tomorrow", () => {
    const r = parseTimeExpression("at 3pm", new Date(2026, 9, 20, 15, 0)); // already 3pm
    expect(r!.at.getDate()).toBe(21); // tomorrow
  });

  it("parses 'tomorrow'", () => {
    const r = parseTimeExpression("tomorrow", now);
    expect(r!.at.getDate()).toBe(21);
  });

  it("parses 'tomorrow at 8am'", () => {
    const r = parseTimeExpression("tomorrow at 8am", now);
    expect(r!.at.getDate()).toBe(21);
    expect(r!.at.getHours()).toBe(8);
  });

  it("parses 'every 5 minutes' as recurring", () => {
    const r = parseTimeExpression("check on me every 5 minutes", now);
    expect(r!.kind).toBe("date");
  });

  it("returns null on garbage", () => {
    expect(parseTimeExpression("banana", now)).toBeNull();
  });
});

describe("the reminder parser", () => {
  const now = new Date(2026, 9, 20, 12, 0, 0);

  it("parses 'remind me to drink water in 10 minutes'", () => {
    const r = parseReminder("remind me to drink water in 10 minutes", now);
    expect(r).not.toBeNull();
    expect(r!.what).toBe("drink water");
    expect(r!.time.at.getMinutes() - now.getMinutes()).toBe(10);
  });

  it("parses 'remind me to call mom at 3pm'", () => {
    const r = parseReminder("remind me to call mom at 3pm", now);
    expect(r!.what).toBe("call mom");
    expect(r!.time.at.getHours()).toBe(15);
  });

  it("returns null on no reminder intent", () => {
    expect(parseReminder("what is the weather", now)).toBeNull();
  });
});

describe("the task list", () => {
  it("adds, lists, and completes tasks", () => {
    const tl = new TaskList();
    tl.add("fix the render bug");
    tl.add("call the dentist");
    expect(tl.open).toBe(2);
    const t = tl.list()[0];
    tl.complete(t.id);
    expect(tl.open).toBe(1);
  });

  it("completes by text match too", () => {
    const tl = new TaskList();
    tl.add("water the plants");
    expect(tl.complete("water the plants")).toBe(true);
    expect(tl.open).toBe(0);
  });
});

describe("the capability builders", () => {
  it("builds the action layer capabilities", () => {
    const caps = buildActionCapabilities({
      speak: () => {}, playMusic: () => {}, openWeb: () => {}, searchWeb: () => {},
    });
    expect(caps.length).toBeGreaterThanOrEqual(4);
    expect(caps.map((c) => c.id)).toContain("remind");
    expect(caps.map((c) => c.id)).toContain("music");
    expect(caps.map((c) => c.id)).toContain("navigate");
    expect(caps.map((c) => c.id)).toContain("tasks");
  });

  it("the capabilities register into the CORTEX and execute", async () => {
    const caps = buildActionCapabilities({
      speak: () => {}, playMusic: () => { /* played */ }, openWeb: () => {}, searchWeb: () => {},
    });
    const c = new Cortex();
    c.registerMany(caps);
    expect(c.has("music")).toBe(true);
    const line = await c.execute("music");
    expect(line).toBe("Playing.");
  });
});
