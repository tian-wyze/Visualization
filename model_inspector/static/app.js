/* ── Palette ────────────────────────────────────────────────────────────────── */
const PALETTE = [
  { border: '#ef4444', bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444' }, // red
  { border: '#3b82f6', bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' }, // blue
  { border: '#f97316', bg: '#fff7ed', text: '#c2410c', dot: '#f97316' }, // orange
  { border: '#a855f7', bg: '#faf5ff', text: '#7e22ce', dot: '#a855f7' }, // purple
  { border: '#ec4899', bg: '#fdf2f8', text: '#be185d', dot: '#ec4899' }, // pink
  { border: '#14b8a6', bg: '#f0fdfa', text: '#0f766e', dot: '#14b8a6' }, // teal
];

/* ── App State ──────────────────────────────────────────────────────────────── */
const S = {
  // benchmarks: bk -> {displayName, numCases,
  //                    models: {name -> {accuracy, color, savedPath}}}
  benchmarks:      {},
  activeBenchmark: null,

  activeTab:  null,   // model name | '__compare__'
  filter:     'failures',
  compareM1:  null,
  compareM2:  null,
  crossMode:  'fail_succeed',

  cases:    [],
  total:    0,
  page:     0,
  PAGE_SIZE: 20,
};

/* ── DOM Refs ───────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function enc(s)        { return encodeURIComponent(s); }
function escHtml(s)    { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s)    { return String(s).replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function shortBk(bk)   { return bk.length > 42 ? bk.slice(0, 39) + '…' : bk; }

/** Client-side benchmark detection from a filename — mirrors backend logic.
 *  Splits at the first underscore after "predictions_", so it works even
 *  before any benchmarks are loaded. */
function detectBkFromFilename(filename) {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/^.*\//, '');
  if (!stem.startsWith('predictions_')) return null;
  const remainder = stem.slice('predictions_'.length);
  const sep = remainder.indexOf('_');
  if (sep === -1) return null;
  return remainder.slice(sep + 1);  // everything after first underscore = bk
}

function activeBenchmarkModels() {
  return S.benchmarks[S.activeBenchmark]?.models || {};
}

/* ── Toasts ─────────────────────────────────────────────────────────────────── */
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

/* ── Drop Zone Setup ────────────────────────────────────────────────────────── */
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

/* ── Benchmark Upload ───────────────────────────────────────────────────────── */
setupDropZone('benchmark-zone', 'benchmark-input', handleBenchmarkFile);

async function handleBenchmarkFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  await _loadBenchmarkResult(
    fetch('/api/upload_benchmark', { method: 'POST', body: fd }),
    null
  );
}

async function handleBenchmarkPath(path) {
  path = path.trim();
  if (!path) return;
  await _loadBenchmarkResult(
    fetch('/api/load_benchmark_path', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path }),
    }),
    path
  );
  if (!$('benchmark-path-input').value.includes('error')) {
    $('benchmark-path-input').value = '';
  }
}

async function _loadBenchmarkResult(fetchPromise, savedPath) {
  try {
    const res  = await fetchPromise;
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // ── Batch (folder) response ──────────────────────────────────────────
    if (data.batch) {
      let firstBk = null;
      for (const item of data.loaded) {
        _applyBenchmarkData(item, null /* individual paths already saved server-side */);
        if (!firstBk) firstBk = item.benchmark_key;
      }
      renderBenchmarkList();
      renderBenchmarkBar();
      updateModelBenchmarkSelect();
      if (!S.activeBenchmark && firstBk) switchBenchmark(firstBk);
      const skipNote = data.skipped.length
        ? ` (${data.skipped.length} skipped: ${data.skipped.join(', ')})`
        : '';
      toast(`Loaded ${data.loaded.length} benchmarks from folder${skipNote}`);
      $('benchmark-path-input').value = '';
      return;
    }

    // ── Single file response ─────────────────────────────────────────────
    _applyBenchmarkData(data, savedPath);
    renderBenchmarkList();
    renderBenchmarkBar();
    updateModelBenchmarkSelect();
    if (!S.activeBenchmark) switchBenchmark(data.benchmark_key);
    toast(`Loaded: ${data.name} (${data.num_cases} cases)`);
    $('benchmark-path-input').value = '';
  } catch (e) {
    toast(e.message, 'error');
  }
}

