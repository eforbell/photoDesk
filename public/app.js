// ── Profile ────────────────────────────────────────────────
(async function initProfile() {
  try {
    const res = await fetch('api/auth/me');
    if (res.status === 401) {
      window.location.href = 'login.html';
      return;
    }
    const profile = await res.json();
    const nameEl = document.getElementById('profile-name');
    if (nameEl) nameEl.textContent = profile.displayName;

    if (!profile.immichConnected) {
      document.getElementById('immich-setup-overlay').style.display = 'flex';
    }
  } catch {
    // Profile check failed - app will still work if session is valid
  }
})();

// ── Immich credential enrollment ───────────────────────────
document.getElementById('immich-setup-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('immich-setup-error');
  const okEl = document.getElementById('immich-setup-success');
  errEl.style.display = 'none';
  okEl.style.display = 'none';

  const apiKey = document.getElementById('immich-api-key').value.trim();
  if (!apiKey) return;

  const btn = e.target.querySelector('.setup-btn');
  btn.disabled = true;
  btn.textContent = 'Verifying\u2026';

  try {
    const res = await fetch('api/auth/immich-credential', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    const data = await res.json();
    if (data.ok) {
      okEl.textContent = 'Connected as ' + (data.immichUserName || 'verified') + '. Reloading\u2026';
      okEl.style.display = 'block';
      setTimeout(() => window.location.reload(), 1200);
    } else {
      errEl.textContent = data.error || 'Verification failed.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Verify & connect';
    }
  } catch {
    errEl.textContent = 'Network error. Try again.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Verify & connect';
  }
});

document.getElementById('profile-menu-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('profile-menu').classList.toggle('hidden');
});

document.addEventListener('click', () => {
  document.getElementById('profile-menu')?.classList.add('hidden');
});

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  await fetch('api/auth/logout', { method: 'POST' });
  window.location.href = 'login.html';
});

/* ── PhotoDesk frontend — multi-pass photo review ───────────── */

// ── SVG Icons ──────────────────────────────────────────────────
function icon(name, size = 16, strokeW = 1.6) {
  const a = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"`;
  const icons = {
    home:     `<svg ${a}><path d="M3 11l9-7 9 7"/><path d="M5 10v9h14v-9"/></svg>`,
    chevL:    `<svg ${a}><path d="M15 18l-6-6 6-6"/></svg>`,
    chevR:    `<svg ${a}><path d="M9 6l6 6-6 6"/></svg>`,
    x:        `<svg ${a}><path d="M18 6L6 18M6 6l12 12"/></svg>`,
    check:    `<svg ${a}><path d="M5 12l5 5L20 6"/></svg>`,
    keep:     `<svg ${a}><path d="M5 12l5 5L20 6"/></svg>`,
    reject:   `<svg ${a}><path d="M18 6L6 18M6 6l12 12"/></svg>`,
    star:     `<svg ${a}><path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6L12 16.9 6.6 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>`,
    stack:    `<svg ${a}><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>`,
    layers:   `<svg ${a}><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>`,
    crop:     `<svg ${a}><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/></svg>`,
    sliders:  `<svg ${a}><path d="M4 7h11M19 7h1M4 17h1M9 17h11"/><circle cx="17" cy="7" r="2.2"/><circle cx="7" cy="17" r="2.2"/></svg>`,
    reset:    `<svg ${a}><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"/></svg>`,
    maximize: `<svg ${a}><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,
    arrowR:   `<svg ${a}><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  };
  return icons[name] || '';
}

// ── Pass definitions ───────────────────────────────────────────
const PASSES = [
  { id: 'cull',   label: 'Review', icon: 'keep',   hint: 'Keep or reject, fast.' },
  { id: 'rate',   label: 'Rate',   icon: 'star',   hint: 'Star the survivors.' },
  { id: 'stack',  label: 'Stack',  icon: 'stack',  hint: 'Group same-shot variants.' },
  { id: 'commit', label: 'Commit', icon: 'arrowR', hint: 'Push to Immich.' },
];

// ── State ──────────────────────────────────────────────────────
const state = {
  currentSession: null,
  scenes: [],            // [{id, scene_index, asset_ids:[], assets:[{id,width,height,originalFileName,fileCreatedAt}]}]
  allAssets: [],         // flat ordered list of all assetIds
  assetMeta: {},         // assetId -> {width, height, originalFileName, fileCreatedAt}
  sceneForAsset: {},     // assetId -> scene index (0-based)

  decisionMap: {},
  ratingMap: {},
  stackGroups: [],
  stackGroupMap: {},
  editMap: {},

  mode: 'cull',          // 'cull'|'rate'|'stack'
  hideRejects: false,
  filterShow: 'all',

  // Lightbox
  lightboxOpen: false,
  lightboxIndex: 0,
  editorOpen: false,
  editorAssetId: null,
  editorTool: 'adjust',
  editorAdjustments: null,
  editorCrop: null,
  editorOriginal: null,

  // Stack mode selection
  stackSelection: new Set(),

  // Grid focus
  focusedAssetId: null,

  // Library discovery
  libraryDays: [],
  libraryYear: null,
  libraryRange: null,
  libraryDragging: false,
  immichConnected: false,
};

// ── DOM shortcuts ──────────────────────────────────────────────
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

// ── Loading overlay ────────────────────────────────────────────
function showLoading(msg = 'Loading...') {
  $('loading-msg').textContent = msg;
  $('loading-overlay').classList.remove('hidden');
}
function hideLoading() {
  $('loading-overlay').classList.add('hidden');
}

// ── Toast system ───────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
  el.innerHTML = `${icon('check', 15, 2.2)} ${escHtml(msg)}`;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.add('hidden'); toastTimer = null; }, 2400);
}

// ── API helpers ────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const error = new Error(err.error || `HTTP ${res.status}`);
    error.data = err;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── LIBRARY / DISCOVER ─────────────────────────────────────────
function thumbnailUrl(assetId) {
  return `/api/proxy/thumbnail/${encodeURIComponent(assetId)}`;
}

function editImageUrl(assetId, edit = state.editMap[assetId]) {
  if (!edit || !['ready', 'uploaded'].includes(edit.render_status)) return null;
  return `/api/edits/${state.currentSession.id}/${encodeURIComponent(assetId)}/image?v=${encodeURIComponent(edit.updated_at)}`;
}

function hasRenderedEdit(edit) {
  return Boolean(edit && ['ready', 'uploaded'].includes(edit.render_status));
}

function heatColor(day) {
  if (!day || !day.count) return 'var(--panel-2)';
  const level = day.count >= 60 ? 3 : day.count >= 30 ? 2 : day.count >= 10 ? 1 : 0;
  return day.untriaged
    ? ['oklch(0.40 0.10 256)', 'oklch(0.52 0.13 256)', 'oklch(0.62 0.15 256)', 'oklch(0.72 0.15 256)'][level]
    : ['oklch(0.30 0 0)', 'oklch(0.36 0 0)', 'oklch(0.43 0 0)', 'oklch(0.50 0 0)'][level];
}

