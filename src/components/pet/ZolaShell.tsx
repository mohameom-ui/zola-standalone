import type { CSSProperties, ReactNode } from "react";

// ZOLA CONSOLE — the character stage and operating controls share one surface.
export default function ZolaShell({
  title,
  subtitle,
  stage,
  primaryColor,
  accentColor,
  children,
}: {
  title: string;
  subtitle: string;
  stage?: ReactNode;
  primaryColor?: string;
  accentColor?: string;
  children: ReactNode;
}) {
  const name = title.split("·").pop()?.trim() || "ZOLA";

  return (
    <main className="zola-console-shell" style={{ "--z-a": primaryColor ?? "#f0b90b", "--z-b": accentColor ?? "#35d0a5" } as CSSProperties}>
      <header className="zola-topbar">
        <div className="zola-brand-lockup">
          <span className="zola-brand-mark" aria-hidden="true">Z</span>
          <div>
            <div className="zola-brand-name">{name}</div>
            <div className="zola-brand-caption">HUMANOID COMPANION · CONTROL STATION</div>
          </div>
        </div>
        <div className="zola-topbar-meta">
          <span className="zola-topbar-dot" />
          <span>INTERACTIVE AVATAR</span>
          <span className="zola-version">V 13.0</span>
        </div>
      </header>

      <div className="zola-console-grid">
        <section className="zola-presence" aria-label="Zola character stage">
          <div className="zola-stage-heading">
            <div>
              <div className="zola-eyebrow">CHARACTER SYSTEM / 01</div>
              <h1>{name}<span>LIVE MODEL</span></h1>
              <p>{subtitle}</p>
            </div>
            <div className="zola-rig-badge">
              <span className="zola-rig-pulse" />
              <div><strong>ZOLA V11</strong><small>ANIMATED COMPANION</small></div>
            </div>
          </div>

          <div className="zola-stage-viewport">
            <div className="zola-stage-corner zola-stage-corner-tl" />
            <div className="zola-stage-corner zola-stage-corner-tr" />
            <div className="zola-stage-corner zola-stage-corner-bl" />
            <div className="zola-stage-corner zola-stage-corner-br" />
            {stage ?? (
              <div className="zola-stage-loading">
                <span className="zola-stage-loader" />
                <span>INITIALIZING CHARACTER SYSTEM</span>
              </div>
            )}
          </div>

          <div className="zola-stage-footer">
            <span><i />20 BUILT-IN MOTION CLIPS</span>
            <span>HANDS · ARMS · LEGS</span>
            <span className="zola-stage-interaction">CLICK OR TAP ZOLA TO INTERACT</span>
          </div>
        </section>

        <aside className="zola-control-dock" aria-label="Zola controls">
          <div className="zola-dock-heading">
            <div>
              <div className="zola-eyebrow">OPERATIONS</div>
              <h2>Companion console</h2>
            </div>
            <span className="zola-dock-indicator" title="Control panel active" />
          </div>
          <div className="zola-dock-content">{children}</div>
        </aside>
      </div>
    </main>
  );
}
