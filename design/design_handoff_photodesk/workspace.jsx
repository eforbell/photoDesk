/* ============================================================
   PhotoDesk — Workspace (progress rail + toolbar + scene grid)
   ============================================================ */

const PASSES = [
  { id: "cull",   label: "Cull",   icon: "keep",    hint: "Keep or reject, fast." },
  { id: "rate",   label: "Rate",   icon: "star",    hint: "Star the survivors." },
  { id: "stack",  label: "Stack",  icon: "stack",   hint: "Group same-shot variants." },
  { id: "commit", label: "Commit", icon: "arrowR",  hint: "Push to Immich." },
];

function arRatio(ar) { const [a, b] = ar.split(":").map(Number); return b / a; }

/* ---- Progress rail ------------------------------------------------ */
function ProgressRail({ pass, setPass, counts, variant = "rail" }) {
  if (variant === "tabs") {
    return (
      <div style={{ display: "flex", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 3, gap: 2 }}>
        {PASSES.map((p) => {
          const active = pass === p.id;
          return (
            <button key={p.id} onClick={() => setPass(p.id)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 14px", borderRadius: 7, border: "none",
                background: active ? "var(--accent)" : "transparent", color: active ? "white" : "var(--text-dim)", fontWeight: 600, fontSize: 13.5 }}>
              <Icon name={p.icon} size={13} stroke={1.9} /> {p.label}
              {counts[p.id] != null && <span className="mono" style={{ fontSize: 11, opacity: 0.8 }}>{counts[p.id]}</span>}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      {PASSES.map((p, i) => {
        const active = pass === p.id;
        const idx = PASSES.findIndex((x) => x.id === pass);
        const done = i < idx;
        const c = counts[p.id];
        return (
          <React.Fragment key={p.id}>
            {i > 0 && <div style={{ width: 26, height: 1.5, background: i <= idx ? "var(--accent)" : "var(--border)", transition: "background .25s", flex: "none" }} />}
            <button onClick={() => setPass(p.id)}
              style={{
                display: "flex", alignItems: "center", gap: 9, padding: "7px 13px 7px 9px", borderRadius: 99,
                border: "1px solid " + (active ? "var(--accent)" : "transparent"),
                background: active ? "var(--accent-dim)" : "transparent",
                color: active ? "var(--accent-text)" : done ? "var(--text-dim)" : "var(--text-faint)",
                transition: "all .18s", flex: "none",
              }}>
              <span style={{
                width: 22, height: 22, borderRadius: 99, display: "grid", placeItems: "center", flex: "none",
                background: active ? "var(--accent)" : done ? "var(--keep-dim)" : "var(--panel-2)",
                color: active ? "white" : done ? "var(--keep)" : "var(--text-faint)",
                border: done ? "1px solid var(--keep)" : "none",
              }}>
                {done ? <Icon name="check" size={13} stroke={2.2} /> : <Icon name={p.icon} size={13} stroke={1.9} />}
              </span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</span>
              {c != null && <span className="mono" style={{ fontSize: 11.5, opacity: 0.85, padding: "1px 6px", borderRadius: 99, background: active ? "rgba(255,255,255,0.08)" : "var(--panel-2)" }}>{c}</span>}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ---- Thumbnail ---------------------------------------------------- */
function Thumb({ photo, pass, focused, selected, onFocus, onOpen, onEdit, onAct, onToggleSelect, dim }) {
  const [hover, setHover] = useState(false);
  const ring = focused ? "var(--accent)" : photo.status === "keep" ? "var(--keep)" : photo.status === "reject" ? "var(--reject)" : selected ? "var(--accent)" : "transparent";
  const isReject = photo.status === "reject";
  return (
    <div
      data-pid={photo.id}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => { onFocus(); if (pass === "stack") onToggleSelect(); }}
      onDoubleClick={() => pass !== "stack" && onOpen()}
      style={{
        position: "relative", width: "var(--thumb)", aspectRatio: photo.ar.replace(":", "/"),
        borderRadius: "var(--r-sm)", overflow: "hidden", cursor: "pointer", flex: "none",
        outline: ring === "transparent" ? "none" : "2px solid " + ring,
        outlineOffset: focused ? "2px" : "-2px",
        boxShadow: focused ? "0 0 0 4px var(--accent-dim)" : "var(--shadow-1)",
        opacity: dim && isReject ? 0.4 : 1,
        transition: "opacity .15s, outline-offset .12s",
      }}>
      <PhotoImg photo={photo} w={420} h={Math.round(420 * arRatio(photo.ar))} adj={photo.edited ? photo.adj : null} />
      {isReject && !dim && <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.42)" }} />}

      {/* selection checkbox (stack pass) */}
      {pass === "stack" && (
        <div style={{ position: "absolute", top: 6, left: 6, width: 20, height: 20, borderRadius: 5, border: "1.5px solid " + (selected ? "var(--accent)" : "rgba(255,255,255,0.6)"), background: selected ? "var(--accent)" : "rgba(0,0,0,0.35)", display: "grid", placeItems: "center", backdropFilter: "blur(4px)" }}>
          {selected && <Icon name="check" size={13} stroke={2.4} style={{ color: "white" }} />}
        </div>
      )}

      {/* status corner badge */}
      {photo.status && pass !== "stack" && (
        <div style={{ position: "absolute", top: 6, left: 6, width: 18, height: 18, borderRadius: 99, background: photo.status === "keep" ? "var(--keep)" : "var(--reject)", display: "grid", placeItems: "center", boxShadow: "var(--shadow-1)" }}>
          <Icon name={photo.status === "keep" ? "check" : "x"} size={11} stroke={2.6} style={{ color: "white" }} />
        </div>
      )}

      {/* top-right markers: edited / stack / defect */}
      <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 4 }}>
        {photo.edited && <span style={{ padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", fontSize: 10, fontWeight: 700, color: "var(--accent-text)", letterSpacing: "0.03em" }}>EDIT</span>}
        {photo.stack != null && <span style={{ padding: "2px 6px", borderRadius: 4, background: "var(--accent)", fontSize: 10, fontWeight: 700, color: "white", display: "flex", alignItems: "center", gap: 3 }}><Icon name="stack" size={9} stroke={2.2} />{photo.stack}</span>}
      </div>

      {/* bottom gradient: rating + defect + hover actions */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "20px 7px 6px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 6,
        background: (photo.rating || photo.defect || hover) ? "linear-gradient(transparent, rgba(0,0,0,0.72))" : "none" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {photo.rating > 0 && <Stars value={photo.rating} size={12} />}
          {photo.defect && !photo.status && <span className="mono" style={{ fontSize: 9.5, color: "oklch(0.82 0.10 70)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{DEFECT_LABEL[photo.defect]}</span>}
        </div>
        {hover && pass !== "stack" && (
          <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
            {pass === "cull" && <>
              <QuickBtn color="var(--keep)" icon="keep" active={photo.status === "keep"} onClick={() => onAct("keep")} />
              <QuickBtn color="var(--reject)" icon="reject" active={photo.status === "reject"} onClick={() => onAct("reject")} />
            </>}
            <QuickBtn color="var(--accent)" icon="maximize" onClick={onOpen} />
          </div>
        )}
      </div>
    </div>
  );
}

function QuickBtn({ icon, color, active, onClick }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ width: 26, height: 26, borderRadius: 6, border: "none", display: "grid", placeItems: "center",
        background: active ? color : "rgba(0,0,0,0.55)", color: active ? "white" : "white", backdropFilter: "blur(4px)" }}>
      <Icon name={icon} size={14} stroke={2.1} />
    </button>
  );
}

/* ---- Scene block -------------------------------------------------- */
function SceneBlock({ scene, photos, grouping, thumbProps }) {
  if (!photos.length) return null;
  const time = photos[0].time.slice(0, 5);
  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-faint)" }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.02em", color: "var(--text-dim)" }}>Scene {scene.idx + 1}</span>
      <span className="mono" style={{ fontSize: 11 }}>{time}</span>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-ghost)" }}>{photos.length} {photos.length === 1 ? "frame" : "frames"}</span>
    </div>
  );
  const tiles = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--grid-gap)" }}>
      {photos.map((p) => <Thumb key={p.id} photo={p} {...thumbProps(p)} />)}
    </div>
  );

  if (grouping === "lane") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "104px 1fr", gap: 18, alignItems: "start", padding: "4px 0" }}>
        <div style={{ position: "sticky", top: 0, paddingTop: 4 }}>{header}</div>
        {tiles}
      </div>
    );
  }
  if (grouping === "carded") {
    return (
      <div style={{ background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-lg)", padding: 14 }}>
        <div style={{ marginBottom: 12 }}>{header}</div>
        {tiles}
      </div>
    );
  }
  // divider (default)
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
        {header}
        <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
      </div>
      {tiles}
    </div>
  );
}

Object.assign(window, { PASSES, ProgressRail, Thumb, SceneBlock, arRatio });