function dateRangeLabel(from, to) {
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const first = new Date(`${from}T12:00:00Z`);
  const last = new Date(`${to}T12:00:00Z`);
  if (from === to) return first.toLocaleDateString('en-US', opts);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${first.toLocaleDateString('en-US', opts)} – ${last.getUTCDate()}`;
  }
  return `${first.toLocaleDateString('en-US', opts)} – ${last.toLocaleDateString('en-US', opts)}`;
}

function setConnectionStatus(health) {
  const pill = $('immich-status');
  state.immichConnected = health.immich === 'connected';
  pill.classList.toggle('connected', state.immichConnected);
  pill.classList.toggle('disconnected', !state.immichConnected);
  pill.querySelector('.connection-label').textContent = health.immich;
}

function renderSuggestions(suggestions) {
  const grid = $('suggestions-grid');
  const visibleSuggestions = suggestions.slice(0, 3);
  if (!visibleSuggestions.length) {
    grid.innerHTML = '<div class="library-empty">All caught up! No un-triaged batches found.</div>';
    return;
  }

  grid.innerHTML = visibleSuggestions.map((suggestion, index) => {
    const mosaicIds = suggestion.previewAssetIds.length
      ? Array.from({ length: 4 }, (_, i) => suggestion.previewAssetIds[i % suggestion.previewAssetIds.length])
      : [];
    return `
    <article class="suggestion-card">
      <div class="suggestion-mosaic">
        ${mosaicIds.map(id => `
          <span><img src="${thumbnailUrl(id)}" alt="" loading="lazy" /></span>
        `).join('')}
        ${Array.from({ length: Math.max(0, 4 - mosaicIds.length) }, () => '<span></span>').join('')}
        <div class="untriaged-pill"><i></i>Un-triaged</div>
      </div>
      <div class="suggestion-body">
        <div class="suggestion-title-row">
          <input
            class="suggestion-name"
            type="text"
            value="${escHtml(suggestion.name)}"
            aria-label="Session label for ${escHtml(suggestion.name)}"
            spellcheck="false"
          />
          <span class="mono">${escHtml(suggestion.when)}</span>
        </div>
        <div class="suggestion-meta mono">
          <span>${escHtml(dateRangeLabel(suggestion.dateFrom, suggestion.dateTo))}</span>
          <span>${suggestion.totalPhotos} photos</span>
          <span>~${suggestion.estimatedScenes} scenes</span>
        </div>
        <button class="suggestion-start" data-index="${index}" ${state.immichConnected ? '' : 'disabled'}>
          Start reviewing ${icon('arrowR', 15)}
        </button>
      </div>
    </article>
  `;
  }).join('');

  grid.querySelectorAll('.suggestion-start').forEach(button => {
    button.addEventListener('click', () => {
      const suggestion = visibleSuggestions[Number(button.dataset.index)];
      const label = button.closest('.suggestion-card').querySelector('.suggestion-name').value.trim();
      createLibrarySession({
        name: label || suggestion.name,
        dateFrom: suggestion.dateFrom,
        dateTo: suggestion.dateTo,
        sceneThreshold: 30,
        untriagedOnly: true,
      }, button);
    });
  });

  grid.querySelectorAll('.suggestion-name').forEach(input => {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.closest('.suggestion-card').querySelector('.suggestion-start').click();
      }
    });
  });
}

function renderHeatmapYearNav(days) {
  const years = PhotoDeskCalendar.yearsForDays(days);
  const select = $('heatmap-year');
  const previous = $('heatmap-prev-year');
  const next = $('heatmap-next-year');

  if (!years.length) {
    state.libraryYear = null;
    select.innerHTML = '';
    select.disabled = true;
    previous.disabled = true;
    next.disabled = true;
    $('heatmap-range').textContent = '';
    return;
  }

  if (!years.includes(state.libraryYear)) state.libraryYear = years.at(-1);
  select.innerHTML = years
    .slice()
    .reverse()
    .map(year => `<option value="${year}" ${year === state.libraryYear ? 'selected' : ''}>${year}</option>`)
    .join('');
  select.disabled = false;

  const index = years.indexOf(state.libraryYear);
  previous.disabled = index <= 0;
  next.disabled = index >= years.length - 1;
  previous.dataset.year = index > 0 ? years[index - 1] : '';
  next.dataset.year = index < years.length - 1 ? years[index + 1] : '';
  $('heatmap-range').textContent = years.length > 1
    ? `${years[0]}–${years.at(-1)} available`
    : `${years[0]} available`;
}

function renderHeatmap(days) {
  const byDate = new Map(days.map(day => [day.date, day]));
  renderHeatmapYearNav(days);
  const months = PhotoDeskCalendar.monthKeysForYear(days, state.libraryYear);
  $('heatmap').innerHTML = months.map(monthKey => {
    const [year, month] = monthKey.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const label = new Date(Date.UTC(year, month - 1, 1))
      .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<i class="heat-cell empty-offset"></i>');
    for (let dayNumber = 1; dayNumber <= lastDay; dayNumber++) {
      const key = `${monthKey}-${String(dayNumber).padStart(2, '0')}`;
      const day = byDate.get(key) || { date: key, count: 0, untriaged: false, untriagedCount: 0 };
      cells.push(`<button class="heat-cell" data-date="${key}" data-count="${day.count}" data-untriaged="${day.untriagedCount}" style="background:${heatColor(day)}" aria-label="${key}: ${day.count} photos"></button>`);
    }
    return `
      <div class="heat-month">
        <div class="heat-month-label">${label} <span class="mono">'${String(year).slice(2)}</span></div>
        <div class="heat-month-grid">${cells.join('')}</div>
      </div>
    `;
  }).join('');

  $('heatmap').querySelectorAll('.heat-cell[data-date]').forEach(cell => {
    cell.addEventListener('mousedown', event => {
      event.preventDefault();
      state.libraryDragging = true;
      state.libraryRange = { a: cell.dataset.date, b: cell.dataset.date };
      updateSelectedCells();
      loadSelectionPanel();
    });
    cell.addEventListener('mouseenter', () => {
      if (state.libraryDragging) {
        state.libraryRange.b = cell.dataset.date;
        updateSelectedCells();
      }
      showHeatTooltip(cell);
    });
    cell.addEventListener('mouseleave', hideHeatTooltip);
  });
}

function updateSelectedCells() {
  const range = state.libraryRange;
  if (!range) return;
  const lo = range.a < range.b ? range.a : range.b;
  const hi = range.a < range.b ? range.b : range.a;
  document.querySelectorAll('.heat-cell[data-date]').forEach(cell => {
    cell.classList.toggle('selected', cell.dataset.date >= lo && cell.dataset.date <= hi);
  });
}

function showHeatTooltip(cell) {
  const tip = $('heatmap-tooltip');
  const rect = cell.getBoundingClientRect();
  const count = Number(cell.dataset.count);
  const untriaged = Number(cell.dataset.untriaged);
  tip.querySelector('strong').textContent = new Date(`${cell.dataset.date}T12:00:00Z`)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  tip.querySelector('span').textContent = count
    ? `${count} photos · ${untriaged ? 'un-triaged' : 'reviewed'}`
    : 'no photos';
  tip.style.left = `${rect.left + rect.width / 2}px`;
  tip.style.top = `${rect.top - 10}px`;
  tip.classList.remove('hidden');
}

function hideHeatTooltip() {
  $('heatmap-tooltip').classList.add('hidden');
}

async function loadSelectionPanel() {
  if (!state.libraryRange) return;
  const { a, b } = state.libraryRange;
  const from = a < b ? a : b;
  const to = a < b ? b : a;
  const panel = $('selection-panel');
  panel.classList.remove('hidden');
  $('selection-label').textContent = dateRangeLabel(from, to);
  $('selection-meta').textContent = 'Loading range…';

  try {
    const summary = await api('GET', `/api/library/range?from=${from}&to=${to}`);
    if (!state.libraryRange) return;
    $('selection-meta').innerHTML = `
      <span>${summary.count} photos</span>
      <span>${summary.dayCount} ${summary.dayCount === 1 ? 'day' : 'days'}</span>
      <span class="accent-text">${summary.untriagedCount} un-triaged</span>
    `;
    $('selection-name').value = dateRangeLabel(from, to);
    $('selection-previews').innerHTML = summary.previewAssetIds.map(id => `
      <span><img src="${thumbnailUrl(id)}" alt="" /></span>
    `).join('') + (summary.count > summary.previewAssetIds.length
      ? `<span class="preview-more mono">+${summary.count - summary.previewAssetIds.length}</span>`
      : '');
    $('start-selection').disabled = !summary.count || !state.immichConnected;
    $('start-selection').dataset.from = from;
    $('start-selection').dataset.to = to;
  } catch (err) {
    $('selection-meta').textContent = err.message;
    $('start-selection').disabled = true;
  }
}

async function createLibrarySession(payload, button) {
  if (!state.immichConnected) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner button-spinner"></span> Fetching from Immich…';
  try {
    const session = await api('POST', '/api/sessions', payload);
    await openSession(session.id);
  } catch (err) {
    alert(`Failed to create session: ${err.message}`);
    button.disabled = false;
    button.innerHTML = original;
  }
}

async function loadSessions() {
  const list = $('sessions-list');
  try {
    const sessions = await api('GET', '/api/sessions');
    if (sessions.length === 0) {
      list.innerHTML = '<p class="muted">No sessions yet. Start with a suggested batch or choose dates above.</p>';
      return;
    }
    list.innerHTML = sessions.map(s => `
      <div class="recent-session" data-id="${s.id}">
        <div class="recent-icon ${s.committed ? 'committed' : 'in-progress'}">
          ${icon(s.committed ? 'check' : 'layers', 16, 1.9)}
        </div>
        <div class="recent-info">
          <div>${escHtml(s.name)}</div>
          <span class="mono">${s.total_assets} photos <i>·</i> ${s.total_scenes} scenes <i>·</i> ${fmtDate(s.created_at)}</span>
        </div>
        ${s.committed
          ? `<div class="recent-counts"><span>${s.kept_count} kept</span><span>${s.rejected_count} cut</span></div>`
          : '<button class="recent-resume">Resume →</button>'}
      </div>
    `).join('');

    list.querySelectorAll('.recent-session').forEach(card => {
      card.addEventListener('click', () => openSession(Number(card.dataset.id)));
    });
  } catch (err) {
    list.innerHTML = `<p class="muted">Error loading sessions: ${escHtml(err.message)}</p>`;
  }
}

async function loadLibrary() {
  $('library-message').classList.add('hidden');
  try {
    const health = await api('GET', '/api/health');
    setConnectionStatus(health);
  } catch (err) {
    setConnectionStatus({ immich: 'disconnected' });
    const message = $('library-message');
    message.textContent = `Immich is unavailable: ${err.message}`;
    message.classList.remove('hidden');
  }

  try {
    const [stats, density, suggestions] = await Promise.all([
      api('GET', '/api/stats'),
      api('GET', '/api/library/density'),
      api('GET', '/api/library/suggestions'),
    ]);
    $('stat-library').textContent = stats.totalLibrary.toLocaleString();
    $('stat-untriaged').textContent = stats.totalUntriaged.toLocaleString();
    $('stat-days').textContent = stats.activeDays.toLocaleString();
    state.libraryDays = density.days;
    renderSuggestions(suggestions);
    renderHeatmap(density.days);
  } catch (err) {
    $('suggestions-grid').innerHTML = `<div class="library-empty">Unable to scan the library: ${escHtml(err.message)}</div>`;
    $('heatmap').innerHTML = '<div class="library-empty">Calendar data unavailable.</div>';
  }

  await loadSessions();
}

function clearLibraryDateSelection() {
  state.libraryRange = null;
  $('selection-panel').classList.add('hidden');
  document.querySelectorAll('.heat-cell.selected').forEach(cell => cell.classList.remove('selected'));
}

function showLibraryYear(year) {
  if (!Number.isInteger(year) || year === state.libraryYear) return;
  state.libraryYear = year;
  clearLibraryDateSelection();
  renderHeatmap(state.libraryDays);
}

$('heatmap-year').addEventListener('change', function () {
  showLibraryYear(Number(this.value));
});

$('heatmap-prev-year').addEventListener('click', function () {
  showLibraryYear(Number(this.dataset.year));
});

$('heatmap-next-year').addEventListener('click', function () {
  showLibraryYear(Number(this.dataset.year));
});

window.addEventListener('mouseup', () => {
  if (state.libraryDragging) {
    state.libraryDragging = false;
    loadSelectionPanel();
  }
});

$('clear-selection').addEventListener('click', () => {
  clearLibraryDateSelection();
});

$('selection-threshold').addEventListener('input', function () {
  $('selection-threshold-value').textContent = `${this.value}s`;
});

$('start-selection').addEventListener('click', function () {
  createLibrarySession({
    name: $('selection-name').value.trim() || dateRangeLabel(this.dataset.from, this.dataset.to),
    dateFrom: this.dataset.from,
    dateTo: this.dataset.to,
    sceneThreshold: Number($('selection-threshold').value),
  }, this);
});

// ── Open a session ─────────────────────────────────────────────
async function openSession(sessionId) {
  showLoading('Loading session...');
  try {
    const scenesData = await api('GET', `/api/sessions/${sessionId}/scenes`);
    // Also fetch session info from the scenes response or separately
    const sessionData = await api('GET', `/api/sessions/${sessionId}`);

    state.currentSession = sessionData;
    state.currentSession._committed = Boolean(sessionData.committed);
    state.scenes = scenesData.scenes;
    state.decisionMap = scenesData.decisionMap || {};
    state.ratingMap = scenesData.ratingMap || {};
    state.stackGroups = scenesData.stackGroups || [];
    state.stackGroupMap = scenesData.stackGroupMap || {};
    state.editMap = scenesData.editMap || {};
    state.mode = 'cull';
    state.hideRejects = false;
    state.filterShow = 'all';
    state.lightboxOpen = false;
    state.lightboxIndex = 0;
    state.editorOpen = false;
    state.editorAssetId = null;
    state.stackSelection = new Set();
    state.focusedAssetId = null;

    // Build flat asset list, scene lookup, and asset metadata
    state.allAssets = [];
    state.sceneForAsset = {};
    state.assetMeta = {};
    for (const scene of state.scenes) {
      const assets = scene.assets || [];
      for (let i = 0; i < scene.asset_ids.length; i++) {
        const id = scene.asset_ids[i];
        const meta = assets[i] || { id, width: 0, height: 0, originalFileName: '', fileCreatedAt: '' };
        state.sceneForAsset[id] = scene.scene_index;
        state.assetMeta[id] = meta;
        state.allAssets.push(id);
      }
    }

    // Set initial focus
    if (state.allAssets.length > 0) {
      state.focusedAssetId = state.allAssets[0];
    }

    hideLoading();
    showScreen('review');

    // Sync UI controls with state
    $('filter-hide-rejects').checked = state.hideRejects;
    $('filter-show').value = state.filterShow;

    // Show session info in topbar
    $('session-name-display').textContent = state.currentSession.name;
    $('session-meta-display').textContent = `${state.allAssets.length} frames \u00B7 ${state.scenes.length} scenes`;

    setMode('cull');
    renderGrid();
  } catch (err) {
    hideLoading();
    alert(`Error loading session: ${err.message}`);
  }
}

// ── Counts for the rail ────────────────────────────────────────
function computeCounts() {
  let picks = 0, rejects = 0, rated = 0;
  const stackIds = new Set();
  for (const id of state.allAssets) {
    const d = state.decisionMap[id];
    if (d === 'pick') picks++;
    else if (d === 'reject') rejects++;
    if (state.ratingMap[id]) rated++;
    if (state.stackGroupMap[id] != null) {
      stackIds.add(state.stackGroupMap[id]);
    }
  }
  return {
    cull: picks,
    rate: rated,
    stack: stackIds.size,
    commit: rejects,
    _picks: picks,
    _rejects: rejects,
    _rated: rated,
    _stacks: stackIds.size,
    _undecided: state.allAssets.length - picks - rejects,
  };
}

// ── Progress Rail rendering ────────────────────────────────────
function renderProgressRail() {
  const rail = $('progress-rail');
  const counts = computeCounts();
  const passIdx = PASSES.findIndex(p => p.id === state.mode);
  const commitIdx = PASSES.findIndex(p => p.id === 'commit');

  let html = '';
  PASSES.forEach((p, i) => {
    const active = state.mode === p.id || (state.mode !== 'commit' && p.id === 'commit' && false);
    const isActive = p.id === state.mode;
    const done = i < passIdx;

    // Connector
    if (i > 0) {
      const filled = i <= passIdx;
      html += `<div class="rail-connector ${filled ? 'filled' : 'empty'}"></div>`;
    }

    // Step
    const cls = ['rail-step'];
    if (isActive) cls.push('active');
    if (done) cls.push('done');

    const dotIcon = done
      ? icon('check', 13, 2.2)
      : icon(p.icon, 13, 1.9);

    const count = counts[p.id];
    const countChip = count != null
      ? `<span class="rail-step-count mono">${count}</span>`
      : '';

    html += `
      <button class="${cls.join(' ')}" data-pass="${p.id}">
        <span class="rail-step-dot">${dotIcon}</span>
        <span>${p.label}</span>
        ${countChip}
      </button>
    `;
  });

  rail.innerHTML = html;

  // Attach click handlers
  rail.querySelectorAll('.rail-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const passId = btn.dataset.pass;
      if (passId === 'commit') {
        showSummary();
      } else {
        setMode(passId);
      }
    });
  });
}

// ── Pass hint strip ────────────────────────────────────────────
function renderPassHint() {
  const pass = PASSES.find(p => p.id === state.mode);
  if (!pass || state.mode === 'commit') {
    $('pass-hint').style.display = 'none';
    return;
  }
  $('pass-hint').style.display = '';
  $('pass-hint').innerHTML = `
    <span class="hint-icon">${icon(pass.icon, 13)}</span>
    <span class="hint-text">${pass.hint}</span>
  `;
}

// ── Keyboard legend ────────────────────────────────────────────
function renderKeyboardLegend() {
  const el = $('keyboard-legend');
  if (!el) return;

  // Hide during lightbox or when stack bar is showing with selection
  if (state.lightboxOpen) {
    el.style.display = 'none';
    return;
  }
  if (state.mode === 'stack' && state.stackSelection.size > 0) {
    el.style.display = 'none';
    return;
  }

  el.style.display = '';
  let items = '';

  if (state.mode === 'cull') {
    items = `
      ${legend('P', 'Keep')}${legend('X', 'Reject')}${legend('U', 'Unset')}
      ${legend('\u2190\u2192', 'Move')}${legend('\u21B5', 'Open')}${legend('E', 'Edit')}
    `;
  } else if (state.mode === 'rate') {
    items = `
      ${legend('1\u20135', 'Rate')}${legend('0', 'Clear')}${legend('X', 'Reject')}
      ${legend('\u2190\u2192', 'Move')}${legend('\u21B5', 'Open')}${legend('E', 'Edit')}
    `;
  } else if (state.mode === 'stack') {
    items = `
      ${legend('Space', 'Select')}${legend('G', 'Group')}
      ${legend('\u2190\u2192', 'Move')}${legend('\u21B5', 'Open')}
    `;
  }

  el.innerHTML = items;
}

function legend(key, label) {
  return `<span class="legend-item"><span class="kbd">${key}</span> ${label}</span>`;
}

// ── Mode management ────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;

  // Stack action bar
  if (mode === 'stack') {
    $('stack-action-bar').classList.remove('hidden');
    updateStackActionBar();
  } else {
    $('stack-action-bar').classList.add('hidden');
    state.stackSelection.clear();
  }

  // Auto-enable hide rejects in rate and stack modes
  if (mode === 'rate' || mode === 'stack') {
    state.hideRejects = true;
    $('filter-hide-rejects').checked = true;
  }

  // Close lightbox if switching to stack mode
  if (mode === 'stack' && state.lightboxOpen) {
    closeLightbox();
  }

  // Grid class for stack mode opacity
  const gridView = $('grid-view');
  gridView.classList.toggle('stack-mode', mode === 'stack');

  renderProgressRail();
  renderPassHint();
  renderKeyboardLegend();
  renderGrid();
}

// ── Filter controls ────────────────────────────────────────────
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
  gridView.classList.remove('filter-picked', 'filter-unrated', 'filter-rated', 'filter-rejects');
  if (state.filterShow !== 'all') {
    gridView.classList.add(`filter-${state.filterShow}`);
  }
}

// ── Visible asset list (respects filters) ──────────────────────
function getVisibleAssets() {
  return state.allAssets.filter(shouldShowAsset);
}

// ── GRID RENDERING ─────────────────────────────────────────────
const STACK_COLORS = ['var(--accent)','oklch(0.70 0.12 192)','oklch(0.74 0.14 70)','oklch(0.74 0.15 152)','oklch(0.64 0.18 25)','oklch(0.70 0.12 220)'];

function stackColorForGroup(groupId) {
  const idx = state.stackGroups.findIndex(sg => sg.id === groupId);
  return STACK_COLORS[idx % STACK_COLORS.length] || 'var(--accent)';
}

function renderGrid() {
  const grid = $('photo-grid');
  const fragments = [];

  let currentSceneIdx = -1;
  let sceneAssetCount = 0;
  let sceneFirstTime = '';

  // Group assets by scene first
  const sceneGroups = [];
  let curGroup = null;

  for (const assetId of state.allAssets) {
    const sceneIdx = state.sceneForAsset[assetId];
    if (!curGroup || curGroup.sceneIdx !== sceneIdx) {
      curGroup = { sceneIdx, assets: [] };
      sceneGroups.push(curGroup);
    }
    curGroup.assets.push(assetId);
  }

  for (const group of sceneGroups) {
    const sceneIdx = group.sceneIdx;
    const assetIds = group.assets;

    // Get first asset's timestamp for the scene header
    const firstAsset = state.assetMeta[assetIds[0]];
    let timeStr = '';
    if (firstAsset && firstAsset.fileCreatedAt) {
      const d = new Date(firstAsset.fileCreatedAt);
      timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    const frameCount = assetIds.length;
    const frameLabel = frameCount === 1 ? 'frame' : 'frames';

    // Scene separator
    fragments.push(`
      <div class="scene-block" data-scene="${sceneIdx}">
        <div class="scene-separator">
          <div class="scene-separator-info">
            <span class="scene-separator-label">Scene ${sceneIdx + 1}</span>
            ${timeStr ? `<span class="scene-separator-time">${timeStr}</span>` : ''}
            <span class="scene-separator-count">${frameCount} ${frameLabel}</span>
          </div>
          <div class="scene-separator-line"></div>
        </div>
        <div class="scene-tiles">
          ${assetIds.map(id => renderGridItem(id)).join('')}
        </div>
      </div>
    `);
  }

  if (sceneGroups.length === 0) {
    fragments.push('<div class="no-frames">No frames match this filter.</div>');
  }

  grid.innerHTML = fragments.join('');

  // Attach event listeners
  grid.querySelectorAll('.grid-item').forEach(el => {
    const assetId = el.dataset.assetId;

    el.addEventListener('click', () => {
      state.focusedAssetId = assetId;
      if (state.mode === 'stack') {
        toggleStackSelection(assetId, el);
      } else {
        openLightbox(assetId);
      }
    });
  });

  applyGridFilters();
  updateFocusRing();
  renderProgressRail();
  renderKeyboardLegend();
}

function renderGridItem(assetId) {
  const decision = state.decisionMap[assetId] || null;
  const rating = state.ratingMap[assetId] || null;
  const stackGroupId = state.stackGroupMap[assetId] || null;
  const isStackSelected = state.stackSelection.has(assetId);
  const isRated = rating !== null;
  const isFocused = state.focusedAssetId === assetId;
  const meta = state.assetMeta[assetId] || {};
  const edit = state.editMap[assetId] || null;

  const classes = ['grid-item'];
  if (decision === 'pick') classes.push('is-pick');
  if (decision === 'reject') classes.push('is-reject');
  if (isRated) classes.push('is-rated');
  if (stackGroupId) classes.push('in-stack-group');
  if (edit) classes.push('is-edited');
  if (isStackSelected) classes.push('stack-selected');
  if (isFocused) classes.push('is-focused');

  // Compute aspect ratio
  let aspectStyle = '';
  if (meta.width && meta.height && meta.width > 0 && meta.height > 0) {
    aspectStyle = `aspect-ratio: ${meta.width}/${meta.height};`;
  } else {
    aspectStyle = 'aspect-ratio: 3/2;';
  }

  const inlineStyle = stackGroupId
    ? `style="${aspectStyle} border-left-color: ${stackColorForGroup(stackGroupId)};"`
    : `style="${aspectStyle}"`;

  let badges = '';

  // Reject scrim
  if (decision === 'reject' && state.mode !== 'stack') {
    badges += `<div class="reject-scrim"></div>`;
  }

  if (state.mode === 'stack') {
    const checkIcon = isStackSelected ? icon('check', 13, 2.4) : '';
    badges += `<div class="grid-check">${checkIcon}</div>`;
  } else {
    if (decision === 'reject') {
      badges += `<div class="grid-badge-status reject">${icon('x', 11, 2.6)}</div>`;
    } else if (decision === 'pick') {
      badges += `<div class="grid-badge-status keep">${icon('check', 11, 2.6)}</div>`;
    }
  }

  if (rating) {
    badges += `<div class="grid-stars">${starIcons(rating, 12)}</div>`;
  }

  if (stackGroupId) {
    badges += `<div class="grid-stack-badge">${icon('stack', 9, 2.2)}${state.stackGroups.findIndex(sg => sg.id === stackGroupId) + 1}</div>`;
  }
  if (edit) {
    const failed = Boolean(edit.render_error);
    badges += `<div class="grid-edit-badge ${failed ? 'failed' : ''}" title="${failed ? 'Render failed — open editor to retry' : 'Edited version ready'}">${failed ? 'EDIT !' : 'EDIT'}</div>`;
  }

  // Hover quick actions (only in cull mode + non-stack)
  let hoverActions = '';
  if (state.mode !== 'stack') {
    let actionBtns = '';
    if (state.mode === 'cull') {
      actionBtns += `<button class="quick-btn" data-action="keep" title="Keep">${icon('keep', 14, 2.1)}</button>`;
      actionBtns += `<button class="quick-btn" data-action="reject" title="Reject">${icon('reject', 14, 2.1)}</button>`;
    }
    actionBtns += `<button class="quick-btn" data-action="edit" title="Edit">${icon('sliders', 14, 2.1)}</button>`;
    actionBtns += `<button class="quick-btn" data-action="open" title="Open">${icon('maximize', 14, 2.1)}</button>`;
    hoverActions = `<div class="grid-item-hover"><div class="grid-hover-actions">${actionBtns}</div></div>`;
  }

  return `
    <div class="${classes.join(' ')}" data-asset-id="${assetId}" data-pid="${assetId}" ${inlineStyle}>
      <img src="${editImageUrl(assetId, edit) || `/api/proxy/thumbnail/${assetId}`}" loading="lazy" alt="" ${edit && !hasRenderedEdit(edit) ? `style="filter:${PhotoDeskEditor.adjustmentFilter(edit.adjustments)}"` : ''} />
      ${badges}
      ${hoverActions}
    </div>
  `;
}

function starIcons(count, size) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="var(--star)" stroke="var(--star)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6L12 16.9 6.6 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>`;
  }
  return html;
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
    state.focusedAssetId = assetId;
    if (state.mode === 'stack') {
      toggleStackSelection(assetId, newEl);
    } else {
      openLightbox(assetId);
    }
  });

  // Re-attach hover action listeners
  attachHoverActions(newEl);

  applyGridFilters();
  renderProgressRail();
}

