/* ============================================================
   PhotoDesk — Library / Discover (the Immich hand-off)
   Discovery-first entry: PhotoDesk surfaces un-triaged batches
   as ready-to-cull sessions, plus a browsable density heatmap.
   ============================================================ */

/* ---- heatmap helpers --------------------------------------------- */
function heatColor(day) {
  if (!day || !day.count) return "var(--panel-2)";
  const lv = day.count >= 60 ? 3 : day.count >= 30 ? 2 : day.count >= 10 ? 1 : 0;
  if (day.untriaged) return ["oklch(0.40 0.10 256)", "oklch(0.52 0.13 256)", "oklch(0.62 0.15 256)", "oklch(0.72 0.15 256)"][lv];
  return ["oklch(0.30 0 0)", "oklch(0.36 0 0)", "oklch(0.43 0 0)", "oklch(0.50 0 0)"][lv];
}
function inRange(key, a, b) {
  if (!a || !b) return false;
  const lo = a < b ? a : b, hi = a < b ? b : a;
  return key >= lo && key <= hi;
}

/* ---- one month block in the heatmap ------------------------------ */
function MonthHeat({ month, range, onDown, onEnter, onHover }) {
  const lead = month.days[0].dow; // empty cells before day 1
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<div key={"e" + i} style={{ width: 15, height: 15 }} />);
  month.days.forEach((dy) => {
    const sel = range && inRange(dy.key, range.a, range.b);
    cells.push(
      <div key={dy.key}
        onMouseDown={(e) => { e.preventDefault(); onDown(dy); }}
        onMouseEnter={(e) => { onEnter(dy); onHover(dy, e.currentTarget); }}
        onMouseLeave={() => onHover(null)}
        style={{
          width: 15, height: 15, borderRadius: 3.5, background: heatColor(dy),
          cursor: dy.count ? "pointer" : "default",
          outline: sel ? "1.5px solid var(--accent)" : "none", outlineOffset: 1,
          boxShadow: sel ? "0 0 0 3px var(--accent-dim)" : "none",
          transition: "outline-color .1s",
        }} />
    );
  });
  return (
    <div style={{ flex: "none" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 8, fontWeight: 600, letterSpacing: "0.02em" }}>{month.label} <span className="mono" style={{ color: "var(--text-ghost)" }}>'{String(month.y).slice(2)}</span></div>
      <div style={{ display: "grid", gridTemplateRows: "repeat(7, 15px)", gridAutoFlow: "column", gridAutoColumns: "15px", gap: 4 }}>{cells}</div>
    </div>
  );
}

/* ---- suggested session card -------------------------------------- */
function SuggestedCard({ s, onStart }) {
  const [hover, setHover] = useState(false);
  const D = window.PHOTODESK;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: "var(--panel)", border: "1px solid " + (hover ? "var(--border-strong)" : "var(--border-soft)"), borderRadius: "var(--r-lg)", overflow: "hidden", transition: "border-color .15s, transform .15s", transform: hover ? "translateY(-2px)" : "none" }}>
      {/* mosaic */}
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 2, aspectRatio: "16/10", background: "var(--panel-3)" }}>
        {s.seeds.map((sd, i) => (
          <div key={i} style={{ overflow: "hidden", background: "var(--panel-3)" }}>
            <img src={D.pic(sd, 240, 160)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.opacity = 0; }} />
          </div>
        ))}
        <div style={{ position: "absolute", top: 9, left: 9, display: "flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: 99, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", fontSize: 11, fontWeight: 600, color: "var(--accent-text)", whiteSpace: "nowrap" }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--accent)", boxShadow: "0 0 6px var(--accent)", flex: "none" }} /> Un-triaged
        </div>
      </div>
      {/* body */}
      <div style={{ padding: "13px 15px 15px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{s.name}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-ghost)", flex: "none" }}>{s.when}</div>
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 5, display: "flex", gap: 12, whiteSpace: "nowrap" }}>
          <span>{s.span}</span><span>{s.photos} photos</span><span>~{s.scenes} scenes</span>
        </div>
        <button onClick={() => onStart({ name: s.span + " · " + s.name, from: s.from, to: s.to, threshold: 30, photos: s.photos })}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", marginTop: 13, padding: "9px", borderRadius: "var(--r-md)", border: "none", background: hover ? "var(--accent)" : "var(--panel-2)", color: hover ? "white" : "var(--text)", fontWeight: 600, fontSize: 13.5, transition: "background .15s" }}>
          Start culling <Icon name="arrowR" size={15} />
        </button>
      </div>
    </div>
  );
}

