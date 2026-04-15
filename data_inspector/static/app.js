/* ── App State ──────────────────────────────────────────────────────────────── */
const S = {
  // galleries: gk -> {displayName, stats, serverPath}
  galleries:     {},
  activeGallery: null,

  households:      [],   // [{household_id, num_identities, num_images}]
  householdFilter: '',
  hhSizeFilter:    '',   // '' | '1' | '2' | ...
  searchQuery:     '',
  sortBy:          'household',

  identities: [],        // current page
  total:      0,
  page:       0,
  PAGE_SIZE:  10,

  // Zoom
  zoomImages: [],        // [{path, mac, identityId, householdId}]
  zoomIndex:  0,
};

/* ── DOM Refs ───────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s) {
  return String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}
function imgSrc(path) {
  return `/api/image?path=${encodeURIComponent(path)}`;
}
function basename(path) {
  return path.split('/').pop();
}
function fmtNum(n) {
  return n.toLocaleString();
}
function shortKey(gk) {
  return gk.length > 60 ? gk.slice(0, 57) + '…' : gk;
}

/* ── Toast ──────────────────────────────────────────────────────────────────── */
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Upload Panel Toggle ────────────────────────────────────────────────────── */
$('toggle-panel-btn').addEventListener('click', () => {
  const p = $('upload-panel');
  p.classList.toggle('hidden');
  $('toggle-panel-btn').textContent = p.classList.contains('hidden') ? 'Show Upload' : 'Hide Upload';
});

/* ── Drop Zone ──────────────────────────────────────────────────────────────── */
function setupDropZone(zoneId, inputId, handler) {
  const zone  = $(zoneId);
  const input = $(inputId);
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) handler(input.files[0]); });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handler(f);
  });
}

setupDropZone('gallery-zone', 'gallery-input', handleGalleryFile);

/* ── Gallery Upload ─────────────────────────────────────────────────────────── */
async function handleGalleryFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  await _loadGalleryResult(
    fetch('/api/upload_gallery', { method: 'POST', body: fd }),
    null
  );
}

async function handleGalleryPath(path) {
  path = path.trim();
  if (!path) return;
  await _loadGalleryResult(
    fetch('/api/load_gallery_path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
    path
  );
}

async function _loadGalleryResult(fetchPromise, savedPath) {
  try {
    const res  = await fetchPromise;
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (data.batch) {
      let firstGk = null;
      for (const item of data.loaded) {
        _applyGalleryData(item, null);
        if (!firstGk) firstGk = item.gallery_key;
      }
      renderGalleryList();
      renderGalleryBar();
      if (!S.activeGallery && firstGk) await switchGallery(firstGk);
      const skipNote = data.skipped.length
        ? ` (${data.skipped.length} skipped)`
        : '';
      toast(`Loaded ${data.loaded.length} galleries from folder${skipNote}`);
      $('gallery-path-input').value = '';
      return;
    }

    _applyGalleryData(data, savedPath);
    renderGalleryList();
    renderGalleryBar();
    if (!S.activeGallery) await switchGallery(data.gallery_key);
    else if (data.gallery_key === S.activeGallery) {
      // reload current gallery data
      await switchGallery(data.gallery_key);
    }
    const s = data.stats;
    toast(`Loaded: ${data.display_name} — ${fmtNum(s.num_identities)} identities, ${fmtNum(s.num_images)} images`);
    $('gallery-path-input').value = '';
  } catch (e) {
    toast(e.message, 'error');
  }
}

function _applyGalleryData(data, savedPath) {
  const gk = data.gallery_key;
  if (!S.galleries[gk]) {
    S.galleries[gk] = { displayName: data.display_name, stats: data.stats, serverPath: savedPath };
  } else {
    S.galleries[gk].displayName = data.display_name;
    S.galleries[gk].stats       = data.stats;
    if (savedPath) S.galleries[gk].serverPath = savedPath;
  }
}

$('gallery-path-btn').addEventListener('click', () =>
  handleGalleryPath($('gallery-path-input').value));
$('gallery-path-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleGalleryPath(e.target.value);
});