function _applyBenchmarkData(data, savedPath) {
  const bk = data.benchmark_key;
  if (!S.benchmarks[bk]) {
    S.benchmarks[bk] = { displayName: data.name, numCases: data.num_cases,
                         serverPath: savedPath, models: {} };
  } else {
    S.benchmarks[bk].displayName = data.name;
    S.benchmarks[bk].numCases    = data.num_cases;
    if (savedPath) S.benchmarks[bk].serverPath = savedPath;
  }
}

$('benchmark-path-btn').addEventListener('click', () =>
  handleBenchmarkPath($('benchmark-path-input').value));
$('benchmark-path-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleBenchmarkPath(e.target.value);
});

/* ── Benchmark management ───────────────────────────────────────────────────── */
function renderBenchmarkList() {
  const list = $('benchmark-list');
  const bks  = Object.keys(S.benchmarks);
  if (bks.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = bks.map(bk => {
    const info = S.benchmarks[bk];
    const tip  = info.serverPath
      ? info.serverPath
      : `${info.displayName}\n(loaded from local file upload)`;
    return `
      <div class="benchmark-item ${bk === S.activeBenchmark ? 'active' : ''}"
           onclick="switchBenchmark('${escAttr(bk)}')">
        <span class="bk-check">✓</span>
        <span class="bk-name">${escHtml(shortBk(bk))}</span>
        <span class="bk-spacer"></span>
        <span class="info-btn" data-tip="${escAttr(tip)}">i</span>
        <span class="bk-cases">${info.numCases} cases</span>
        <button class="bk-del" title="Remove benchmark"
                onclick="event.stopPropagation();deleteBenchmark('${escAttr(bk)}')">✕</button>
      </div>`;
  }).join('');
}

function renderBenchmarkBar() {
  const bks = Object.keys(S.benchmarks);
  $('benchmark-bar').classList.toggle('hidden', bks.length === 0);
  $('benchmark-bar').innerHTML = bks.map(bk => {
    const info = S.benchmarks[bk];
    return `
      <div class="benchmark-tab ${bk === S.activeBenchmark ? 'active' : ''}"
           onclick="switchBenchmark('${escAttr(bk)}')" title="${escAttr(bk)}">
        ${escHtml(bk)}
        <span class="bk-count-badge">${info.numCases}</span>
      </div>`;
  }).join('');
}

function switchBenchmark(bk) {
  if (!S.benchmarks[bk]) return;
  S.activeBenchmark = bk;
  S.activeTab  = null;
  S.compareM1  = null;
  S.compareM2  = null;
  S.page       = 0;
  renderBenchmarkList();
  renderBenchmarkBar();
  renderModels();
  renderTabs();
  renderEmptyOrCases();
}

async function deleteBenchmark(bk) {
  await fetch('/api/delete_benchmark', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ benchmark: bk }),
  });
  delete S.benchmarks[bk];
  if (S.activeBenchmark === bk) {
    const remaining = Object.keys(S.benchmarks);
    S.activeBenchmark = remaining.length ? remaining[0] : null;
    S.activeTab = null;
  }
  renderBenchmarkList();
  renderBenchmarkBar();
  renderModels();
  renderTabs();
  renderEmptyOrCases();
  updateModelBenchmarkSelect();
  toast('Benchmark removed');
}

/* ── Add Model Flow ─────────────────────────────────────────────────────────── */
$('show-add-model-btn').addEventListener('click', () => {
  $('add-model-form').classList.toggle('hidden');
  updateModelBenchmarkSelect();
  $('model-name-input').focus();
});
$('cancel-add-model').addEventListener('click', () => {
  $('add-model-form').classList.add('hidden');
  resetAddModelForm();
});

setupDropZone('model-drop-zone', 'model-csv-input', file => {
  $('model-drop-zone').querySelector('.dz-label').textContent = file.name;
  $('model-drop-zone').classList.add('loaded');
  $('model-drop-zone')._file = file;
  // Auto-detect benchmark from filename and update selector
  const detected = detectBkFromFilename(file.name);
  if (detected) {
    $('model-benchmark-select').value = detected;
    $('model-bk-detect').textContent  = `Auto-detected from filename`;
  } else {
    $('model-bk-detect').textContent = 'Could not auto-detect — using selected benchmark';
  }
});