/* ---- selection preview (from calendar) --------------------------- */
function SelectionPanel({ range, onStart, onClear }) {
  const D = window.PHOTODESK;
  const sel = useMemo(() => D.library.days.filter((dy) => dy.count && inRange(dy.key, range.a, range.b)), [range]);
  const [name, setName] = useState("");
  const [thresh, setThresh] = useState(30);
  const photos = sel.reduce((a, b) => a + b.count, 0);
  const untri = sel.reduce((a, b) => a + (b.untriaged ? b.count : 0), 0);
  const lo = sel[0], hi = sel[sel.length - 1];
  const auto = !sel.length ? "—" : lo.key === hi.key ? lo.label : lo.label + " – " + hi.label;
  const previewSeeds = sel.slice(0, 6).map((d) => d.seed);

  if (!sel.length) return (
    <div style={{ background: "var(--panel)", border: "1px dashed var(--border)", borderRadius: "var(--r-lg)", padding: "22px", textAlign: "center", color: "var(--text-ghost)", fontSize: 13.5 }}>
      No photos in that range. Pick a brighter cell — or drag across several days.
    </div>
  );

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-lg)", padding: 18, display: "flex", flexDirection: "column", gap: 15 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{auto}</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4, display: "flex", gap: 12 }}>
            <span>{photos} photos</span><span>{sel.length} {sel.length === 1 ? "day" : "days"}</span>
            {untri > 0 && <span style={{ color: "var(--accent-text)" }}>{untri} un-triaged</span>}
          </div>
        </div>
        <button onClick={onClear} style={{ ...ghostBtn, width: 30, height: 30 }}><Icon name="x" size={15} /></button>
      </div>

      {/* tiny preview strip */}
      <div style={{ display: "flex", gap: 5 }}>
        {previewSeeds.map((sd, i) => (
          <div key={i} style={{ width: 52, height: 40, borderRadius: 5, overflow: "hidden", background: "var(--panel-3)", flex: "none" }}>
            <img src={D.pic(sd, 110, 80)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.opacity = 0; }} />
          </div>
        ))}
        {photos > previewSeeds.length && <div style={{ width: 52, height: 40, borderRadius: 5, background: "var(--panel-2)", display: "grid", placeItems: "center", flex: "none", fontSize: 12, color: "var(--text-faint)" }} className="mono">+{photos - previewSeeds.length}</div>}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
        <label style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Session name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={auto} style={inputStyle} />
        </label>
        <label style={{ width: 140, flex: "none" }}>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, display: "flex", justifyContent: "space-between" }}><span>Scene gap</span><span className="mono" style={{ color: "var(--accent-text)" }}>{thresh}s</span></div>
          <input type="range" min={5} max={120} step={5} value={thresh} onChange={(e) => setThresh(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)", marginTop: 9 }} />
        </label>
        <button onClick={() => onStart({ name: name || auto, from: lo.key, to: hi.key, threshold: thresh, photos })}
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "11px 18px", borderRadius: "var(--r-md)", border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 14, flex: "none" }}>
          Start session <Icon name="arrowR" size={15} />
        </button>
      </div>
    </div>
  );
}

