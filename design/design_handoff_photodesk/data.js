/* ============================================================
   PhotoDesk — mock session data
   A scene = a time-cluster of frames of the same capture.
   Within a scene, variants share one source image; subtle
   filter / framing / defect differences simulate "same shot,
   different take" so picking the keeper is a real decision.
   ============================================================ */
(function () {
  // Build a Lorem Picsum URL (real photographic content, deterministic by seed).
  function pic(seed, w, h) {
    return "https://picsum.photos/seed/" + encodeURIComponent(seed) + "/" + w + "/" + h;
  }

  // Per-scene definitions. `frames` describe variants of the same capture.
  const SCENES = [
    {
      seed: "phd-cafe-7", ar: "3:2", start: "10:58", cam: "iPhone 16 Pro", lens: "Main", focal: "24mm", f: "1.78",
      frames: [
        { f: "1/120", iso: 80, filt: "", pos: "50% 45%", defect: null },
      ],
    },
    {
      seed: "phd-brunch-4", ar: "3:2", start: "11:04", cam: "iPhone 16 Pro", lens: "Main", focal: "24mm", f: "1.78",
      frames: [
        { sh: "1/90", iso: 100, filt: "brightness(0.82) contrast(0.95)", pos: "40% 60%", defect: "dark" },
        { sh: "1/110", iso: 80, filt: "blur(1.4px)", pos: "52% 52%", defect: "soft" },
        { sh: "1/110", iso: 80, filt: "", pos: "50% 50%", defect: null },
      ],
    },
    {
      seed: "phd-wall-22", ar: "2:3", start: "13:21", cam: "iPhone 16 Pro", lens: "Main", focal: "24mm", f: "1.78",
      frames: [
        { sh: "1/250", iso: 64, filt: "blur(1.8px) brightness(0.96)", pos: "46% 40%", defect: "motion" },
        { sh: "1/250", iso: 64, filt: "brightness(0.9)", pos: "60% 42%", defect: "blink" },
        { sh: "1/250", iso: 64, filt: "blur(1px)", pos: "50% 38%", defect: "soft" },
        { sh: "1/250", iso: 64, filt: "", pos: "50% 40%", defect: null },
      ],
    },
    {
      seed: "phd-skyline-11", ar: "3:2", start: "14:47", cam: "iPhone 16 Pro", lens: "0.5×", focal: "13mm", f: "2.2",
      frames: [
        { sh: "1/600", iso: 50, filt: "", pos: "50% 55%", defect: null },
      ],
    },
    {
      seed: "phd-beach-9", ar: "3:2", start: "16:12", cam: "iPhone 16 Pro", lens: "Main", focal: "24mm", f: "1.78",
      frames: [
        { sh: "1/900", iso: 50, filt: "brightness(1.08) contrast(0.94)", pos: "40% 50%", defect: "flat" },
        { sh: "1/900", iso: 50, filt: "", pos: "50% 50%", defect: null },
        { sh: "1/900", iso: 50, filt: "blur(1.2px)", pos: "58% 52%", defect: "soft" },
      ],
    },
    {
      seed: "phd-museum-3", ar: "3:2", start: "11:31", cam: "iPhone 16 Pro", lens: "Main", focal: "24mm", f: "1.78",
      frames: [
        { sh: "1/60", iso: 320, filt: "brightness(0.86)", pos: "44% 48%", defect: "dark" },
        { sh: "1/60", iso: 320, filt: "blur(1.6px)", pos: "50% 50%", defect: "motion" },
        { sh: "1/60", iso: 320, filt: "", pos: "52% 46%", defect: null },
        { sh: "1/60", iso: 320, filt: "brightness(0.95) contrast(1.02)", pos: "56% 50%", defect: null },
      ],
    },
    {
      seed: "phd-street-15", ar: "2:3", start: "17:54", cam: "iPhone 16 Pro", lens: "2×", focal: "48mm", f: "2.8",
      frames: [
        { sh: "1/400", iso: 64, filt: "", pos: "50% 42%", defect: null },
        { sh: "1/400", iso: 64, filt: "blur(1.3px)", pos: "46% 46%", defect: "soft" },
      ],
    },
    {
      seed: "phd-sunset-6", ar: "3:2", start: "19:08", cam: "iPhone 16 Pro", lens: "Main", focal: "24mm", f: "1.78",
      frames: [
        { sh: "1/250", iso: 100, filt: "brightness(0.92) saturate(1.05)", pos: "50% 60%", defect: null },
        { sh: "1/200", iso: 125, filt: "brightness(1.05) saturate(0.95)", pos: "50% 55%", defect: "flat" },
      ],
    },
    {
      seed: "phd-portrait-18", ar: "2:3", start: "18:22", cam: "iPhone 16 Pro", lens: "2×", focal: "48mm", f: "2.8",
      frames: [
        { sh: "1/200", iso: 80, filt: "", pos: "50% 38%", defect: null },
      ],
    },
  ];

  // Flatten into a photo list with stable ids + EXIF.
  let n = 9000;
  const photos = [];
  const scenes = [];
  SCENES.forEach((sc, si) => {
    const ids = [];
    sc.frames.forEach((fr, fi) => {
      const id = "a" + (++n);
      const mm = String(fi * 7 + 3).padStart(2, "0");
      photos.push({
        id,
        scene: si,
        seed: sc.seed,
        ar: sc.ar,
        file: "IMG_" + (4000 + si * 11 + fi) + ".HEIC",
        time: sc.start + ":" + mm,
        filter: fr.filt || "",
        pos: fr.pos || "50% 50%",
        defect: fr.defect || null,
        exif: { cam: sc.cam, lens: sc.lens, focal: sc.focal, f: sc.f, iso: fr.iso, shutter: fr.sh || fr.f || "1/120" },
        // session state (mutated by the app)
        status: null,   // 'keep' | 'reject' | null
        rating: 0,      // 0–5
        stack: null,    // stack id
        edited: false,
        adj: null,      // edit adjustments
      });
      ids.push(id);
    });
    scenes.push({ id: "s" + si, idx: si, start: sc.start, frameIds: ids });
  });

  window.PHOTODESK = {
    pic,
    makeSessionPhotos: function () {
      // deep clone so each session starts fresh
      return photos.map((p) => Object.assign({}, p, { exif: Object.assign({}, p.exif) }));
    },
    scenes,
    sessionMeta: {
      name: "Miami Trip — Jan",
      from: "2026-01-03",
      to: "2026-01-12",
      threshold: 30,
      count: photos.length,
      sceneCount: scenes.length,
    },
    pastSessions: [
      { name: "Family Visit", photos: 8, scenes: 2, date: "Jun 6", threshold: 25, done: true, kept: 5, rejected: 2 },
      { name: "Manatee Springs", photos: 14, scenes: 4, date: "Jun 2", threshold: 45, done: true, kept: 9, rejected: 4 },
      { name: "Backyard / Spring", photos: 21, scenes: 6, date: "May 24", threshold: 30, done: false, kept: 0, rejected: 0 },
    ],
    presets: [
      { id: "none", name: "Original", adj: {} },
      { id: "punch", name: "Punch", adj: { exposure: 4, contrast: 18, saturation: 14, vibrance: 0 } },
      { id: "warm", name: "Warm", adj: { temp: 16, exposure: 3, saturation: 6 } },
      { id: "cool", name: "Cool", adj: { temp: -16, contrast: 6 } },
      { id: "matte", name: "Matte", adj: { contrast: -16, exposure: 5, saturation: -8, vignette: 10 } },
      { id: "bw", name: "B&W", adj: { saturation: -100, contrast: 12 } },
      { id: "film", name: "Film", adj: { temp: 8, contrast: -8, saturation: -6, vignette: 16 } },
    ],
  };

  /* ---- Library model: daily photo density for the Discover screen ---- */
  (function () {
    const L = window.PHOTODESK;
    const seedPool = ["phd-cafe-7", "phd-brunch-4", "phd-wall-22", "phd-skyline-11", "phd-beach-9", "phd-museum-3", "phd-street-15", "phd-sunset-6", "phd-portrait-18"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = (n) => String(n).padStart(2, "0");

    // Dense "outing" days. u=true → un-triaged (needs culling).
    const bursts = {
      "2025-10-05": { c: 38, u: false }, "2025-10-19": { c: 52, u: false },
      "2025-11-02": { c: 27, u: false }, "2025-11-23": { c: 64, u: false },
      "2025-12-24": { c: 71, u: false }, "2025-12-25": { c: 88, u: false }, "2025-12-31": { c: 46, u: false },
      "2026-01-03": { c: 42, u: true }, "2026-01-04": { c: 22, u: true },
      "2026-01-08": { c: 31, u: true },
      "2026-01-10": { c: 19, u: true }, "2026-01-11": { c: 27, u: true }, "2026-01-12": { c: 14, u: true },
    };

    const days = [];
    let total = 0, untriaged = 0;
    const cur = new Date(Date.UTC(2025, 9, 1));        // Oct 1 2025
    const end = new Date(Date.UTC(2026, 0, 12));       // Jan 12 2026
    while (cur <= end) {
      const y = cur.getUTCFullYear(), m = cur.getUTCMonth(), d = cur.getUTCDate();
      const key = y + "-" + pad(m + 1) + "-" + pad(d);
      let count = 0, unt = false;
      if (bursts[key]) { count = bursts[key].c; unt = bursts[key].u; }
      else {
        const r = ((m * 31 + d) * 9301 + 49297) % 233280 / 233280;
        if (r > 0.74) count = Math.floor(r * 7) + 1;   // sprinkle small everyday days
      }
      if (count) { total += count; if (unt) untriaged += count; }
      days.push({ key, y, m, d, dow: cur.getUTCDay(), count, untriaged: unt, label: MONTHS[m] + " " + d, seed: seedPool[(d + m) % seedPool.length] });
      cur.setUTCDate(d + 1);
    }

    // group into month blocks for the heatmap
    const monthMap = {};
    days.forEach((dy) => { const mk = dy.y + "-" + dy.m; (monthMap[mk] = monthMap[mk] || { label: MONTHS[dy.m], y: dy.y, m: dy.m, days: [] }).days.push(dy); });
    const months = Object.values(monthMap);

    L.library = { days, months, total, untriaged, untriagedDays: Object.values(bursts).filter((b) => b.u).length };

    L.suggested = [
      { id: "sug1", name: "New Year outing", from: "2026-01-03", to: "2026-01-04", span: "Jan 3–4", photos: 64, scenes: 9, when: "5 days ago", seeds: ["phd-beach-9", "phd-sunset-6", "phd-skyline-11", "phd-portrait-18"] },
      { id: "sug2", name: "Afternoon walk", from: "2026-01-08", to: "2026-01-08", span: "Jan 8", photos: 31, scenes: 5, when: "Yesterday", seeds: ["phd-street-15", "phd-wall-22", "phd-museum-3", "phd-cafe-7"] },
      { id: "sug3", name: "Weekend at home", from: "2026-01-10", to: "2026-01-12", span: "Jan 10–12", photos: 60, scenes: 8, when: "Today", seeds: ["phd-brunch-4", "phd-portrait-18", "phd-cafe-7", "phd-beach-9"] },
    ];
  })();
})();
