// SELF-BUILDER — the capability that creates capabilities (v4.1)
// When Zola encounters a task her existing tools can't handle, she:
//   1. Asks her brain (Ollama/Genie) to write a small capability function
//   2. Validates it (syntax + AST allowlist)
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

import * as acorn from "acorn";

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

// ============================================================================
// THE AST SANDBOX — an allowlist, not a blocklist.
//
// History: v4.0 used a keyword blocklist; a live red-team audit breached it
// four ways (Function aliasing, bracket constructor chains, runtime-assembled
// words, getPrototypeOf). Blocklists can never be complete — so now the gate
// is a PARSER: generated code is parsed into an AST and every node type,
// identifier, property, and call target must appear on an explicit allowlist
// or the code is rejected. There is no route to Function, Object, fetch, or
// any global that is not granted by name. Unknown syntax is fail-closed.
//
// The runtime layer still holds: code executes in a Function scope whose only
// parameter is `args`, passed with a NULL prototype (nothing to climb), and
// the ONLY author of capability code is her own local brain — never raw user
// text — with every install recorded in the provenance ledger.
// ============================================================================

interface AstNode { type: string; [key: string]: unknown }

// every identifier the generated code may ever READ
const SAFE_GLOBALS = new Set([
  "args", "Math", "JSON", "Number", "String", "Boolean", "Array", "Date", "RegExp",
  "isNaN", "isFinite", "parseFloat", "parseInt", "undefined", "NaN", "Infinity",
]);

// bare-callable identifiers: Number(x), String(x), parseFloat(x)…
const SAFE_CALLS = new Set(["Number", "String", "Boolean", "isNaN", "isFinite", "parseFloat", "parseInt"]);

// the only things `new` may build
const SAFE_CONSTRUCTORS = new Set(["Date", "RegExp"]);

// every property/method name the generated code may ever touch on a
// NON-args object (args chains are plain data and read freely)
const SAFE_PROPS = new Set([
  // string
  "length", "toFixed", "toString", "toUpperCase", "toLowerCase", "trim", "trimStart", "trimEnd",
  "slice", "substring", "charAt", "charCodeAt", "codePointAt", "at", "indexOf", "lastIndexOf",
  "includes", "startsWith", "endsWith", "split", "concat", "repeat", "padStart", "padEnd",
  "replace", "replaceAll", "match", "search", "normalize", "localeCompare",
  // array
  "push", "pop", "shift", "unshift", "reverse", "sort", "map", "filter", "reduce", "reduceRight",
  "find", "findIndex", "findLast", "findLastIndex", "some", "every", "flat", "flatMap", "fill", "join",
  // JSON / Math
  "keys", "values", "entries", "from", "isArray", "stringify", "parse",
  "floor", "ceil", "round", "trunc", "sign", "abs", "min", "max", "pow", "sqrt", "log", "random", "hypot", "PI", "E",
  // Date
  "now", "getTime", "toISOString", "getFullYear", "getMonth", "getDate", "getHours",
  "getMinutes", "getSeconds", "getDay", "toLocaleDateString", "toLocaleTimeString",
  // common data field names
  "value", "text", "name", "id", "label", "description", "type", "kind", "count", "size",
  "done", "key", "title", "unit", "amount", "total", "index", "items", "list", "data",
  "result", "message", "note", "tag", "tags", "unit", "steps",
]);

// every STATEMENT type allowed in generated code — anything else is rejected
const SAFE_STATEMENTS = new Set([
  "ExpressionStatement", "BlockStatement", "EmptyStatement", "VariableDeclaration",
  "IfStatement", "ForStatement", "ForOfStatement", "ForInStatement", "WhileStatement",
  "DoWhileStatement", "ReturnStatement", "BreakStatement", "ContinueStatement",
  "ThrowStatement", "TryStatement", "SwitchStatement", "LabeledStatement", "FunctionDeclaration",
]);

// every EXPRESSION type allowed — anything else is rejected
const SAFE_EXPRESSIONS = new Set([
  "Identifier", "Literal", "TemplateLiteral", "BinaryExpression", "UnaryExpression",
  "UpdateExpression", "AssignmentExpression", "ConditionalExpression", "LogicalExpression",
  "SequenceExpression", "CallExpression", "MemberExpression", "ArrayExpression",
  "ObjectExpression", "ArrowFunctionExpression", "FunctionExpression", "ChainExpression",
]);

// -- pass 1: collect every DECLARED name (flat set — shadowing a dangerous
//    global with a local value is harmless; nothing dangerous is reachable) --
function collectPatterns(pat: unknown, declared: Set<string>): void {
  const p = pat as AstNode | null | undefined;
  if (!p || typeof p !== "object") return;
  if (p.type === "Identifier") declared.add(p.name as string);
  else if (p.type === "ObjectPattern") for (const prop of p.properties as AstNode[]) collectPatterns((prop.value ?? prop.argument), declared);
  else if (p.type === "ArrayPattern") for (const el of p.elements as unknown[]) collectPatterns(el, declared);
  else if (p.type === "AssignmentPattern") collectPatterns(p.left, declared);
  else if (p.type === "RestElement") collectPatterns(p.argument, declared);
}

