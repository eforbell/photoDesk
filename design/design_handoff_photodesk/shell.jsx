/* ============================================================
   PhotoDesk — Workspace shell + Commit summary
   ============================================================ */

function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2400); }, []);
  const node = toast ? (
    <div style={{ position: "fixed", bottom: 76, left: "50%", transform: "translateX(-50%)", zIndex: 90,
      background: "var(--panel-2)", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "11px 18px",
      fontSize: 13.5, color: "var(--text)", boxShadow: "var(--shadow-3)", display: "flex", alignItems: "center", gap: 9 }}>
      <Icon name="check" size={15} stroke={2.2} style={{ color: "var(--keep)" }} /> {toast}
    </div>
  ) : null;
  return [node, show];
}

function WorkspaceShell({ photos, setPhotos, pass, setPass, sessionName, tweaks, onHome, onCommit }) {
  const [filter, setFilter] = useState("all");
  const [hideRejects, setHideRejects] = useState(false);
  const [focusId, setFocusId] = useState(photos[0] && photos[0].id);
  const [sel, setSel] = useState(() => new Set());
  const [lbIndex, setLbIndex] = useState(null);
  const [editId, setEditId] = useState(null);
  const [toast, showToast] = useToast();
  const scrollRef = useRef(null);

  const D = window.PHOTODESK;
  const update = useCallback((id, patch) => setPhotos((ps) => ps.map((p) => (p.id === id ? Object.assign({}, p, typeof patch === "function" ? patch(p) : patch) : p))), [setPhotos]);

  // pass defaults
  useEffect(() => { setHideRejects(pass === "rate" || pass === "stack"); setSel(new Set()); }, [pass]);

  // counts
  const counts = useMemo(() => {
    let keep = 0, reject = 0, rated = 0; const stacks = new Set();
    photos.forEach((p) => { if (p.status === "keep") keep++; if (p.status === "reject") reject++; if (p.rating > 0) rated++; if (p.stack != null) stacks.add(p.stack); });
    return { cull: keep, rate: rated, stack: stacks.size, commit: reject, _reject: reject, _keep: keep, _rated: rated, _stacks: stacks.size };
  }, [photos]);

  // visible filtering
  const passVisible = useCallback((p) => {
    if (hideRejects && p.status === "reject") return false;
    if (filter === "picks" && p.status !== "keep") return false;
    if (filter === "rated" && !(p.rating > 0)) return false;
    if (filter === "unrated" && (p.rating > 0 || p.status === "reject")) return false;
    if (filter === "rejects" && p.status !== "reject") return false;
    return true;
  }, [hideRejects, filter]);

  const scenesView = useMemo(() => D.scenes.map((s) => ({ scene: s, photos: photos.filter((p) => p.scene === s.idx && passVisible(p)) })).filter((g) => g.photos.length), [photos, passVisible]);
  const flat = useMemo(() => scenesView.flatMap((g) => g.photos), [scenesView]);

  // keep focus valid
  useEffect(() => { if (!flat.find((p) => p.id === focusId)) setFocusId(flat[0] && flat[0].id); }, [flat, focusId]);

  const ensureVisible = (id) => {
    const cont = scrollRef.current; if (!cont) return;
    const el = cont.querySelector('[data-pid="' + id + '"]'); if (!el) return;
    const cr = cont.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.top < cr.top + 70) cont.scrollTop -= (cr.top + 70 - er.top);
    else if (er.bottom > cr.bottom - 20) cont.scrollTop += (er.bottom - (cr.bottom - 20));
  };
  const moveFocus = (d) => {
    const i = flat.findIndex((p) => p.id === focusId);
    const ni = Math.max(0, Math.min(flat.length - 1, (i < 0 ? 0 : i) + d));
    const id = flat[ni] && flat[ni].id; if (id) { setFocusId(id); ensureVisible(id); }
  };

  const act = (id, status) => update(id, (p) => ({ status: p.status === status ? null : status }));
  const rate = (id, v) => update(id, { rating: v });
  const saveEdit = (id, adj, crop) => { update(id, { edited: !!adj || (crop && crop !== "Original"), adj: adj, crop }); setEditId(null); showToast("Saved as new version · original preserved"); };
  const groupStack = () => {
    if (sel.size < 2) return;
    const existing = new Set(); photos.forEach((p) => p.stack != null && existing.add(p.stack));
    let n = 1; while (existing.has(n)) n++;
    setPhotos((ps) => ps.map((p) => (sel.has(p.id) ? Object.assign({}, p, { stack: n }) : p)));
    showToast("Grouped " + sel.size + " frames into stack " + n);
    setSel(new Set());
  };
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (editId != null) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
      const k = e.key;
      const cur = lbIndex != null ? flat[lbIndex] : flat.find((p) => p.id === focusId);
      if (lbIndex != null) {
        if (k === "Escape") { setLbIndex(null); return; }
        if (k === "ArrowRight") { e.preventDefault(); setLbIndex((i) => Math.min(flat.length - 1, i + 1)); return; }
        if (k === "ArrowLeft") { e.preventDefault(); setLbIndex((i) => Math.max(0, i - 1)); return; }
        if (k === "Enter") {
          e.preventDefault();
          if (e.shiftKey) {
            // jump to first frame of the PREVIOUS scene
            setLbIndex((i) => {
              const sc = flat[i].scene;
              let j = i - 1;
              while (j >= 0 && flat[j].scene === sc) j--;            // skip to prev scene's last frame
              if (j < 0) return 0;
              const prevSc = flat[j].scene;
              while (j > 0 && flat[j - 1].scene === prevSc) j--;     // walk to its first frame
              return j;
            });
          } else {
            // jump to first frame of the NEXT scene
            setLbIndex((i) => {
              const sc = flat[i].scene;
              let j = i + 1;
              while (j < flat.length && flat[j].scene === sc) j++;
              return j < flat.length ? j : flat.length - 1;
            });
          }
          return;
        }
        if (k === "e" || k === "E") { setEditId(cur.id); return; }
        if (!cur) return;
        if (pass === "rate") { if (k >= "1" && k <= "5") rate(cur.id, +k); else if (k === "0") rate(cur.id, 0); else if (k === "x" || k === "X") act(cur.id, "reject"); }
        else { if (k === "p" || k === "P") act(cur.id, "keep"); else if (k === "x" || k === "X") act(cur.id, "reject"); else if (k === "u" || k === "U") update(cur.id, { status: null }); }
        return;
      }
      // grid
      if (k === "ArrowRight" || k === "ArrowDown") { e.preventDefault(); moveFocus(1); return; }
      if (k === "ArrowLeft" || k === "ArrowUp") { e.preventDefault(); moveFocus(-1); return; }
      if (!cur) return;
      if (k === "Enter" || k === "o") { setLbIndex(flat.findIndex((p) => p.id === cur.id)); return; }
      if (k === "e" || k === "E") { setEditId(cur.id); return; }
      if (pass === "stack") { if (k === " ") { e.preventDefault(); toggleSel(cur.id); } else if (k === "g" || k === "G") groupStack(); else if (k === "Backspace") setSel(new Set()); return; }
      if (pass === "rate") { if (k >= "1" && k <= "5") rate(cur.id, +k); else if (k === "0") rate(cur.id, 0); else if (k === "x" || k === "X") act(cur.id, "reject"); return; }
      if (k === "p" || k === "P") act(cur.id, "keep"); else if (k === "x" || k === "X") act(cur.id, "reject"); else if (k === "u" || k === "U") update(cur.id, { status: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, focusId, lbIndex, editId, pass, sel]);

  // density → css vars
  const thumb = Math.round(300 - tweaks.density * 18);
  const gap = tweaks.density >= 7 ? 6 : 10;

  const thumbProps = (p) => ({
    pass, focused: focusId === p.id && lbIndex == null, selected: sel.has(p.id), dim: pass === "stack",
    onFocus: () => setFocusId(p.id),
    onOpen: () => setLbIndex(flat.findIndex((x) => x.id === p.id)),
    onEdit: () => setEditId(p.id),
    onAct: (s) => act(p.id, s),
    onToggleSelect: () => toggleSel(p.id),
  });

  const editPhoto = editId != null ? photos.find((p) => p.id === editId) : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* header */}
      <header style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 16, padding: "11px 18px", borderBottom: "1px solid var(--border-soft)", background: "var(--panel)", flex: "none", zIndex: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <button onClick={onHome} style={{ ...ghostBtn, width: "auto", padding: "0 12px", gap: 7, display: "flex", alignItems: "center", fontSize: 13.5 }}><Icon name="home" size={15} /> Home</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sessionName}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-ghost)" }}>{photos.length} frames · {D.scenes.length} scenes</div>
          </div>
        </div>
        <ProgressRail pass={pass} setPass={(id) => (id === "commit" ? onCommit() : setPass(id))} counts={counts} variant={tweaks.railStyle} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--text-dim)", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={hideRejects} onChange={(e) => setHideRejects(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Hide rejects
          </label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text-dim)", fontSize: 13 }}>
            <option value="all">All</option><option value="picks">Picks</option><option value="rated">Rated</option><option value="unrated">Unrated</option><option value="rejects">Rejects</option>
          </select>
        </div>
      </header>

      {/* pass hint strip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "7px", background: "var(--bg)", borderBottom: "1px solid var(--border-soft)", fontSize: 12.5, color: "var(--text-faint)", flex: "none" }}>
        <Icon name={PASSES.find((p) => p.id === pass).icon} size={13} style={{ color: "var(--accent-text)" }} />
        <span style={{ color: "var(--text-dim)" }}>{PASSES.find((p) => p.id === pass).hint}</span>
      </div>

      {/* grid */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "22px 26px 90px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: tweaks.grouping === "carded" ? 14 : 28, "--thumb": thumb + "px", "--grid-gap": gap + "px" }}>
          {scenesView.map((g) => <SceneBlock key={g.scene.id} scene={g.scene} photos={g.photos} grouping={tweaks.grouping} thumbProps={thumbProps} />)}
          {scenesView.length === 0 && <div style={{ textAlign: "center", color: "var(--text-ghost)", padding: 80, fontSize: 14 }}>No frames match this filter.</div>}
        </div>
      </div>

      {/* bottom: stack bar OR shortcut legend */}
      {pass === "stack" && sel.size > 0 ? (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 22px", background: "var(--panel-2)", borderTop: "1px solid var(--border-strong)", boxShadow: "0 -8px 24px rgba(0,0,0,0.3)", flex: "none" }}>
          <span style={{ fontSize: 13.5, color: "var(--text-dim)" }}><b style={{ color: "var(--accent-text)" }}>{sel.size}</b> selected</span>
          <div style={{ display: "flex", gap: 9 }}>
            <button onClick={() => setSel(new Set())} style={{ ...toolBtn }}>Clear</button>
            <button onClick={groupStack} disabled={sel.size < 2} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 8, border: "none", background: sel.size < 2 ? "var(--panel-3)" : "var(--accent)", color: sel.size < 2 ? "var(--text-faint)" : "white", fontWeight: 600, fontSize: 13.5 }}><Icon name="stack" size={15} /> Group as stack <span className="kbd" style={{ marginLeft: 2 }}>G</span></button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, padding: "10px", background: "var(--panel)", borderTop: "1px solid var(--border-soft)", fontSize: 12, color: "var(--text-faint)", flex: "none" }}>
          {pass === "cull" && <><Legend k="P" l="Keep" /><Legend k="X" l="Reject" /><Legend k="U" l="Unset" /></>}
          {pass === "rate" && <><Legend k="1–5" l="Rate" /><Legend k="0" l="Clear" /><Legend k="X" l="Reject" /></>}
          {pass === "stack" && <><Legend k="Click" l="Select" /><Legend k="G" l="Group" /></>}
          <Legend k="↑↓←→" l="Move" /><Legend k="↵" l="Open" /><Legend k="E" l="Edit" />
        </div>
      )}

      {lbIndex != null && <Lightbox list={flat} index={lbIndex} setIndex={(fn) => setLbIndex(fn)} pass={pass} onAct={act} onRate={rate} onClose={() => setLbIndex(null)} onEdit={(id) => setEditId(id)} />}
      {editPhoto && <Editor photo={editPhoto} onSave={saveEdit} onClose={() => setEditId(null)} />}
      {toast}
    </div>
  );
}