// Also auto-detect when user types a server path
$('model-path-input').addEventListener('input', e => {
  const filename = e.target.value.split('/').pop();
  const detected = detectBkFromFilename(filename);
  if (detected) {
    $('model-benchmark-select').value = detected;
    $('model-bk-detect').textContent  = `Auto-detected from filename`;
  } else if (filename) {
    $('model-bk-detect').textContent = 'Could not auto-detect — using selected benchmark';
  } else {
    $('model-bk-detect').textContent = '';
  }
});

function updateModelBenchmarkSelect() {
  const sel = $('model-benchmark-select');
  const bks = Object.keys(S.benchmarks);
  sel.innerHTML = bks.length
    ? bks.map(bk => `<option value="${escAttr(bk)}" ${bk === S.activeBenchmark ? 'selected' : ''}>${escHtml(shortBk(bk))}</option>`).join('')
    : '<option value="">— load a benchmark first —</option>';
}

$('submit-add-model').addEventListener('click', async () => {
  const name = $('model-name-input').value.trim();
  const file = $('model-drop-zone')._file;
  const path = $('model-path-input').value.trim();
  const bk   = $('model-benchmark-select').value;

  if (!file && !path) { toast('Drop a CSV file or enter a server path / folder', 'error'); return; }
  if (!bk && !path)   { toast('Load a benchmark first', 'error'); return; }

  $('submit-add-model').disabled = true;
  try {
    let data;
    if (file) {
      // Local file upload — name and bk required
      if (!name) { toast('Enter a model name', 'error'); return; }
      const fd = new FormData();
      fd.append('name', name);
      fd.append('file', file);
      fd.append('benchmark', bk);
      data = await fetch('/api/upload_model', { method: 'POST', body: fd }).then(r => r.json());
    } else {
      // Server path (file or folder) — name optional for folders/parseable filenames
      data = await fetch('/api/load_model_path', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name, path, benchmark: bk }),
      }).then(r => r.json());
    }
    if (data.error) throw new Error(data.error);

    // ── Batch (folder) response ───────────────────────────────────────────
    if (data.batch) {
      for (const item of data.loaded) {
        _applyModelData(item, path);
      }
      renderModels();
      renderTabs();
      if (!S.activeTab) {
        const models = activeBenchmarkModels();
        if (Object.keys(models).length) {
          switchTab(Object.entries(models).sort(([,a],[,b]) => b.accuracy - a.accuracy)[0][0]);
        }
      }
      $('add-model-form').classList.add('hidden');
      resetAddModelForm();
      const skipNote = data.skipped.length
        ? ` (${data.skipped.length} skipped)`
        : '';
      toast(`Loaded ${data.loaded.length} models from folder${skipNote}`);
      if (data.skipped.length) {
        console.warn('Skipped model files:', data.skipped);
      }
      return;
    }

    // ── Single file response ──────────────────────────────────────────────
    _applyModelData(data, file ? null : path);
    renderModels();
    renderTabs();
    if (data.benchmark_key === S.activeBenchmark && !S.activeTab) switchTab(data.name);
    $('add-model-form').classList.add('hidden');
    resetAddModelForm();
    toast(`${data.name} → ${shortBk(data.benchmark_key)} (${data.accuracy}%)`);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    $('submit-add-model').disabled = false;
  }
});

function _applyModelData(item, savedPath) {
  const targetBk = item.benchmark_key;
  if (!S.benchmarks[targetBk]) return;  // benchmark not in client state yet
  const colorIdx = Object.keys(S.benchmarks[targetBk].models).length % PALETTE.length;
  S.benchmarks[targetBk].models[item.name] = {
    accuracy:  item.accuracy,
    color:     PALETTE[colorIdx],
    savedPath: savedPath || null,
  };
}

function resetAddModelForm() {
  $('model-name-input').value  = '';
  $('model-path-input').value  = '';
  $('model-bk-detect').textContent = '';
  const dz = $('model-drop-zone');
  dz.querySelector('.dz-label').textContent = 'Drop predictions CSV';
  dz.classList.remove('loaded');
  dz._file = null;
  $('model-csv-input').value = '';
}

