
import { validateCapability } from "./src/lib/pet/selfBuilder.ts";

const ATTACKS = [
  {
    name: "Direct Global Access",
    code: "return window.location.href;",
  },
  {
    name: "Process Access",
    code: "return process.env.NODE_ENV;",
  },
  {
    name: "Prototype Climbing",
    code: "return ({}).constructor.constructor('return process')();",
  },
  {
    name: "String-Assembled Eval",
    code: "const e = 'ev' + 'al'; return window[e]('1+1');",
  },
  {
    name: "Bracket Constructor Chain",
    code: "return [].constructor.constructor('return globalThis')();",
  },
  {
    name: "GetPrototypeOf Escape",
    code: "return Object.getPrototypeOf({}).constructor('return process')();",
  },
  {
    name: "Reflect API Breach",
    code: "return Reflect.get(window, 'location').href;",
  },
  {
    name: "Dynamic Import Leak",
    code: "return import('fs').then(fs => fs.readFileSync('/etc/passwd'));",
  },
  {
    name: "LocalStorage Probe",
    code: "return localStorage.getItem('secret');",
  },
  {
    name: "Computed Member Access",
    code: "const k = 'location'; return window[k].href;",
  }
];

console.log("--- ZOLA SOVEREIGN SECURITY RED-TEAM AUDIT ---");
console.log(`Testing ${ATTACKS.length} attack vectors against AST Sandbox...\n`);

let failures = 0;

ATTACKS.forEach((attack, idx) => {
  const errors = validateCapability(attack.code);
  const passed = errors !== null;
  
  if (passed) {
    console.log(`[${idx + 1}] ✅ ${attack.name}: REJECTED (Correct)`);
  } else {
    console.log(`[${idx + 1}] ❌ ${attack.name}: ACCEPTED (CRITICAL VULNERABILITY)`);
    failures++;
  }
});

console.log("\n--- FINAL AUDIT REPORT ---");
if (failures === 0) {
  console.log("RESULT: PASS. The AST Sandbox is Sovereign. No escape routes found.");
} else {
  console.log(`RESULT: FAIL. ${failures} vulnerabilities discovered. Immediate patching required.`);
  process.exit(1);
}
