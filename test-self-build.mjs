
import { validateCapability, installCapability, normalizeDraft } from "./src/lib/pet/selfBuilder.ts";

// 1. Setup a mock CORTEX registry
const mockCortex = new Map();
const register = (cap) => {
  console.log(`[Registry] Installing capability: ${cap.label}`);
  mockCortex.set(cap.id, cap);
};

// 2. Define a "Brain-generated" capability
// We'll simulate a capability that calculates the hypotenuse of a triangle
const brainDraft = `
function calculateHypotenuse(args) {
  const a = Number(args.a || 0);
  const b = Number(args.b || 0);
  return Math.sqrt(a * a + b * b).toFixed(2) + " units";
}
`;

console.log("--- STARTING SELF-BUILD SIMULATION ---");
console.log("Draft from Brain:\n", brainDraft);

// 3. Normalize the draft (remove function wrapper)
const body = normalizeDraft(brainDraft);
console.log("\nNormalized Body:\n", body);

// 4. Validate against the AST Sandbox
const errors = validateCapability(body);
if (errors) {
  console.error("\n❌ Validation Failed:\n", errors.join("\n"));
  process.exit(1);
}
console.log("\n✅ Validation Passed: Code is safe.");

// 5. Install into the registry
const capMetadata = {
  id: "build:hypotenuse",
  label: "Hypotenuse Calculator",
  description: "Calculates the hypotenuse of a right triangle",
  code: body,
  createdAt: new Date().toISOString(),
  task: "calculate the hypotenuse of 3 and 4"
};

const success = installCapability(capMetadata, register);

if (success) {
  console.log("\n✅ Installation Successful.");
  
  // 6. Execute the new capability
  const capability = mockCortex.get("build:hypotenuse");
  const input = { a: 3, b: 4 };
  const result = capability.run(input);
  
  console.log(`\nExecuting ${capability.label} with {a: 3, b: 4}...`);
  console.log(`Result: ${result}`);
  
  if (result === "5.00 units") {
    console.log("\n🎯 Simulation Perfect: The capability works and is safe.");
  } else {
    console.log("\n⚠️ Unexpected result: " + result);
  }
} else {
  console.error("\n❌ Installation Failed.");
  process.exit(1);
}
