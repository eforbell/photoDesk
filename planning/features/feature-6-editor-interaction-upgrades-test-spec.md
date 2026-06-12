# Feature 6 Test Specification — Editor Interaction Upgrades

## Unit tests

### Crop geometry (`test/editor.test.js`)

- `Free` is exported for the browser and accepted by server validation.
- `9:16` is accepted as the persisted flipped orientation of `16:9`.
- Move preserves width/height and clamps all four boundaries.
- Each corner resize anchors the opposite corner.
- Locked aspect resize meets the target source-pixel ratio within 0.2% for
  landscape, portrait, square, Original, and flipped 9:16 crops.
- Free north/east/south/west handles change only their boundary.
- Minimum crop size is enforced from a 44px display minimum.
- Aspect refit preserves center unless a boundary forces clamping.
- Flip maps 4:5↔5:4, 3:2↔2:3, and 16:9↔9:16.
- Crop values remain finite and normalized after extreme deltas.

### Editing profiles (`test/editor.test.js`)

- Fifteen IDs are unique and grouped correctly.
- Existing seven definitions deep-equal their shipped values.
- Scaling at 0, 60, and 100 percent produces integer normalized adjustments.
- Scaling never mutates profile definitions.
- Adjustment/profile comparison detects exact and Custom states.
- Preview helper output includes temperature and vignette where configured.

## Renderer tests (`test/edit-renderer.test.js`)

- A four-color landscape fixture cropped off-center returns pixels from the
  selected quadrant, not the centered region.
- A four-color portrait fixture verifies the same behavior.
- An EXIF orientation fixture is auto-oriented before the off-center region is
  extracted.
- Free crops render arbitrary output dimensions.
- Existing named crop and neutral/full-profile renders remain unchanged.

## API tests (`test/edit-api.test.js`)

- POST edit accepts `aspect: "Free"` with a valid arbitrary rectangle.
- POST edit accepts the flipped `aspect: "9:16"`.
- Invalid arbitrary rectangles outside normalized bounds are rejected.
- Save/reload returns identical crop and adjustment recipes.
- A scaled profile remains a normal adjustment object; no profile or intensity
  fields are persisted.
- Previous-ready preservation and render serialization tests continue passing.

## Browser tests

Run against real application routes and an Immich-backed or deterministic
fixture session.

### Desktop

1. Open a landscape asset in Crop.
2. Move the crop off-center.
3. Resize each locked corner and verify handles remain captured outside their
   original hit box.
4. Select Free and resize each edge.
5. Select 4:5, Flip to 5:4, then use **Apply crop & adjust**.
6. Confirm Adjust shows only the selected crop.
7. Inspect all profile groups and confirm thumbnails use the current asset.
8. Apply Film at 60%; verify slider values equal scaled base values.
9. Change one slider; verify Custom/edited state.
10. Save, reopen, and confirm recipe plus crop preview.

### Mobile/touch (390×844)

1. Drag and resize with touch/pointer emulation.
2. Verify crop handles have usable hit targets and no page scrolling occurs
   during manipulation.
3. Verify crop controls, Apply action, profile gallery, intensity, Save, and
   Cancel are reachable without horizontal scrolling.
4. Rotate the viewport once and verify crop normalization survives
   `ResizeObserver` recalculation.

### Failure/cancellation

- Trigger `pointercancel` and switch tools mid-interaction; no further movement
  occurs and dimming returns to rest.
- Close the editor during interaction; reopening has no stale listeners.
- Force a render failure; previous ready derivative and current recipe safety
  behavior remain unchanged.

## Visual verification

Use `design/design_handoff_photodesk/Editor Lab.html` as the interaction and
composition reference. Run `$visual-verdict` after each editor visual iteration.

- No critical mismatch.
- Crop handles/grid/surround and grouped profiles match the design hierarchy.
- Portrait and landscape stages remain source-faithful.
- Desktop visual score is at least 95/100.
- Mobile visual score is at least 92/100 with no blocked primary action.

## Commands

```bash
node --test test/editor.test.js test/edit-renderer.test.js test/edit-api.test.js
npm test
node --check public/editor.js
node --check public/app.js
node --check src/editor.js
git diff --check
```
