/* ============================================================
   PhotoDesk — Editor Lab :: draggable crop
   Outputs normalized {x,y,width,height} (0..1) — exactly what
   the server's validateCrop / pixelCrop already accept.
   Uniform contain-scale means screen-px ratio == image ratio,
   so aspect locking is enforced directly in screen px.
   ============================================================ */
const MIN_PX = 44;

function CropArea({ natRatio, src, filter, crop, setCrop, aspect, grid }) {
  const boxRef = useRef(null);
  const drag = useRef(null);
  const [active, setActive] = useState(false);
  const free = aspect === "Free";

  const ratioPx = useMemo(() => {
    if (free) return null;
    if (aspect === "Original") return natRatio;
    const [a, b] = aspect.split(":").map(Number);
    return a / b;
  }, [aspect, free, natRatio]);

  const size = () => { const r = boxRef.current.getBoundingClientRect(); return { W: r.width, H: r.height }; };

  const onDown = (e, handle) => {
    e.preventDefault(); e.stopPropagation();
    const { W, H } = size();
    drag.current = { handle, sx: e.clientX, sy: e.clientY, start: { ...crop }, W, H };
    setActive(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const { W, H } = d;
    let l = d.start.x * W, t = d.start.y * H, r = (d.start.x + d.start.w) * W, b = (d.start.y + d.start.h) * H;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    const h = d.handle;

    if (h === "move") {
      const w = r - l, ht = b - t;
      let nl = Math.max(0, Math.min(W - w, l + dx));
      let nt = Math.max(0, Math.min(H - ht, t + dy));
      l = nl; t = nt; r = nl + w; b = nt + ht;
    } else {
      const mL = h.includes("w"), mR = h.includes("e"), mT = h.includes("n"), mB = h.includes("s");
      if (mL) l = Math.min(r - MIN_PX, Math.max(0, l + dx));
      if (mR) r = Math.max(l + MIN_PX, Math.min(W, r + dx));
      if (mT) t = Math.min(b - MIN_PX, Math.max(0, t + dy));
      if (mB) b = Math.max(t + MIN_PX, Math.min(H, b + dy));

      if (ratioPx) {
        // corner handles only in locked mode → anchor opposite corner, derive height from width
        const ax = mL ? r : l, ay = mT ? b : t;        // fixed corner
        let w = Math.abs((mL ? l : r) - ax);
        let ht = w / ratioPx;
        let nx = mL ? ax - w : ax + w;
        let ny = mT ? ay - ht : ay + ht;
        if (nx < 0) { nx = 0; w = Math.abs(ax - nx); ht = w / ratioPx; ny = mT ? ay - ht : ay + ht; }
        if (nx > W) { nx = W; w = Math.abs(ax - nx); ht = w / ratioPx; ny = mT ? ay - ht : ay + ht; }
        if (ny < 0) { ny = 0; ht = Math.abs(ay - ny); w = ht * ratioPx; nx = mL ? ax - w : ax + w; }
        if (ny > H) { ny = H; ht = Math.abs(ay - ny); w = ht * ratioPx; nx = mL ? ax - w : ax + w; }
        l = Math.min(ax, nx); r = Math.max(ax, nx); t = Math.min(ay, ny); b = Math.max(ay, ny);
      }
    }
    setCrop({ x: l / W, y: t / H, w: (r - l) / W, h: (b - t) / H });
  };

  const onUp = () => { drag.current = null; setActive(false); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };

  const pct = (v) => (v * 100).toFixed(3) + "%";
  const corners = ["nw", "ne", "sw", "se"];
  const edges = free ? ["n", "e", "s", "w"] : [];

  return (
    <div ref={boxRef} style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", aspectRatio: natRatio, boxShadow: "var(--shadow-3)", userSelect: "none", touchAction: "none" }}>
      <img src={src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter }} onError={(e) => { e.target.style.opacity = 0.15; }} />

      {/* crop window */}
      <div
        onPointerDown={(e) => onDown(e, "move")}
        style={{ position: "absolute", left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h),
          boxShadow: `0 0 0 9999px rgba(0,0,0,${active ? 0.6 : 0.26})`, transition: "box-shadow .28s var(--ease)", outline: "1px solid rgba(255,255,255,0.92)", cursor: "move" }}>
        {/* thirds grid */}
        {grid && (
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} preserveAspectRatio="none" viewBox="0 0 100 100">
            {[33.33, 66.66].map((v) => <line key={"h" + v} x1="0" y1={v} x2="100" y2={v} stroke="rgba(255,255,255,0.4)" strokeWidth="0.4" />)}
            {[33.33, 66.66].map((v) => <line key={"v" + v} x1={v} y1="0" x2={v} y2="100" stroke="rgba(255,255,255,0.4)" strokeWidth="0.4" />)}
          </svg>
        )}
        {/* corner handles */}
        {corners.map((c) => {
          const top = c[0] === "n", left = c[1] === "w";
          return (
            <div key={c} onPointerDown={(e) => onDown(e, c)}
              style={{ position: "absolute", width: 22, height: 22, [top ? "top" : "bottom"]: -3, [left ? "left" : "right"]: -3, cursor: c + "-resize" }}>
              <div style={{ position: "absolute", [top ? "top" : "bottom"]: 0, [left ? "left" : "right"]: 0, width: 18, height: 18,
                borderTop: top ? "3px solid white" : "none", borderBottom: !top ? "3px solid white" : "none",
                borderLeft: left ? "3px solid white" : "none", borderRight: !left ? "3px solid white" : "none" }} />
            </div>
          );
        })}
        {/* edge handles (free only) */}
        {edges.map((c) => {
          const horiz = c === "n" || c === "s";
          const pos = { n: { top: -3, left: "50%", marginLeft: -13 }, s: { bottom: -3, left: "50%", marginLeft: -13 }, e: { right: -3, top: "50%", marginTop: -13 }, w: { left: -3, top: "50%", marginTop: -13 } }[c];
          return (
            <div key={c} onPointerDown={(e) => onDown(e, c)}
              style={{ position: "absolute", ...pos, width: horiz ? 26 : 6, height: horiz ? 6 : 26, cursor: (horiz ? "ns" : "ew") + "-resize" }}>
              <div style={{ width: horiz ? 26 : 4, height: horiz ? 4 : 26, background: "white", borderRadius: 2 }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.CropArea = CropArea;