/* ── Gallery List (upload panel) ────────────────────────────────────────────── */
function renderGalleryList() {
  const list = $('gallery-list');
  const gks  = Object.keys(S.galleries);
  if (!gks.length) { list.innerHTML = ''; return; }

  list.innerHTML = gks.map(gk => {
    const info = S.galleries[gk];
    const tip  = info.serverPath
      ? info.serverPath
      : `${info.displayName}\n(loaded from local file upload)`;
    const saved = info.serverPath
      ? '<span class="saved-badge" title="Path saved; will auto-reload on restart">saved</span>'
      : '';
    return `
      <div class="gallery-item ${gk === S.activeGallery ? 'active' : ''}"
           onclick="switchGallery('${escAttr(gk)}')">
        <span class="gi-check">✓</span>
        <span class="gi-name">${escHtml(shortKey(gk))}</span>
        ${saved}
        <span class="info-btn" data-tip="${escAttr(tip)}">i</span>
        <span class="gi-count">${fmtNum(info.stats.num_identities)} ids</span>
        <button class="gi-del" title="Remove gallery"
                onclick="event.stopPropagation();deleteGallery('${escAttr(gk)}')">✕</button>
      </div>`;
  }).join('');
}

/* ── Gallery Tab Bar ────────────────────────────────────────────────────────── */
function renderGalleryBar() {
  const bar = $('gallery-bar');
  const gks = Object.keys(S.galleries);
  bar.classList.toggle('hidden', gks.length === 0);
  bar.innerHTML = gks.map(gk => {
    const info = S.galleries[gk];
    return `
      <button class="gallery-tab ${gk === S.activeGallery ? 'active' : ''}"
              onclick="switchGallery('${escAttr(gk)}')">
        ${escHtml(shortKey(gk))}
        <span class="gt-id-badge">${fmtNum(info.stats.num_identities)}</span>
      </button>`;
  }).join('');
}

/* ── Switch Gallery ─────────────────────────────────────────────────────────── */
async function switchGallery(gk) {
  S.activeGallery    = gk;
  S.householdFilter  = '';
  S.hhSizeFilter     = '';
  S.searchQuery      = '';
  S.sortBy           = 'household';
  S.page             = 0;

  renderGalleryList();
  renderGalleryBar();
  renderStats();
  $('controls').classList.remove('hidden');
  $('status-bar').classList.remove('hidden');
  $('empty-state').classList.add('hidden');

  // Reset control UI
  $('household-select').value = '';
  $('hh-size-select').value   = '';
  $('search-input').value     = '';
  $('sort-select').value      = 'household';
  $('page-size-select').value = String(S.PAGE_SIZE);

  await loadHouseholds();
  await loadIdentities();
}