/* ---- Library screen ---------------------------------------------- */
function Library({ onStart }) {
  const D = window.PHOTODESK;
  const lib = D.library;
  const [range, setRange] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const onDown = (dy) => { setRange({ a: dy.key, b: dy.key }); setDragging(true); };
  const onEnter = (dy) => { if (dragging) setRange((r) => ({ a: r.a, b: dy.key })); };
  const onHover = (dy, el) => {
    if (!dy) { setTip(null); return; }
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, label: dy.label, count: dy.count, untriaged: dy.untriaged });
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "radial-gradient(120% 70% at 100% 0%, oklch(0.20 0.02 256) 0%, var(--bg) 44%)" }} onMouseLeave={() => setTip(null)}>
      {/* header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 36px", borderBottom: "1px solid var(--border-soft)", position: "sticky", top: 0, background: "color-mix(in oklab, var(--bg) 86%, transparent)", backdropFilter: "blur(10px)", zIndex: 6 }}>
        <Wordmark />
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-dim)", background: "var(--panel)", padding: "6px 12px", borderRadius: 99, border: "1px solid var(--border-soft)" }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--keep)", boxShadow: "0 0 8px var(--keep)" }} />
          Immich · <span className="mono" style={{ color: "var(--text-faint)" }}>connected</span>
        </div>
      </header>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "40px 36px 70px" }}>
        {/* hero / stats */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 38, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-0.025em" }}>Your library</h1>
            <p style={{ margin: "8px 0 0", color: "var(--text-dim)", fontSize: 15, maxWidth: 520 }}>
              PhotoDesk scans Immich for photos you haven't culled yet and groups them into sessions. Start with a suggestion, or browse the calendar.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Stat n={lib.total.toLocaleString()} l="In library" />
            <Stat n={lib.untriaged} l="Un-triaged" accent />
            <Stat n={lib.untriagedDays} l="Active days" />
          </div>
        </div>

        {/* suggested */}
        <section style={{ marginBottom: 44 }}>
          <SectionHead title="Ready to cull" sub="Un-triaged batches, newest first" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {D.suggested.map((s) => <SuggestedCard key={s.id} s={s} onStart={onStart} />)}
          </div>
        </section>

        {/* browse heatmap */}
        <section style={{ marginBottom: 44 }}>
          <SectionHead title="Browse by date" sub="Click a day or drag across several · brighter = more photos" />
          <div style={{ background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-xl)", padding: "22px 24px", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap", overflowX: "auto", paddingBottom: 4 }}>
              {lib.months.map((m) => <MonthHeat key={m.label + m.y} month={m} range={range} onDown={onDown} onEnter={onEnter} onHover={onHover} />)}
            </div>
            {/* legend */}
            <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-soft)", fontSize: 12, color: "var(--text-faint)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "oklch(0.62 0.15 256)" }} /> Needs culling</span>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "oklch(0.43 0 0)" }} /> Reviewed</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>Less
                {["var(--panel-2)", "oklch(0.40 0.06 256)", "oklch(0.52 0.13 256)", "oklch(0.62 0.15 256)", "oklch(0.72 0.15 256)"].map((c, i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 3, background: c }} />)}
                More</span>
            </div>
          </div>
          {range && <SelectionPanel range={range} onStart={onStart} onClear={() => setRange(null)} />}
        </section>

        {/* recent sessions */}
        <section>
          <SectionHead title="Recent sessions" sub="Pick up where you left off" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {D.pastSessions.map((s, i) => (
              <div key={i} onClick={() => onStart({ name: s.name, resume: !s.done })}
                style={{ display: "flex", alignItems: "center", gap: 16, background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-md)", padding: "11px 14px", cursor: "pointer", transition: "border-color .15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-soft)"; }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: s.done ? "var(--panel-2)" : "var(--accent-dim)", border: "1px solid " + (s.done ? "var(--border)" : "var(--accent)"), display: "grid", placeItems: "center", flex: "none", color: s.done ? "var(--text-faint)" : "var(--accent-text)" }}>
                  <Icon name={s.done ? "check" : "layers"} size={16} stroke={1.9} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-ghost)", display: "flex", gap: 12, marginTop: 2 }}>
                    <span>{s.photos} photos</span><span>{s.scenes} scenes</span><span>{s.date}</span>
                  </div>
                </div>
                {s.done
                  ? <span style={{ fontSize: 12, color: "var(--text-faint)", display: "flex", gap: 8, alignItems: "center" }}><span style={{ color: "var(--keep)" }}>{s.kept} kept</span><span style={{ color: "var(--reject)" }}>{s.rejected} cut</span></span>
                  : <span style={{ flex: "none", padding: "5px 12px", borderRadius: 99, background: "var(--accent-dim)", border: "1px solid var(--accent)", color: "var(--accent-text)", fontSize: 12.5, fontWeight: 600 }}>Resume →</span>}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* hover tooltip */}
      {tip && (
        <div style={{ position: "fixed", left: tip.x, top: tip.y - 12, transform: "translate(-50%, -100%)", zIndex: 40, pointerEvents: "none",
          background: "var(--panel-3)", border: "1px solid var(--border-strong)", borderRadius: 7, padding: "6px 10px", boxShadow: "var(--shadow-2)", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{tip.label}</div>
          <div className="mono" style={{ fontSize: 11, color: tip.count ? (tip.untriaged ? "var(--accent-text)" : "var(--text-dim)") : "var(--text-ghost)", marginTop: 2 }}>
            {tip.count ? tip.count + " photos · " + (tip.untriaged ? "un-triaged" : "reviewed") : "no photos"}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ n, l, accent }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-md)", padding: "12px 18px", minWidth: 96, textAlign: "center" }}>
      <div className="mono" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: accent ? "var(--accent-text)" : "var(--text)" }}>{n}</div>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)", marginTop: 7, whiteSpace: "nowrap" }}>{l}</div>
    </div>
  );
}

function SectionHead({ title, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: "0.01em", whiteSpace: "nowrap", flex: "none" }}>{title}</h2>
      <span style={{ fontSize: 12.5, color: "var(--text-ghost)", whiteSpace: "nowrap" }}>{sub}</span>
    </div>
  );
}

Object.assign(window, { Library });
