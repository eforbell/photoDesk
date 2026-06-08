/* ── PhotoDesk frontend — multi-pass culling ───────────────── */

// ── State ────────────────────────────────────────────────────
const state = {
  currentSession: null,  // session object
  scenes: [],            // [{id, scene_index, asset_ids:[]}]
  allAssets: [],         // flat ordered list of all assetIds across all scenes
  sceneForAsset: {},     // assetId -> scene index (0-based)

  decisionMap: {},       // assetId -> 'pick'|'reject'|null
  ratingMap: {},         // assetId -> 1-5|null
  stackGroups: [],       // [{id, asset_ids:[]}]
  stackGroupMap: {},     // assetId -> stackGroupId

  mode: 'triage',        // 'triage'|'rate'|'stack'
  hideRejects: false,
  filterShow: 'all',     // 'all'|'picked'|'unrated'|'rated'

  // Lightbox
  lightboxOpen: false,
  lightboxIndex: 0,      // index into allAssets

  // Stack mode selection
  stackSelection: new Set(), // selected assetIds
};

// ── DOM shortcuts ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

const screens = {
  home:    $('screen-home'),
  review:  $('screen-review'),
  summary: $('screen-summary'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Loading overlay ───────────────────────────────────────────
function showLoading(msg = 'Loading...') {
  $('loading-msg').textContent = msg;
  $('loading-overlay').classList.remove('hidden');
}
function hideLoading() {
  $('loading-overlay').classList.add('hidden');
}

// ── API helpers ───────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── HOME SCREEN ───────────────────────────────────────────────
async function loadSessions() {
  const list = $('sessions-list');
  try {
    const sessions = await api('GET', '/api/sessions');
    if (sessions.length === 0) {
      list.innerHTML = '<p class="muted">No sessions yet. Create one above.</p>';
      return;
    }
    list.innerHTML = sessions.map(s => `
      <div class="session-card" data-id="${s.id}">
        <div class="session-card-name">${escHtml(s.name)}</div>
        <div class="session-card-meta">
          <span>${s.total_assets} photos</span>
          <span>${s.total_scenes} scenes</span>
          <span>${fmtDate(s.created_at)}</span>
          ${s.scene_threshold ? `<span>Threshold: ${s.scene_threshold}s</span>` : ''}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.session-card').forEach(card => {
      card.addEventListener('click', () => openSession(Number(card.dataset.id)));
    });
  } catch (err) {
    list.innerHTML = `<p class="muted">Error loading sessions: ${escHtml(err.message)}</p>`;
  }
}

$('scene-threshold').addEventListener('input', function () {
  $('threshold-display').textContent = this.value;
});

$('new-session-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const name = $('session-name').value.trim();
  const dateFrom = $('date-from').value || undefined;
  const dateTo = $('date-to').value || undefined;
  const sceneThreshold = Number($('scene-threshold').value);

  if (!name) return;

  const btn = $('create-btn');
  btn.disabled = true;
  showLoading('Fetching photos from Immich...');

  try {
    const session = await api('POST', '/api/sessions', {
      name,
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
      sceneThreshold,
    });
    hideLoading();
    await openSession(session.id);
  } catch (err) {
    hideLoading();
    alert(`Failed to create session: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ── Open a session ────────────────────────────────────────────
async function openSession(sessionId) {
  showLoading('Loading session...');
  try {
    const [sessionData, scenesData] = await Promise.all([
      api('GET', `/api/sessions/${sessionId}`),
      api('GET', `/api/sessions/${sessionId}/scenes`),
    ]);

    state.currentSession = sessionData;
    state.scenes = scenesData.scenes;
    state.decisionMap = scenesData.decisionMap || {};
    state.ratingMap = scenesData.ratingMap || {};
    state.stackGroups = scenesData.stackGroups || [];
    state.stackGroupMap = scenesData.stackGroupMap || {};
    state.mode = 'triage';
    state.hideRejects = false;
    state.filterShow = 'all';
    state.lightboxOpen = false;
    state.lightboxIndex = 0;
    state.stackSelection = new Set();

    // Build flat asset list and scene lookup
    state.allAssets = [];
    state.sceneForAsset = {};
    for (const scene of state.scenes) {
      for (const id of scene.asset_ids) {
        state.sceneForAsset[id] = scene.scene_index;
        state.allAssets.push(id);
      }
    }

    hideLoading();
    showScreen('review');

    // Sync UI controls with state
    $('filter-hide-rejects').checked = state.hideRejects;
    $('filter-show').value = state.filterShow;
    setMode('triage');
    renderGrid();
  } catch (err) {
    hideLoading();
    alert(`Error loading session: ${err.message}`);
  }
}

// ── Mode management ───────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;

  // Update tab UI
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  // Stack action bar
  if (mode === 'stack') {
    $('stack-action-bar').classList.remove('hidden');
    updateStackActionBar();
  } else {
    $('stack-action-bar').classList.add('hidden');
    state.stackSelection.clear();
  }

  // Auto-enable hide rejects in rate mode
  if (mode === 'rate') {
    state.hideRejects = true;
    $('filter-hide-rejects').checked = true;
  }

  // Close lightbox if opening stack mode
  if (mode === 'stack' && state.lightboxOpen) {
    closeLightbox();
  }

  renderGrid();
}

document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

// ── Filter controls ───────────────────────────────────────────
$('filter-hide-rejects').addEventListener('change', function () {
  state.hideRejects = this.checked;
  applyGridFilters();
});

$('filter-show').addEventListener('change', function () {
  state.filterShow = this.value;
  applyGridFilters();
});

function applyGridFilters() {
  const gridView = $('grid-view');
  gridView.classList.toggle('hide-rejects', state.hideRejects);
  gridView.classList.remove('filter-picked', 'filter-unrated', 'filter-rated');
  if (state.filterShow !== 'all') {
    gridView.classList.add(`filter-${state.filterShow}`);
  }
}

// ── GRID RENDERING ────────────────────────────────────────────
const STACK_COLORS = ['#a855f7','#3b82f6','#f59e0b','#10b981','#f43f5e','#06b6d4'];

function stackColorForGroup(groupId) {
  const idx = state.stackGroups.findIndex(sg => sg.id === groupId);
  return STACK_COLORS[idx % STACK_COLORS.length] || '#999';
}

function renderGrid() {
  const grid = $('photo-grid');
  const fragments = [];

  let currentSceneIdx = -1;

  for (const assetId of state.allAssets) {
    const sceneIdx = state.sceneForAsset[assetId];

    // Scene separator
    if (sceneIdx !== currentSceneIdx) {
      currentSceneIdx = sceneIdx;
      fragments.push(`
        <div class="scene-separator">
          <div class="scene-separator-line"></div>
          <div class="scene-separator-label">Scene ${sceneIdx + 1}</div>
          <div class="scene-separator-line"></div>
        </div>
      `);
    }

    fragments.push(renderGridItem(assetId));
  }

  grid.innerHTML = fragments.join('');

  // Attach event listeners
  grid.querySelectorAll('.grid-item').forEach(el => {
    const assetId = el.dataset.assetId;

    el.addEventListener('click', () => {
      if (state.mode === 'stack') {
        toggleStackSelection(assetId, el);
      } else {
        openLightbox(assetId);
      }
    });
  });

  applyGridFilters();
}

function renderGridItem(assetId) {
  const decision = state.decisionMap[assetId] || null;
  const rating = state.ratingMap[assetId] || null;
  const stackGroupId = state.stackGroupMap[assetId] || null;
  const isStackSelected = state.stackSelection.has(assetId);
  const isRated = rating !== null;

  const classes = ['grid-item'];
  if (decision === 'pick') classes.push('is-pick');
  if (decision === 'reject') classes.push('is-reject');
  if (isRated) classes.push('is-rated');
  if (stackGroupId) classes.push('in-stack-group');
  if (isStackSelected) classes.push('stack-selected');

  const inlineStyle = stackGroupId
    ? `style="border-left-color: ${stackColorForGroup(stackGroupId)};"`
    : '';

  let badges = '';

  if (state.mode === 'stack') {
    const check = isStackSelected ? '&#10003;' : '';
    badges += `<div class="grid-check">${check}</div>`;
  } else {
    if (decision === 'reject') {
      badges += `<div class="grid-badge-reject">&#x2715;</div>`;
    } else if (decision === 'pick') {
      badges += `<div class="grid-badge-pick"></div>`;
    }
  }

  if (rating) {
    badges += `<div class="grid-stars">${'★'.repeat(rating)}</div>`;
  }

  if (stackGroupId) {
    badges += `<div class="grid-stack-badge">stack</div>`;
  }

  return `
    <div class="${classes.join(' ')}" data-asset-id="${assetId}" ${inlineStyle}>
      <img src="/api/proxy/thumbnail/${assetId}" loading="lazy" alt="" />
      ${badges}
    </div>
  `;
}

function refreshGridItem(assetId) {
  const el = document.querySelector(`.grid-item[data-asset-id="${assetId}"]`);
  if (!el) return;

  const newHtml = renderGridItem(assetId);
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newEl = tmp.firstElementChild;

  // Preserve the img src to avoid re-fetching
  const oldImg = el.querySelector('img');
  const newImg = newEl.querySelector('img');
  if (oldImg && newImg && oldImg.complete) {
    newImg.src = oldImg.src;
  }

  el.replaceWith(newEl);

  // Re-attach click listener
  newEl.addEventListener('click', () => {
    if (state.mode === 'stack') {
      toggleStackSelection(assetId, newEl);
    } else {
      openLightbox(assetId);
    }
  });

  applyGridFilters();
}

// ── LIGHTBOX ──────────────────────────────────────────────────
function openLightbox(assetId) {
  const idx = state.allAssets.indexOf(assetId);
  if (idx === -1) return;
  state.lightboxIndex = idx;
  state.lightboxOpen = true;
  $('lightbox').classList.remove('hidden');
  renderLightbox();
}

function closeLightbox() {
  state.lightboxOpen = false;
  $('lightbox').classList.add('hidden');
}

function renderLightbox() {
  if (!state.lightboxOpen) return;

  const assetId = state.allAssets[state.lightboxIndex];
  const decision = state.decisionMap[assetId] || null;
  const rating = state.ratingMap[assetId] || null;

  // Image
  const img = $('lb-image');
  img.style.opacity = '0.6';
  img.src = `/api/proxy/thumbnail/${assetId}`;
  img.onload = () => { img.style.opacity = '1'; };
  img.onerror = () => { img.style.opacity = '0.3'; };

  // Progress — show position within visible assets
  const visibleAssets = state.allAssets.filter(shouldShowAsset);
  const visiblePos = visibleAssets.indexOf(assetId) + 1;
  $('photo-progress').textContent = `${visiblePos} / ${visibleAssets.length}`;

  // Decision badge
  const badge = $('lb-decision-badge');
  badge.className = 'lb-decision-badge' + (decision ? ` ${decision}` : '');
  badge.textContent = decision ? decision.toUpperCase() : '';

  // Stars
  const starsEl = $('lb-stars');
  starsEl.textContent = rating ? '★'.repeat(rating) : '';

  // Flash cleared
  $('lb-flash').className = 'lb-flash';

  // Nav buttons
  $('lb-prev').disabled = state.lightboxIndex === 0;
  $('lb-next').disabled = state.lightboxIndex === state.allAssets.length - 1;

  // Keyboard hints per mode
  renderLightboxHints();
}

function renderLightboxHints() {
  const hints = $('lb-hints');
  if (state.mode === 'triage') {
    hints.innerHTML = `
      <span><kbd>P</kbd> Pick</span>
      <span><kbd>X</kbd> Reject</span>
      <span><kbd>←</kbd><kbd>→</kbd> Navigate</span>
      <span><kbd>Esc</kbd> Close</span>
    `;
  } else if (state.mode === 'rate') {
    hints.innerHTML = `
      <span><kbd>1</kbd>–<kbd>5</kbd> Star</span>
      <span><kbd>0</kbd> Clear rating</span>
      <span><kbd>X</kbd> Reject</span>
      <span><kbd>←</kbd><kbd>→</kbd> Navigate</span>
      <span><kbd>Esc</kbd> Close</span>
    `;
  } else {
    hints.innerHTML = `<span><kbd>Esc</kbd> Close</span>`;
  }
}

function shouldShowAsset(assetId) {
  if (state.hideRejects && state.decisionMap[assetId] === 'reject') return false;
  if (state.filterShow === 'picked' && state.decisionMap[assetId] !== 'pick') return false;
  if (state.filterShow === 'unrated' && state.ratingMap[assetId]) return false;
  if (state.filterShow === 'rated' && !state.ratingMap[assetId]) return false;
  return true;
}

function lbNavigate(delta) {
  let next = state.lightboxIndex + delta;
  while (next >= 0 && next < state.allAssets.length) {
    if (shouldShowAsset(state.allAssets[next])) {
      state.lightboxIndex = next;
      renderLightbox();
      return;
    }
    next += delta;
  }
}

$('lb-prev').addEventListener('click', () => lbNavigate(-1));
$('lb-next').addEventListener('click', () => lbNavigate(1));
$('lb-close').addEventListener('click', closeLightbox);

// ── Decision / Rating recording ───────────────────────────────
async function recordDecision(assetId, decision) {
  const prev = state.decisionMap[assetId];
  if (prev === decision) {
    // Toggle off — remove decision
    delete state.decisionMap[assetId];
    api('DELETE', '/api/decisions', {
      sessionId: state.currentSession.id,
      assetId,
    }).catch(err => console.warn('Decision delete failed:', err));
  } else {
    state.decisionMap[assetId] = decision;
    api('POST', '/api/decisions', {
      sessionId: state.currentSession.id,
      assetId,
      decision,
    }).catch(err => console.warn('Decision save failed:', err));
  }

  // Flash
  if (state.lightboxOpen) {
    const flash = $('lb-flash');
    flash.className = `lb-flash ${decision}`;
    setTimeout(() => { flash.className = 'lb-flash'; }, 300);
    renderLightbox();
  }

  refreshGridItem(assetId);
}

async function recordRating(assetId, rating) {
  if (rating === 0 || rating === null) {
    delete state.ratingMap[assetId];
    api('DELETE', '/api/ratings', {
      sessionId: state.currentSession.id,
      assetId,
    }).catch(err => console.warn('Rating delete failed:', err));
  } else {
    state.ratingMap[assetId] = rating;
    api('POST', '/api/ratings', {
      sessionId: state.currentSession.id,
      assetId,
      rating,
    }).catch(err => console.warn('Rating save failed:', err));
  }

  // Flash
  if (state.lightboxOpen) {
    const flash = $('lb-flash');
    flash.className = 'lb-flash star';
    setTimeout(() => { flash.className = 'lb-flash'; }, 300);
    renderLightbox();
  }

  refreshGridItem(assetId);
}

// ── Stack mode ────────────────────────────────────────────────
function toggleStackSelection(assetId, el) {
  if (state.stackSelection.has(assetId)) {
    state.stackSelection.delete(assetId);
    el.classList.remove('stack-selected');
    el.querySelector('.grid-check').innerHTML = '';
  } else {
    state.stackSelection.add(assetId);
    el.classList.add('stack-selected');
    const check = el.querySelector('.grid-check');
    if (check) check.innerHTML = '&#10003;';
  }
  updateStackActionBar();
}

function updateStackActionBar() {
  const count = state.stackSelection.size;
  $('stack-selection-count').textContent = `${count} selected`;
  $('btn-group-stack').disabled = count < 2;
}

$('btn-group-stack').addEventListener('click', async () => {
  const assetIds = [...state.stackSelection];
  if (assetIds.length < 2) return;

  try {
    const group = await api('POST', '/api/stack-groups', {
      sessionId: state.currentSession.id,
      assetIds,
    });

    state.stackGroups.push(group);
    for (const id of group.asset_ids) {
      state.stackGroupMap[id] = group.id;
    }

    state.stackSelection.clear();
    updateStackActionBar();
    renderGrid();
  } catch (err) {
    alert(`Failed to create stack group: ${err.message}`);
  }
});

$('btn-clear-selection').addEventListener('click', () => {
  state.stackSelection.clear();
  updateStackActionBar();
  renderGrid();
});

// ── Keyboard handling ─────────────────────────────────────────
document.addEventListener('keydown', function (e) {
  if (!screens.review.classList.contains('active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (state.lightboxOpen) {
    const assetId = state.allAssets[state.lightboxIndex];

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeLightbox();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        lbNavigate(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        lbNavigate(1);
        break;
      case 'p':
      case 'P':
        if (state.mode === 'triage' || state.mode === 'rate') {
          e.preventDefault();
          recordDecision(assetId, 'pick');
          lbNavigate(1);
        }
        break;
      case 'x':
      case 'X':
        e.preventDefault();
        recordDecision(assetId, 'reject');
        lbNavigate(1);
        break;
      case '1': case '2': case '3': case '4': case '5':
        if (state.mode === 'rate') {
          e.preventDefault();
          recordRating(assetId, Number(e.key));
          lbNavigate(1);
        }
        break;
      case '0':
        if (state.mode === 'rate') {
          e.preventDefault();
          recordRating(assetId, 0);
        }
        break;
    }
  }
});

// ── Review nav ────────────────────────────────────────────────
$('back-to-home').addEventListener('click', () => {
  closeLightbox();
  showScreen('home');
  loadSessions();
});

$('go-to-summary').addEventListener('click', showSummary);

// ── SUMMARY SCREEN ────────────────────────────────────────────
function showSummary() {
  closeLightbox();

  let picks = 0, rejects = 0, undecided = 0, rated = 0;

  for (const id of state.allAssets) {
    const d = state.decisionMap[id];
    if (d === 'pick') picks++;
    else if (d === 'reject') rejects++;
    else undecided++;

    if (state.ratingMap[id]) rated++;
  }

  const stacks = state.stackGroups.length;

  $('summary-stats').innerHTML = `
    <div class="stat-box">
      <div class="stat-number pick">${picks}</div>
      <div class="stat-label">Picked</div>
    </div>
    <div class="stat-box">
      <div class="stat-number reject">${rejects}</div>
      <div class="stat-label">Rejected</div>
    </div>
    <div class="stat-box">
      <div class="stat-number neutral">${undecided}</div>
      <div class="stat-label">Undecided</div>
    </div>
    <div class="stat-box">
      <div class="stat-number star">${rated}</div>
      <div class="stat-label">Rated</div>
    </div>
    <div class="stat-box">
      <div class="stat-number stack">${stacks}</div>
      <div class="stat-label">Stacks</div>
    </div>
  `;

  $('commit-result').className = 'commit-result hidden';
  $('commit-btn').disabled = false;
  showScreen('summary');
}

$('back-to-review').addEventListener('click', () => {
  showScreen('review');
});

$('commit-btn').addEventListener('click', async () => {
  $('commit-btn').disabled = true;
  showLoading('Committing to Immich...');

  const trashRejects = $('opt-trash-rejects').checked;
  const writeRatings = $('opt-write-ratings').checked;
  const createStacks = $('opt-create-stacks').checked;

  try {
    const result = await api('POST', `/api/sessions/${state.currentSession.id}/commit`, {
      trashRejects,
      writeRatings,
      createStacks,
    });
    hideLoading();

    const el = $('commit-result');
    el.className = 'commit-result ' + (result.errors && result.errors.length ? 'error' : 'success');

    const lines = [
      `Trashed: ${result.assetsTrashed} photos`,
      `Ratings written: ${result.ratingsWritten}`,
      `Stacks created: ${result.stacksCreated}`,
    ];
    if (result.errors && result.errors.length) {
      lines.push('', 'Errors:', ...result.errors);
    }
    el.textContent = lines.join('\n');
  } catch (err) {
    hideLoading();
    const el = $('commit-result');
    el.className = 'commit-result error';
    el.textContent = `Commit failed: ${err.message}`;
    $('commit-btn').disabled = false;
  }
});

// ── Utilities ─────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Init ──────────────────────────────────────────────────────
loadSessions();