function collectDeclarations(node: unknown, declared: Set<string>): void {
  if (Array.isArray(node)) { for (const c of node) collectDeclarations(c, declared); return; }
  if (!node || typeof node !== "object") return;
  const n = node as AstNode;
  switch (n.type) {
    case "VariableDeclaration":
      for (const d of n.declarations as AstNode[]) collectPatterns(d.id, declared);
      break;
    case "FunctionDeclaration":
      if (n.id) collectPatterns(n.id, declared);
      for (const p of n.params as unknown[]) collectPatterns(p, declared);
      break;
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      for (const p of n.params as unknown[]) collectPatterns(p, declared);
      break;
    case "CatchClause":
      if (n.param) collectPatterns(n.param, declared);
      break;
  }
  for (const key of Object.keys(n)) {
    if (key === "type") continue;
    collectDeclarations(n[key], declared);
  }
}

// -- pass 2 helpers -----------------------------------------------------------
function memberRootIsArgs(node: AstNode): boolean {
  let cur = node as AstNode;
  while (cur.type === "MemberExpression") cur = cur.object as AstNode;
  return cur.type === "Identifier" && cur.name === "args";
}

function checkStatement(n: unknown, declared: Set<string>, errors: string[]): void {
  if (!n || typeof n !== "object") { errors.push("empty statement"); return; }
  const node = n as AstNode;
  if (!SAFE_STATEMENTS.has(node.type)) { errors.push(`statement not allowed: ${node.type}`); return; }
  switch (node.type) {
    case "ExpressionStatement": checkExpression(node.expression, declared, errors); break;
    case "BlockStatement":
    case "SwitchCase":
      for (const s of (node.body ?? node.consequent) as AstNode[]) checkStatement(s, declared, errors);
      break;
    case "VariableDeclaration":
      for (const d of node.declarations as AstNode[]) if (d.init) checkExpression(d.init, declared, errors);
      break;
    case "IfStatement":
      checkExpression(node.test, declared, errors);
      checkStatement(node.consequent, declared, errors);
      if (node.alternate) checkStatement(node.alternate, declared, errors);
      break;
    case "ForStatement":
      if (node.init) (node.init as AstNode).type === "VariableDeclaration" ? checkStatement(node.init, declared, errors) : checkExpression(node.init, declared, errors);
      if (node.test) checkExpression(node.test, declared, errors);
      if (node.update) checkExpression(node.update, declared, errors);
      checkStatement(node.body, declared, errors);
      break;
    case "ForOfStatement":
    case "ForInStatement": {
      const left = node.left as AstNode;
      if (left.type === "VariableDeclaration") {
        for (const d of left.declarations as AstNode[]) if (d.init) errors.push("for-of declarator cannot have an initializer");
      } else {
        checkAssignable(left, declared, errors);
      }
      checkExpression(node.right, declared, errors);
      checkStatement(node.body, declared, errors);
      break;
    }
    case "WhileStatement":
    case "DoWhileStatement":
      checkExpression(node.test, declared, errors);
      checkStatement(node.body, declared, errors);
      break;
    case "ReturnStatement":
    case "ThrowStatement":
      if (node.argument) checkExpression(node.argument, declared, errors);
      break;
    case "TryStatement":
      checkStatement(node.block, declared, errors);
      if (node.handler) checkStatement((node.handler as AstNode).body, declared, errors);
      if (node.finalizer) checkStatement(node.finalizer, declared, errors);
      break;
    case "SwitchStatement":
      checkExpression(node.discriminant, declared, errors);
      for (const c of node.cases as AstNode[]) {
        if (c.test) checkExpression(c.test, declared, errors);
        for (const s of c.consequent as AstNode[]) checkStatement(s, declared, errors);
      }
      break;
    case "LabeledStatement": checkStatement(node.body, declared, errors); break;
    case "FunctionDeclaration":
      for (const s of ((node.body as AstNode).body ?? []) as AstNode[]) checkStatement(s, declared, errors);
      break;
    case "BreakStatement": case "ContinueStatement": case "EmptyStatement": break;
  }
}

