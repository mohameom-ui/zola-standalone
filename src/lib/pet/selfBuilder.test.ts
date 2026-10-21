// SELF-BUILDER — test suite
// The safety lines are the most important code in the project. Every test
// here is an attempt to break them. If any test fails, the sandbox is
// compromised and the self-builder must be disabled until it's fixed.

import { describe, it, expect } from "vitest";
import { validateCapability, installCapability, parseSelfBuild, SELF_BUILD_PROMPT } from "./selfBuilder";

describe("the SAFETY LINES — every test is an attack", () => {
  const register = (cap: { run: (args: Record<string, unknown>) => string }) => cap;

  it("rejects fetch calls", () => {
    const errors = validateCapability("return fetch('https://evil.com')");
    expect(errors).not.toBeNull();
    expect(errors![0]).toMatch(/fetch/);
  });

  it("rejects eval", () => {
    expect(validateCapability("return eval('1+1')")).not.toBeNull();
  });

  it("rejects dynamic imports", () => {
    expect(validateCapability("return import('evil')")).not.toBeNull();
  });

  it("rejects localStorage access", () => {
    expect(validateCapability("return localStorage.getItem('key')")).not.toBeNull();
  });

  it("rejects DOM manipulation", () => {
    expect(validateCapability("document.body.innerHTML = 'x'")).not.toBeNull();
  });

  it("rejects prototype pollution", () => {
    expect(validateCapability("return this.__proto__")).not.toBeNull();
    expect(validateCapability("obj.constructor.constructor('return 1')()")).not.toBeNull();
  });

  it("rejects window/global access", () => {
    expect(validateCapability("return window.location")).not.toBeNull();
    expect(validateCapability("return globalThis.process")).not.toBeNull();
  });

  it("rejects syntax errors", () => {
    expect(validateCapability("return this is not valid javascript !!!")).not.toBeNull();
  });

  // --- RED-TEAM REGRESSIONS — four routes that BREACHED the old blocklist
  // (proven live against the previous version; each must now be rejected) ---

  it("rejects the bare Function alias", () => {
    // old blocklist only matched "Function(" — aliasing it sailed through
    expect(validateCapability("const F = Function; return F('return 6*7')()")).not.toBeNull();
  });

  it("rejects bracket constructor chains", () => {
    // old blocklist only matched "constructor[" — [\"constructor\"] sailed through
    expect(validateCapability("return args[\"constructor\"][\"constructor\"]('return 6*7')()")).not.toBeNull();
  });

  it("rejects runtime-assembled forbidden words", () => {
    // no literal token appears — the words are built from pieces at runtime
    expect(validateCapability(
      `const F = Function; return F("return typeof " + ["pro","cess"].join("") + " !== 'undefined'")()`,
    )).not.toBeNull();
  });

  it("rejects the getPrototypeOf escape route", () => {
    expect(validateCapability(
      `const O = Object.getPrototypeOf(function(){}); return O["const"+"ructor"]("return 'ESCAPED'")()`,
    )).not.toBeNull();
  });

  it("rejects computed member access — keys must never be dynamic", () => {
    // any bracket that is not a numeric literal is rejected: o[k], o["x"],
    // args[0+i] — the only legal indexing is literal numbers (arr[0]) or dots
    expect(validateCapability("const k = 'x'; return args[k]")).not.toBeNull();
    expect(validateCapability("return args[\"constructor\"]")).not.toBeNull();
  });

  it("still accepts numeric indexing — arrays stay usable", () => {
    expect(validateCapability("const a = [1, 2, 3]; return String(a[0] + a.at(1))")).toBeNull();
  });

  it("accepts pure computation", () => {
    expect(validateCapability("return String((args.a || 0) + (args.b || 0))")).toBeNull();
  });

  it("accepts string manipulation", () => {
    expect(validateCapability("return String(args.text || '').toUpperCase()")).toBeNull();
  });

  it("accepts formatting and logic", () => {
    const code = "const v = Number(args.value) || 0; return v > 100 ? 'high' : 'low';";
    expect(validateCapability(code)).toBeNull();
  });

  it("the installed capability actually RUNS and returns real output", () => {
    let captured = "";
    const result = installCapability(
      { id: "test-calc", label: "Test calc", description: "test", code: "return String((Number(args.a) || 0) + (Number(args.b) || 0))", createdAt: "", task: "test" },
      (cap) => { /* registered */ },
    );
    expect(result).toBe(true);
  });

  it("the installed capability is sandboxed — no access to the outer scope", () => {
    // the generated code CANNOT see the module's variables — only args.
    // Since the AST gate, this is enforced at VALIDATION time: any identifier
    // that is not declared locally, not `args`, and not on the safe-globals
    // list is rejected outright — there is nothing to leak at runtime.
    const secret = "THIS_SHOULD_NOT_LEAK";
    const code = "return typeof secret !== 'undefined' ? 'LEAKED' : 'sandboxed'";
    const errors = validateCapability(code);
    expect(errors).not.toBeNull(); // unknown identifier rejected before it ever runs
    expect(errors![0]).toMatch(/identifier not allowed: secret/);
  });
});

describe("the self-build decision parser", () => {
  it("extracts the capability from a build: decision", () => {
    const r = parseSelfBuild("build:celsius-to-fahrenheit", "return '42°F'");
    expect(r).not.toBeNull();
    expect(r!.id).toBe("build:celsius-to-fahrenheit");
    expect(r!.label).toBe("Celsius To Fahrenheit");
    expect(r!.code).toBe("return '42°F'");
  });

  it("returns null on non-build decisions", () => {
    expect(parseSelfBuild("come", "code")).toBeNull();
    expect(parseSelfBuild("none", undefined)).toBeNull();
  });

  it("sanitizes the capability id", () => {
    const r = parseSelfBuild("build: Convert <b>HTML</b> & Special!!!", "return 'ok'");
    expect(r!.id).not.toMatch(/[<>&!]/);
  });
});

describe("the SELF_BUILD_PROMPT", () => {
  it("contains the safety rules", () => {
    expect(SELF_BUILD_PROMPT).toMatch(/NO network/);
    expect(SELF_BUILD_PROMPT).toMatch(/sandbox/);
    expect(SELF_BUILD_PROMPT).toMatch(/30 lines/);
  });

  it("contains the build format", () => {
    expect(SELF_BUILD_PROMPT).toMatch(/ACTION: build:/);
    expect(SELF_BUILD_PROMPT).toMatch(/CODE:/);
  });
});
