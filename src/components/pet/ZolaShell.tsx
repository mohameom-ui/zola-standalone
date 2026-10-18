export default function ZolaShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <aside className="absolute top-4 right-4 bottom-4 z-20 w-[440px] max-w-[95vw] glass-panel rounded-2xl flex flex-col overflow-hidden scanline shadow-2xl">
      <div className="px-4 py-3 border-b border-[rgba(240,185,11,0.15)]">
        <h2 className="text-[#f0b90b] text-sm tracking-[0.2em] font-semibold">{title}</h2>
        <p className="hud-label mt-0.5">{subtitle}</p>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