/* ── Render Model List ──────────────────────────────────────────────────────── */
function renderModels() {
  const list   = $('model-list');
  const models = activeBenchmarkModels();
  if (Object.keys(models).length === 0) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No models for this benchmark.</div>';
    return;
  }
  list.innerHTML = Object.entries(models)
    .sort(([, a], [, b]) => b.accuracy - a.accuracy)
    .map(([name, info]) => {
      const savedBadge = info.savedPath
        ? `<span class="saved-badge">saved</span>`
        : '';
      const tip = info.savedPath
        ? info.savedPath
        : '(loaded from local file upload)';
      return `
        <div class="model-item">
          <div class="model-item-top">
            <span class="model-dot" style="background:${info.color.dot}"></span>
            <span class="model-name">${escHtml(name)}</span>
            <span class="info-btn" data-tip="${escAttr(tip)}">i</span>
            ${savedBadge}
            <button class="model-del" title="Remove"
                    onclick="removeModel('${escAttr(name)}','${escAttr(S.activeBenchmark)}')">✕</button>
          </div>
          <div class="model-bar-track">
            <div class="model-bar-fill" style="width:${info.accuracy}%;background:${info.color.dot}">
              <span class="model-bar-label">${info.accuracy}%</span>
            </div>
          </div>
        </div>`;
    }).join('');
}

async function removeModel(name, bk) {
  await fetch('/api/delete_model', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name, benchmark: bk }),
  });
  if (S.benchmarks[bk]?.models) delete S.benchmarks[bk].models[name];
  if (S.activeTab  === name) S.activeTab  = null;
  if (S.compareM1  === name) S.compareM1  = null;
  if (S.compareM2  === name) S.compareM2  = null;
  renderModels();
  renderTabs();
  renderEmptyOrCases();
  toast(`${name} removed`);
}

/* ── Tabs ───────────────────────────────────────────────────────────────────── */
function renderTabs() {
  const bar    = $('tab-bar');
  const models = activeBenchmarkModels();
  const modelNames = Object.entries(models)
    .sort(([, a], [, b]) => b.accuracy - a.accuracy)
    .map(([name]) => name);

  if (!S.activeBenchmark || modelNames.length === 0) { bar.innerHTML = ''; return; }

  let html = modelNames.map(name => `
    <div class="tab ${S.activeTab === name ? 'active' : ''}"
         onclick="switchTab('${escAttr(name)}')">${escHtml(name)}</div>`).join('');
  if (modelNames.length >= 2) {
    html += `<div class="tab tab-compare ${S.activeTab === '__compare__' ? 'active' : ''}"
               onclick="switchTab('__compare__')">⇄ Compare</div>`;
  }
  bar.innerHTML = html;
}

function switchTab(tab) {
  S.activeTab = tab;
  S.page = 0;
  renderTabs();
  renderControls();
  loadCases();
}

/* ── Controls Bar ───────────────────────────────────────────────────────────── */
function renderControls() {
  const ctrl   = $('controls');
  const models = activeBenchmarkModels();
  if (!S.activeTab) { ctrl.classList.add('hidden'); return; }
  ctrl.classList.remove('hidden');

  if (S.activeTab !== '__compare__') {
    ctrl.innerHTML = `
      <span class="filter-label">Show</span>
      <div class="filter-pills">
        ${['failures','correct','all'].map(f => `
          <button class="pill ${S.filter === f ? 'active' : ''}"
                  onclick="setFilter('${f}')">${capitalize(f)}</button>`).join('')}
      </div>`;
  } else {
    const names = Object.entries(models)
      .sort(([, a], [, b]) => b.accuracy - a.accuracy)
      .map(([n]) => n);
    const m1 = S.compareM1 || names[0];
    const m2 = S.compareM2 || names[1];
    if (!S.compareM1) S.compareM1 = m1;
    if (!S.compareM2) S.compareM2 = m2;

    ctrl.innerHTML = `
      <span class="filter-label">Compare</span>
      <select class="ctrl-select" id="cmp-m1" onchange="setCompareM1(this.value)">
        ${names.map(n => `<option value="${escAttr(n)}" ${n===m1?'selected':''}>${escHtml(n)}</option>`).join('')}
      </select>
      <span style="color:var(--text-muted);font-weight:600">vs</span>
      <select class="ctrl-select" id="cmp-m2" onchange="setCompareM2(this.value)">
        ${names.map(n => `<option value="${escAttr(n)}" ${n===m2?'selected':''}>${escHtml(n)}</option>`).join('')}
      </select>
      <select class="ctrl-select" id="cmp-mode" onchange="setCrossMode(this.value)">
        <option value="fail_succeed" ${S.crossMode==='fail_succeed'?'selected':''}>Left fails, Right succeeds</option>
        <option value="succeed_fail" ${S.crossMode==='succeed_fail'?'selected':''}>Left succeeds, Right fails</option>
        <option value="both_fail"    ${S.crossMode==='both_fail'   ?'selected':''}>Both fail</option>
        <option value="both_correct" ${S.crossMode==='both_correct'?'selected':''}>Both correct</option>
      </select>`;
  }
}

