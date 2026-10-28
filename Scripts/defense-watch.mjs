// THE DEFENSIVE LAYER — Zola watches her own host and reports what she sees.
// This is monitoring and alerting, not attack. She reads status, she does not
// fire exploits. The red team tools (Metasploit, Hashcat, Hydra) stay behind
// the human keyboard — an AI companion does not decide what to attack.
//
//   node Scripts/defense-watch.mjs           → one pass, prints the report
//   node Scripts/defense-watch.mjs --serve   → serves at :3004, refreshes every 30 s
//
// What she watches:
//   - Windows Defender status (signatures, real-time protection)
//   - Firewall profile states (all three: domain/private/public)
//   - Suspicious listening ports (compared against her known-good set)
//   - Running process anomalies (new processes since the last check)
//   - Disk space and system health
//   - Her own services (panel, console, tensorboard, ollama)
//   - Failed auth attempts (the Windows security event log, if readable)
import http from "node:http";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE = process.argv.includes("--serve");
// the known-good listening ports: her services + the standard Windows services
// + the dev tools. The threshold for "unrecognized" is generous because
// Windows opens dozens of ephemeral/service ports normally.
const KNOWN_PORTS = new Set([
  // her services
  3001, 3002, 3003, 3004, 6006, 11434,
  // the isaac/sim stack
  8765, 5760, 14540,
  // windows core services (netbios, smb, rpc, winrm, wsd, etc.)
  135, 139, 445, 5040, 5357, 5985, 5986, 7680,
  // the ephemeral/service range — windows opens these dynamically
  ...Array.from({ length: 100 }, (_, i) => 49152 + i),
  // common dev/services
  3306, 5432, 6379, 8080, 8081, 9200, 27017, 7777, 7778, 9012, 9013, 9014, 9658,
  1042, 1177, 1981, 1985, 1989, 6463, 6850, 8070,
]);
const STATE_FILE = path.join(repo, "Saved", "defense-watch-state.json");

let lastKnownProcesses = null;
let alertLog = [];

const log = (m) => console.log(`[defense-watch ${new Date().toISOString().slice(11, 19)}] ${m}`);

function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf8", timeout: 15_000, shell: true }); }
  catch (e) { return e.stdout ?? ""; }
}

// ---- the checks ---------------------------------------------------------------
function checkDefender() {
  const out = sh(`powershell -Command "Get-MpComputerStatus | Select-Object AMRunningMode,RealTimeProtectionEnabled,AntivirusSignatureLastUpdated,AntispywareSignatureLastUpdated | ConvertTo-Json" 2>nul`);
  try {
    const s = JSON.parse(out.trim());
    const days = s.AntivirusSignatureLastUpdated ? Math.round((Date.now() - new Date(s.AntivirusSignatureLastUpdated)) / 86400000) : "?";
    return {
      realtime: s.RealTimeProtectionEnabled,
      mode: s.AMRunningMode ?? "unknown",
      signatureAgeDays: days,
      verdict: s.RealTimeProtectionEnabled && days <= 2 ? "OK" : "ATTENTION",
    };
  } catch { return { verdict: "UNREADABLE" }; }
}

function checkFirewall() {
  const out = sh(`powershell -Command "Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json" 2>nul`);
  try {
    const profiles = JSON.parse(out.trim());
    const down = profiles.filter(p => !p.Enabled).map(p => p.Name);
    return {
      profiles: profiles.map(p => `${p.Name}: ${p.Enabled ? "ON" : "OFF"}`),
      verdict: down.length === 0 ? "OK" : `${down.length} profile(s) OFF`,
    };
  } catch { return { verdict: "UNREADABLE" }; }
}

function checkListeningPorts() {
  const out = sh(`netstat -ano | findstr LISTENING`, { timeout: 10_000 });
  const lines = out.split("\n").map(l => l.trim()).filter(Boolean);
  const ports = new Set();
  const pids = {};
  for (const line of lines) {
    const parts = line.split(/\s+/);
    const local = parts[1] ?? "";
    const port = parseInt(local.split(":").pop());
    if (!port || port < 1) continue;
    ports.add(port);
    pids[port] = parts[4];
  }
  const unknown = [...ports].filter(p => !KNOWN_PORTS.has(p)).sort((a, b) => a - b);
  return {
    total: ports.size,
    unknownPorts: unknown.slice(0, 15),
    unknownCount: unknown.length,
    verdict: unknown.length <= 3 ? "OK" : `${unknown.length} unrecognized listening ports`,
  };
}

function checkNewProcesses() {
  const out = sh(`powershell -Command "Get-Process | Select-Object ProcessName,Id | ConvertTo-Json -Compress" 2>nul`);
  try {
    const procs = JSON.parse(out.trim());
    const current = new Set(procs.map(p => `${p.ProcessName}:${p.Id}`));
    const names = new Set(procs.map(p => p.ProcessName));
    let newNames = [];
    if (lastKnownProcesses) {
      newNames = [...names].filter(n => !lastKnownProcesses.has(n) && !["chrome", "msedge", "Code", "python", "node"].includes(n));
    }
    lastKnownProcesses = names;
    return {
      total: procs.length,
      newSinceLast: newNames.slice(0, 10),
      verdict: newNames.length === 0 ? "OK" : `${newNames.length} new process name(s)`,
    };
  } catch { return { verdict: "UNREADABLE" }; }
}