/* ── Delete Gallery ─────────────────────────────────────────────────────────── */
async function deleteGallery(gk) {
  try {
    await fetch('/api/delete_gallery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gallery: gk }),
    });
    delete S.galleries[gk];
    if (S.activeGallery === gk) {
      const remaining = Object.keys(S.galleries);
      S.activeGallery = remaining[0] || null;
    }
    renderGalleryList();
    renderGalleryBar();
    if (S.activeGallery) {
      await switchGallery(S.activeGallery);
    } else {
      $('stats-bar').classList.add('hidden');
      $('controls').classList.add('hidden');
      $('status-bar').classList.add('hidden');
      $('identities').innerHTML = '';
      $('empty-state').classList.remove('hidden');
    }
    toast(`Removed gallery: ${gk}`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Stats Bar ──────────────────────────────────────────────────────────────── */
function renderStats() {
  const bar = $('stats-bar');
  if (!S.activeGallery || !S.galleries[S.activeGallery]) {
    bar.classList.add('hidden');
    return;
  }
  const s = S.galleries[S.activeGallery].stats;
  bar.classList.remove('hidden');
  const qCount = s.num_query_images   != null ? fmtNum(s.num_query_images)   : '—';
  const gCount = s.num_gallery_images != null ? fmtNum(s.num_gallery_images) : '—';
  bar.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${fmtNum(s.num_households)}</div>
      <div class="stat-label">Households</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${fmtNum(s.num_identities)}</div>
      <div class="stat-label">Identities</div>
    </div>
    <div class="stat-sep"></div>
    <div class="stat-card stat-card-query">
      <div class="stat-value">${qCount}</div>
      <div class="stat-label">Query imgs</div>
    </div>
    <div class="stat-card stat-card-gallery">
      <div class="stat-value">${gCount}</div>
      <div class="stat-label">Gallery imgs</div>
    </div>
    <div class="stat-sep"></div>
    <div class="stat-card">
      <div class="stat-value">${fmtNum(s.num_singleton_households)}</div>
      <div class="stat-label">Singleton HH</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${fmtNum(s.num_family_households)}</div>
      <div class="stat-label">Family HH</div>
    </div>
    <div class="stat-sep"></div>
    <div class="stat-card">
      <div class="stat-value">${s.avg_images_per_identity}</div>
      <div class="stat-label">Avg imgs / id</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.min_images_per_identity}–${s.max_images_per_identity}</div>
      <div class="stat-label">Min–Max imgs</div>
    </div>`;
}

/* ── Households ─────────────────────────────────────────────────────────────── */
async function loadHouseholds() {
  if (!S.activeGallery) return;
  try {
    const res  = await fetch(`/api/households?gallery=${encodeURIComponent(S.activeGallery)}`);
    const data = await res.json();
    S.households = data.households || [];
    renderHouseholdSelect();
    renderHhSizeSelect();
  } catch (e) {
    console.error('loadHouseholds:', e);
  }
}

function renderHouseholdSelect() {
  const sel = $('household-select');
  sel.innerHTML = '<option value="">All households</option>';
  for (const hh of S.households) {
    const opt = document.createElement('option');
    opt.value       = hh.household_id;
    opt.textContent = `${hh.household_id}  (${hh.num_identities} id, ${fmtNum(hh.num_images)} imgs)`;
    if (hh.household_id === S.householdFilter) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderHhSizeSelect() {
  // Build distribution: size -> number of households with that many identities
  const dist = {};   // {num_identities: count_of_households}
  for (const hh of S.households) {
    const n = hh.num_identities;
    dist[n] = (dist[n] || 0) + 1;
  }

  const sel = $('hh-size-select');
  sel.innerHTML = '<option value="">Any size</option>';
  for (const n of Object.keys(dist).map(Number).sort((a, b) => a - b)) {
    const hhCount  = dist[n];
    const idLabel  = n === 1 ? '1 identity' : `${n} identities`;
    const hhLabel  = hhCount === 1 ? '1 household' : `${hhCount} households`;
    const opt = document.createElement('option');
    opt.value       = String(n);
    opt.textContent = `${idLabel}  (${hhLabel})`;
    if (String(n) === S.hhSizeFilter) opt.selected = true;
    sel.appendChild(opt);
  }
}

/* ── Load Identities ────────────────────────────────────────────────────────── */
async function loadIdentities() {
  if (!S.activeGallery) return;
  $('loading-cases').classList.remove('hidden');
  $('identities').innerHTML = '';
  $('status-bar').classList.add('hidden');

  const params = new URLSearchParams({
    gallery:   S.activeGallery,
    household: S.householdFilter,
    hh_size:   S.hhSizeFilter,
    search:    S.searchQuery,
    sort_by:   S.sortBy,
    page:      S.page,
    page_size: S.PAGE_SIZE,
  });

  try {
    const res  = await fetch(`/api/identities?${params}`);
    const data = await res.json();
    S.identities = data.identities || [];
    S.total      = data.total || 0;
    $('loading-cases').classList.add('hidden');
    renderIdentities();
    renderStatusBar();
  } catch (e) {
    $('loading-cases').classList.add('hidden');
    toast('Failed to load identities: ' + e.message, 'error');
  }
}

/* ── Card image registry ────────────────────────────────────────────────────── */
// Maps a stable card key ("page-cardIdx") to a flat list of image records.
// Avoids embedding JSON in onclick attributes.
const _cardImages = {};

/* ── Render Identity Cards ──────────────────────────────────────────────────── */
function renderIdentities() {
  // Clear previous registry
  Object.keys(_cardImages).forEach(k => delete _cardImages[k]);

  const container = $('identities');
  if (!S.identities.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:14px">
        No identities match the current filters.
      </div>`;
    return;
  }

  container.innerHTML = S.identities
    .map((identity, cardIdx) => renderCard(identity, cardIdx))
    .join('');
}