function attachHoverActions(el) {
  el.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const assetId = el.dataset.assetId;
      const action = btn.dataset.action;
      if (action === 'keep') recordDecision(assetId, 'pick');
      else if (action === 'reject') recordDecision(assetId, 'reject');
      else if (action === 'edit') openEditor(assetId);
      else if (action === 'open') openLightbox(assetId);
    });
  });
}

// Attach hover actions after initial render
function attachAllHoverActions() {
  document.querySelectorAll('.grid-item').forEach(attachHoverActions);
}

// ── Grid focus management ──────────────────────────────────────
function updateFocusRing() {
  // Remove old focus
  document.querySelectorAll('.grid-item.is-focused').forEach(el => el.classList.remove('is-focused'));
  // Add new focus
  if (state.focusedAssetId && !state.lightboxOpen) {
    const el = document.querySelector(`.grid-item[data-asset-id="${state.focusedAssetId}"]`);
    if (el) el.classList.add('is-focused');
  }
}

function moveFocusInGrid(delta) {
  const visible = getVisibleAssets();
  if (visible.length === 0) return;

  const curIdx = visible.indexOf(state.focusedAssetId);
  let nextIdx;
  if (curIdx === -1) {
    nextIdx = 0;
  } else {
    nextIdx = Math.max(0, Math.min(visible.length - 1, curIdx + delta));
  }

  state.focusedAssetId = visible[nextIdx];
  updateFocusRing();
  ensureFocusVisible();
}