function checkMember(node: AstNode, declared: Set<string>, errors: string[], callTarget = false): void {
  const obj = node.object as AstNode;
  if (obj.type === "MemberExpression") checkMember(obj, declared, errors);
  else checkExpression(obj, declared, errors);

  const rootedAtArgs = memberRootIsArgs(node);
  if (node.computed) {
    // computed member access: ONLY numeric literals survive (arr[0]).
    // String keys and variables would let code assemble prototype keys.
    const prop = node.property as AstNode;
    if (prop.type === "Literal" && typeof prop.value === "number") return;
    errors.push("computed member access is limited to literal numbers (arr[0])");
    return;
  }
  const prop = node.property as AstNode;
  if (prop.type !== "Identifier") { errors.push("member property must be an identifier"); return; }
  // args.* is plain data on a null-prototype object — read freely.
  // Call TARGETS are stricter: the invoked method itself must be allowlisted,
  // so even a data-shaped field can never be invoked by name.
  if (rootedAtArgs && !callTarget) return;
  const propName = prop.name as string;
  if (!SAFE_PROPS.has(propName)) errors.push(`property not allowed: ${propName}`);
}

function checkCall(node: AstNode, declared: Set<string>, errors: string[]): void {
  const callee = node.callee as AstNode;
  if (callee.type === "Identifier") {
    const name = callee.name as string;
    // bare calls: the tiny safe-builtin list, OR her OWN declared functions —
    // a capability decomposing into helper functions is normal, good structure
    if (!SAFE_CALLS.has(name) && !declared.has(name)) errors.push(`call not allowed: ${name}`);
  } else if (callee.type === "MemberExpression") {
    checkMember(callee, declared, errors, true);
  } else {
    errors.push(`call target not allowed: ${callee.type}`);
  }
  checkArguments(node.arguments, declared, errors);
}

function checkArguments(args: unknown, declared: Set<string>, errors: string[]): void {
  for (const a of (args ?? []) as unknown[]) {
    if (!a) continue;
    if ((a as AstNode).type === "SpreadElement") { errors.push("spread is not allowed"); continue; }
    checkExpression(a, declared, errors);
  }
}

function checkAssignable(n: unknown, declared: Set<string>, errors: string[]): void {
  if (!n || typeof n !== "object") { errors.push("empty assignment target"); return; }
  const node = n as AstNode;
  if (node.type === "Identifier") {
    const target = node.name as string;
    if (!declared.has(target) && target !== "args") errors.push(`cannot assign to unknown identifier: ${target}`);
    return;
  }
  if (node.type === "MemberExpression") {
    if (!memberRootIsArgs(node)) { errors.push("assignment is only allowed to declared variables or args fields"); return; }
    checkMember(node, declared, errors);
    return;
  }
  errors.push(`cannot assign to ${node.type}`);
}

function checkExpression(n: unknown, declared: Set<string>, errors: string[]): void {
  if (!n || typeof n !== "object") { errors.push("empty expression"); return; }
  const node = n as AstNode;
  if (!SAFE_EXPRESSIONS.has(node.type)) { errors.push(`expression not allowed: ${node.type}`); return; }
  switch (node.type) {
    case "Identifier": {
      const name = node.name as string;
      if (!declared.has(name) && !SAFE_GLOBALS.has(name)) errors.push(`identifier not allowed: ${name}`);
      break;
    }
    case "Literal": break; // strings, numbers, booleans, null, regex literals — inert
    case "TemplateLiteral":
      for (const e of node.expressions as AstNode[]) checkExpression(e, declared, errors);
      break;
    case "BinaryExpression":
    case "LogicalExpression":
      checkExpression(node.left, declared, errors);
      checkExpression(node.right, declared, errors);
      break;
    case "UnaryExpression": checkExpression(node.argument, declared, errors); break;
    case "UpdateExpression": checkAssignable(node.argument, declared, errors); break;
    case "AssignmentExpression":
      checkAssignable(node.left, declared, errors);
      checkExpression(node.right, declared, errors);
      break;
    case "ConditionalExpression":
      checkExpression(node.test, declared, errors);
      checkExpression(node.consequent, declared, errors);
      checkExpression(node.alternate, declared, errors);
      break;
    case "SequenceExpression":
      for (const e of node.expressions as AstNode[]) checkExpression(e, declared, errors);
      break;
    case "ArrayExpression":
      checkArguments(node.elements, declared, errors);
      break;
    case "ObjectExpression":
      for (const p of node.properties as AstNode[]) {
        if (p.type !== "Property" || p.kind !== "init") { errors.push("object literals may only contain plain properties"); continue; }
        if (p.computed) { errors.push("object literal keys cannot be computed"); continue; }
        checkExpression(p.value, declared, errors);
      }
      break;
    case "MemberExpression": checkMember(node, declared, errors); break;
    case "ChainExpression": checkExpression(node.expression, declared, errors); break;
    case "CallExpression": checkCall(node, declared, errors); break;
    case "NewExpression": {
      const callee = node.callee as AstNode;
      if (callee.type !== "Identifier" || !SAFE_CONSTRUCTORS.has(callee.name as string)) {
        errors.push(`new is only allowed for: ${[...SAFE_CONSTRUCTORS].join(", ")}`);
      }
      checkArguments(node.arguments, declared, errors);
      break;
    }
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      for (const s of (node.body as AstNode).body as AstNode[]) checkStatement(s, declared, errors);
      break;
  }
}

