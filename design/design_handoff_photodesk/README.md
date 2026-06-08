# Handoff: PhotoDesk — Immich culling & light-edit tool

## Overview
PhotoDesk is a self-hosted photo **culling** tool that sits on top of [Immich](https://immich.app). It fills the workflow gap between "photos auto-uploaded from phone" and "curated library" — the pick / reject / rate / stack / light-edit pass that Lightroom provides but Immich lacks. Immich remains the source of truth for storage, sync, and browsing; PhotoDesk reads from it, lets the user triage a batch locally, and writes decisions back via the Immich REST API only on an explicit **Commit**.

This bundle is a **high-fidelity, interactive prototype** of the full flow: a Library/Discover entry screen, a three-pass workspace (Cull → Rate → Stack), an immersive lightbox, a humble editor (crop + adjustment sliders + presets), and a Commit screen.

---

## About the Design Files
The files in this bundle are **design references created in HTML/React-via-Babel** — a prototype showing the intended look and behavior. **They are not production code to copy directly.** The task is to **recreate these designs in the target codebase's environment**, using its established patterns.

The reference implementation already matches the stated target architecture (Express/Node backend + vanilla frontend, SQLite for session state, Immich REST API via an API key, thumbnail proxy to keep credentials server-side). A developer may:
- Lift the **visual system** (tokens, layouts, component specs below) verbatim — it is final.
- Re-implement the **frontend** in whatever the project standardizes on (the prototype uses React through an in-browser Babel transform with no build step; a real app would likely use a bundler, or plain vanilla JS/Web Components to match the "no build tools" pattern described for PhotoDesk).
- Treat all data as **mock** — there is no real Immich connection in the prototype. Every place that reads/writes photos is a documented integration point (see **Immich Integration** below).

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, shadows, and interactions are final and intended to be reproduced precisely. Exact values are in **Design Tokens**. The only thing that is *not* real is the data layer (photos are placeholder images; counts are mock).

---

## Design Tokens

All tokens live in `theme.css` as CSS custom properties. Colors are authored in **OKLCH**. The app is **dark-only** by deliberate design (you judge photos against neutral dark chrome). A default "graphite" (pure-neutral) theme plus optional "warm" and "cool" variants exist; ship graphite as the default.

### Neutrals (graphite / default theme)
| Token | OKLCH | Use |
|---|---|---|
| `--bg-deep` | `oklch(0.135 0 0)` | Lightbox / editor immersive backdrop |
| `--bg` | `oklch(0.165 0 0)` | Workspace canvas |
| `--panel` | `oklch(0.195 0 0)` | Rails, toolbars, cards |
| `--panel-2` | `oklch(0.235 0 0)` | Raised cards, inputs |
| `--panel-3` | `oklch(0.285 0 0)` | Hover, active wells |
| `--border` | `oklch(0.30 0 0)` | Default borders |
| `--border-soft` | `oklch(0.25 0 0)` | Subtle dividers |
| `--border-strong` | `oklch(0.40 0 0)` | Emphasis borders |
| `--text` | `oklch(0.955 0 0)` | Primary text |
| `--text-dim` | `oklch(0.74 0 0)` | Secondary text |
| `--text-faint` | `oklch(0.56 0 0)` | Labels |
| `--text-ghost` | `oklch(0.44 0 0)` | Metadata / mono captions |

### Accent + semantic status
The palette is deliberately disciplined: **one** accent (selection / active / stack) plus **three** load-bearing culling colors. Do not introduce more hues.
| Token | OKLCH | Meaning |
|---|---|---|
| `--accent` | `oklch(0.66 0.15 256)` | Selection, active pass, stacks, primary buttons |
| `--accent-text` | `oklch(0.80 0.10 256)` | Accent text on dark |
| `--accent-dim` | `oklch(0.66 0.15 256 / 0.16)` | Accent fills/backgrounds |
| `--keep` | `oklch(0.74 0.15 152)` | Pick / keep (green) |
| `--reject` | `oklch(0.64 0.18 25)` | Reject (red) |
| `--star` | `oklch(0.81 0.13 80)` | Star ratings (gold) |

Accent has 4 selectable variants (azure default, teal `0.70 0.12 192`, violet `0.66 0.16 298`, amber `0.74 0.14 70`) — optional; azure is the default.

### Typography
- **Sans:** `"Hanken Grotesk"` (Google Fonts), weights 400/500/600/700. UI text, headings.
- **Mono:** `"JetBrains Mono"` (Google Fonts), weights 400/500/600. All metadata, EXIF, counts, timestamps, file names. Uses `font-feature-settings: "tnum" 1` (tabular numbers).
- Scale in use: page titles 30px/700/-0.025em; section headers 13–15px/600 uppercase 0.06em tracking for eyebrows; body 14–15px; metadata 11–12.5px mono; thumbnail captions 9.5–11px.

### Radii
`--r-sm 5px` (thumbnails) · `--r-md 8px` (buttons, inputs) · `--r-lg 12px` (cards) · `--r-xl 16px` (large panels).

### Shadows
`--shadow-1 0 1px 2px rgba(0,0,0,.4)` · `--shadow-2 0 4px 16px rgba(0,0,0,.45)` · `--shadow-3 0 16px 48px rgba(0,0,0,.55)`.

### Motion
`--ease cubic-bezier(0.32, 0.72, 0, 1)`. Transitions are short (.12–.25s). Avoid decorative looping animation. Entrance fades were intentionally kept minimal/absent so content is always visible in print/export/static contexts.

### Spacing
Use a 4px base rhythm. Common gaps: grid tiles 6–10px (density-driven), card padding 13–22px, section spacing 28–44px.

---

## Screens / Views

### 1. Library / Discover (entry screen) — `library.jsx`
**Purpose:** Replace "conjure up a date range" with discovery. PhotoDesk surfaces un-triaged batches and lets the user browse the library by density.

**Layout:** Full-height scroll. Sticky translucent (`backdrop-filter: blur(10px)`) header (wordmark left, Immich connection pill right). Centered content column `max-width: 1180px`, padding `40px 36px 70px`. Subtle radial background glow top-right in accent hue.

**Sections (top to bottom):**
- **Hero row:** `<h1>` "Your library" 30px/700 + descriptive subtitle, with a right-aligned cluster of 3 **Stat** cards (In library / Un-triaged [accent] / Active days). Stat: panel card, mono 24px/700 number, 10.5px uppercase label.
- **Ready to cull:** section header ("Ready to cull" + eyebrow sub) then a responsive grid `repeat(auto-fill, minmax(280px, 1fr))`, gap 16. Each **SuggestedCard**: a 2×2 photo mosaic (aspect 16/10, 2px gaps) with an absolute "● Un-triaged" pill (accent, blurred dark bg) top-left; body with name (15/600, nowrap), right-aligned "when" (mono 11px ghost), a mono metadata row (span · N photos · ~N scenes), and a full-width "Start culling →" button that fills with `--accent` on card hover. Card lifts `translateY(-2px)` on hover.
- **Browse by date:** a GitHub-style **calendar heatmap**. Month blocks laid in a wrapping row, gap 30. Each month: label ("Oct '25" mono year) over a `grid-auto-flow: column`, `grid-template-rows: repeat(7, 15px)`, 15px cells, gap 4, with leading empty cells for the first day's weekday offset. Cell color = `heatColor(day)`: un-triaged days use an accent-blue lightness ramp `[0.40, 0.52, 0.62, 0.72]` chroma 0.13 hue 256; reviewed days use neutral `[0.30, 0.36, 0.43, 0.50]`; empty days `--panel-2`. Level thresholds by photo count: `<10 / 10–29 / 30–59 / 60+`. Below the grid: a legend (Needs culling [blue] · Reviewed [gray] · Less→More ramp).
  - **Interaction:** mousedown a cell → start range at that date; mouseenter while dragging → extend range; window mouseup → end. A single click = a one-day range. Selected cells get `outline: 1.5px solid var(--accent)` + `0 0 0 3px var(--accent-dim)` glow. Hover any cell → fixed tooltip (date, "N photos · un-triaged/reviewed", or "no photos").
  - When a range is selected, a **SelectionPanel** appears below the heatmap: summary (auto label "Jan 3 – Jan 4", N photos, N days, N un-triaged in accent), a small thumbnail preview strip (first 6 + "+N" chip), an editable session-name input (placeholder = auto label), a "Scene gap" slider (5–120s, default 30), and a "Start session →" primary button. An ✕ clears the selection.
- **Recent sessions:** compact rows (icon tile, name, mono meta, and either "N kept / N cut" if committed or a "Resume →" pill if in progress).

### 2. Workspace — `shell.jsx` (shell, keyboard, filters, commit) + `workspace.jsx` (rail, thumbnails, scene blocks)
**Purpose:** The triage surface. One scrolling scene grid; the active "pass" changes which verb is emphasized.

**Layout:** Column flex, full height.
- **Header** (`grid-template-columns: 1fr auto 1fr`): left = Home button + session name (14/600) and mono "N frames · N scenes"; center = **ProgressRail**; right = "Hide rejects" checkbox + a filter `<select>` (All / Picks / Rated / Unrated / Rejects).
- **ProgressRail** (the reworked navigation — replaces 3 peer tabs): a connected sequence `Cull → Rate → Stack → Commit` with connector lines that fill with accent as you progress. Each step is a pill with a status dot (filled accent when active, green check when a prior pass is done), label, and a live count chip. The connector + checks frame it as one journey toward Commit. A **`tabs` variant** also exists (a simple segmented control) — toggleable; ship the rail as default.
- **Pass hint strip:** centered icon + one-line hint for the current pass ("Keep or reject, fast." / "Star the survivors." / "Group same-shot variants.").
- **Scene grid:** vertical stack of **SceneBlock**s. A scene = a time-cluster of frames. Three grouping layouts (Tweakable): `divider` (label + horizontal rule, default), `lane` (sticky left label column 104px + tiles), `carded` (each scene in a bordered panel). Within a block, tiles are a `flex-wrap` row, gap density-driven. Tile width is a CSS var `--thumb` ≈ `300 − density*18` px; gap 6px at high density else 10px.
- **Bottom bar:** when in Stack pass with a selection, a sticky action bar ("N selected", Clear, "Group as stack [G]"); otherwise a centered keyboard-shortcut legend for the current pass.

**Thumbnail (`Thumb`):** aspect from the photo's `ar` ("3:2"/"2:3"), `--r-sm` radius. Focus ring = accent with `0 0 0 4px var(--accent-dim)` glow; keep/reject tint the outline green/red. Reject overlays a 42% black scrim (or dims to 40% opacity in Stack pass). Corner badges: status dot (✓/✕) top-left; "EDIT" + stack number top-right; bottom gradient shows stars and/or a mono defect label ("soft", "motion blur", "underexposed", etc.). Hover reveals quick-action buttons (keep/reject in Cull, maximize always). In Stack pass a checkbox replaces status. Double-click opens the lightbox; single click focuses (and toggles selection in Stack).

### 3. Lightbox — `lightbox.jsx`
**Purpose:** The heart of culling — full-screen single-photo review with keyboard blitzing.
**Layout:** Fixed, `--bg-deep`. Header (close ✕, mono filename, "i / N", defect chip, "Edit [E]" button). Center **Stage** (the image, max 1200px, drop-shadow, with live edit adjustments applied if edited; large status badge top-right when keep/reject; "EDITED · original kept" pill top-left). Large circular prev/next nav buttons (outside the image). A centered rating row (interactive 5-star control). A horizontal **filmstrip** (64px-tall thumbs, active one ringed + auto-centered on change, status dot + star count overlays). A bottom keyboard legend.

### 4. Editor — `lightbox.jsx` (`Editor`, `Stage`, `Histogram`)
**Purpose:** Humble, non-destructive light editing. Saves a new version; original is preserved (mirrors Immich stacking).
**Layout:** Fixed split. Left = preview Stage (with a Crop/Adjust tool toggle in its header; crop mode shows a rule-of-thirds overlay and applies the chosen aspect ratio live). Right = 320px control panel: a decorative **histogram** (shifts with exposure) at top; then either **Crop** (aspect-ratio grid: Original/1:1/4:5/5:4/3:2/2:3/16:9) or **Adjust** (a preset pill row + grouped sliders). Footer = Reset + "Save as new version" (disabled until dirty).
**Adjustment model** (each −100…100, vignette 0…100): Light → Exposure, Contrast, Highlights, Shadows; Color → Temp, Saturation, Vibrance; Effects → Vignette. Rendered live via CSS: a `filter` string (brightness/contrast/saturate composited from the values) plus a temp color overlay (warm/cool `soft-light` tint) and a radial-gradient vignette overlay. Presets (Original, Punch, Warm, Cool, Matte, B&W, Film) set adjustment bundles. Double-clicking a slider label resets it to 0.

### 5. Commit / Summary — `shell.jsx` (`Summary`)
**Purpose:** Review counts and choose what to push to Immich. Nothing is written until here.
**Layout:** Centered card (max 560px). Eyebrow (session name) + "Commit to Immich" title. A 3-col grid of stat tiles (Kept/Rejected/Undecided/Rated/Stacks/Edited, color-coded). Then "What to push" — four independent checkbox rows, each with a colored dot, title, and mono sub-detail:
- **Trash rejects** → soft-delete to Immich trash (recoverable)
- **Write star ratings** → asset metadata
- **Create stacks** → from manual groups, best frame primary
- **Upload edited versions** → new assets, stacked over originals

A "Commit to Immich →" button runs each selected action, appending a green check line per step to a live log, ending in "Done. Immich is up to date." Each action is reported separately (with room for per-action error handling).

---

## Interactions & Behavior

### The three-pass model
Deliberately sequential, but switchable at any time via the rail:
- **Cull (Pass 1):** fast binary keep/reject. `P` keep, `X` reject, `U` unset. Pick is a *triage state*, not a rating.
- **Rate (Pass 2):** rejects auto-hide ("Hide rejects" defaults on). `1`–`5` set stars, `0` clears, `X` can still reject. Only survivors are shown.
- **Stack (Pass 3):** grid becomes multi-select. Click tiles to select, `G` (or the bottom-bar button) groups ≥2 into a stack. **Never auto-stack** — only the user decides true variants. Scene clustering is a browsing aid, not grouping.
- **Commit (Pass 4):** opens the Summary screen.

### Keyboard (keyboard-first, with mouse affordances)
**Grid:** arrows move focus (and auto-scroll to keep focus visible); `Enter`/`O` open lightbox; `E` edit; pass-specific keys (P/X/U, 1–5/0/X, Space/G in Stack).
**Lightbox:** `← →` navigate; **`Enter` jumps to the first frame of the NEXT scene; `Shift+Enter` to the previous scene's first frame**; `E` edit; `Esc` close; pass-specific keys apply to the current photo.
Keyboard handlers ignore events when focus is in an INPUT/SELECT/TEXTAREA.

### Other behavior
- "Hide rejects" defaults **on** in Rate and Stack, **off** in Cull.
- Filter `<select>` narrows the visible set; the lightbox navigates only the filtered/flattened list, so culling is never interrupted by hidden noise.
- Editing marks a photo `edited`, stores its `adj` + crop, and shows EDIT badges; "save" is non-destructive (new version).
- Toasts confirm edits ("Saved as new version · original preserved") and stacking.

---

## State Management

Prototype state is React `useState` lifted into `App` / `WorkspaceShell`. In production, **session state lives server-side in SQLite** until Commit; Immich is only mutated on Commit.

**Per-photo session fields** (see `data.js`):
- `id` — Immich asset id
- `scene` — cluster index (derived from capture-time proximity + a threshold)
- `ar`, `file`, `time`, `exif{cam,lens,focal,f,iso,shutter}` — from Immich asset metadata
- `defect` — *(prototype-only hint; real app may compute or omit)*
- `status` — `'keep' | 'reject' | null` (triage)
- `rating` — `0–5`
- `stack` — local stack group id or `null`
- `edited` (bool), `adj` (adjustment object or null), `crop`

**Session-level:** name, from/to date range, scene threshold (seconds), derived counts (keep/reject/rated/stacks/edited/undecided).

**Discovery state:** library day-density model, suggested batches, calendar selection range `{a, b}` (date strings), drag flag.

---

## Immich Integration (the real work)

All data in the prototype is mock. Each touchpoint maps to an Immich REST endpoint (API key in `Authorization`/`x-api-key`, proxied server-side):

| PhotoDesk action | Immich API |
|---|---|
| Pull a date range / build a session | `POST /api/search/metadata` (or `/api/assets` with `takenAfter`/`takenBefore`) |
| Thumbnails | `GET /api/assets/{id}/thumbnail` (proxied to hide the key) |
| Scene clustering | client/server-side grouping by `fileCreatedAt` proximity (threshold seconds) |
| Library density heatmap | aggregate asset counts per day over the range |
| "Un-triaged" detection | track which assets PhotoDesk has already processed (SQLite), diff against Immich |
| Commit: trash rejects | `DELETE /api/assets` (soft delete → trash, recoverable) |
| Commit: write ratings | rating to asset metadata (e.g. `PUT /api/assets/{id}` / metadata endpoint; Immich rating support) |
| Commit: create stacks | `POST /api/stacks` with `{ assetIds: [...] }` (first id = primary) |
| Commit: upload edited version | `POST /api/assets` (multipart: file, `fileCreatedAt`, `fileModifiedAt`), then `POST /api/stacks` with `[editedId, originalId]` so the edit shows in the timeline and the original is preserved underneath |
| Apply edits server-side | `sharp` (libvips) to render crop/levels/filters before upload |

> Verify exact endpoint shapes against the running Immich version's `/api/docs` (the API evolves). The prototype's adjustment model (`adjCss` / temp / vignette in `components.jsx` + `lightbox.jsx`) is a CSS approximation; the server should reproduce it in `sharp`.

---

## Assets
- **Fonts:** Hanken Grotesk + JetBrains Mono via Google Fonts (`<link>` in `PhotoDesk.html`). Self-host in production.
- **Icons:** inline stroked SVGs in `components.jsx` (`Icon` component) — no icon dependency.
- **Photos:** placeholder images from Lorem Picsum (`https://picsum.photos/seed/...`), with CSS-filter variants simulating near-duplicates and a graceful gradient fallback on load error. **Replace entirely** with Immich thumbnails.
- No raster logo — the wordmark is CSS/SVG (`Wordmark` in `landing.jsx`).

---

## Files
The design lives in these files (all in the project root; copied into this handoff folder):
- `PhotoDesk.html` — entry point; loads fonts, React (via Babel), and all modules in order.
- `theme.css` — all design tokens, base styles, scrollbars, `.kbd`/`.mono` utilities, keyframes.
- `data.js` — mock session photos, scenes, past sessions, presets, **and** the library density model + suggested batches.
- `components.jsx` — shared atoms: `Icon`, `PhotoImg` (with adjustments + fallback), `Stars`, the **adjustment engine** (`adjCss`, `tempOverlay`, `vignetteOverlay`, `ADJ_ZERO`), defect labels.
- `landing.jsx` — `Wordmark`, `Field`, shared `inputStyle` (and a legacy `Landing` form, superseded by Library).
- `library.jsx` — the Library/Discover entry screen (suggested cards, calendar heatmap, selection panel).
- `workspace.jsx` — `ProgressRail` (rail + tabs variants), `Thumb`, `SceneBlock`.
- `lightbox.jsx` — `Lightbox`, `Editor`, `Stage`, `Histogram`.
- `shell.jsx` — `WorkspaceShell` (keyboard, filtering, focus, stacking, toasts) and `Summary` (commit).
- `app.jsx` — root: screen routing (landing → work → summary), tweaks wiring, theme/accent application.
- `tweaks-panel.jsx` — optional in-prototype controls (theme, accent, grid density, scene grouping, rail vs tabs). Not part of the product UI; safe to drop.

> Note on the prototype's tech: it uses React compiled in-browser by Babel with components attached to `window` across separate `<script type="text/babel">` files (no build step). This is a prototyping convenience — reimplement with the project's normal toolchain.
