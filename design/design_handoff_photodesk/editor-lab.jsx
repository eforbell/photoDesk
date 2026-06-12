/* ============================================================
   PhotoDesk — Editor Lab
   A focused prototype of the upgraded editor: draggable crop +
   a grouped profile gallery with live previews and intensity.
   Reuses the EXACT adjustment math from public/editor.js so what
   you see maps 1:1 to the sharp render on the server.
   ============================================================ */
const { useState, useEffect, useRef, useMemo } = React;

/* ---- Sample images (test crop on both orientations) -------------- */
const SAMPLES = [
  { id: "portrait", label: "Portrait", seed: "phd-golf-girl", w: 1000, h: 1500, ratio: 1000 / 1500 },
  { id: "land", label: "Landscape", seed: "phd-skyline-11", w: 1500, h: 1000, ratio: 1500 / 1000 },
  { id: "square", label: "Wide", seed: "phd-beach-9", w: 1600, h: 1067, ratio: 1600 / 1067 },
];
const picURL = (s, w, h) => `https://picsum.photos/seed/${encodeURIComponent(s)}/${w}/${h}`;

/* ---- Profile library (expanded + grouped) ------------------------ *
 * Existing 7 from public/editor.js are kept verbatim; the rest are
 * additions, all within the same 8-parameter model — no renderer
 * change required.                                                    */
const ZERO = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, saturation: 0, vibrance: 0, vignette: 0 };
const PROFILE_GROUPS = [
  { group: "Standard", items: [
    { id: "original", name: "Original", adj: {} },
    { id: "punch", name: "Punch", adj: { exposure: 5, contrast: 24, saturation: 14, vibrance: 22 } },           // existing
    { id: "vivid", name: "Vivid", adj: { contrast: 14, saturation: 24, vibrance: 28 } },
    { id: "soft", name: "Soft", adj: { contrast: -12, highlights: -10, shadows: 16, saturation: -4 } },
  ]},
  { group: "White balance", items: [
    { id: "warm", name: "Warm", adj: { exposure: 4, temp: 28, saturation: 8, vibrance: 12 } },                  // existing
    { id: "cool", name: "Cool", adj: { temp: -26, contrast: 8, vibrance: 10 } },                                // existing
    { id: "golden", name: "Golden", adj: { exposure: 3, temp: 34, highlights: -8, saturation: 10, vibrance: 8 } },
    { id: "shade", name: "Open Shade", adj: { temp: -16, exposure: 6, shadows: 12, vibrance: 8 } },
  ]},
  { group: "Black & white", items: [
    { id: "bw", name: "B&W", adj: { contrast: 18, saturation: -100, highlights: 8 } },                          // existing
    { id: "monohi", name: "Mono Hi", adj: { contrast: 34, saturation: -100, highlights: -6, shadows: -10 } },
    { id: "silver", name: "Silver", adj: { contrast: 6, saturation: -100, highlights: 10, shadows: 22 } },
  ]},
  { group: "Film & vintage", items: [
    { id: "film", name: "Film", adj: { contrast: 12, highlights: -16, shadows: 18, temp: 10, saturation: -12, vignette: 18 } }, // existing
    { id: "matte", name: "Matte", adj: { contrast: -20, highlights: -18, shadows: 24, saturation: -8 } },        // existing
    { id: "faded", name: "Faded", adj: { contrast: -16, exposure: 6, highlights: -10, shadows: 22, saturation: -14, vignette: 10 } },
    { id: "classic", name: "Classic", adj: { contrast: 10, temp: 8, highlights: -10, shadows: 14, vibrance: 8, vignette: 8 } },
  ]},
];
const ALL_PROFILES = PROFILE_GROUPS.flatMap((g) => g.items);
const EXISTING = new Set(["original", "punch", "warm", "cool", "matte", "bw", "film"]);

const scaleAdj = (adj, f) => Object.fromEntries(Object.keys(ZERO).map((k) => [k, Math.round((adj[k] || 0) * f)]));
const fullAdj = (adj) => Object.assign({}, ZERO, adj);
const isZero = (adj) => Object.keys(ZERO).every((k) => !(adj[k] || 0));