function checkDisk() {
  const out = sh(`powershell -Command "Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json -Compress" 2>nul`);
  try {
    const s = JSON.parse(out.trim());
    const freeGB = Math.round(s.Free / 1e9);
    return { freeGB, verdict: freeGB > 20 ? "OK" : `${freeGB} GB free — clean up` };
  } catch { return { verdict: "UNREADABLE" }; }
}

function checkHerServices() {
  const services = [
    ["panel", 3001], ["trainer console", 3002], ["tensorboard", 6006],
    ["debug engine", 3003], ["ollama", 11434],
  ];
  const results = [];
  for (const [name, port] of services) {
    const up = (() => {
      try { return !!execSync(`curl -s -m 3 -o nul -w "%{http_code}" http://localhost:${port}`, { shell: true, timeout: 8000 }).toString().match(/[23]\d\d/); }
      catch { return false; }
    })();
    results.push({ name, port, up });
  }
  const down = results.filter(r => !r.up);
  return { results, verdict: down.length === 0 ? "OK" : `down: ${down.map(d => d.name).join(", ")}` };
}

function checkFailedAuth() {
  // the Windows Security event log: failed logons (event 4625), last 24 h
  const out = sh(`powershell -Command "try { (Get-WinEvent -FilterHashtable @{LogName='Security';Id=4625;StartTime=(Get-Date).AddHours(-24)} -MaxEvents 20 -ErrorAction Stop | Measure-Object).Count } catch { 'log-unreadable' }" 2>nul`);
  const count = parseInt(out.trim()) || 0;
  return {
    failedLogons24h: count,
    verdict: count === 0 ? "OK" : count < 5 ? `${count} failed logon(s)` : `${count} failed logons — investigate`,
  };
}

// ---- the full sweep ------------------------------------------------------------
function sweep() {
  const results = {};
  results.defender = checkDefender();
  results.firewall = checkFirewall();
  results.ports = checkListeningPorts();
  results.processes = checkNewProcesses();
  results.disk = checkDisk();
  results.services = checkHerServices();
  results.failedAuth = checkFailedAuth();
  results.at = new Date().toISOString();

  // the alert log
  for (const [key, r] of Object.entries(results)) {
    if (r.verdict && !r.verdict.startsWith("OK") && r.verdict !== "UNREADABLE") {
      alertLog.unshift(`[${new Date().toISOString().slice(11, 19)}] ${key}: ${r.verdict}`);
    }
  }
  alertLog = alertLog.slice(0, 30);

  try {
    writeFileSync(STATE_FILE, JSON.stringify({ lastSweep: results, alertLog }, null, 2));
  } catch {}
  return results;
}

// ---- the page ------------------------------------------------------------------
const page = (results) => `<!doctype html><meta charset="utf-8"><title>DEFENSE WATCH</title>
<meta http-equiv="refresh" content="30">
<body style="background:#0a0c10;color:#cfd6e4;font-family:Consolas,monospace;max-width:900px;margin:24px auto;padding:0 16px">
<h1 style="color:#5ac8fa">🛡️ DEFENSE WATCH</h1>
<p style="color:#8b93a5">monitoring her host — the blue team layer, not the red team</p>
${results ? Object.entries(results).map(([key, r]) => {
  const color = String(r.verdict).startsWith("OK") ? "#9fe8c8" : String(r.verdict).includes("UNREADABLE") ? "#8b93a5" : "#ffd27a";
  return `<div style="border:1px solid #1a2233;padding:10px;margin:8px 0"><b style="color:${color}">${key.toUpperCase()}</b><br>${JSON.stringify(r, null, 1)}</div>`;
}).join("") : "<p>first sweep running…</p>"}
${alertLog.length ? `<h3 style="color:#ffd27a">⚠ ALERT LOG</h3><pre style="font-size:11px;color:#cfd6e4">${alertLog.join("\n")}</pre>` : ""}
<p style="color:#6d7588;font-size:11px">refreshes every 30 s · the red team tools are NOT wired to this — an AI does not decide what to attack</p>
</body>`;

// ---- the server ------------------------------------------------------------------
if (SERVE) {
  const PORT = 3004;
  let lastResults = sweep();
  setInterval(() => { lastResults = sweep(); log("sweep complete"); }, 30_000);
  http.createServer((req, res) => {
    if (req.url === "/report") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results: lastResults, alerts: alertLog }, null, 2));
      return;
    }
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(page(lastResults));
  }).listen(PORT, "127.0.0.1", () => log(`defense watch → http://localhost:${PORT}`));
} else {
  const results = sweep();
  console.log(JSON.stringify(results, null, 2));
}
