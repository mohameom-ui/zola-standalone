"use client";

// ============================================================================
// ZOLA COMPANION VIEW — open http://<this-pc-ip>:3000/zola on a phone
// (same Wi-Fi) to watch her live: mood, flight, task, her last words.
// Text-only — her camera never streams (privacy contract).
// ============================================================================

import { useEffect, useState } from "react";

interface ZolaState {
  mood: string; persona: string; activity: string; battery: number; alt: number;
  task: string | null; bond: number; trust: number; owner: string | null;
  items: number; lastSay: string; log: { who: string; text: string }[];
  at?: number;
}

export default function ZolaCompanionPage() {
  const [s, setS] = useState<ZolaState | null>(null);
  const [status, setStatus] = useState("connecting…");

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/zola", { cache: "no-store" });
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
    <main className="min-h-screen bg-[#040507] text-[#e9e7dc] p-6 font-mono">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-[#f0b90b] tracking-[0.3em] text-lg">ZOLA · COMPANION VIEW</h1>
        <p className="text-[10px] text-[#8b8f9c]">live status · text only — her camera never streams</p>

        <div className="rounded-xl border border-[#f0b90b]/30 bg-[#0b0e17] p-4 space-y-3">
          <div className="flex justify-between"><span className="text-[#8b8f9c] text-xs">STATUS</span><span className={status === "live" ? "text-[#35d0a5] text-xs" : "text-[#ff9f43] text-xs"}>{status.toUpperCase()}</span></div>
          {s && (
            <>
              <div className="flex justify-between"><span className="text-[#8b8f9c] text-xs">MOOD / PERSONA</span><span className="text-[#f0b90b] text-sm">{s.mood} · {s.persona}</span></div>
              <div className="flex justify-between"><span className="text-[#8b8f9c] text-xs">DOING</span><span className="text-[#5ac8fa] text-sm">{s.activity}</span></div>
              <div className="flex justify-between"><span className="text-[#8b8f9c] text-xs">ALTITUDE</span><span className="font-mono">{s.alt.toFixed(2)} m</span></div>
              <div className="flex justify-between"><span className="text-[#8b8f9c] text-xs">BATTERY</span><span className={s.battery < 0.2 ? "text-[#ff4d4f]" : "text-[#35d0a5]"}>{Math.round(s.battery * 100)}%</span></div>
              <div className="flex justify-between"><span className="text-[#8b8f9c] text-xs">TASK</span><span className="text-[10px] text-right max-w-[55%]">{s.task ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-[#8b8f9c] text-xs">BOND / TRUST</span><span className="text-[#ff9f43]">{Math.round(s.bond * 100)}% / {Math.round(s.trust * 100)}%</span></div>
              <div className="flex justify-between"><span className="text-[#8b8f9c] text-xs">HUMAN</span><span>{s.owner ?? "unknown"}</span></div>
              <div className="flex justify-between"><span className="text-[#8b8f9c] text-xs">THINGS KNOWN</span><span className="font-mono">{s.items}</span></div>
              <div className="pt-2 border-t border-white/10">
                <div className="text-[#8b8f9c] text-[10px] pb-1">SHE SAYS</div>
                <div className="text-sm text-[#f0b90b] min-h-[2.5rem]">{s.lastSay || "…"}</div>
              </div>
            </>
          )}
        </div>

        {s && s.log?.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-[#0b0e17] p-4 space-y-1">
            <div className="text-[#8b8f9c] text-[10px] pb-1">RECENT LOG</div>
            {s.log.slice(-8).reverse().map((l, i) => (
              <div key={i} className="text-[10px] leading-relaxed">
                <span className={l.who === "you" ? "text-[#5ac8fa]" : l.who === "aura" ? "text-[#f0b90b]" : "text-[#8b8f9c]"}>{l.who}:</span> {l.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}