function renderCard(identity, cardIdx) {
  const { identity_id, household_id, images_by_mac, num_query, num_gallery,
          total_images, num_macs } = identity;
  const cardKey = `${S.page}-${cardIdx}`;

  // Build flat image list for zoom (query first per MAC, then gallery — preserves order)
  const allImages = [];
  for (const [mac, entry] of Object.entries(images_by_mac)) {
    for (const path of (entry.query   || [])) allImages.push({ path, mac, identity_id, household_id, type: 'query'   });
    for (const path of (entry.gallery || [])) allImages.push({ path, mac, identity_id, household_id, type: 'gallery' });
  }
  _cardImages[cardKey] = allImages;

  // Header badges
  const macBadge = num_macs > 1
    ? `<span class="id-badge id-badge-mac">${num_macs} cameras</span>`
    : '';
  const qBadge = num_query   > 0 ? `<span class="id-badge id-badge-q">Q ${fmtNum(num_query)}</span>`   : '';
  const gBadge = num_gallery > 0 ? `<span class="id-badge id-badge-g">G ${fmtNum(num_gallery)}</span>` : '';

  // Build MAC groups — each group has separate Q and G rows
  let flatIndex = 0;
  const macGroupsHtml = Object.entries(images_by_mac).map(([mac, entry]) => {
    const queryPaths   = entry.query   || [];
    const galleryPaths = entry.gallery || [];

    const counts = [
      queryPaths.length   > 0 ? `Q: ${queryPaths.length}`   : '',
      galleryPaths.length > 0 ? `G: ${galleryPaths.length}` : '',
    ].filter(Boolean).join(' · ');

    const macHeader = `
      <div class="mac-header">
        <span class="field-key mac-field-key">MAC</span>
        <span class="mac-label">${escHtml(mac)}</span>
        <span class="mac-count">${counts}</span>
      </div>`;

    // Render one typed row (Q or G); returns '' if no images
    function typeRow(paths, type) {
      if (!paths.length) return '';
      const label    = type === 'query' ? 'Q' : 'G';
      const cls      = type === 'query' ? 'row-label-q' : 'row-label-g';
      const thumbs   = paths.map((path, localIdx) => {
        const globalIdx = flatIndex + localIdx;
        return `
          <div class="img-thumb img-thumb-${type}"
               title="${escAttr(path)}"
               onclick="openZoom('${escAttr(cardKey)}', ${globalIdx})">
            <img src="${imgSrc(path)}" alt="${escHtml(basename(path))}" loading="lazy">
          </div>`;
      }).join('');
      flatIndex += paths.length;
      return `
        <div class="img-type-row">
          <div class="row-label ${cls}">${label}<span class="row-count">${paths.length}</span></div>
          <div class="img-row">${thumbs}</div>
        </div>`;
    }

    const qRow = typeRow(queryPaths,   'query');
    const gRow = typeRow(galleryPaths, 'gallery');

    return `
      <div class="mac-group">
        ${macHeader}
        ${qRow}
        ${gRow}
      </div>`;
  }).join('');

  return `
    <div class="identity-card">
      <div class="identity-header">
        <span class="id-field"><span class="field-key">Household</span><span class="field-val">${escHtml(household_id)}</span></span>
        <span class="id-field"><span class="field-key">Identity</span><span class="field-val">${escHtml(identity_id)}</span></span>
        <div class="id-stats">
          ${qBadge}${gBadge}
          ${macBadge}
        </div>
      </div>
      <div class="identity-body">
        ${macGroupsHtml}
      </div>
    </div>`;
}

/* ── Zoom Modal ─────────────────────────────────────────────────────────────── */
// Called from onclick in card thumbnails. cardKey identifies the _cardImages entry.
function openZoom(cardKey, index) {
  S.zoomImages = _cardImages[cardKey] || [];
  S.zoomIndex  = index;
  renderZoom();
  $('zoom-modal').classList.remove('hidden');
  document.addEventListener('keydown', _zoomKeyHandler);
}

function _zoomKeyHandler(e) {
  if (e.key === 'Escape')      closeZoom();
  else if (e.key === 'ArrowLeft')  navigateZoom(-1);
  else if (e.key === 'ArrowRight') navigateZoom(1);
}

function closeZoom() {
  $('zoom-modal').classList.add('hidden');
  $('zoom-img').src = '';
  document.removeEventListener('keydown', _zoomKeyHandler);
}

function navigateZoom(delta) {
  const newIdx = S.zoomIndex + delta;
  if (newIdx < 0 || newIdx >= S.zoomImages.length) return;
  S.zoomIndex = newIdx;
  renderZoom();
}