function setFilter(f)    { S.filter = f; S.page = 0; renderControls(); loadCases(); }
function setCompareM1(v) { S.compareM1 = v; S.page = 0; loadCases(); }
function setCompareM2(v) { S.compareM2 = v; S.page = 0; loadCases(); }
function setCrossMode(v) { S.crossMode = v; S.page = 0; loadCases(); }

/* ── Load Cases ─────────────────────────────────────────────────────────────── */
async function loadCases() {
  if (!S.activeTab || !S.activeBenchmark) return;
  $('empty-state').classList.add('hidden');
  $('loading-cases').classList.remove('hidden');
  $('cases').innerHTML = '';

  let url;
  if (S.activeTab === '__compare__') {
    url = `/api/cases?benchmark=${enc(S.activeBenchmark)}&view=compare&model=${enc(S.compareM1)}&model2=${enc(S.compareM2)}&cross_mode=${S.crossMode}&page=${S.page}&page_size=${S.PAGE_SIZE}`;
  } else {
    url = `/api/cases?benchmark=${enc(S.activeBenchmark)}&view=single&model=${enc(S.activeTab)}&type=${S.filter}&page=${S.page}&page_size=${S.PAGE_SIZE}`;
  }

  try {
    const data = await fetch(url).then(r => r.json());
    S.cases = data.cases;
    S.total = data.total;
    $('loading-cases').classList.add('hidden');
    renderCases(data.cases);
    renderStatusBar();
  } catch (e) {
    $('loading-cases').classList.add('hidden');
    toast('Failed to load cases: ' + e.message, 'error');
  }
}

function renderEmptyOrCases() {
  const models = activeBenchmarkModels();
  if (!S.activeBenchmark || Object.keys(models).length === 0) {
    $('controls').classList.add('hidden');
    $('status-bar').classList.add('hidden');
    $('cases').innerHTML = '';
    $('loading-cases').classList.add('hidden');
    $('empty-state').classList.remove('hidden');
    return;
  }
  if (!S.activeTab) {
    const first = Object.entries(models).sort(([, a], [, b]) => b.accuracy - a.accuracy)[0][0];
    switchTab(first);
  }
}

/* ── Render Cases ───────────────────────────────────────────────────────────── */
function renderCases(cases) {
  if (cases.length === 0) {
    $('cases').innerHTML = `
      <div style="padding:48px;text-align:center;color:var(--text-muted)">
        <div style="font-size:32px;margin-bottom:12px">🎯</div>
        <div style="font-weight:600;margin-bottom:6px">No cases found</div>
        <div style="font-size:12px">Try a different filter or model combination.</div>
      </div>`;
    return;
  }
  $('cases').innerHTML = cases.map(c => renderCard(c)).join('');
}