function ensureFocusVisible() {
  if (!state.focusedAssetId) return;
  const cont = $('grid-view');
  const el = document.querySelector(`.grid-item[data-pid="${state.focusedAssetId}"]`);
  if (!cont || !el) return;

  const cr = cont.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  if (er.top < cr.top + 70) {
    cont.scrollTop -= (cr.top + 70 - er.top);
  } else if (er.bottom > cr.bottom - 20) {
    cont.scrollTop += (er.bottom - (cr.bottom - 20));
  }
}

// ── LIGHTBOX ───────────────────────────────────────────────────
function openLightbox(assetId) {
  const visible = getVisibleAssets();
  const idx = visible.indexOf(assetId);
  if (idx === -1) return;
  state.lightboxIndex = idx;
  state.lightboxOpen = true;
  state.focusedAssetId = assetId;
  $('lightbox').classList.remove('hidden');
  $('keyboard-legend').style.display = 'none';
  renderLightbox();
}

function closeLightbox() {
  if (state.editorOpen) closeEditor();
  state.lightboxOpen = false;
  $('lightbox').classList.add('hidden');
  renderKeyboardLegend();
  updateFocusRing();
  ensureFocusVisible();
}

function renderLightbox() {
  if (!state.lightboxOpen) return;

  const visible = getVisibleAssets();
  if (visible.length === 0) { closeLightbox(); return; }

  // Clamp index
  if (state.lightboxIndex >= visible.length) state.lightboxIndex = visible.length - 1;
  if (state.lightboxIndex < 0) state.lightboxIndex = 0;

  const assetId = visible[state.lightboxIndex];
  state.focusedAssetId = assetId;
  const decision = state.decisionMap[assetId] || null;
  const rating = state.ratingMap[assetId] || null;
  const meta = state.assetMeta[assetId] || {};
  const edit = state.editMap[assetId] || null;

  // Image
  const img = $('lb-image');
  img.style.opacity = '0.6';
  img.src = editImageUrl(assetId, edit) || `/api/proxy/thumbnail/${assetId}`;
  img.style.filter = edit && !hasRenderedEdit(edit)
    ? PhotoDeskEditor.adjustmentFilter(edit.adjustments)
    : '';
  img.onload = () => { img.style.opacity = '1'; };
  img.onerror = () => { img.style.opacity = '0.3'; };
  $('lb-edit-temp').style.background = edit && !hasRenderedEdit(edit)
    ? PhotoDeskEditor.temperatureOverlay(edit.adjustments)
    : '';
  $('lb-edit-temp').classList.toggle('visible', Boolean($('lb-edit-temp').style.background));
  $('lb-edit-vignette').style.background = edit && !hasRenderedEdit(edit)
    ? PhotoDeskEditor.vignetteOverlay(edit.adjustments)
    : '';
  $('lb-edit-vignette').classList.toggle('visible', Boolean($('lb-edit-vignette').style.background));
  const editedBadge = $('lb-edited-badge');
  editedBadge.textContent = edit?.render_error
    ? 'EDIT FAILED · open editor to retry'
    : 'EDITED · original kept';
  editedBadge.classList.toggle('failed', Boolean(edit?.render_error));
  editedBadge.classList.toggle('visible', Boolean(edit));

  // Filename
  $('lb-filename').textContent = meta.originalFileName || assetId.substring(0, 12);

  // Counter
  $('lb-counter').textContent = `${state.lightboxIndex + 1} / ${visible.length}`;

  // Decision badge
  const badge = $('lb-decision-badge');
  if (decision) {
    badge.className = 'lb-decision-badge ' + (decision === 'pick' ? 'pick' : 'reject');
    badge.innerHTML = `${icon(decision === 'pick' ? 'check' : 'x', 14, 2.6)} ${decision === 'pick' ? 'KEEP' : 'REJECT'}`;
  } else {
    badge.className = 'lb-decision-badge';
    badge.innerHTML = '';
  }

  // Flash cleared
  $('lb-flash').className = 'lb-flash';

  // Nav buttons
  $('lb-prev').disabled = state.lightboxIndex === 0;
  $('lb-next').disabled = state.lightboxIndex === visible.length - 1;

  // Rating row
  renderLightboxRating(rating);

  // Filmstrip
  renderFilmstrip(visible, state.lightboxIndex);

  // Keyboard hints
  renderLightboxHints();
}

function renderLightboxRating(currentRating) {
  const pill = $('lb-rating-pill');
  let html = '';
  for (let i = 1; i <= 5; i++) {
    const active = currentRating && currentRating >= i;
    html += `<button class="lb-star ${active ? 'active' : ''}" data-rating="${i}">
      <svg width="20" height="20" viewBox="0 0 24 24" ${active ? 'fill="var(--star)" stroke="var(--star)"' : 'fill="none" stroke="var(--text-ghost)"'} stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6L12 16.9 6.6 19.4l1.2-6L3.4 9.3l6-.7z"/>
      </svg>
    </button>`;
  }
  pill.innerHTML = html;

  // Attach star click handlers
  pill.querySelectorAll('.lb-star').forEach(star => {
    star.addEventListener('click', () => {
      const visible = getVisibleAssets();
      const assetId = visible[state.lightboxIndex];
      const r = Number(star.dataset.rating);
      const currentRating = state.ratingMap[assetId] || 0;
      recordRating(assetId, currentRating === r ? 0 : r);
    });
  });
}

