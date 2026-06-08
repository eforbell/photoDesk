/* ============================================================
   PhotoDesk — shared atoms, icons, adjustment engine
   Exported to window for the other babel scripts.
   ============================================================ */
const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* ---- Icons (simple strokes only) ---------------------------------- */
function Icon({ name, size = 16, stroke = 1.6, style }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round",
    strokeLinejoin: "round", style,
  };
  switch (name) {
    case "home": return <svg {...p}><path d="M3 11l9-7 9 7"/><path d="M5 10v9h14v-9"/></svg>;
    case "chevL": return <svg {...p}><path d="M15 18l-6-6 6-6"/></svg>;
    case "chevR": return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>;
    case "chevD": return <svg {...p}><path d="M6 9l6 6 6-6"/></svg>;
    case "x": return <svg {...p}><path d="M18 6L6 18M6 6l12 12"/></svg>;
    case "check": return <svg {...p}><path d="M5 12l5 5L20 6"/></svg>;
    case "keep": return <svg {...p}><path d="M5 12l5 5L20 6"/></svg>;
    case "reject": return <svg {...p}><path d="M18 6L6 18M6 6l12 12"/></svg>;
    case "star": return <svg {...p} fill={p.fill}><path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6L12 16.9 6.6 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>;
    case "crop": return <svg {...p}><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/></svg>;
    case "sliders": return <svg {...p}><path d="M4 7h11M19 7h1M4 17h1M9 17h11"/><circle cx="17" cy="7" r="2.2"/><circle cx="7" cy="17" r="2.2"/></svg>;
    case "stack": return <svg {...p}><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>;
    case "layers": return <svg {...p}><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>;
    case "undo": return <svg {...p}><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg>;
    case "reset": return <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"/></svg>;
    case "info": return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>;
    case "grid": return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case "maximize": return <svg {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>;
    case "arrowR": return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case "filter": return <svg {...p}><circle cx="8" cy="6" r="2.4"/><circle cx="16" cy="12" r="2.4"/><circle cx="9" cy="18" r="2.4"/><path d="M10.4 6H21M3 6h2.6M13.4 12H21M3 12h5.6M11.4 18H21M3 18h3.6"/></svg>;
    case "calendar": return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>;
    case "trash": return <svg {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>;
    case "dot": return <svg {...p} fill="currentColor" stroke="none"><circle cx="12" cy="12" r="5"/></svg>;
    case "spinner": return <svg {...p}><path d="M12 3a9 9 0 1 0 9 9" opacity="0.9"/></svg>;
    default: return null;
  }
}

/* ---- Adjustment engine ------------------------------------------- */
// adj keys: exposure, contrast, highlights, shadows, temp, saturation, vibrance, vignette  (each -100..100, vignette 0..100)
const ADJ_ZERO = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, saturation: 0, vibrance: 0, vignette: 0 };

function adjCss(adj) {
  const a = Object.assign({}, ADJ_ZERO, adj || {});
  const brightness = 1 + a.exposure / 100 * 0.4 + a.shadows / 100 * 0.12 - a.highlights / 100 * 0.10;
  const contrast = 1 + a.contrast / 100 * 0.32 + a.highlights / 100 * 0.06;
  const saturate = Math.max(0, 1 + a.saturation / 100 + a.vibrance / 100 * 0.5);
  return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)})`;
}
function tempOverlay(adj) {
  const t = (adj && adj.temp) || 0;
  if (!t) return null;
  const warm = t > 0;
  const color = warm ? "255,168,76" : "78,150,255";
  const op = Math.min(0.34, Math.abs(t) / 100 * 0.30);
  return { background: `rgba(${color},${op})`, mixBlendMode: warm ? "soft-light" : "soft-light" };
}
function vignetteOverlay(adj) {
  const v = (adj && adj.vignette) || 0;
  if (!v) return null;
  const op = v / 100 * 0.75;
  return { background: `radial-gradient(ellipse 78% 78% at 50% 50%, transparent 50%, rgba(0,0,0,${op.toFixed(3)}) 100%)` };
}
function hasAdj(adj) {
  if (!adj) return false;
  return Object.keys(ADJ_ZERO).some((k) => (adj[k] || 0) !== 0);
}

/* ---- Photo image with adjustments + graceful fallback ------------- */
function PhotoImg({ photo, w, h, adj, className, draggable }) {
  const [err, setErr] = useState(false);
  const src = window.PHOTODESK.pic(photo.seed, w, h);
  // baseline per-variant filter (defect simulation) composited with edit adj
  const filter = [photo.filter, adjCss(adj)].filter(Boolean).join(" ");
  const fallbackHue = (photo.seed.length * 37 + photo.scene * 53) % 360;
  if (err) {
    return (
      <div className={className} style={{
        width: "100%", height: "100%",
        background: `linear-gradient(150deg, oklch(0.32 0.05 ${fallbackHue}), oklch(0.20 0.04 ${(fallbackHue + 40) % 360}))`,
        filter,
      }} />
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={photo.file}
      draggable={draggable ? undefined : false}
      onError={() => setErr(true)}
      style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: photo.pos, filter, display: "block" }}
    />
  );
}

/* ---- Stars ------------------------------------------------------- */
function Stars({ value, size = 13, onSet, gap = 2 }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "inline-flex", gap }} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => {
        const active = (hover || value) >= i;
        return (
          <span key={i}
            onClick={onSet ? (e) => { e.stopPropagation(); onSet(value === i ? 0 : i); } : undefined}
            onMouseEnter={onSet ? () => setHover(i) : undefined}
            style={{ color: active ? "var(--star)" : "var(--text-ghost)", cursor: onSet ? "pointer" : "default", lineHeight: 0, display: "inline-flex" }}>
            <Icon name="star" size={size} stroke={1.4} />
          </span>
        );
      })}
    </div>
  );
}

/* ---- Defect label ------------------------------------------------- */
const DEFECT_LABEL = { soft: "soft", motion: "motion blur", blink: "blink", dark: "underexposed", flat: "flat" };

Object.assign(window, { Icon, PhotoImg, Stars, adjCss, tempOverlay, vignetteOverlay, hasAdj, ADJ_ZERO, DEFECT_LABEL,
  useState, useEffect, useRef, useCallback, useMemo });
