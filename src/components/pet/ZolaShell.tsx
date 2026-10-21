// ZOLA SHELL — the minimalist header: identity first, noise last
export default function ZolaShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  // her name, cleanly — everything before "·" is lineage we don't shout
  const name = title.split("·").pop()?.trim() || "ZOLA";
  return (
    <aside className="absolute top-4 right-4 bottom-4 z-20 w-[440px] max-w-[95vw] glass-panel rounded-2xl flex flex-col overflow-hidden shadow-2xl">
      <div className="px-5 pt-4 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#35d0a5] opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#35d0a5]" />
          </span>
          <h2 className="text-[#e9e7dc] text-lg font-semibold tracking-[0.35em]">{name}</h2>
          <span className="ml-auto text-[9px] px-2 py-0.5 rounded-full border border-[#f0b90b]/40 text-[#f0b90b] tracking-widest">
            v5.5
          </span>
        </div>
        <p className="mt-1 text-[10px] text-[#8b8f9c] tracking-[0.18em] uppercase">{subtitle}</p>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
