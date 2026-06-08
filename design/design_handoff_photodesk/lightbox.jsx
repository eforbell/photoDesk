/* ============================================================
   PhotoDesk — Lightbox + Editor module
   ============================================================ */

/* ---- Histogram (decorative, deterministic by seed) ---------------- */
function Histogram({ seed = "x", adj, height = 56 }) {
  const path = useMemo(() => {
    let s = 0; for (const ch of seed) s += ch.charCodeAt(0);
    const N = 48, pts = [];
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      const a = Math.sin((x * 6 + s) ) * 0.5 + 0.5;
      const b = Math.sin((x * 13 + s * 0.7)) * 0.5 + 0.5;
      const bell = Math.exp(-Math.pow((x - 0.5) * 2.4, 2));
      pts.push(Math.max(0.04, (a * 0.45 + b * 0.3 + bell * 0.55) * (0.6 + (s % 5) / 12)));
    }
    return pts;
  }, [seed]);
  const ex = (adj && adj.exposure) || 0;
  const W = 240, H = height;
  const toPath = (arr, shift) => {
    let d = `M 0 ${H}`;
    arr.forEach((v, i) => { const x = (i / (arr.length - 1)) * W + shift; d += ` L ${x.toFixed(1)} ${(H - v * H * 0.92).toFixed(1)}`; });
    d += ` L ${W + shift} ${H} Z`;
    return d;
  };
  const shift = ex / 100 * 22;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} preserveAspectRatio="none">
      <path d={toPath(path, shift)} fill="oklch(0.85 0 0 / 0.32)" />
      <path d={toPath(path.map((v, i) => v * (0.7 + ((i * 7) % 5) / 14)), shift + 3)} fill="oklch(0.66 0.15 256 / 0.30)" />
      <path d={toPath(path.map((v, i) => v * (0.6 + ((i * 11) % 5) / 16)), shift - 3)} fill="oklch(0.64 0.18 25 / 0.22)" />
    </svg>
  );
}

