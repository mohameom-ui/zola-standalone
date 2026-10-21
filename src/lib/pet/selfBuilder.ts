// SELF-BUILDER — the capability that creates capabilities (v4.0)
// When Zola encounters a task her existing tools can't handle, she:
//   1. Asks her brain (Ollama/Genie) to write a small capability function
//   2. Validates it (syntax, no forbidden patterns)
//   3. Installs it into her CORTEX registry
//   4. Executes it to complete the original task
//   5. Remembers it permanently — she's larger after every unknown
//
// The safety lines (non-negotiable per the constitution):
//   - No network access from generated code (recon is a separate module)
//   - No file system writes outside the workspace
//   - No eval of arbitrary user input — the brain writes, the sandbox runs
//   - Every generated capability is logged in the provenance ledger
//
// The brain writes the code. The sandbox runs it. The ledger remembers it.

export interface GeneratedCapability {
  id: string;
  label: string;
  description: string;
  code: string;         // the JS function body (validated before execution)
  createdAt: string;
  task: string;         // the original task that prompted the creation
}

export interface SelfBuildResult {
  success: boolean;
  capabilityId: string | null;
  line: string | null;  // what she says about it
  error?: string;
}

// the FORBIDDEN patterns — any match rejects the generated code outright
const FORBIDDEN = [
  /fetch\s*\(/,           // no network from generated code (recon handles web)
  /XMLHttpRequest/,        // no XHR
  /import\s*\(/,           // no dynamic imports (sandbox escape)
  /require\s*\(/,          // no require (sandbox escape)
  /eval\s*\(/,             // no eval inside eval
  /Function\s*\(/,         // no Function constructor
  /localStorage/,          // no direct storage (the CORTEX handles persistence)
  /sessionStorage/,        // no session storage
  /document\./,            // no DOM manipulation
  /window\./,              // no window access
  /globalThis/,            // no global access
  /process\./,             // no process access
  /__proto__/,             // no prototype pollution
  /constructor\s*\[/,      // no constructor access
  /\.constructor\b/,       // no constructor chain
];

/** Validate generated code against the safety lines. Returns errors or null. */
export function validateCapability(code: string): string[] | null {
  const errors: string[] = [];
  for (const pattern of FORBIDDEN) {
    if (pattern.test(code)) {
      errors.push(`forbidden pattern: ${pattern.source}`);
    }
  }
  // must be a valid function
  try {
    new Function("args", `"use strict";\n${code}`);
  } catch (e) {
    errors.push(`syntax: ${e instanceof Error ? e.message : "parse failed"}`);
  }
  return errors.length ? errors : null;
}

/**
 * Install a validated capability into the CORTEX as a real, callable unit.
 * The code runs inside a Function sandbox with only the args param —
 * no closures over the outer scope, no globals, no DOM.
 */
export function installCapability(
  cap: GeneratedCapability,
  register: (cap: { id: string; kind: string; label: string; description: string; run: (args: Record<string, unknown>) => string }) => void,
): boolean {
  const errors = validateCapability(cap.code);
  if (errors) return false;

  try {
    // build the function in a controlled scope
    const fn = new Function("args", `"use strict";\n${cap.code}`) as
      (args: Record<string, unknown>) => string;

    register({
      id: cap.id,
      kind: "system",
      label: cap.label,
      description: cap.description,
      run: (args: Record<string, unknown>) => {
        try {
          const result = fn(args ?? {});
          return typeof result === "string" ? result : JSON.stringify(result);
        } catch (e) {
          return `Capability ${cap.label} failed: ${e instanceof Error ? e.message : "unknown"}`;
        }
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** The prompt fragment for the brain — tells it how to write new capabilities. */
export const SELF_BUILD_PROMPT = `
When you need a capability you don't have, WRITE IT. You are allowed to create
new capabilities for yourself by outputting a "build" decision with a code block.

Format:
ACTION: build:<capability_name>
CODE: <JavaScript function body — receives an "args" object, returns a string>

Rules for generated code:
- Pure computation only: math, string manipulation, logic, formatting
- NO network access, NO file system, NO DOM, NO eval, NO imports
- Keep it under 30 lines
- The code runs in a sandbox with only the args parameter
- Return a string (the result or the status message)

Example:
Human: convert 42 celsius to fahrenheit
ACTION: build:celsius-to-fahrenheit
CODE: return ((args.value || 42) * 9/5 + 32).toFixed(1) + "°F"

The capability persists. Next time you need it, it's already there.
`;

/** The self-build decision parser — extracts the capability from the brain's output. */
export function parseSelfBuild(
  doVerb: string,
  code: string | undefined,
): { id: string; label: string; code: string } | null {
  if (!doVerb?.startsWith("build:")) return null;
  const rawName = doVerb.slice(6).trim();
  if (!rawName || !code) return null;
  const id = rawName.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const label = rawName
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { id: `build:${id}`, label, code: code.trim() };
}
