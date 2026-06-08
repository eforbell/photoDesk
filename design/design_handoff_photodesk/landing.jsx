/* ============================================================
   PhotoDesk — Landing / session browser
   ============================================================ */

function Wordmark({ size = 22 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: "var(--accent)", transform: "rotate(8deg)", opacity: 0.55 }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: "var(--panel-2)", border: "1.5px solid var(--border-strong)", display: "grid", placeItems: "center" }}>
          <Icon name="layers" size={size * 0.6} stroke={1.8} style={{ color: "var(--accent-text)" }} />
        </div>
      </div>
      <div style={{ fontWeight: 700, fontSize: size * 0.82, letterSpacing: "-0.02em" }}>
        Photo<span style={{ color: "var(--text-dim)", fontWeight: 600 }}>Desk</span>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 7, fontWeight: 600 }}>{label}</div>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%", background: "var(--panel-2)", border: "1px solid var(--border)",
  borderRadius: "var(--r-md)", padding: "10px 12px", color: "var(--text)", fontSize: 14,
  outline: "none",
};

function Landing({ onStart }) {
  const D = window.PHOTODESK;
  const [name, setName] = useState("Miami Trip — Jan");
  const [from, setFrom] = useState(D.sessionMeta.from);
  const [to, setTo] = useState(D.sessionMeta.to);
  const [thresh, setThresh] = useState(30);
  const [fetching, setFetching] = useState(false);

  const start = () => {
    setFetching(true);
    setTimeout(() => onStart({ name: name || "Untitled session", from, to, threshold: thresh }), 480);
  };

  const heroSeeds = ["phd-wall-22", "phd-brunch-4", "phd-beach-9", "phd-museum-3", "phd-street-15", "phd-sunset-6"];

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "radial-gradient(120% 80% at 100% 0%, oklch(0.20 0.02 256) 0%, var(--bg) 42%)" }}>
      {/* header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 36px", borderBottom: "1px solid var(--border-soft)" }}>
        <Wordmark />
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-dim)", background: "var(--panel)", padding: "6px 12px", borderRadius: 99, border: "1px solid var(--border-soft)" }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--keep)", boxShadow: "0 0 8px var(--keep)" }} />
          Immich · <span className="mono" style={{ color: "var(--text-faint)" }}>connected</span>
        </div>
      </header>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "44px 36px 60px" }}>
        {/* hero line */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-0.025em" }}>Cull a batch.</h1>
          <p style={{ margin: "8px 0 0", color: "var(--text-dim)", fontSize: 15, maxWidth: 540 }}>
            Pull a date range from Immich, separate keepers from junk, then push your decisions back. Nothing changes in Immich until you commit.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,360px) minmax(0,1fr)", gap: 40, alignItems: "start" }}>
          {/* New session */}
          <section style={{ }}>
            <h2 style={{ margin: "0 0 18px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)" }}>New session</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-xl)", padding: 22 }}>
              <Field label="Session name">
                <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekend trip" />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="From"><input type="date" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="To"><input type="date" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <span style={{ fontSize: 11.5, color: "var(--text-faint)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Scene threshold</span>
                  <span className="mono" style={{ fontSize: 13, color: "var(--accent-text)" }}>{thresh}s</span>
                </div>
                <input type="range" min={5} max={180} step={5} value={thresh} onChange={(e) => setThresh(+e.target.value)}
                  style={{ width: "100%", accentColor: "var(--accent)" }} />
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-ghost)", lineHeight: 1.5 }}>
                  Frames shot within {thresh}s of each other group into one scene.
                </p>
              </div>
              <button onClick={start} disabled={fetching}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px", borderRadius: "var(--r-md)", border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 14.5, marginTop: 2 }}>
                {fetching ? <><Icon name="spinner" size={16} style={{ animation: "spin 0.8s linear infinite" }} /> Fetching from Immich…</> : <>Fetch &amp; start session <Icon name="arrowR" size={16} /></>}
              </button>
            </div>
          </section>

          {/* Past sessions */}
          <section style={{ }}>
            <h2 style={{ margin: "0 0 18px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)" }}>Past sessions</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {D.pastSessions.map((s, i) => (
                <div key={i} onClick={() => onStart({ name: s.name, resume: !s.done })}
                  style={{ display: "flex", alignItems: "center", gap: 18, background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-lg)", padding: 14, cursor: "pointer", transition: "border-color .15s, background .15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.background = "var(--panel-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-soft)"; e.currentTarget.style.background = "var(--panel)"; }}>
                  {/* thumb stack */}
                  <div style={{ display: "flex", flex: "none" }}>
                    {[0, 1, 2].map((k) => (
                      <div key={k} style={{ width: 46, height: 46, borderRadius: 8, overflow: "hidden", border: "2px solid var(--panel)", marginLeft: k ? -16 : 0, boxShadow: "var(--shadow-1)", background: "var(--panel-3)" }}>
                        <img src={D.pic(heroSeeds[(i * 3 + k) % heroSeeds.length], 90, 90)} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{s.name}</div>
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--text-ghost)", display: "flex", gap: 14, flexWrap: "wrap" }}>
                      <span>{s.photos} photos</span><span>{s.scenes} scenes</span><span>{s.date}</span><span>{s.threshold}s</span>
                    </div>
                  </div>
                  {s.done ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-faint)", flex: "none" }}>
                      <span style={{ color: "var(--keep)" }}>{s.kept} kept</span>
                      <span style={{ color: "var(--text-ghost)" }}>·</span>
                      <span style={{ color: "var(--reject)" }}>{s.rejected} cut</span>
                      <span style={{ marginLeft: 8, padding: "3px 9px", borderRadius: 99, background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--text-dim)" }}>Committed</span>
                    </div>
                  ) : (
                    <span style={{ flex: "none", padding: "5px 12px", borderRadius: 99, background: "var(--accent-dim)", border: "1px solid var(--accent)", color: "var(--accent-text)", fontSize: 12.5, fontWeight: 600 }}>Resume →</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Landing, Wordmark, Field, inputStyle });
