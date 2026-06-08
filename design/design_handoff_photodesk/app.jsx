/* ============================================================
   PhotoDesk — App root, tweaks, mount
   ============================================================ */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "graphite",
  "accent": "azure",
  "density": 5,
  "grouping": "divider",
  "railStyle": "rail"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [screen, setScreen] = useState("landing");
  const [pass, setPass] = useState("cull");
  const [photos, setPhotos] = useState(null);
  const [sessionName, setSessionName] = useState("");

  // apply theme + accent to root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
    document.documentElement.setAttribute("data-accent", t.accent);
  }, [t.theme, t.accent]);

  const startSession = (meta) => {
    setPhotos(window.PHOTODESK.makeSessionPhotos());
    setSessionName(meta.name);
    setPass("cull");
    setScreen("work");
  };

  const counts = useMemo(() => {
    if (!photos) return {};
    let keep = 0, reject = 0, rated = 0; const stacks = new Set();
    photos.forEach((p) => { if (p.status === "keep") keep++; if (p.status === "reject") reject++; if (p.rating > 0) rated++; if (p.stack != null) stacks.add(p.stack); });
    return { _keep: keep, _reject: reject, _rated: rated, _stacks: stacks.size };
  }, [photos]);

  return (
    <div style={{ height: "100%" }}>
      {screen === "landing" && <Library onStart={startSession} />}
      {screen === "work" && photos && (
        <WorkspaceShell photos={photos} setPhotos={setPhotos} pass={pass} setPass={setPass}
          sessionName={sessionName} tweaks={t} onHome={() => setScreen("landing")} onCommit={() => setScreen("summary")} />
      )}
      {screen === "summary" && photos && (
        <Summary photos={photos} counts={counts} sessionName={sessionName}
          onBack={() => setScreen("work")} onHome={() => setScreen("landing")}
          setPass={(id) => { if (id !== "commit") { setPass(id); setScreen("work"); } }} />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={t.theme} options={["graphite", "warm", "cool"]} onChange={(v) => setTweak("theme", v)} />
        <TweakColor label="Accent" value={accentHex(t.accent)}
          options={[ACCENTS.azure, ACCENTS.teal, ACCENTS.violet, ACCENTS.amber]}
          onChange={(v) => setTweak("accent", hexAccent(v))} />
        <TweakSection label="Grid" />
        <TweakSlider label="Thumbnail density" value={t.density} min={1} max={10} onChange={(v) => setTweak("density", v)} />
        <TweakRadio label="Scene grouping" value={t.grouping} options={["divider", "lane", "carded"]} onChange={(v) => setTweak("grouping", v)} />
        <TweakSection label="Workflow" />
        <TweakRadio label="Pass navigation" value={t.railStyle} options={["rail", "tabs"]} onChange={(v) => setTweak("railStyle", v)} />
      </TweaksPanel>
    </div>
  );
}

const ACCENTS = { azure: "#5b8cff", teal: "#3bc4c4", violet: "#9b7bff", amber: "#e0a93c" };
function accentHex(name) { return ACCENTS[name] || ACCENTS.azure; }
function hexAccent(hex) { return Object.keys(ACCENTS).find((k) => ACCENTS[k] === hex) || "azure"; }

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