/* ---- Big preview with live adjustments + overlays ----------------- */
function Stage({ photo, adj, crop, showThirds }) {
  const temp = tempOverlay(adj), vig = vignetteOverlay(adj);
  const cropStyle = crop ? {
    aspectRatio: crop.ar.replace(":", "/"),
    maxWidth: "min(100%, 1100px)", maxHeight: "100%",
  } : { maxWidth: "min(100%, 1200px)", maxHeight: "100%", aspectRatio: photo.ar.replace(":", "/") };
  return (
    <div style={{ position: "relative", ...cropStyle, boxShadow: "var(--shadow-3)", borderRadius: 2, overflow: "hidden", transition: "aspect-ratio .3s var(--ease)" }}>
      <PhotoImg photo={photo} w={1600} h={Math.round(1600 * arRatio(photo.ar))} adj={adj} />
      {temp && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", ...temp }} />}
      {vig && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", ...vig }} />}
      {showThirds && (
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} preserveAspectRatio="none" viewBox="0 0 100 100">
          {[33.33, 66.66].map((v) => <line key={"h" + v} x1="0" y1={v} x2="100" y2={v} stroke="rgba(255,255,255,0.35)" strokeWidth="0.3" />)}
          {[33.33, 66.66].map((v) => <line key={"v" + v} x1={v} y1="0" x2={v} y2="100" stroke="rgba(255,255,255,0.35)" strokeWidth="0.3" />)}
        </svg>
      )}
    </div>
  );
}

/* ---- Lightbox ----------------------------------------------------- */
function Lightbox({ list, index, setIndex, pass, onAct, onRate, onClose, onEdit }) {
  const photo = list[index];
  const stripRef = useRef(null);
  useEffect(() => {
    const el = stripRef.current && stripRef.current.querySelector('[data-active="1"]');
    if (el) el.parentNode.scrollLeft = el.offsetLeft - el.parentNode.clientWidth / 2 + el.clientWidth / 2;
  }, [index]);
  if (!photo) return null;
  const go = (d) => setIndex((i) => Math.max(0, Math.min(list.length - 1, i + d)));

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-deep)", zIndex: 60, display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", flex: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onClose} style={ghostBtn}><Icon name="x" size={18} /></button>
          <div className="mono" style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{photo.file}</div>
          <span className="mono" style={{ fontSize: 12.5, color: "var(--text-ghost)" }}>{index + 1} / {list.length}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {photo.defect && <span className="mono" style={{ fontSize: 11, color: "oklch(0.82 0.10 70)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "4px 8px", borderRadius: 6, background: "var(--star-dim)" }}>{DEFECT_LABEL[photo.defect]}</span>}
          <button onClick={() => onEdit(photo.id)} style={{ ...ghostBtn, width: "auto", padding: "0 14px", gap: 7, display: "flex", alignItems: "center", fontSize: 13.5, fontWeight: 600 }}><Icon name="sliders" size={15} /> Edit <span className="kbd" style={{ marginLeft: 2 }}>E</span></button>
        </div>
      </div>

      {/* stage */}
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 70px", minHeight: 0 }}>
        <button onClick={() => go(-1)} disabled={index === 0} style={{ ...navBtn, left: 14, opacity: index === 0 ? 0.25 : 1 }}><Icon name="chevL" size={26} /></button>

        <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Stage photo={photo} adj={photo.edited ? photo.adj : null} />
          {/* status badge */}
          {photo.status && (
            <div style={{ position: "absolute", top: 14, right: 14, display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 99, fontWeight: 700, fontSize: 13, letterSpacing: "0.05em",
              background: photo.status === "keep" ? "var(--keep)" : "var(--reject)", color: "white", boxShadow: "var(--shadow-2)" }}>
              <Icon name={photo.status === "keep" ? "check" : "x"} size={14} stroke={2.6} /> {photo.status === "keep" ? "KEEP" : "REJECT"}
            </div>
          )}
          {photo.edited && <div style={{ position: "absolute", top: 14, left: 14, padding: "6px 11px", borderRadius: 99, background: "var(--accent)", color: "white", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em", boxShadow: "var(--shadow-2)" }}>EDITED · original kept</div>}
        </div>

        <button onClick={() => go(1)} disabled={index === list.length - 1} style={{ ...navBtn, right: 14, opacity: index === list.length - 1 ? 0.25 : 1 }}><Icon name="chevR" size={26} /></button>
      </div>

      {/* rating row */}
      <div style={{ display: "flex", justifyContent: "center", padding: "2px 0 10px", flex: "none" }}>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: 99, padding: "7px 14px", display: "flex", alignItems: "center", gap: 12 }}>
          <Stars value={photo.rating} size={20} gap={4} onSet={(v) => onRate(photo.id, v)} />
        </div>
      </div>

      {/* filmstrip */}
      <div ref={stripRef} style={{ flex: "none", borderTop: "1px solid var(--border-soft)", background: "var(--bg)", padding: "10px 14px", overflowX: "auto", display: "flex", gap: 7 }}>
        {list.map((p, i) => (
          <div key={p.id} data-active={i === index ? "1" : "0"} onClick={() => setIndex(i)}
            style={{ position: "relative", height: 64, aspectRatio: p.ar.replace(":", "/"), borderRadius: 4, overflow: "hidden", flex: "none", cursor: "pointer",
              outline: i === index ? "2px solid var(--accent)" : "1px solid var(--border)", outlineOffset: i === index ? 1 : -1, opacity: i === index ? 1 : 0.62, transition: "opacity .12s" }}>
            <PhotoImg photo={p} w={160} h={Math.round(160 * arRatio(p.ar))} adj={p.edited ? p.adj : null} />
            {p.status && <div style={{ position: "absolute", top: 3, left: 3, width: 12, height: 12, borderRadius: 99, background: p.status === "keep" ? "var(--keep)" : "var(--reject)" }} />}
            {p.rating > 0 && <div style={{ position: "absolute", bottom: 2, left: 0, right: 0, textAlign: "center", fontSize: 9, color: "var(--star)", fontWeight: 700 }}>{"★".repeat(p.rating)}</div>}
          </div>
        ))}
      </div>

      {/* legend */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 18, padding: "9px 0", background: "var(--bg-deep)", borderTop: "1px solid var(--border-soft)", fontSize: 12, color: "var(--text-faint)" }}>
        {pass === "rate"
          ? <><Legend k="1–5" l="Rate" /><Legend k="0" l="Clear" /><Legend k="X" l="Reject" /></>
          : <><Legend k="P" l="Keep" /><Legend k="X" l="Reject" /><Legend k="U" l="Unset" /></>}
        <Legend k="← →" l="Navigate" /><Legend k="↵" l="Next scene" /><Legend k="E" l="Edit" /><Legend k="Esc" l="Close" />
      </div>
    </div>
  );
}
function Legend({ k, l }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="kbd">{k}</span> {l}</span>;
}

const ghostBtn = { width: 36, height: 36, borderRadius: 8, border: "1px solid var(--border-soft)", background: "var(--panel)", color: "var(--text-dim)", display: "grid", placeItems: "center" };
const navBtn = { position: "absolute", top: "50%", transform: "translateY(-50%)", zIndex: 2, width: 48, height: 48, borderRadius: 99, border: "1px solid var(--border-soft)", background: "var(--panel)", color: "var(--text)", display: "grid", placeItems: "center", boxShadow: "var(--shadow-2)" };

/* ---- Editor ------------------------------------------------------- */
const CROP_ARS = ["Original", "1:1", "4:5", "5:4", "3:2", "2:3", "16:9"];
const SLIDER_GROUPS = [
  { label: "Light", keys: [["exposure", "Exposure"], ["contrast", "Contrast"], ["highlights", "Highlights"], ["shadows", "Shadows"]] },
  { label: "Color", keys: [["temp", "Temp"], ["saturation", "Saturation"], ["vibrance", "Vibrance"]] },
  { label: "Effects", keys: [["vignette", "Vignette", 0]] },
];

function EditSlider({ label, value, min = -100, max = 100, onChange }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span onDoubleClick={() => onChange(0)} style={{ fontSize: 12.5, color: "var(--text-dim)", cursor: "default" }}>{label}</span>
        <span className="mono" style={{ fontSize: 12, color: value ? "var(--accent-text)" : "var(--text-ghost)" }}>{value > 0 ? "+" + value : value}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
    </div>
  );
}