function renderCard(c) {
  const { idx, query, gallery, label, models: modelPreds } = c;
  const modelEntries = Object.entries(modelPreds);
  const bkModels     = activeBenchmarkModels();

  const predTags = modelEntries.map(([name, pred]) => {
    const color   = bkModels[name]?.color || PALETTE[0];
    const correct = pred === label;
    return `<span class="case-pred-tag" style="background:${color.bg};color:${color.text}">
              ${escHtml(name)}: ${pred} ${correct ? '✓' : '✗'}</span>`;
  }).join('');

  const galleryHtml = gallery.map((imgPath, i) => {
    const pos             = i + 1;
    const isGT            = pos === label;
    const wrongPredModels = modelEntries.filter(([, pred]) => pred === pos && !isGT);
    const rightPredModels = modelEntries.filter(([, pred]) => pred === pos &&  isGT);

    const borderClass = isGT ? 'gt-border' : '';
    const shadowList  = wrongPredModels.map(([name], i2) => {
      const color  = bkModels[name]?.color || PALETTE[0];
      const offset = (i2 + 1) * 3;
      return `0 0 0 ${offset}px ${color.border}`;
    });
    const imgStyle = shadowList.length ? `box-shadow:${shadowList.join(',')};` : '';

    let badges = '';
    if (isGT) badges += '<span class="badge badge-gt">GT</span>';
    // Models that correctly predicted this (GT) position
    rightPredModels.forEach(([name]) => {
      const color = bkModels[name]?.color || PALETTE[0];
      badges += `<span class="badge" style="background:${color.bg};color:${color.text};border:1px solid ${color.border}">${escHtml(name)}</span>`;
    });
    // Models that wrongly predicted this (non-GT) position
    wrongPredModels.forEach(([name]) => {
      const color = bkModels[name]?.color || PALETTE[0];
      badges += `<span class="badge" style="background:${color.bg};color:${color.text};border:1px solid ${color.border}">${escHtml(name)}</span>`;
    });

    return `
      <div class="img-item">
        <img src="/api/image?path=${enc(imgPath)}"
             class="${borderClass}" style="${imgStyle}"
             title="Gallery ${pos} — ${imgPath}" loading="lazy"
             onerror="this.style.opacity='0.25'">
        <div class="img-label">
          <span class="lbl-num">${pos}</span>${badges}
        </div>
      </div>`;
  }).join('');

  const caseDataAttr = escAttr(JSON.stringify({...c, benchmark: S.activeBenchmark}));

  return `
    <div class="case-card" data-case="${caseDataAttr}">
      <div class="case-header">
        <span class="case-idx">#${idx}</span>
        <span class="case-gt">GT: ${label}</span>
        ${predTags}
        <button class="zoom-btn" title="Zoom in" onclick="openZoom(this)">⤢</button>
      </div>
      <div class="case-images">
        <div class="img-item">
          <img src="/api/image?path=${enc(query)}" title="Query — ${query}"
               loading="lazy" onerror="this.style.opacity='0.25'">
          <div class="img-label"><span class="lbl-num" style="font-weight:700;color:var(--text)">Q</span></div>
        </div>
        <div class="query-divider"></div>
        ${galleryHtml}
      </div>
    </div>`;
}

/* ── Status Bar & Pagination ────────────────────────────────────────────────── */
function renderStatusBar() {
  const bar = $('status-bar');
  bar.classList.remove('hidden');

  const from       = S.page * S.PAGE_SIZE + 1;
  const to         = Math.min((S.page + 1) * S.PAGE_SIZE, S.total);
  const totalPages = Math.ceil(S.total / S.PAGE_SIZE);

  $('case-count').textContent = S.total === 0
    ? 'No cases'
    : `Showing ${from}–${to} of ${S.total} cases`;

  $('pagination').innerHTML = `
    <button class="page-btn" ${S.page === 0 ? 'disabled' : ''} onclick="goPage(${S.page-1})">‹</button>
    <span id="page-info">${totalPages > 0 ? `${S.page+1} / ${totalPages}` : '—'}</span>
    <button class="page-btn" ${S.page >= totalPages-1 ? 'disabled' : ''} onclick="goPage(${S.page+1})">›</button>`;
}