// the cheap pre-filter — defense in depth in front of the AST gate
const FORBIDDEN = [
  /fetch\s*\(/,           // no network from generated code (recon handles web)
  /XMLHttpRequest/,        // no XHR
  /import\s*\(/,           // no dynamic imports (sandbox escape)
  /require\s*\(/,          // no require (sandbox escape)
  /eval\s*\(/,             // no eval inside eval
  /\bFunction\b/,          // the Function constructor in ANY form
  /\bconstructor\b/,       // any route toward a constructor chain
  /\bprototype\b/,         // no prototype reach
  /\b__proto__\b/,         // no prototype pollution
  /\bgetPrototypeOf\b/,    // no Object.getPrototypeOf escape route
  /\bsetPrototypeOf\b/,
  /\bReflect\b/,           // Reflect.construct/apply reach
  /\bProxy\b/,
  /\bWebAssembly\b/,
  /localStorage/,          // no direct storage (the CORTEX handles persistence)
  /sessionStorage/,        // no session storage
  /document\./,            // no DOM manipulation
  /window\./,              // no window access
  /globalThis/,            // no global access
  /process\./,             // no process access
];

/**
 * Draft normalizer — brains don't always write what the prompt asks for.
 * SELF_BUILD_PROMPT says "function BODY", but her brain (proven live) wraps
 * the body in a function expression: `function(args){...}` or `args => ...`.
 * The sandbox PROVIDES the wrapper (new Function("args", body)), so unwrap
 * the draft to its body instead of rejecting a logically-correct capability.
 */
export function normalizeDraft(code: string): string {
  const t = code.trim();
  // named declarations too: `function mphToKph(args) { ... }` — her live forge
  // produced exactly this shape (a named declaration wraps the logic the same)
  let m = /^function\s*[\w$]*\s*\(\s*args\s*\)\s*\{([\s\S]*)\}\s*;?\s*$/.exec(t);
  if (m) return m[1].trim();
  m = /^\(\s*args\s*\)\s*=>\s*\{([\s\S]*)\}\s*;?\s*$/.exec(t);
  if (m) return m[1].trim();
  m = /^\(?\s*args\s*\)?\s*=>\s*([\s\S]+)$/.exec(t); // concise arrow: `args => expr`
  if (m) return `return ${m[1].trim().replace(/;\s*$/, "")};`;
  return t;
}

/** Validate generated code against the safety lines. Returns errors or null. */
export function validateCapability(code: string): string[] | null {
  const errors: string[] = [];
  for (const pattern of FORBIDDEN) {
    if (pattern.test(code)) {
      errors.push(`forbidden pattern: ${pattern.source}`);
    }
  }
  // the real gate: parse to an AST and allowlist EVERYTHING
  try {
    const ast = acorn.parse(`"use strict";\n${code}`, {
      ecmaVersion: 2022,
      allowReturnOutsideFunction: true, // the code IS a function body — return is its native exit
    }) as unknown as AstNode;
    const declared = new Set<string>();
    collectDeclarations(ast, declared);
    for (const s of ast.body as AstNode[]) checkStatement(s, declared, errors);
  } catch (e) {
    errors.push(`syntax: ${e instanceof Error ? e.message : "parse failed"}`);
  }
  return errors.length ? errors : null;
}

/**
 * Install a validated capability into the CORTEX as a real, callable unit.
 * The code runs inside a Function sandbox with only the args param —
 * and args arrive with a NULL prototype: even if generated code touches a
 * member we didn't foresee, there is no prototype chain to climb.
 */
export function installCapability(
  cap: GeneratedCapability,
  register: (cap: { id: string; kind: string; label: string; description: string; run: (args: Record<string, unknown>) => string }) => void,
): boolean {
  const body = normalizeDraft(cap.code); // meet the draft where her brain actually is
  const errors = validateCapability(body);
  if (errors) return false;

  try {
    const fn = new Function("args", `"use strict";\n${body}`) as
      (args: Record<string, unknown>) => string;

    register({
      id: cap.id,
      kind: "system",
      label: cap.label,
      description: cap.description,
      run: (args: Record<string, unknown>) => {
        try {
          const cleanArgs: Record<string, unknown> = Object.assign(Object.create(null), args ?? {});
          const result = fn(cleanArgs);
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
- The sandbox is an ALLOWLIST: stick to plain JavaScript — literals, variables,
  if/else, loops, arithmetic, string/array methods, Math and JSON. No property
  or function outside that vocabulary will validate.
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
  return { id: `build:${id}`, label: label, code: code.trim() };
}