function Editor({ photo, onSave, onClose }) {
  const [adj, setAdj] = useState(() => Object.assign({}, ADJ_ZERO, photo.adj || {}));
  const [crop, setCrop] = useState(photo.crop || "Original");
  const [tool, setTool] = useState("light"); // 'crop' | 'light'
  const set = (k, v) => setAdj((a) => Object.assign({}, a, { [k]: v }));
  const applyPreset = (p) => setAdj(Object.assign({}, ADJ_ZERO, p.adj));
  const reset = () => { setAdj(Object.assign({}, ADJ_ZERO)); setCrop("Original"); };
  const dirty = hasAdj(adj) || crop !== "Original";
  const cropObj = crop === "Original" ? { ar: photo.ar } : { ar: crop };

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-deep)", zIndex: 70, display: "flex" }}>
      {/* preview side */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={onClose} style={ghostBtn}><Icon name="x" size={18} /></button>
            <div className="mono" style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{photo.file}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setTool("crop")} style={{ ...toolBtn, ...(tool === "crop" ? toolBtnOn : {}) }}><Icon name="crop" size={15} /> Crop</button>
            <button onClick={() => setTool("light")} style={{ ...toolBtn, ...(tool === "light" ? toolBtnOn : {}) }}><Icon name="sliders" size={15} /> Adjust</button>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 36px 36px", minHeight: 0 }}>
          <Stage photo={photo} adj={adj} crop={tool === "crop" ? cropObj : null} showThirds={tool === "crop"} />
        </div>
      </div>

      {/* control panel */}
      <div style={{ width: 320, flex: "none", background: "var(--panel)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-soft)" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)", marginBottom: 8, fontWeight: 600 }}>Histogram</div>
          <div style={{ background: "var(--bg-deep)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border-soft)" }}><Histogram seed={photo.seed} adj={adj} /></div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {tool === "crop" ? (
            <div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)", marginBottom: 10, fontWeight: 600 }}>Aspect ratio</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {CROP_ARS.map((a) => (
                  <button key={a} onClick={() => setCrop(a)} style={{ padding: "9px", borderRadius: 8, fontSize: 13, border: "1px solid " + (crop === a ? "var(--accent)" : "var(--border)"), background: crop === a ? "var(--accent-dim)" : "var(--panel-2)", color: crop === a ? "var(--accent-text)" : "var(--text-dim)", fontWeight: crop === a ? 600 : 400 }}>{a}</button>
                ))}
              </div>
              <p style={{ fontSize: 12, color: "var(--text-ghost)", lineHeight: 1.5, marginTop: 16 }}>Drag thirds to compose. Crop is applied to a new version on save — the original stays untouched.</p>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)", marginBottom: 9, fontWeight: 600 }}>Presets</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {window.PHOTODESK.presets.map((p) => (
                    <button key={p.id} onClick={() => applyPreset(p)} style={{ padding: "6px 11px", borderRadius: 99, fontSize: 12.5, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text-dim)" }}>{p.name}</button>
                  ))}
                </div>
              </div>
              {SLIDER_GROUPS.map((g) => (
                <div key={g.label} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)", marginBottom: 10, fontWeight: 600 }}>{g.label}</div>
                  {g.keys.map(([k, lbl, min]) => <EditSlider key={k} label={lbl} value={adj[k]} min={min === 0 ? 0 : -100} onChange={(v) => set(k, v)} />)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: 16, borderTop: "1px solid var(--border-soft)", display: "flex", gap: 9 }}>
          <button onClick={reset} disabled={!dirty} style={{ ...toolBtn, opacity: dirty ? 1 : 0.4 }}><Icon name="reset" size={14} /> Reset</button>
          <button onClick={() => onSave(photo.id, dirty ? adj : null, crop)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: dirty ? "var(--accent)" : "var(--panel-2)", color: dirty ? "white" : "var(--text-faint)", fontWeight: 600, fontSize: 13.5 }}>{dirty ? "Save as new version" : "Done"}</button>
        </div>
      </div>
    </div>
  );
}

const toolBtn = { display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 8, border: "1px solid var(--border-soft)", background: "var(--panel)", color: "var(--text-dim)", fontSize: 13.5, fontWeight: 500 };
const toolBtnOn = { background: "var(--accent-dim)", borderColor: "var(--accent)", color: "var(--accent-text)" };

Object.assign(window, { Lightbox, Editor, Histogram, Stage });