function renderZoom() {
  const images = S.zoomImages;
  const idx    = S.zoomIndex;
  const img    = images[idx];
  if (!img) return;

  // Header
  const typeBadge = img.type === 'query'
    ? `<span class="zoom-type-badge zoom-type-q">Query</span>`
    : img.type === 'gallery'
    ? `<span class="zoom-type-badge zoom-type-g">Gallery</span>`
    : '';
  $('zoom-header').innerHTML = `
    <span class="id-field"><span class="field-key">Household</span><span class="field-val">${escHtml(img.household_id)}</span></span>
    <span class="id-field"><span class="field-key">Identity</span><span class="field-val">${escHtml(img.identity_id)}</span></span>
    ${img.mac ? `<span class="id-field"><span class="field-key mac-field-key">MAC</span><span class="mac-label">${escHtml(img.mac)}</span></span>` : ''}
    ${typeBadge}`;

  // Image — add a colored border class based on type
  const zoomImgEl = $('zoom-img');
  zoomImgEl.className = img.type === 'query' ? 'zoom-query' : img.type === 'gallery' ? 'zoom-gallery' : '';
  zoomImgEl.src = imgSrc(img.path);

  // Path
  $('zoom-path').textContent = img.path;

  // Counter
  $('zoom-counter').textContent = `${idx + 1} / ${images.length}`;

  // Nav buttons
  $('zoom-prev').disabled = idx === 0;
  $('zoom-next').disabled = idx === images.length - 1;
}

/* ── Status Bar & Pagination ────────────────────────────────────────────────── */
function renderStatusBar() {
  const bar = $('status-bar');
  if (!S.activeGallery) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  const start  = S.page * S.PAGE_SIZE + 1;
  const end    = Math.min(start + S.PAGE_SIZE - 1, S.total);
  const filter = S.householdFilter || S.searchQuery
    ? ` (filtered)`
    : '';
  $('case-count').textContent = S.total === 0
    ? 'No identities found'
    : `Showing ${start}–${end} of ${fmtNum(S.total)} identities${filter}`;

  const totalPages = Math.ceil(S.total / S.PAGE_SIZE);
  $('pagination').innerHTML = totalPages <= 1 ? '' : `
    <button class="page-btn" onclick="changePage(-1)" ${S.page === 0 ? 'disabled' : ''}>&#8249;</button>
    <span id="page-info">${S.page + 1} / ${totalPages}</span>
    <button class="page-btn" onclick="changePage(1)" ${S.page >= totalPages - 1 ? 'disabled' : ''}>&#8250;</button>`;
}

function changePage(delta) {
  const totalPages = Math.ceil(S.total / S.PAGE_SIZE);
  const newPage = S.page + delta;
  if (newPage < 0 || newPage >= totalPages) return;
  S.page = newPage;
  loadIdentities();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Control Event Listeners ────────────────────────────────────────────────── */
$('household-select').addEventListener('change', e => {
  S.householdFilter = e.target.value;
  // Clear size filter — a specific household implies a fixed size
  if (S.householdFilter) {
    S.hhSizeFilter = '';
    $('hh-size-select').value = '';
  }
  S.page = 0;
  loadIdentities();
});

$('hh-size-select').addEventListener('change', e => {
  S.hhSizeFilter    = e.target.value;
  // Clear the specific-household filter — it's redundant when filtering by size
  S.householdFilter = '';
  $('household-select').value = '';
  S.page = 0;
  loadIdentities();
});

let _searchDebounce = null;
$('search-input').addEventListener('input', e => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    S.searchQuery = e.target.value.trim();
    S.page = 0;
    loadIdentities();
  }, 300);
});

$('sort-select').addEventListener('change', e => {
  S.sortBy = e.target.value;
  S.page   = 0;
  loadIdentities();
});

$('page-size-select').addEventListener('change', e => {
  S.PAGE_SIZE = parseInt(e.target.value, 10);
  S.page      = 0;
  loadIdentities();
});

/* ── Init ───────────────────────────────────────────────────────────────────── */
async function initFromServer() {
  try {
    const [stateData, savedData] = await Promise.all([
      fetch('/api/state').then(r => r.json()),
      fetch('/api/saved_paths').then(r => r.json()),
    ]);
    const saved = savedData.galleries || {};

    for (const [gk, gdata] of Object.entries(stateData.galleries || {})) {
      S.galleries[gk] = {
        displayName: gdata.display_name,
        stats:       gdata.stats,
        serverPath:  gdata.server_path || saved[gk] || null,
      };
    }

    renderGalleryList();
    renderGalleryBar();

    const gks = Object.keys(S.galleries);
    if (gks.length > 0) {
      await switchGallery(gks[0]);
    }
  } catch (e) {
    console.error('initFromServer:', e);
  }
}

initFromServer();