function renderFilmstrip(visible, activeIndex) {
  const strip = $('filmstrip');
  let html = '';

  for (let i = 0; i < visible.length; i++) {
    const id = visible[i];
    const meta = state.assetMeta[id] || {};
    const decision = state.decisionMap[id] || null;
    const rating = state.ratingMap[id] || null;
    const isActive = i === activeIndex;
    const edit = state.editMap[id] || null;

    // Aspect ratio for filmstrip thumb
    let arStyle = '';
    if (meta.width && meta.height && meta.width > 0 && meta.height > 0) {
      arStyle = `aspect-ratio: ${meta.width}/${meta.height};`;
    } else {
      arStyle = 'aspect-ratio: 3/2;';
    }

    let overlays = '';
    if (decision) {
      overlays += `<div class="filmstrip-dot ${decision === 'pick' ? 'keep' : 'reject'}"></div>`;
    }
    if (rating && rating > 0) {
      overlays += `<div class="filmstrip-stars">${'\u2605'.repeat(rating)}</div>`;
    }
    if (edit) overlays += '<div class="filmstrip-edit-dot">E</div>';

    html += `
      <div class="filmstrip-thumb ${isActive ? 'active' : ''}" data-index="${i}" style="${arStyle}">
        <img src="${editImageUrl(id, edit) || `/api/proxy/thumbnail/${id}`}" loading="lazy" alt="" ${edit && !hasRenderedEdit(edit) ? `style="filter:${PhotoDeskEditor.adjustmentFilter(edit.adjustments)}"` : ''} />
        ${overlays}
      </div>
    `;
  }

  strip.innerHTML = html;

  // Attach click handlers
  strip.querySelectorAll('.filmstrip-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => {
      state.lightboxIndex = Number(thumb.dataset.index);
      renderLightbox();
    });
  });

  // Auto-center active thumbnail
  requestAnimationFrame(() => {
    const activeEl = strip.querySelector('.filmstrip-thumb.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });
}

function renderLightboxHints() {
  const hints = $('lb-hints');
  let items = '';

  if (state.mode === 'rate') {
    items = `${legend('1\u20135', 'Rate')}${legend('0', 'Clear')}${legend('X', 'Reject')}`;
  } else if (state.mode === 'cull') {
    items = `${legend('P', 'Keep')}${legend('X', 'Reject')}${legend('U', 'Unset')}`;
  }

  items += `${legend('\u2190 \u2192', 'Navigate')}${legend('\u21B5', 'Next scene')}${legend('E', 'Edit')}${legend('Esc', 'Close')}`;
  hints.innerHTML = items;
}

function shouldShowAsset(assetId) {
  if (state.hideRejects && state.decisionMap[assetId] === 'reject') return false;
  if (state.filterShow === 'picked' && state.decisionMap[assetId] !== 'pick') return false;
  if (state.filterShow === 'unrated' && state.ratingMap[assetId]) return false;
  if (state.filterShow === 'rated' && !state.ratingMap[assetId]) return false;
  if (state.filterShow === 'rejects' && state.decisionMap[assetId] !== 'reject') return false;
  return true;
}

function lbNavigate(delta) {
  const visible = getVisibleAssets();
  let next = state.lightboxIndex + delta;
  if (next >= 0 && next < visible.length) {
    state.lightboxIndex = next;
    renderLightbox();
  }
}

// Scene navigation in lightbox
function lbJumpToNextScene() {
  const visible = getVisibleAssets();
  const currentAssetId = visible[state.lightboxIndex];
  const currentScene = state.sceneForAsset[currentAssetId];

  // Find first frame of next scene
  let j = state.lightboxIndex + 1;
  while (j < visible.length && state.sceneForAsset[visible[j]] === currentScene) j++;
  if (j < visible.length) {
    state.lightboxIndex = j;
    renderLightbox();
  }
}

function lbJumpToPrevScene() {
  const visible = getVisibleAssets();
  const currentAssetId = visible[state.lightboxIndex];
  const currentScene = state.sceneForAsset[currentAssetId];

  // Go back to find a frame in a previous scene
  let j = state.lightboxIndex - 1;
  while (j >= 0 && state.sceneForAsset[visible[j]] === currentScene) j--;
  if (j < 0) { state.lightboxIndex = 0; renderLightbox(); return; }

  // Now find the first frame of that scene
  const prevScene = state.sceneForAsset[visible[j]];
  while (j > 0 && state.sceneForAsset[visible[j - 1]] === prevScene) j--;
  state.lightboxIndex = j;
  renderLightbox();
}

$('lb-prev').addEventListener('click', () => lbNavigate(-1));
$('lb-next').addEventListener('click', () => lbNavigate(1));
$('lb-close').addEventListener('click', closeLightbox);

// ── Decision / Rating recording ────────────────────────────────
async function recordDecision(assetId, decision) {
  const prev = state.decisionMap[assetId];
  if (prev === decision) {
    // Toggle off
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

// ── Stack mode ─────────────────────────────────────────────────
function toggleStackSelection(assetId, el) {
  if (state.stackSelection.has(assetId)) {
    state.stackSelection.delete(assetId);
  } else {
    state.stackSelection.add(assetId);
  }
  refreshGridItem(assetId);
  updateStackActionBar();
  renderKeyboardLegend();
}

function updateStackActionBar() {
  const count = state.stackSelection.size;
  $('stack-selection-count').innerHTML = `<b>${count}</b> selected`;
  $('btn-group-stack').disabled = count < 2;

  // Show/hide the stack bar vs legend
  if (count > 0) {
    $('stack-action-bar').classList.remove('hidden');
    $('keyboard-legend').style.display = 'none';
  } else if (state.mode === 'stack') {
    $('stack-action-bar').classList.remove('hidden');
    $('keyboard-legend').style.display = '';
  }
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

    const groupNum = state.stackGroups.length;
    showToast(`Grouped ${assetIds.length} frames into stack ${groupNum}`);

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

// ── EDITOR ─────────────────────────────────────────────────────
const EDITOR_SLIDER_GROUPS = [
  {
    label: 'Light',
    controls: [
      ['exposure', 'Exposure'],
      ['contrast', 'Contrast'],
      ['highlights', 'Highlights'],
      ['shadows', 'Shadows'],
    ],
  },
  {
    label: 'Color',
    controls: [
      ['temp', 'Temp'],
      ['saturation', 'Saturation'],
      ['vibrance', 'Vibrance'],
    ],
  },
  { label: 'Effects', controls: [['vignette', 'Vignette', 0]] },
];

function currentEditorEdit() {
  return state.editMap[state.editorAssetId] || null;
}

function editorDraftValue() {
  return {
    adjustments: PhotoDeskEditor.normalizeAdjustments(state.editorAdjustments),
    crop: state.editorCrop,
  };
}

function editorDirty() {
  return JSON.stringify(editorDraftValue()) !== JSON.stringify(state.editorOriginal);
}

function openEditor(assetId) {
  if (!state.currentSession || !state.assetMeta[assetId]) return;
  const edit = state.editMap[assetId];
  const meta = state.assetMeta[assetId];
  state.editorOpen = true;
  state.editorAssetId = assetId;
  state.editorTool = 'adjust';
  state.editorAdjustments = PhotoDeskEditor.normalizeAdjustments(edit?.adjustments);
  state.editorCrop = edit?.crop || PhotoDeskEditor.cropForAspect(meta, 'Original');
  const matchedPreset = PhotoDeskEditor.matchingPreset(state.editorAdjustments);
  state.editorPresetId = matchedPreset?.id || null;
  state.editorPresetIntensity = 100;
  state.editorCropDrag = null;
  state.editorOriginal = editorDraftValue();
  $('editor').classList.remove('hidden');
  $('keyboard-legend').style.display = 'none';
  renderEditor();
}

function closeEditor() {
  endEditorCropDrag();
  state.editorOpen = false;
  state.editorAssetId = null;
  $('editor').classList.add('hidden');
  if (state.lightboxOpen) {
    renderLightbox();
  } else {
    renderKeyboardLegend();
    updateFocusRing();
  }
}

function editorSourceAspectRatio() {
  const meta = state.assetMeta[state.editorAssetId] || {};
  return PhotoDeskEditor.ratioValue(
    'Original',
    meta.width,
    meta.height
  );
}

function editorPreviewAspectRatio() {
  if (state.editorTool === 'crop') return editorSourceAspectRatio();
  return PhotoDeskEditor.cropDisplayAspect(
    state.editorCrop,
    state.assetMeta[state.editorAssetId]
  );
}

function updateEditorFrameSize() {
  if (!state.editorOpen) return;
  const stage = $('editor-image-frame').parentElement;
  const style = getComputedStyle(stage);
  const availableWidth = stage.clientWidth
    - parseFloat(style.paddingLeft)
    - parseFloat(style.paddingRight);
  const availableHeight = stage.clientHeight
    - parseFloat(style.paddingTop)
    - parseFloat(style.paddingBottom);
  const size = PhotoDeskEditor.containSize(
    availableWidth,
    availableHeight,
    editorPreviewAspectRatio(),
    1100
  );
  const frame = $('editor-image-frame');
  frame.style.width = `${size.width}px`;
  frame.style.height = `${size.height}px`;
}

function updateEditorCropOverlay() {
  const overlay = $('editor-crop-window');
  const crop = state.editorCrop || { x: 0, y: 0, width: 1, height: 1 };
  overlay.style.left = `${crop.x * 100}%`;
  overlay.style.top = `${crop.y * 100}%`;
  overlay.style.width = `${crop.width * 100}%`;
  overlay.style.height = `${crop.height * 100}%`;
  overlay.classList.toggle('hidden', state.editorTool !== 'crop');
  overlay.classList.toggle('is-active', Boolean(state.editorCropDrag));
  overlay.classList.toggle('is-free', crop.aspect === 'Free');
}

function histogramSvg(seed, exposure) {
  let value = 0;
  for (const char of String(seed)) value += char.charCodeAt(0);
  const points = [];
  for (let i = 0; i < 48; i++) {
    const x = i / 47;
    const wave = (Math.sin(x * 6 + value) + Math.sin(x * 13 + value * 0.7)) / 4 + 0.5;
    const bell = Math.exp(-Math.pow((x - 0.5) * 2.4, 2)) * 0.55;
    points.push(Math.max(0.04, wave * 0.55 + bell));
  }
  const shift = Number(exposure || 0) / 100 * 22;
  const path = points.map((point, index) => {
    const x = index / 47 * 240 + shift;
    const y = 56 - point * 51;
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 240 56" preserveAspectRatio="none" aria-hidden="true">
    <path d="${path} L${(240 + shift).toFixed(1)} 56 L0 56 Z" fill="oklch(0.85 0 0 / 0.32)"></path>
    <path d="${path}" fill="none" stroke="oklch(0.66 0.15 256 / 0.6)" stroke-width="1"></path>
  </svg>`;
}

function updateEditorPreview() {
  const adjustments = state.editorAdjustments;
  const frame = $('editor-image-frame');
  const sourceImage = $('editor-image');
  const croppedImage = $('editor-cropped-image');
  const filter = PhotoDeskEditor.adjustmentFilter(adjustments);
  sourceImage.style.filter = filter;
  croppedImage.style.filter = filter;
  $('editor-temp-overlay').style.background = PhotoDeskEditor.temperatureOverlay(adjustments);
  $('editor-vignette-overlay').style.background = PhotoDeskEditor.vignetteOverlay(adjustments);
  frame.style.aspectRatio = editorPreviewAspectRatio();
  updateEditorFrameSize();
  const showingCrop = state.editorTool === 'crop';
  sourceImage.classList.toggle('hidden', !showingCrop);
  croppedImage.classList.toggle('hidden', showingCrop);
  if (!showingCrop) {
    const background = PhotoDeskEditor.cropBackground(state.editorCrop);
    croppedImage.style.backgroundImage = `url("${sourceImage.src}")`;
    croppedImage.style.backgroundSize = background.backgroundSize;
    croppedImage.style.backgroundPosition = background.backgroundPosition;
  }
  updateEditorCropOverlay();
  $('editor-histogram').innerHTML = histogramSvg(
    state.editorAssetId,
    adjustments.exposure
  );
  const dirty = editorDirty();
  $('editor-save').textContent = dirty
    ? (PhotoDeskEditor.isNeutralEdit(adjustments, state.editorCrop) ? 'Remove edit' : 'Save edit')
    : 'Done';
  $('editor-save').disabled = false;
  $('editor-save').classList.toggle('is-dirty', dirty);
  $('editor-reset').disabled = PhotoDeskEditor.isNeutralEdit(adjustments, state.editorCrop);
}

function endEditorCropDrag(pointerId) {
  const cropWindow = $('editor-crop-window');
  const hadDrag = Boolean(state.editorCropDrag);
  state.editorCropDrag = null;
  if (pointerId != null && cropWindow.hasPointerCapture?.(pointerId)) {
    cropWindow.releasePointerCapture(pointerId);
  }
  cropWindow.classList.remove('is-active');
  if (hadDrag && state.editorOpen && state.editorTool === 'crop') {
    renderEditorCropControls();
    updateEditorSaveState();
  }
}

function beginEditorCropDrag(event) {
  if (state.editorTool !== 'crop' || event.button > 0) return;
  event.preventDefault();
  const cropWindow = $('editor-crop-window');
  const frame = $('editor-image-frame');
  const rect = frame.getBoundingClientRect();
  const handle = event.target.closest('[data-crop-handle]')?.dataset.cropHandle || 'move';
  state.editorCropDrag = {
    pointerId: event.pointerId,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    crop: { ...state.editorCrop },
    frameWidth: rect.width,
    frameHeight: rect.height,
  };
  cropWindow.setPointerCapture?.(event.pointerId);
  updateEditorCropOverlay();
}

function moveEditorCropDrag(event) {
  const drag = state.editorCropDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const meta = state.assetMeta[state.editorAssetId] || {};
  state.editorCrop = PhotoDeskEditor.transformCrop(drag.crop, {
    handle: drag.handle,
    deltaX: event.clientX - drag.startX,
    deltaY: event.clientY - drag.startY,
    frameWidth: drag.frameWidth,
    frameHeight: drag.frameHeight,
    aspect: drag.crop.aspect,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
  });
  updateEditorCropOverlay();
  updateEditorSaveState();
}

function updateEditorSaveState() {
  const dirty = editorDirty();
  $('editor-save').textContent = dirty
    ? (PhotoDeskEditor.isNeutralEdit(state.editorAdjustments, state.editorCrop) ? 'Remove edit' : 'Save edit')
    : 'Done';
  $('editor-save').disabled = false;
  $('editor-save').classList.toggle('is-dirty', dirty);
  $('editor-reset').disabled = PhotoDeskEditor.isNeutralEdit(
    state.editorAdjustments,
    state.editorCrop
  );
}

function renderEditorRating() {
  const current = state.ratingMap[state.editorAssetId] || 0;
  $('editor-rating-stars').innerHTML = Array.from({ length: 5 }, (_, index) => {
    const value = index + 1;
    return `<button class="editor-star ${current >= value ? 'active' : ''}" data-rating="${value}" aria-label="${value} stars">
      ${icon('star', 18, 1.4)}
    </button>`;
  }).join('');
  $('editor-rating-stars').querySelectorAll('.editor-star').forEach(button => {
    button.addEventListener('click', () => {
      const value = Number(button.dataset.rating);
      recordRating(state.editorAssetId, current === value ? 0 : value);
      renderEditorRating();
    });
  });
}

function renderEditorAdjustControls() {
  const source = `/api/proxy/thumbnail/${state.editorAssetId}`;
  const selectedPreset = PhotoDeskEditor.PRESETS.find(
    preset => preset.id === state.editorPresetId
  );
  const profileGroups = PhotoDeskEditor.PROFILE_GROUPS.map(group => `
    <section class="editor-profile-group">
      <div class="editor-profile-group-label">${group}</div>
      <div class="editor-profile-grid">
        ${PhotoDeskEditor.PRESETS.filter(preset => preset.group === group).map(preset => {
          const adjustments = PhotoDeskEditor.normalizeAdjustments(preset.adj);
          return `<button class="editor-profile ${state.editorPresetId === preset.id ? 'active' : ''}" data-preset="${preset.id}">
            <span class="editor-profile-preview">
              <img src="${source}" alt="" style="filter:${PhotoDeskEditor.adjustmentFilter(adjustments)}" />
              <span class="editor-profile-temp" style="background:${PhotoDeskEditor.temperatureOverlay(adjustments)}"></span>
              <span class="editor-profile-vignette" style="background:${PhotoDeskEditor.vignetteOverlay(adjustments)}"></span>
            </span>
            <span class="editor-profile-name">${preset.name}</span>
          </button>`;
        }).join('')}
      </div>
    </section>
  `).join('');
  const presetBase = selectedPreset
    ? PhotoDeskEditor.scaleAdjustments(selectedPreset.adj, state.editorPresetIntensity)
    : null;
  const custom = !presetBase
    || !PhotoDeskEditor.adjustmentsEqual(state.editorAdjustments, presetBase);
  const groups = EDITOR_SLIDER_GROUPS.map(group => `
    <section class="editor-control-group">
      <div class="editor-eyebrow">${group.label}</div>
      ${group.controls.map(([key, label, min = -100]) => {
        const value = state.editorAdjustments[key];
        return `<label class="editor-slider" data-adjustment="${key}">
          <span class="editor-slider-label" title="Double-click to reset">${label}</span>
          <span class="editor-slider-value mono">${value > 0 ? '+' : ''}${value}</span>
          <input type="range" min="${min}" max="100" value="${value}" />
        </label>`;
      }).join('')}
    </section>
  `).join('');
  $('editor-controls').innerHTML = `
    <section class="editor-profiles">
      <div class="editor-profile-head">
        <div class="editor-eyebrow">Profiles</div>
        ${custom ? '<span class="editor-custom-tag">Custom</span>' : ''}
      </div>
      ${profileGroups}
    </section>
    ${selectedPreset && selectedPreset.id !== 'original' ? `
      <label class="editor-intensity">
        <span>Intensity</span>
        <span class="editor-intensity-value mono">${state.editorPresetIntensity}%</span>
        <input type="range" min="0" max="100" value="${state.editorPresetIntensity}" />
      </label>
    ` : ''}
    ${groups}
  `;

  $('editor-controls').querySelectorAll('.editor-profile').forEach(button => {
    button.addEventListener('click', () => {
      const preset = PhotoDeskEditor.PRESETS.find(item => item.id === button.dataset.preset);
      state.editorPresetId = preset.id;
      state.editorPresetIntensity = 100;
      state.editorAdjustments = PhotoDeskEditor.scaleAdjustments(preset.adj, 100);
      renderEditorControls();
      updateEditorPreview();
    });
  });
  const intensity = $('editor-controls').querySelector('.editor-intensity input');
  intensity?.addEventListener('input', () => {
    const preset = PhotoDeskEditor.PRESETS.find(item => item.id === state.editorPresetId);
    state.editorPresetIntensity = Number(intensity.value);
    state.editorAdjustments = PhotoDeskEditor.scaleAdjustments(
      preset.adj,
      state.editorPresetIntensity
    );
    $('editor-controls').querySelector('.editor-intensity-value').textContent =
      `${state.editorPresetIntensity}%`;
    $('editor-controls').querySelectorAll('.editor-slider').forEach(label => {
      const key = label.dataset.adjustment;
      const input = label.querySelector('input');
      const value = state.editorAdjustments[key];
      input.value = value;
      label.querySelector('.editor-slider-value').textContent =
        `${value > 0 ? '+' : ''}${value}`;
    });
    updateEditorCustomTag();
    updateEditorPreview();
  });
  $('editor-controls').querySelectorAll('.editor-slider').forEach(label => {
    const key = label.dataset.adjustment;
    const input = label.querySelector('input');
    const value = label.querySelector('.editor-slider-value');
    input.addEventListener('input', () => {
      state.editorAdjustments[key] = Number(input.value);
      value.textContent = `${input.value > 0 ? '+' : ''}${input.value}`;
      updateEditorCustomTag();
      updateEditorPreview();
    });
    label.querySelector('.editor-slider-label').addEventListener('dblclick', () => {
      state.editorAdjustments[key] = 0;
      input.value = 0;
      value.textContent = '0';
      updateEditorCustomTag();
      updateEditorPreview();
    });
  });
}

function updateEditorCustomTag() {
  const head = $('editor-controls').querySelector('.editor-profile-head');
  if (!head) return;
  const preset = PhotoDeskEditor.PRESETS.find(item => item.id === state.editorPresetId);
  const expected = preset
    ? PhotoDeskEditor.scaleAdjustments(preset.adj, state.editorPresetIntensity)
    : null;
  const custom = !expected
    || !PhotoDeskEditor.adjustmentsEqual(state.editorAdjustments, expected);
  const tag = head.querySelector('.editor-custom-tag');
  if (custom && !tag) {
    head.insertAdjacentHTML('beforeend', '<span class="editor-custom-tag">Custom</span>');
  } else if (!custom) {
    tag?.remove();
  }
}

function renderEditorCropControls() {
  const meta = state.assetMeta[state.editorAssetId] || {};
  const aspects = state.editorCrop.aspect === '9:16'
    ? [...PhotoDeskEditor.CROP_ASPECTS, '9:16']
    : PhotoDeskEditor.CROP_ASPECTS;
  $('editor-controls').innerHTML = `
    <section class="editor-crop-controls">
      <div class="editor-crop-head">
        <div class="editor-eyebrow">Aspect ratio</div>
        <button class="editor-flip" ${state.editorCrop.aspect.includes(':') ? '' : 'disabled'}>
          ${icon('reset', 13)} Flip
        </button>
      </div>
      <div class="editor-aspect-grid">
        ${aspects.map(aspect => `
          <button class="editor-aspect ${state.editorCrop.aspect === aspect ? 'active' : ''}" data-aspect="${aspect}">
            ${aspect}
          </button>
        `).join('')}
      </div>
      <div class="editor-crop-readout">
        <div class="editor-eyebrow">Crop region</div>
        <div class="mono">
          <span>x <b>${state.editorCrop.x.toFixed(3)}</b></span>
          <span>y <b>${state.editorCrop.y.toFixed(3)}</b></span>
          <span>w <b>${state.editorCrop.width.toFixed(3)}</b></span>
          <span>h <b>${state.editorCrop.height.toFixed(3)}</b></span>
        </div>
        <small class="mono">≈ ${Math.round(state.editorCrop.width * (meta.width || 0))} × ${Math.round(state.editorCrop.height * (meta.height || 0))} px</small>
      </div>
      <p>Drag to reposition; pull a corner to resize. Free unlocks edge handles. The original remains untouched.</p>
      <button class="editor-apply-crop">${icon('check', 15, 2.2)} Apply crop &amp; adjust ${icon('arrowR', 15)}</button>
    </section>
  `;
  $('editor-controls').querySelectorAll('.editor-aspect').forEach(button => {
    button.addEventListener('click', () => {
      state.editorCrop = PhotoDeskEditor.refitCrop(
        state.editorCrop,
        meta,
        button.dataset.aspect
      );
      renderEditorCropControls();
      updateEditorPreview();
    });
  });
  $('editor-controls').querySelector('.editor-flip').addEventListener('click', () => {
    const flipped = PhotoDeskEditor.flipAspect(state.editorCrop.aspect);
    state.editorCrop = PhotoDeskEditor.refitCrop(state.editorCrop, meta, flipped);
    renderEditorCropControls();
    updateEditorPreview();
  });
  $('editor-controls').querySelector('.editor-apply-crop').addEventListener('click', () => {
    setEditorTool('adjust');
  });
}

function setEditorTool(tool) {
  endEditorCropDrag();
  state.editorTool = tool;
  renderEditor();
}

function renderEditorControls() {
  if (state.editorTool === 'crop') renderEditorCropControls();
  else renderEditorAdjustControls();
}

function renderEditor() {
  const assetId = state.editorAssetId;
  const meta = state.assetMeta[assetId] || {};
  $('editor-filename').textContent = meta.originalFileName || assetId.substring(0, 12);
  const editorImage = $('editor-image');
  editorImage.onload = () => {
    if (!(meta.width > 0 && meta.height > 0)) {
      meta.width = editorImage.naturalWidth;
      meta.height = editorImage.naturalHeight;
      state.editorCrop = PhotoDeskEditor.cropForAspect(
        meta,
        state.editorCrop?.aspect || 'Original'
      );
      renderEditorControls();
    }
    updateEditorPreview();
  };
  editorImage.src = `/api/proxy/thumbnail/${assetId}`;
  document.querySelectorAll('.editor-tool').forEach(button => {
    button.classList.toggle('active', button.dataset.editorTool === state.editorTool);
  });
  renderEditorControls();
  renderEditorRating();
  updateEditorPreview();
}

async function saveEditor() {
  if (!editorDirty()) {
    closeEditor();
    return;
  }

  const button = $('editor-save');
  button.disabled = true;
  button.textContent = 'Rendering…';
  try {
    if (PhotoDeskEditor.isNeutralEdit(state.editorAdjustments, state.editorCrop)) {
      await api('DELETE', '/api/edits', {
        sessionId: state.currentSession.id,
        assetId: state.editorAssetId,
      });
      delete state.editMap[state.editorAssetId];
      showToast('Edit removed · original unchanged');
    } else {
      const edit = await api('POST', '/api/edits', {
        sessionId: state.currentSession.id,
        assetId: state.editorAssetId,
        adjustments: state.editorAdjustments,
        crop: state.editorCrop,
      });
      state.editMap[state.editorAssetId] = edit;
      showToast('Edit saved locally · original preserved');
    }
    refreshGridItem(state.editorAssetId);
    closeEditor();
  } catch (err) {
    if (err.data?.edit) {
      state.editMap[state.editorAssetId] = err.data.edit;
      refreshGridItem(state.editorAssetId);
    }
    button.disabled = false;
    updateEditorPreview();
    alert(`Failed to save edit: ${err.message}`);
  }
}

$('lb-edit').addEventListener('click', () => {
  const visible = getVisibleAssets();
  openEditor(visible[state.lightboxIndex]);
});
$('editor-close').addEventListener('click', closeEditor);
$('editor-cancel').addEventListener('click', closeEditor);
$('editor-save').addEventListener('click', saveEditor);
$('editor-reset').addEventListener('click', () => {
  state.editorAdjustments = PhotoDeskEditor.normalizeAdjustments();
  state.editorCrop = PhotoDeskEditor.cropForAspect(
    state.assetMeta[state.editorAssetId],
    'Original'
  );
  renderEditor();
});
document.querySelectorAll('.editor-tool').forEach(button => {
  button.addEventListener('click', () => {
    setEditorTool(button.dataset.editorTool);
  });
});
$('editor-crop-window').addEventListener('pointerdown', beginEditorCropDrag);
$('editor-crop-window').addEventListener('pointermove', moveEditorCropDrag);
$('editor-crop-window').addEventListener('pointerup', event => endEditorCropDrag(event.pointerId));
$('editor-crop-window').addEventListener('pointercancel', event => endEditorCropDrag(event.pointerId));
$('editor-crop-window').addEventListener('lostpointercapture', () => endEditorCropDrag());
new ResizeObserver(() => {
  if (state.editorOpen) updateEditorFrameSize();
}).observe(document.querySelector('.editor-stage'));

// ── Keyboard handling ──────────────────────────────────────────
document.addEventListener('keydown', function (e) {
  if (!screens.review.classList.contains('active')) return;
  if (state.editorOpen) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
    }
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (state.lightboxOpen) {
    const visible = getVisibleAssets();
    const assetId = visible[state.lightboxIndex];

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
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey) {
          lbJumpToPrevScene();
        } else {
          lbJumpToNextScene();
        }
        break;
      case 'e':
      case 'E':
        e.preventDefault();
        openEditor(assetId);
        break;
      case 'p':
      case 'P':
        if (state.mode === 'cull' || state.mode === 'rate') {
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
      case 'u':
      case 'U':
        if (state.mode === 'cull') {
          e.preventDefault();
          // Unset = remove decision
          delete state.decisionMap[assetId];
          api('DELETE', '/api/decisions', {
            sessionId: state.currentSession.id,
            assetId,
          }).catch(() => {});
          renderLightbox();
          refreshGridItem(assetId);
        }
        break;
      case '1': case '2': case '3': case '4': case '5':
        e.preventDefault();
        recordRating(assetId, Number(e.key));
        lbNavigate(1);
        break;
      case '0':
        e.preventDefault();
        recordRating(assetId, 0);
        break;
    }
    return;
  }

  // Grid keyboard navigation
  const k = e.key;

  if (k === 'ArrowRight' || k === 'ArrowDown') {
    e.preventDefault();
    moveFocusInGrid(1);
    return;
  }
  if (k === 'ArrowLeft' || k === 'ArrowUp') {
    e.preventDefault();
    moveFocusInGrid(-1);
    return;
  }

  if (!state.focusedAssetId) return;
  const focusedId = state.focusedAssetId;

  if (k === 'Enter' || k === 'o' || k === 'O') {
    e.preventDefault();
    openLightbox(focusedId);
    return;
  }
  if (k === 'e' || k === 'E') {
    e.preventDefault();
    openEditor(focusedId);
    return;
  }

  if (k >= '1' && k <= '5') {
    e.preventDefault();
    recordRating(focusedId, Number(k));
    return;
  }
  if (k === '0') {
    e.preventDefault();
    recordRating(focusedId, 0);
    return;
  }

  if (state.mode === 'stack') {
    if (k === ' ') {
      e.preventDefault();
      const el = document.querySelector(`.grid-item[data-asset-id="${focusedId}"]`);
      if (el) toggleStackSelection(focusedId, el);
    } else if (k === 'g' || k === 'G') {
      e.preventDefault();
      $('btn-group-stack').click();
    }
    return;
  }

  if (state.mode === 'rate') {
    if (k === 'x' || k === 'X') { e.preventDefault(); recordDecision(focusedId, 'reject'); return; }
    return;
  }

  // Cull mode
  if (k === 'p' || k === 'P') { e.preventDefault(); recordDecision(focusedId, 'pick'); }
  else if (k === 'x' || k === 'X') { e.preventDefault(); recordDecision(focusedId, 'reject'); }
  else if (k === 'u' || k === 'U') {
    e.preventDefault();
    delete state.decisionMap[focusedId];
    api('DELETE', '/api/decisions', {
      sessionId: state.currentSession.id,
      assetId: focusedId,
    }).catch(() => {});
    refreshGridItem(focusedId);
    renderProgressRail();
  }
});

// ── Review nav ─────────────────────────────────────────────────
$('back-to-home').addEventListener('click', () => {
  closeLightbox();
  showScreen('home');
  loadLibrary();
});

// ── SUMMARY SCREEN ─────────────────────────────────────────────
function showSummary() {
  closeLightbox();

  const counts = computeCounts();
  const edited = Object.values(state.editMap).filter(edit => (
    ['ready', 'uploaded'].includes(edit.render_status)
  ));
  const pendingEdits = edited.filter(edit => edit.render_status !== 'uploaded');

  // Eyebrow
  $('summary-eyebrow').textContent = state.currentSession.name;

  // Stat tiles
  const stats = [
    { n: counts._picks, l: 'Kept', c: 'var(--keep)' },
    { n: counts._rejects, l: 'Rejected', c: 'var(--reject)' },
    { n: counts._undecided, l: 'Undecided', c: 'var(--text-dim)' },
    { n: counts._rated, l: 'Rated', c: 'var(--star)' },
    { n: counts._stacks, l: 'Stacks', c: 'var(--accent-text)' },
    { n: edited.length, l: 'Edited', c: 'var(--accent-text)' },
  ];

  $('summary-stats').innerHTML = stats.map(s => `
    <div class="stat-tile">
      <div class="stat-tile-number mono" style="color: ${s.c}">${s.n}</div>
      <div class="stat-tile-label">${s.l}</div>
    </div>
  `).join('');

  // Commit row sub-details
  $('opt-trash-sub').textContent = `${counts._rejects} photos \u2192 Immich trash (recoverable)`;
  $('opt-ratings-sub').textContent = `${counts._rated} ratings to asset metadata`;
  $('opt-stacks-sub').textContent = `${counts._stacks} manual groups, best frame as primary`;
  $('opt-edits-sub').textContent = pendingEdits.length > 0
    ? `${pendingEdits.length} new ${pendingEdits.length === 1 ? 'asset' : 'assets'}, stacked over originals`
    : edited.length > 0
      ? `${edited.length} edited ${edited.length === 1 ? 'version' : 'versions'} already uploaded`
      : 'No saved edits ready to upload';
  $('opt-upload-edits').checked = pendingEdits.length > 0;
  $('opt-upload-edits').disabled = edited.length === 0;
  $('opt-upload-edits-row').classList.toggle('disabled', edited.length === 0);

  // Reset commit state
  $('commit-log').innerHTML = '';
  $('commit-confirmation').classList.add('hidden');
  $('summary-actions').classList.remove('hidden');
  if (state.currentSession._committed) {
    $('commit-options').style.display = 'none';
    $('commit-btn').disabled = false;
    $('commit-btn').innerHTML = `Done`;
    $('commit-btn').onclick = () => { showScreen('home'); loadLibrary(); };
    $('commit-log').innerHTML = `<div class="commit-log-inner"><div class="commit-log-done">Already committed. Immich is up to date.</div></div>`;
  } else {
    $('commit-options').style.display = '';
    $('commit-btn').disabled = false;
    $('commit-btn').innerHTML = `Commit to Immich ${icon('arrowR', 15)}`;
    $('commit-btn').onclick = null;
  }

  showScreen('summary');
}

$('back-to-review').addEventListener('click', () => {
  $('commit-confirmation').classList.add('hidden');
  showScreen('review');
});

function selectedCommitOptions() {
  return {
    trashRejects: $('opt-trash-rejects').checked,
    writeRatings: $('opt-write-ratings').checked,
    createStacks: $('opt-create-stacks').checked,
    uploadEdits: $('opt-upload-edits').checked,
  };
}

let pendingCommitOptions = null;
let commitRequestInFlight = false;

function setCommitOptionControlsDisabled(disabled) {
  $('opt-trash-rejects').disabled = disabled;
  $('opt-write-ratings').disabled = disabled;
  $('opt-create-stacks').disabled = disabled;
  const hasEdits = Object.values(state.editMap).some(edit => (
    ['ready', 'uploaded'].includes(edit.render_status)
  ));
  $('opt-upload-edits').disabled = disabled || !hasEdits;
}

function closeCommitConfirmation() {
  if (commitRequestInFlight) return;
  pendingCommitOptions = null;
  $('commit-confirmation').classList.add('hidden');
  $('summary-actions').classList.remove('hidden');
  setCommitOptionControlsDisabled(false);
  $('commit-btn').disabled = false;
  $('commit-btn').innerHTML = `Commit to Immich ${icon('arrowR', 15)}`;
}

function showCommitConfirmation(preview, options) {
  pendingCommitOptions = { ...options };
  setCommitOptionControlsDisabled(true);
  const selectedSteps = preview.steps.filter(step => step.selected);
  $('commit-confirm-steps').innerHTML = selectedSteps.length
    ? selectedSteps.map(step => {
      const pending = `${step.pending} pending`;
      const applied = step.alreadyApplied > 0
        ? ` · ${step.alreadyApplied} already applied`
        : '';
      return `
        <div class="commit-confirm-step">
          <span>${escHtml(step.label)}</span>
          <strong>${escHtml(pending + applied)}</strong>
        </div>
      `;
    }).join('')
    : `
      <div class="commit-confirm-step">
        <span>Immich changes</span>
        <strong>None selected</strong>
      </div>
    `;
  const warning = $('commit-confirm-warning');
  warning.textContent = preview.warnings.join(' ');
  warning.classList.toggle('hidden', preview.warnings.length === 0);
  $('commit-confirm-note').textContent = preview.pendingActions > 0
    ? 'PhotoDesk records each successful action. If a later action fails, Retry sends only unfinished work.'
    : 'No new Immich operations are pending. Confirming will mark this review session processed.';
  if (preview.steps.some(step => step.id === 'edits' && step.selected && step.recheckedAtCommit)) {
    $('commit-confirm-note').textContent += ' Uploaded edits are rechecked against Immich when the commit starts.';
  }
  $('commit-confirm-apply').textContent = preview.pendingActions > 0
    ? `Confirm ${preview.pendingActions} ${preview.pendingActions === 1 ? 'action' : 'actions'}`
    : 'Mark reviewed';
  $('commit-confirmation').classList.remove('hidden');
  $('summary-actions').classList.add('hidden');
  $('commit-confirm-apply').focus();
}

async function executeCommit(options) {
  if (commitRequestInFlight) return;
  commitRequestInFlight = true;
  $('commit-confirm-apply').disabled = true;
  $('commit-confirm-cancel').disabled = true;
  pendingCommitOptions = null;
  $('commit-confirmation').classList.add('hidden');
  $('summary-actions').classList.remove('hidden');
  $('commit-btn').disabled = true;
  $('commit-btn').innerHTML = `<span class="spinner" style="width:15px;height:15px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span> Committing\u2026`;

  const logEl = $('commit-log');
  logEl.innerHTML = '<div class="commit-log" id="commit-log-inner"></div>';
  const logInner = $('commit-log-inner');

  // Hide options
  $('commit-options').style.display = 'none';

  function addLogLine(msg) {
    logInner.innerHTML += `<div class="commit-log-line">${icon('check', 14, 2.4)} ${escHtml(msg)}</div>`;
  }

  try {
    const result = await api('POST', `/api/sessions/${state.currentSession.id}/commit`, {
      ...options,
    });

    for (const action of result.steps || []) {
      if (!action.selected) continue;
      if (action.succeeded > 0) {
        addLogLine(`${action.label}: ${action.succeeded} completed`);
      }
      if (action.alreadyApplied > 0) {
        logInner.innerHTML += `<div class="commit-log-line skipped">${icon('check', 14, 2)} ${escHtml(action.label)}: ${action.alreadyApplied} already applied, skipped</div>`;
      }
      for (const error of action.errors || []) {
        logInner.innerHTML += `<div class="commit-log-line failed">${icon('x', 14, 2.4)} ${escHtml(error)}</div>`;
      }
    }
    if (result.steps?.every(action => !action.selected || (
      action.succeeded === 0 && action.alreadyApplied === 0 && action.errors.length === 0
    ))) {
      addLogLine('No Immich changes selected');
    }

    if (result.committed) {
      logInner.innerHTML += `<div class="commit-log-done">Done. Immich is up to date.</div>`;
      $('commit-options').style.display = 'none';
      state.currentSession._committed = true;
      $('commit-btn').disabled = false;
      $('commit-btn').innerHTML = `Done`;
      $('commit-btn').onclick = () => { showScreen('home'); loadLibrary(); };
    } else {
      logInner.innerHTML += '<div class="commit-log-line" style="color: var(--reject)">Commit incomplete. Fix the errors above and retry.</div>';
      $('commit-options').style.display = '';
      setCommitOptionControlsDisabled(false);
      $('commit-btn').disabled = false;
      $('commit-btn').innerHTML = `Retry ${icon('arrowR', 15)}`;
    }

  } catch (err) {
    logInner.innerHTML += `<div class="commit-log-line" style="color: var(--reject)">${icon('x', 14, 2.4)} Commit failed: ${escHtml(err.message)}</div>`;
    setCommitOptionControlsDisabled(false);
    $('commit-btn').disabled = false;
    $('commit-btn').innerHTML = `Retry ${icon('arrowR', 15)}`;
  } finally {
    commitRequestInFlight = false;
    $('commit-confirm-apply').disabled = false;
    $('commit-confirm-cancel').disabled = false;
  }
}

$('commit-btn').addEventListener('click', async () => {
  if (state.currentSession._committed) return;
  const options = selectedCommitOptions();
  $('commit-btn').disabled = true;
  $('commit-btn').innerHTML = `<span class="spinner" style="width:15px;height:15px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span> Checking\u2026`;
  try {
    const preview = await api(
      'POST',
      `/api/sessions/${state.currentSession.id}/commit?dryRun=true`,
      options
    );
    showCommitConfirmation(preview, options);
  } catch (err) {
    $('commit-log').innerHTML = `<div class="commit-log"><div class="commit-log-line failed">${icon('x', 14, 2.4)} Preview failed: ${escHtml(err.message)}</div></div>`;
    closeCommitConfirmation();
  }
});

$('commit-confirm-cancel').addEventListener('click', closeCommitConfirmation);
$('commit-confirm-apply').addEventListener('click', () => {
  executeCommit(pendingCommitOptions || selectedCommitOptions());
});

// ── Utilities ──────────────────────────────────────────────────
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

// ── Grid render post-processing (attach hover actions) ─────────
const originalRenderGrid = renderGrid;
const _renderGrid = renderGrid;

// Use MutationObserver to attach hover actions after DOM update
const gridObserver = new MutationObserver(() => {
  attachAllHoverActions();
});

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const grid = $('photo-grid');
  if (grid) {
    gridObserver.observe(grid, { childList: true, subtree: true });
  }
});

loadLibrary();
