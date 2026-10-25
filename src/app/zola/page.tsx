"use client";

// ============================================================================
// ZOLA COMPANION VIEW — open http://<this-pc-ip>:3001/zola on a phone
// (same Wi-Fi) to watch her live: mood, flight, task, her last words.
// Text-only — her camera never streams (privacy contract).
// ============================================================================

import { useEffect, useState } from "react";

interface ZolaState {
  mood: string; persona: string; activity: string; battery: number | null; alt: number;
  task: string | null; bond: number; trust: number; owner: string | null;
  items: number; lastSay: string; log: { who: string; text: string }[];
  at?: number;
}

export default function ZolaCompanionPage() {
  const [s, setS] = useState<ZolaState | null>(null);
  const [status, setStatus] = useState("connecting…");

  useEffect(() => {
    // PAIRING — the relay only answers paired requests. The desktop panel
    // prints a link ending in ?pair=<token>; carrying that once is enough,
    // then the token persists in this device's localStorage.
    const urlPair = new URLSearchParams(window.location.search).get("pair");
    if (urlPair) { try { localStorage.setItem("zola_pair_token", urlPair); } catch { /* private mode */ } }
    let pair = "";
    try { pair = localStorage.getItem("zola_pair_token") ?? ""; } catch { pair = ""; }

    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/zola", { cache: "no-store", headers: { "x-zola-pair": pair } });
        if (r.status === 401) { if (alive) setStatus("unpaired — open the ?pair= link printed in Zola's panel log"); return; }
        const d = (await r.json()) as { ok: boolean; reason?: string; state?: ZolaState };
        if (!alive) return;
        if (d.ok && d.state) { setS(d.state); setStatus("live"); }
        else setStatus(d.reason === "offline" ? "Zola's panel is not open on the host machine" : "signal stale — reconnecting…");
      } catch { if (alive) setStatus("cannot reach the host — same Wi-Fi?"); }
    };
    pull();
    const t = setInterval(pull, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <main className="zola-companion-page">
      <div className="zola-companion-wrap">
        <header className="zola-companion-header">
          <div>
            <h1 className="zola-companion-title">ZOLA <span style={{ color: "#35d0a5" }}>·</span> COMPANION</h1>
            <div className="zola-companion-subtitle">Read-only live status · camera does not stream</div>
          </div>
          <div className="zola-companion-live"><i />{status === "live" ? "LIVE" : "LINK PENDING"}</div>
        </header>

        <section className="zola-companion-card" aria-label="Zola live status">
          <div className="zola-companion-state" aria-live="polite">{status}</div>
          {s && (
            <>
              <div className="zola-companion-metrics">
                <CompanionMetric label="MOOD / PERSONA" value={`${s.mood} · ${s.persona}`} tone="#e5bd64" />
                <CompanionMetric label="ACTIVITY" value={s.activity} tone="#72c9e9" />
                <CompanionMetric label="ALTITUDE" value={`${s.alt.toFixed(2)} m`} />
                <CompanionMetric label="BATTERY" value={s.battery === null ? "—" : `${Math.round(s.battery * 100)}%`} tone={s.battery !== null && s.battery < 0.2 ? "#ff777b" : "#65d2ae"} />
                <CompanionMetric label="ACTIVE TASK" value={s.task ?? "—"} />
                <CompanionMetric label="BOND / TRUST" value={`${Math.round(s.bond * 100)}% / ${Math.round(s.trust * 100)}%`} tone="#e5bd64" />
                <CompanionMetric label="HUMAN" value={s.owner ?? "Unknown"} />
                <CompanionMetric label="ITEMS KNOWN" value={String(s.items)} />
              </div>
              <div className="zola-companion-callout">
                <div className="zola-companion-label">LATEST MESSAGE</div>
                <div className="zola-companion-value" style={{ color: "#e5bd64", minHeight: "2.5rem" }}>{s.lastSay || "…"}</div>
              </div>
            </>
          )}
        </section>

        {s && s.log?.length > 0 && (
          <section className="zola-companion-card" aria-label="Recent activity">
            <div className="zola-companion-label" style={{ marginBottom: 9 }}>RECENT ACTIVITY</div>
            {s.log.slice(-8).reverse().map((l, i) => (
              <div key={i} className="zola-companion-log">
                <span style={{ color: l.who === "you" ? "#72c9e9" : l.who === "aura" ? "#e5bd64" : "#8391a4" }}>{l.who === "aura" ? "Zola" : l.who}:</span> {l.text}
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function CompanionMetric({ label, value, tone = "#e5ebf2" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="zola-companion-metric">
      <div className="zola-companion-label">{label}</div>
      <div className="zola-companion-value" style={{ color: tone }}>{value}</div>
    </div>
  );
}