// SceneBlock renders its own thumbs via the thumbProps function passed in.

/* ---- Commit / Summary --------------------------------------------- */
function Summary({ photos, counts, sessionName, onBack, onHome, setPass }) {
  const [opts, setOpts] = useState({ trash: true, ratings: true, stacks: true, edits: true });
  const [state, setState] = useState("idle"); // idle | running | done
  const [log, setLog] = useState([]);
  const edited = photos.filter((p) => p.edited).length;
  const undecided = photos.filter((p) => !p.status).length;

  const stats = [
    { n: counts._keep, l: "Kept", c: "var(--keep)" },
    { n: counts._reject, l: "Rejected", c: "var(--reject)" },
    { n: undecided, l: "Undecided", c: "var(--text-dim)" },
    { n: counts._rated, l: "Rated", c: "var(--star)" },
    { n: counts._stacks, l: "Stacks", c: "var(--accent-text)" },
    { n: edited, l: "Edited", c: "var(--accent-text)" },
  ];

  const commit = () => {
    setState("running"); setLog([]);
    const steps = [];
    if (opts.trash) steps.push("Trashed " + counts._reject + " rejects → Immich trash");
    if (opts.ratings) steps.push("Wrote " + counts._rated + " star ratings to metadata");
    if (opts.stacks) steps.push("Created " + counts._stacks + " stacks");
    if (opts.edits) steps.push("Uploaded " + edited + " edited versions, stacked over originals");
    if (!steps.length) steps.push("No changes selected — nothing pushed");
    steps.forEach((s, idx) => setTimeout(() => {
      setLog((l) => [...l, s]);
      if (idx === steps.length - 1) setTimeout(() => setState("done"), 420);
    }, 380 + idx * 520));
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "11px 18px", borderBottom: "1px solid var(--border-soft)", background: "var(--panel)", flex: "none" }}>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onHome} style={{ ...ghostBtn, width: "auto", padding: "0 12px", gap: 7, display: "flex", alignItems: "center", fontSize: 13.5 }}><Icon name="home" size={15} /> Home</button>
        </div>
        <ProgressRail pass="commit" setPass={(id) => setPass(id)} counts={{ cull: counts._keep, rate: counts._rated, stack: counts._stacks }} />
        <div />
      </header>

      <div style={{ flex: 1, overflowY: "auto", display: "grid", placeItems: "center", padding: 30 }}>
        <div style={{ width: "min(560px, 100%)", background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-xl)", padding: "30px 34px", boxShadow: "var(--shadow-2)" }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)", marginBottom: 4, fontWeight: 600 }}>{sessionName}</div>
          <h2 style={{ margin: "0 0 24px", fontSize: 23, letterSpacing: "-0.02em" }}>Commit to Immich</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 28 }}>
            {stats.map((s) => (
              <div key={s.l} style={{ background: "var(--bg)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "14px 12px", textAlign: "center" }}>
                <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: s.c, lineHeight: 1 }}>{s.n}</div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)", marginTop: 7 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {state !== "done" && <>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)", marginBottom: 12, fontWeight: 600 }}>What to push</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 26 }}>
              <CommitRow on={opts.trash} set={(v) => setOpts({ ...opts, trash: v })} title="Trash rejects" sub={counts._reject + " photos → Immich trash (recoverable)"} c="var(--reject)" />
              <CommitRow on={opts.ratings} set={(v) => setOpts({ ...opts, ratings: v })} title="Write star ratings" sub={counts._rated + " ratings to asset metadata"} c="var(--star)" />
              <CommitRow on={opts.stacks} set={(v) => setOpts({ ...opts, stacks: v })} title="Create stacks" sub={counts._stacks + " manual groups, best frame as primary"} c="var(--accent-text)" />
              <CommitRow on={opts.edits} set={(v) => setOpts({ ...opts, edits: v })} title="Upload edited versions" sub={edited + " new assets, stacked over originals"} c="var(--accent-text)" />
            </div>
          </>}

          {log.length > 0 && (
            <div style={{ background: "var(--bg-deep)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "14px 16px", marginBottom: 22 }}>
              {log.filter(Boolean).map((l, i) => <div key={i} className="mono" style={{ fontSize: 12.5, color: "var(--keep)", display: "flex", gap: 8, padding: "3px 0" }}><Icon name="check" size={14} stroke={2.4} /> {l}</div>)}
              {state === "done" && <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-dim)" }}>Done. Immich is up to date.</div>}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            {state === "done"
              ? <><button onClick={onBack} style={toolBtn}>Back to review</button><button onClick={onHome} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 13.5 }}>Finish</button></>
              : <><button onClick={onBack} disabled={state === "running"} style={toolBtn}>Back to review</button>
                <button onClick={commit} disabled={state === "running"} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 8, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 13.5, opacity: state === "running" ? 0.7 : 1 }}>
                  {state === "running" ? <><Icon name="spinner" size={15} style={{ animation: "spin .8s linear infinite" }} /> Committing…</> : <>Commit to Immich <Icon name="arrowR" size={15} /></>}
                </button></>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CommitRow({ on, set, title, sub, c }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 4px", cursor: "pointer", borderBottom: "1px solid var(--border-soft)" }}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
      <span style={{ width: 8, height: 8, borderRadius: 99, background: c, flex: "none" }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--text-ghost)", marginTop: 2 }}>{sub}</div>
      </div>
    </label>
  );
}

Object.assign(window, { WorkspaceShell, Summary });