/* ---- adjustment → CSS (mirrors public/editor.js exactly) --------- */
function adjFilter(a) {
  const brightness = 1 + a.exposure / 100 * 0.4 + a.shadows / 100 * 0.12 - a.highlights / 100 * 0.10;
  const contrast = 1 + a.contrast / 100 * 0.32 + a.highlights / 100 * 0.06;
  const saturate = Math.max(0, 1 + a.saturation / 100 + a.vibrance / 100 * 0.5);
  return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)})`;
}
function tempRGBA(a) {
  if (!a.temp) return null;
  const color = a.temp > 0 ? "255,168,76" : "78,150,255";
  return `rgba(${color},${Math.min(0.34, Math.abs(a.temp) / 100 * 0.30).toFixed(3)})`;
}
function vignetteBG(a) {
  if (!a.vignette) return null;
  return `radial-gradient(ellipse 78% 78% at 50% 50%, transparent 50%, rgba(0,0,0,${(a.vignette / 100 * 0.75).toFixed(3)}) 100%)`;
}

/* ---- a rendered image with overlays ------------------------------ */
function Rendered({ src, adj, radius = 0, style }) {
  const temp = tempRGBA(adj), vig = vignetteBG(adj);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: radius, overflow: "hidden", ...style }}>
      <img src={src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: adjFilter(adj) }} onError={(e) => { e.target.style.opacity = 0.15; }} />
      {temp && <div style={{ position: "absolute", inset: 0, background: temp, mixBlendMode: "soft-light", pointerEvents: "none" }} />}
      {vig && <div style={{ position: "absolute", inset: 0, background: vig, pointerEvents: "none" }} />}
    </div>
  );
}

/* ---- cropped stage (bright, no surround) — JS-measured so it can't *
 * collapse: a <div> with background-image has no intrinsic size, so we
 * measure the available area and size the pane in real pixels.        */
function CroppedStage({ src, crop, adj, sample }) {
  const areaRef = useRef(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = areaRef.current; if (!el) return;
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const R = (crop.w * sample.w) / (crop.h * sample.h);   // displayed aspect of the crop
  let dispW = Math.min(area.w, 980), dispH = dispW / R;
  if (dispH > area.h) { dispH = area.h; dispW = dispH * R; }
  const temp = tempRGBA(adj), vig = vignetteBG(adj);
  const posX = crop.w < 0.999 ? (crop.x / (1 - crop.w)) * 100 : 0;
  const posY = crop.h < 0.999 ? (crop.y / (1 - crop.h)) * 100 : 0;
  return (
    <div ref={areaRef} style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {dispW > 0 && (
        <div style={{ width: Math.round(dispW), height: Math.round(dispH), position: "relative", boxShadow: "var(--shadow-3)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: `url("${src}")`, backgroundRepeat: "no-repeat",
            backgroundSize: `${(100 / crop.w).toFixed(2)}% ${(100 / crop.h).toFixed(2)}%`,
            backgroundPosition: `${posX.toFixed(2)}% ${posY.toFixed(2)}%`, filter: adjFilter(adj) }} />
          {temp && <div style={{ position: "absolute", inset: 0, background: temp, mixBlendMode: "soft-light", pointerEvents: "none" }} />}
          {vig && <div style={{ position: "absolute", inset: 0, background: vig, pointerEvents: "none" }} />}
        </div>
      )}
    </div>
  );
}

/* ---- compact histogram ------------------------------------------- */
function Histo({ seed, adj }) {
  const pts = useMemo(() => {
    let s = 0; for (const c of seed) s += c.charCodeAt(0);
    const N = 46, out = [];
    for (let i = 0; i < N; i++) { const x = i / (N - 1); const bell = Math.exp(-Math.pow((x - 0.5) * 2.3, 2)); out.push(Math.max(0.05, (Math.sin(x * 7 + s) * 0.4 + 0.5) * 0.5 + bell * 0.5)); }
    return out;
  }, [seed]);
  const W = 240, H = 58, shift = adj.exposure / 100 * 22;
  const path = (arr, sh, sc) => { let d = `M 0 ${H}`; arr.forEach((v, i) => { d += ` L ${(i / (arr.length - 1) * W + sh).toFixed(1)} ${(H - v * H * 0.9 * sc).toFixed(1)}`; }); return d + ` L ${W + sh} ${H} Z`; };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={path(pts, shift, 1)} fill="oklch(0.85 0 0 / 0.30)" />
      <path d={path(pts, shift + 3, 0.8)} fill="oklch(0.66 0.15 256 / 0.30)" />
    </svg>
  );
}

/* ---- profile thumbnail ------------------------------------------- */
function ProfileThumb({ p, src, active, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: 0, border: "none", background: "none", display: "flex", flexDirection: "column", gap: 5, alignItems: "stretch", cursor: "pointer" }}>
      <div style={{ position: "relative", aspectRatio: "1", borderRadius: 7, overflow: "hidden",
        outline: active ? "2px solid var(--accent)" : "1px solid var(--border)", outlineOffset: active ? 1 : -1,
        boxShadow: active ? "0 0 0 4px var(--accent-dim)" : "none" }}>
        <Rendered src={src} adj={fullAdj(p.adj)} />
        {!EXISTING.has(p.id) && <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 99, background: "var(--accent)", boxShadow: "0 0 0 2px rgba(0,0,0,0.4)" }} />}
      </div>
      <span style={{ fontSize: 11.5, color: active ? "var(--accent-text)" : "var(--text-dim)", fontWeight: active ? 600 : 400, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
    </button>
  );
}

/* ---- slider ------------------------------------------------------ */
function Slider({ label, value, min = -100, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span onDoubleClick={() => onChange(0)} style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{label}</span>
        <span className="mono" style={{ fontSize: 12, color: value ? "var(--accent-text)" : "var(--text-ghost)" }}>{value > 0 ? "+" + value : value}</span>
      </div>
      <input type="range" min={min} max={100} value={value} onChange={(e) => onChange(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
    </div>
  );
}

const ASPECTS = ["Free", "Original", "1:1", "4:5", "5:4", "3:2", "2:3", "16:9"];
const SLIDER_DEFS = [
  ["Light", [["exposure", "Exposure"], ["contrast", "Contrast"], ["highlights", "Highlights"], ["shadows", "Shadows"]]],
  ["Color", [["temp", "Temp"], ["saturation", "Saturation"], ["vibrance", "Vibrance"]]],
  ["Effects", [["vignette", "Vignette", 0]]],
];

function EditorLab() {
  const [sample, setSample] = useState(SAMPLES[0]);
  const [tool, setTool] = useState("adjust");      // 'crop' | 'adjust'
  const [aspect, setAspect] = useState("Free");
  const [crop, setCrop] = useState({ x: 0.08, y: 0.06, w: 0.84, h: 0.88 });
  const [adj, setAdj] = useState(ZERO);
  const [presetId, setPresetId] = useState("original");
  const [amount, setAmount] = useState(100);
  const [rating, setRating] = useState(0);
  const [compare, setCompare] = useState(false);

  const cropBoxRef = useRef(null);
  const src = picURL(sample.seed, sample.w, sample.h);
  const thumbSrc = picURL(sample.seed, 200, 200);
  const base = ALL_PROFILES.find((p) => p.id === presetId) || ALL_PROFILES[0];
  const edited = presetId && !objEq(adj, scaleAdj(base.adj, amount / 100));
  const shownAdj = compare ? ZERO : adj;

  const applyProfile = (p) => { setPresetId(p.id); setAmount(100); setAdj(fullAdj(p.adj)); };
  const setAmt = (v) => { setAmount(v); if (base) setAdj(fullAdj(scaleAdj(base.adj, v / 100))); };
  const setSlider = (k, v) => setAdj((a) => Object.assign({}, a, { [k]: v }));
  const resetAll = () => { setAdj(ZERO); setPresetId("original"); setAmount(100); setAspect("Free"); setCrop({ x: 0.08, y: 0.06, w: 0.84, h: 0.88 }); };

  // choose aspect → refit crop centered on current center
  const chooseAspect = (a) => {
    setAspect(a);
    if (a === "Free") return;
    const rp = a === "Original" ? sample.ratio : (() => { const [x, y] = a.split(":").map(Number); return x / y; })();
    const boxRatio = sample.ratio; // normalized box ratio == image ratio
    // work in a unit box scaled by ratio to keep px-true: treat width in [0,1], height scaled
    const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
    // ratioPx maps to normalized: w/h (normalized) = rp / boxRatio
    const rN = rp / boxRatio;
    let w = crop.w, h = w / rN;
    if (h > 1) { h = 0.96; w = h * rN; }
    if (w > 1) { w = 0.96; h = w / rN; }
    let x = cx - w / 2, y = cy - h / 2;
    x = Math.max(0, Math.min(1 - w, x)); y = Math.max(0, Math.min(1 - h, y));
    setCrop({ x, y, w, h });
  };

  const flipAspect = () => { if (aspect.includes(":")) { const [a, b] = aspect.split(":"); chooseAspect(b + ":" + a); } };

  // keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.key === "c" || e.key === "C") setTool((t) => t === "crop" ? "adjust" : "crop");
      if (e.key >= "1" && e.key <= "5") setRating(+e.key);
      if (e.key === "0") setRating(0);
      if (e.key === "\\") { setCompare(true); }
    };
    const up = (e) => { if (e.key === "\\") setCompare(false); };
    window.addEventListener("keydown", onKey); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", up); };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-deep)", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", flex: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={ghostSq}><Icon name="x" size={18} /></button>
          <div className="mono" style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{sample.seed === "phd-golf-girl" ? "IMG_8391.JPG" : "IMG_" + sample.w + ".JPG"}</div>
          {edited && tool === "adjust" && <span style={{ fontSize: 11, color: "var(--text-ghost)", padding: "3px 8px", borderRadius: 6, background: "var(--panel-2)" }}>edited</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onMouseDown={() => setCompare(true)} onMouseUp={() => setCompare(false)} onMouseLeave={() => setCompare(false)}
            style={{ ...toolChip, ...(compare ? toolChipOn : {}) }}><Icon name="info" size={15} /> Before <span className="kbd" style={{ marginLeft: 2 }}>\</span></button>
          <button onClick={() => setTool("crop")} style={{ ...toolChip, ...(tool === "crop" ? toolChipOn : {}) }}><Icon name="crop" size={15} /> Crop</button>
          <button onClick={() => setTool("adjust")} style={{ ...toolChip, ...(tool === "adjust" ? toolChipOn : {}) }}><Icon name="sliders" size={15} /> Adjust</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* stage */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px 36px 18px", minWidth: 0, gap: 14 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0, width: "100%" }}>
            {tool === "crop"
              ? <CropArea natRatio={sample.ratio} src={src} filter={adjFilter(shownAdj)} crop={crop} setCrop={setCrop} aspect={aspect} grid />
              : <CroppedStage src={src} crop={crop} adj={shownAdj} sample={sample} />}
          </div>
          {/* sample switcher */}
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            {SAMPLES.map((s) => (
              <button key={s.id} onClick={() => setSample(s)} title={s.label}
                style={{ width: 46, height: 34, borderRadius: 6, overflow: "hidden", padding: 0, border: "1px solid " + (sample.id === s.id ? "var(--accent)" : "var(--border)"), outline: sample.id === s.id ? "2px solid var(--accent-dim)" : "none" }}>
                <img src={picURL(s.seed, 92, 68)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.opacity = 0; }} />
              </button>
            ))}
          </div>
        </div>

        {/* panel */}
        <div style={{ width: 340, flex: "none", background: "var(--panel)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
          {/* histogram + rating */}
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-soft)" }}>
            <Lbl>Histogram</Lbl>
            <div style={{ background: "var(--bg-deep)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border-soft)", marginTop: 8 }}><Histo seed={sample.seed} adj={shownAdj} /></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
              <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Rating</span>
              <Stars value={rating} size={16} gap={3} onSet={setRating} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
            {tool === "crop" ? (
              <CropPanel aspect={aspect} chooseAspect={chooseAspect} flipAspect={flipAspect} crop={crop} sample={sample} goAdjust={() => setTool("adjust")} />
            ) : (
              <AdjustPanel groups={PROFILE_GROUPS} thumbSrc={thumbSrc} presetId={presetId} applyProfile={applyProfile}
                amount={amount} setAmt={setAmt} base={base} adj={adj} setSlider={setSlider} edited={edited} />
            )}
          </div>

          {/* footer */}
          <div style={{ padding: 16, borderTop: "1px solid var(--border-soft)", display: "flex", gap: 9 }}>
            <button onClick={resetAll} style={toolChip}><Icon name="reset" size={14} /> Reset</button>
            <button style={{ ...toolChip, marginLeft: "auto" }}>Cancel</button>
            <button style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 13.5 }}>Save version</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Crop panel -------------------------------------------------- */
function CropPanel({ aspect, chooseAspect, flipAspect, crop, sample, goAdjust }) {
  const px = (v, dim) => Math.round(v * (dim === "w" ? sample.w : sample.h));
  const cropped = crop.w < 0.999 || crop.h < 0.999;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ whiteSpace: "nowrap" }}><Lbl>Aspect ratio</Lbl></span>
        <button onClick={flipAspect} disabled={!aspect.includes(":")} title="Flip orientation"
          style={{ ...miniBtn, opacity: aspect.includes(":") ? 1 : 0.4 }}><Icon name="reset" size={13} /> Flip</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {ASPECTS.map((a) => {
          const on = aspect === a;
          return (
            <button key={a} onClick={() => chooseAspect(a)}
              style={{ padding: "9px", borderRadius: 8, fontSize: 13, border: "1px solid " + (on ? "var(--accent)" : "var(--border)"), background: on ? "var(--accent-dim)" : "var(--panel-2)", color: on ? "var(--accent-text)" : "var(--text-dim)", fontWeight: on ? 600 : 400, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {a === "Free" && <Icon name="maximize" size={13} />}{a}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 18, padding: 14, background: "var(--bg-deep)", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
        <Lbl>Crop region <span style={{ color: "var(--text-ghost)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· normalized → server</span></Lbl>
        <div className="mono" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", marginTop: 10, fontSize: 12, color: "var(--text-dim)" }}>
          <span>x <b style={{ color: "var(--text)" }}>{crop.x.toFixed(3)}</b></span>
          <span>y <b style={{ color: "var(--text)" }}>{crop.y.toFixed(3)}</b></span>
          <span>w <b style={{ color: "var(--text)" }}>{crop.w.toFixed(3)}</b></span>
          <span>h <b style={{ color: "var(--text)" }}>{crop.h.toFixed(3)}</b></span>
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
          ≈ {px(crop.w, "w")} × {px(crop.h, "h")} px
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-ghost)", lineHeight: 1.55, marginTop: 14 }}>
        Drag the box to reposition; pull a corner to resize. <b style={{ color: "var(--text-faint)" }}>Free</b> unlocks all edges. The dim only deepens while you drag.
      </p>
      <button onClick={goAdjust}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", marginTop: 14, padding: "11px", borderRadius: "var(--r-md)", border: "1px solid var(--accent)", background: "var(--accent-dim)", color: "var(--accent-text)", fontWeight: 600, fontSize: 13.5 }}>
        <Icon name="check" size={15} stroke={2.2} /> Apply crop &amp; adjust <Icon name="arrowR" size={15} />
      </button>
      <p style={{ fontSize: 11, color: "var(--text-ghost)", lineHeight: 1.5, marginTop: 9, textAlign: "center" }}>
        Your crop stays applied — keep editing on the framed image. The original is never modified.
      </p>
    </div>
  );
}

/* ---- Adjust panel ------------------------------------------------ */
function AdjustPanel({ groups, thumbSrc, presetId, applyProfile, amount, setAmt, base, adj, setSlider, edited }) {
  const showAmount = base && base.id !== "original";
  return (
    <div>
      {/* profile gallery */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Lbl>Profiles</Lbl>
        <span style={{ fontSize: 10.5, color: "var(--text-ghost)", display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 5, height: 5, borderRadius: 99, background: "var(--accent)" }} /> new</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {groups.map((g) => (
          <div key={g.group}>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 9 }}>{g.group}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 9 }}>
              {g.items.map((p) => <ProfileThumb key={p.id} p={p} src={thumbSrc} active={presetId === p.id} onClick={() => applyProfile(p)} />)}
            </div>
          </div>
        ))}
      </div>

      {/* intensity */}
      {showAmount && (
        <div style={{ marginTop: 18, padding: "13px 14px", background: "var(--bg-deep)", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500 }}>Intensity{edited && <span style={{ color: "var(--text-ghost)", fontWeight: 400 }}> · edited</span>}</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--accent-text)" }}>{amount}%</span>
          </div>
          <input type="range" min={0} max={100} value={amount} onChange={(e) => setAmt(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
          <p style={{ fontSize: 11, color: "var(--text-ghost)", margin: "8px 0 0", lineHeight: 1.5 }}>Scales every value in <b style={{ color: "var(--text-faint)" }}>{base.name}</b> — a lighter touch, no new render math.</p>
        </div>
      )}

      {/* manual sliders */}
      <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--border-soft)" }}>
        {SLIDER_DEFS.map(([label, keys]) => (
          <div key={label} style={{ marginBottom: 16 }}>
            <Lbl>{label}</Lbl>
            <div style={{ marginTop: 10 }}>
              {keys.map(([k, lbl, min]) => <Slider key={k} label={lbl} value={adj[k]} min={min === 0 ? 0 : -100} onChange={(v) => setSlider(k, v)} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- bits -------------------------------------------------------- */
function Lbl({ children }) { return <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)", fontWeight: 600 }}>{children}</div>; }
function objEq(a, b) { return Object.keys(ZERO).every((k) => (a[k] || 0) === (b[k] || 0)); }

const ghostSq = { width: 36, height: 36, borderRadius: 8, border: "1px solid var(--border-soft)", background: "var(--panel)", color: "var(--text-dim)", display: "grid", placeItems: "center" };
const toolChip = { display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 8, border: "1px solid var(--border-soft)", background: "var(--panel)", color: "var(--text-dim)", fontSize: 13.5, fontWeight: 500 };
const toolChipOn = { background: "var(--accent-dim)", borderColor: "var(--accent)", color: "var(--accent-text)" };
const miniBtn = { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text-dim)", fontSize: 12 };

ReactDOM.createRoot(document.getElementById("root")).render(<EditorLab />);
