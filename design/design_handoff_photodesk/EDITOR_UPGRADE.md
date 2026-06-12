# PhotoDesk — Editor Upgrade Spec (for the coding agent)

Two features, both **frontend-only** (your `sharp` renderer and DB schema already support them). The interaction design is prototyped in `Editor Lab.html` (+ `editor-crop.jsx`, `editor-lab.jsx`). This doc maps that prototype onto your real repo.

Repo refs are to `eforbell/photoDesk@main`.

---

## 1. Draggable / resizable crop

### Why it's frontend-only
- `src/editor.js → validateCrop()` already accepts **arbitrary** normalized `{aspect, x, y, width, height}` in `[0,1]`, only requiring the rect stays inside the image. It is **not** limited to centered crops.
- `src/edit-renderer.js → pixelCrop()` already converts any normalized rect → pixel `extract` region.
- Today the frontend only ever *produces* centered rects via `cropForAspect()` in `public/editor.js`, so the freedom is unused.

### What to build (in `public/app.js`, the editor view)
Replace the centered-crop display with an interactive crop overlay. Reference implementation: **`editor-crop.jsx` → `CropArea`** (vanilla-portable; it's ~120 lines of plain math + DOM, no React-specific logic beyond state).

Behavior:
- Render the image contain-fit; overlay a crop rectangle with **box-shadow surround** (`0 0 0 9999px rgba(0,0,0,.58)`), a 1px light outline, and a rule-of-thirds grid.
- **Drag inside** = move (clamped to image). **Drag a corner** = resize. Min size ~44px.
- **Handles:** 4 corner handles always; in **Free** aspect also show 4 edge handles. In a locked aspect, show corners only and maintain ratio.
- **Aspect ratio enforcement is done in screen pixels** — because contain-fit is a uniform scale, screen-px ratio == image-px ratio, so `'1:1'`→1, `'3:2'`→1.5, `'Original'`→ source W/H. (See `CropArea`'s `ratioPx` + the corner-resize block with the 4 clamp guards.)
- Store crop as **normalized** `{x,y,w,h}` (convert px→normalized on every move using the image box's live `getBoundingClientRect`, so it's resize-safe). Map to the server's `{x, y, width, height}` field names on save.
- Selecting an aspect chip **refits** the current rect to that ratio about its center, clamped to the image (see `chooseAspect` in `editor-lab.jsx`). Add a **Flip** button that swaps `W:H`→`H:W` for `n:m` aspects.

### Dim-at-rest + locking in the crop (important UX)
- The surround overlay must **only deepen while dragging**. At rest, keep it light (~`rgba(0,0,0,.26)`) so the whole image reads brightly; ramp to ~`.6` during an active drag and ease back on pointer-up (see `CropArea`'s `active` state + the `box-shadow` transition). This was a real complaint with a static-heavy overlay.
- **Switching to Adjust is the "lock-in" gesture** — and the Adjust stage must render the **cropped** result (bright, no surround), so editing continues on the framed image. Reference: `CroppedStage` in `editor-lab.jsx`. **Sizing caveat:** a `<div>` with a `background-image` has no intrinsic dimensions, so it will collapse to a blank pane inside a flex-centered area sized only by `aspect-ratio`/`max-*` (the crop tool avoids this only because it uses a real `<img>`). `CroppedStage` measures the available area (ResizeObserver) and sizes the pane in real pixels; reproduce that, or paint onto an actual `<img>` element. The crop region is painted via `background-size: 100/w% 100/h%` and `background-position: x/(1-w)*100% y/(1-h)*100%` from the normalized rect. Provide an explicit **"Apply crop & adjust →"** button in the crop panel in addition to the tab, so the commit step is discoverable.

### One small backend change — only if you want true "Free"
`src/editor.js` has `const ASPECTS = new Set([...])` **without** `'Free'`, and `validateCrop` rejects unknown aspects. To allow un-ratio'd crops:
```js
const ASPECTS = new Set(['Free', 'Original', '1:1', '4:5', '5:4', '3:2', '2:3', '16:9']);
```
Add `'Free'` to `CROP_ASPECTS` in `public/editor.js` too. No renderer change — a "Free" crop is just an arbitrary rect, which `pixelCrop` already handles. (If you'd rather not touch the server, keep the rect free-form but tag it with the nearest named aspect; the rect is what's honored.)

### Acceptance
- Off-center crops round-trip: drag a rect, Save version, confirm the rendered JPG in `PHOTODESK_EDIT_DIR` matches the dragged region (not a centered crop).
- Aspect-locked resize never drifts off-ratio; Free resize moves single edges.
- Original image untouched (already guaranteed by your new-asset + stack flow).

---

## 2. Expanded profile gallery + intensity

### Today
`public/editor.js → PRESETS` has 7 profiles in a flat list, rendered as text pills (see screenshot 2). Applying sets the 8 adjustment values directly.

### What to build
A **grouped gallery with live preview thumbnails** and an **intensity** control. Reference: `editor-lab.jsx → AdjustPanel` + `ProfileThumb` + `PROFILE_GROUPS`.

- **Thumbnails:** render each profile as a small square = the *current asset's* thumbnail with that profile's CSS filter + temp/vignette overlays applied (reuse your existing `adjustmentFilter` / `temperatureOverlay` / `vignetteOverlay` from `public/editor.js` — the prototype's `adjFilter`/`tempRGBA`/`vignetteBG` are copies of yours). This is the single biggest usability win — your family can *see* each look on the actual photo before applying.
- **Groups:** Standard · White balance · Black & white · Film & vintage. Mark non-original profiles new vs. existing as you like.
- **Profile set** (all within your existing 8-param model — drop straight into `PRESETS`; the 7 existing keep their exact values):

```js
const PRESETS = [
  // Standard
  { id:'original', name:'Original', group:'Standard', adj:{} },
  { id:'punch',  name:'Punch',  group:'Standard', adj:{ exposure:5, contrast:24, saturation:14, vibrance:22 } }, // existing
  { id:'vivid',  name:'Vivid',  group:'Standard', adj:{ contrast:14, saturation:24, vibrance:28 } },
  { id:'soft',   name:'Soft',   group:'Standard', adj:{ contrast:-12, highlights:-10, shadows:16, saturation:-4 } },
  // White balance
  { id:'warm',   name:'Warm',   group:'White balance', adj:{ exposure:4, temp:28, saturation:8, vibrance:12 } }, // existing
  { id:'cool',   name:'Cool',   group:'White balance', adj:{ temp:-26, contrast:8, vibrance:10 } },              // existing
  { id:'golden', name:'Golden', group:'White balance', adj:{ exposure:3, temp:34, highlights:-8, saturation:10, vibrance:8 } },
  { id:'shade',  name:'Open Shade', group:'White balance', adj:{ temp:-16, exposure:6, shadows:12, vibrance:8 } },
  // Black & white
  { id:'bw',     name:'B&W',    group:'Black & white', adj:{ contrast:18, saturation:-100, highlights:8 } },     // existing
  { id:'monohi', name:'Mono Hi',group:'Black & white', adj:{ contrast:34, saturation:-100, highlights:-6, shadows:-10 } },
  { id:'silver', name:'Silver', group:'Black & white', adj:{ contrast:6, saturation:-100, highlights:10, shadows:22 } },
  // Film & vintage
  { id:'film',   name:'Film',   group:'Film & vintage', adj:{ contrast:12, highlights:-16, shadows:18, temp:10, saturation:-12, vignette:18 } }, // existing
  { id:'matte',  name:'Matte',  group:'Film & vintage', adj:{ contrast:-20, highlights:-18, shadows:24, saturation:-8 } }, // existing
  { id:'faded',  name:'Faded',  group:'Film & vintage', adj:{ contrast:-16, exposure:6, highlights:-10, shadows:22, saturation:-14, vignette:10 } },
  { id:'classic',name:'Classic',group:'Film & vintage', adj:{ contrast:10, temp:8, highlights:-10, shadows:14, vibrance:8, vignette:8 } },
];
```

- **Intensity (0–100%):** scales every value of the chosen profile before it becomes the working adjustment set:
  ```js
  const scaleAdj = (adj, pct) =>
    Object.fromEntries(ADJUSTMENT_KEYS.map(k => [k, Math.round((adj[k]||0) * pct/100)]));
  ```
  The *result* is still a normal adjustment object your validator/renderer already accept — **no new render math, no schema change.** Apply profile → working adj = `scaleAdj(profile.adj, 100)`. Move intensity → recompute from the profile's base. Manual slider edits then layer on top (show an "edited" tag when the working set diverges from `scaleAdj(base, amount)`).

### Acceptance
- Each thumbnail shows the live look on the current asset.
- Applying a profile then setting intensity 60% writes 60%-scaled values; the saved render matches the preview.
- Existing 7 profiles produce byte-identical output to today at 100%.

---

## Nice-to-haves (not in this pass; flag for later)
- **Straighten / rotate** would need real backend work (`edit-renderer.js` has no rotate step) — out of scope here.
- **Before/after compare** is trivial and already prototyped (hold `\` ): temporarily render with zeroed adj + full crop.
- **Per-user favorite profiles** — you have per-profile accounts now; a starred subset would be a small DB add.

## Files to read in the prototype
- `editor-crop.jsx` — the crop interaction (math + handles), portable to vanilla.
- `editor-lab.jsx` — gallery, intensity, panel layout, aspect refit logic.
- `theme.css` — tokens (already match your app).
- Open `Editor Lab.html` to click through both.