function goPage(p) {
  S.page = p;
  loadCases();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Zoom Modal ─────────────────────────────────────────────────────────────── */
function openZoom(btn) {
  const c    = JSON.parse(btn.closest('.case-card').dataset.case);
  const { idx, query, gallery, label, models: modelPreds, benchmark: bk } = c;
  const modelEntries = Object.entries(modelPreds);
  const bkModels     = S.benchmarks[bk]?.models || activeBenchmarkModels();

  const makeItem = (imgPath, posLabel, isQuery) => {
    let borderClass = '', imgStyle = '', badges = '';
    if (!isQuery) {
      const pos             = parseInt(posLabel);
      const isGT            = pos === label;
      const wrongPredModels = modelEntries.filter(([, pred]) => pred === pos && !isGT);
      const rightPredModels = modelEntries.filter(([, pred]) => pred === pos &&  isGT);
      if (isGT) borderClass = 'gt-border';
      const shadows = wrongPredModels.map(([name], i2) => {
        const color = bkModels[name]?.color || PALETTE[0];
        return `0 0 0 ${(i2+1)*4}px ${color.border}`;
      });
      if (shadows.length) imgStyle = `box-shadow:${shadows.join(',')};`;
      if (isGT) badges += '<span class="badge badge-gt">GT</span>';
      rightPredModels.forEach(([name]) => {
        const color = bkModels[name]?.color || PALETTE[0];
        badges += `<span class="badge" style="background:${color.bg};color:${color.text};border:1px solid ${color.border}">${escHtml(name)}</span>`;
      });
      wrongPredModels.forEach(([name]) => {
        const color = bkModels[name]?.color || PALETTE[0];
        badges += `<span class="badge" style="background:${color.bg};color:${color.text};border:1px solid ${color.border}">${escHtml(name)}</span>`;
      });
    }
    return `
      <div class="zoom-img-item">
        <img src="/api/image?path=${enc(imgPath)}" class="${borderClass}"
             style="${imgStyle}" onerror="this.style.opacity='0.25'">
        <div class="img-label" style="justify-content:center">
          <span class="lbl-num" style="${isQuery?'font-weight:700;color:var(--text)':''}">${posLabel}</span>
          ${badges}
        </div>
      </div>`;
  };

  const predTags = modelEntries.map(([name, pred]) => {
    const color   = bkModels[name]?.color || PALETTE[0];
    const correct = pred === label;
    return `<span class="case-pred-tag" style="background:${color.bg};color:${color.text}">
              ${escHtml(name)}: ${pred} ${correct ? '✓' : '✗'}</span>`;
  }).join('');

  $('zoom-header').innerHTML = `
    <span class="case-idx">#${idx}</span>
    <span class="case-gt">GT: ${label}</span>
    ${predTags}`;
  $('zoom-body').innerHTML = `
    ${makeItem(query, 'Q', true)}
    <div class="query-divider" style="align-self:stretch"></div>
    ${gallery.map((p, i) => makeItem(p, i+1, false)).join('')}`;

  $('zoom-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeZoom() {
  $('zoom-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ── Init: restore server state on page load ────────────────────────────────── */
async function initFromServer() {
  try {
    const [stateData, pathsData] = await Promise.all([
      fetch('/api/state').then(r => r.json()),
      fetch('/api/saved_paths').then(r => r.json()),
    ]);

    const savedBks = pathsData.benchmarks || {};

    for (const [bk, bdata] of Object.entries(stateData.benchmarks || {})) {
      const savedModelPaths = Object.fromEntries(
        (savedBks[bk]?.models || []).map(m => [m.name, m.path])
      );
      S.benchmarks[bk] = {
        displayName: bdata.display_name,
        numCases:    bdata.num_cases,
        serverPath:  savedBks[bk]?.path || null,
        models: Object.fromEntries(
          Object.entries(bdata.models)
            .sort(([, a], [, b]) => b.accuracy - a.accuracy)
            .map(([name, info], i) => [name, {
              accuracy:  info.accuracy,
              color:     PALETTE[i % PALETTE.length],
              savedPath: savedModelPaths[name] || null,
            }])
        ),
      };
    }

    if (Object.keys(S.benchmarks).length === 0) return;

    renderBenchmarkList();
    renderBenchmarkBar();
    updateModelBenchmarkSelect();

    // Switch to first benchmark and its top model
    S.activeBenchmark = Object.keys(S.benchmarks)[0];
    renderModels();
    renderTabs();
    renderEmptyOrCases();
  } catch (e) {
    console.error('initFromServer failed:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('status-bar').classList.add('hidden');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeZoom(); });
  initFromServer();
});
