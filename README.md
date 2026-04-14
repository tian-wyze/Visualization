# Model Inspector

A local web application for visually diagnosing failure cases in **image-retrieval / re-identification** models. Given one or more benchmark JSON files and model prediction CSVs, the app lets you browse failures, correct predictions, and cross-model comparisons side by side in the browser — across multiple benchmarks simultaneously.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Repository Structure](#2-repository-structure)
3. [Dependencies](#3-dependencies)
4. [Environment Setup](#4-environment-setup)
5. [Data Format Specification](#5-data-format-specification)
6. [Running the App](#6-running-the-app)
7. [Using the App — UI Walkthrough](#7-using-the-app--ui-walkthrough)
8. [Architecture](#8-architecture)
   - [Backend (Flask)](#81-backend-flask)
   - [Frontend (Vanilla JS)](#82-frontend-vanilla-js)
   - [Request / Response Flow](#83-request--response-flow)
9. [API Reference](#9-api-reference)
10. [Visual Encoding Reference](#10-visual-encoding-reference)
11. [Adapting for Your Own Task](#11-adapting-for-your-own-task)
12. [Extending the App](#12-extending-the-app)

---

## 1. Overview

The task this app is designed for is **person re-identification**: given a *query* image of a person, a model must identify which image in a fixed *gallery* shows the same person. Each test case has one query image and a variable-length gallery; the ground-truth answer is which gallery position (1-indexed) is the correct match.

The app solves four common diagnostic needs:

| Need | What the app shows |
|---|---|
| "Where does Model A go wrong?" | Single-model tab → **Failures** filter |
| "Where does Model A get it right?" | Single-model tab → **Correct** filter |
| "Where does A fail but B succeed (and vice versa)?" | **⇄ Compare** tab → cross-mode selector |
| "How do models behave across different test conditions?" | Multiple benchmark tabs |

The app is **local-only** — it runs a Python web server on your machine and serves images directly from their absolute paths on disk. No data ever leaves your computer.

State (loaded benchmarks and models) is **automatically restored** between sessions via `.saved_paths.json` — no need to re-upload files every time you restart.

---

## 2. Repository Structure

```
Visualization/
│
├── README.md                        ← This file
├── .gitignore
│
├── python_plots/                    ← Standalone Python plotting scripts (do not modify)
│   └── visual_examples/
│       ├── plot_visual_examles.py   ← Original matplotlib-based visualizer
│       ├── *.json                   ← Benchmark files (input data)
│       └── *.csv                    ← Prediction files (input data)
│
└── model_inspector/                          ← The web application (this project)
    ├── app.py                       ← Flask backend server
    ├── requirements.txt             ← Python dependencies
    ├── .saved_paths.json            ← Auto-generated; persists loaded file paths across restarts
    ├── templates/
    │   └── index.html               ← Single-page HTML shell
    └── static/
        ├── style.css                ← All styles (CSS variables, layout, components)
        └── app.js                   ← All frontend logic (state, rendering, API calls)
```

> **Convention:** `python_plots/` is kept strictly for static Python scripts. All web app code lives under `model_inspector/`. `.saved_paths.json` is auto-generated and git-ignored.

---

## 3. Dependencies

### Python packages

| Package | Purpose | Minimum version |
|---|---|---|
| `flask` | HTTP server, routing, template rendering | 3.0 |
| `pandas` | Parsing prediction CSV files | 2.0 |
| `pillow` | Generating placeholder images for missing paths | 10.0 |

### Browser

Any modern browser (Chrome, Firefox, Safari, Edge). No build step, no Node.js, no npm — the frontend is plain HTML + CSS + JavaScript.

### System

- **Conda** (Miniconda or Anaconda) for environment management
- **Python 3.11+**

---

## 4. Environment Setup

### Create and activate the conda environment

```bash
# Create the environment (only needed once)
conda create -n visualization python=3.11 flask pandas pillow -y

# Activate it every time you start a new terminal session
conda activate visualization
```

### Alternative: install into an existing environment

```bash
conda activate <your-env>
pip install -r Visualization/model_inspector/requirements.txt
```

### Verify the installation

```bash
python -c "import flask, pandas, PIL; print('All dependencies OK')"
```

---

## 5. Data Format Specification

The app expects two types of input files: **benchmark JSONs** and **prediction CSVs**.

### 5.1 Benchmark JSON

This file defines the test cases — what the query image is and what the gallery looks like.

```json
{
  "eval_cases": [
    {
      "query":   "/absolute/path/to/query_0.jpg",
      "gallery": [
        "/absolute/path/to/gallery_0_1.jpg",
        "/absolute/path/to/gallery_0_2.jpg",
        "/absolute/path/to/gallery_0_3.jpg"
      ]
    },
    {
      "query":   "/absolute/path/to/query_1.jpg",
      "gallery": [
        "/absolute/path/to/gallery_1_1.jpg",
        "/absolute/path/to/gallery_1_2.jpg"
      ]
    }
  ]
}
```

**Key rules:**
- The top-level key must be `"eval_cases"`.
- Each case must have `"query"` (a single image path) and `"gallery"` (a list of image paths).
- All paths must be **absolute** paths accessible on the machine running the server.
- Gallery size can vary across cases — it does not need to be fixed.
- Case indices are **implicit**: `eval_cases[0]` is case `idx=0`, `eval_cases[1]` is case `idx=1`, etc.
- The **benchmark key** is derived from the JSON filename stem. For example, `cropped_crossclothes_family_crosscamera.json` → key `cropped_crossclothes_family_crosscamera`.
- If an image path does not exist on disk, the app displays a grey "Not Found" placeholder instead of crashing.

### 5.2 Prediction CSV

One CSV file per model per benchmark. Each row records the model's prediction for one test case.

```
idx,label,prediction
0,3,3
1,2,1
2,5,5
3,1,4
4,2,2
```

**Column definitions:**

| Column | Type | Description |
|---|---|---|
| `idx` | int | 0-based index into `eval_cases` in the benchmark JSON |
| `label` | int | Ground-truth gallery position (1-indexed: 1 = `gallery[0]`) |
| `prediction` | int | The model's predicted gallery position (1-indexed) |

**Key rules:**
- The `idx` column is used as the row index. If absent, the default integer index (0, 1, 2, …) is used.
- `label` and `prediction` use **1-based** indexing to match gallery position.
- Rows where `label == prediction` are correct; all others are failures.
- If a CSV is missing an `idx` that exists in the benchmark, that case is simply skipped.
- Extra columns beyond `idx`, `label`, `prediction` are ignored.

### 5.3 Prediction CSV filename convention

The app can automatically assign a CSV to the correct benchmark and parse the model name from the filename, using this convention:

```
predictions_{model_name}_{benchmark_key}.csv
```

Examples:
```
predictions_sft-qwen3b-DINOv2_cropped_crossclothes_family_crosscamera.csv
  → model name: sft-qwen3b-DINOv2
  → benchmark:  cropped_crossclothes_family_crosscamera

predictions_gemini_gemini-2.5-pro_cropped_crossclothes_family_crosscamera.csv
  → model name: gemini
  → benchmark:  gemini-2.5-pro_cropped_crossclothes_family_crosscamera
```

**Parsing strategy:**
1. If benchmarks are already loaded, the longest matching benchmark key is stripped from the end — this handles model names that contain underscores (e.g. `sft-qwen3b-WYZEv03_23_token`).
2. If no benchmarks are loaded yet, the app splits at the first `_cropped_` occurrence as a fallback heuristic.

If the filename doesn't follow this convention, you can manually enter the model name and select the benchmark in the Add Model form.

---

## 6. Running the App

```bash
# 1. Navigate to the model_inspector directory
cd /path/to/Visualization/model_inspector

# 2. Activate the environment
conda activate visualization

# 3. Start the server
python app.py
```

You should see:
```
Starting Model Inspector on http://localhost:5000
[auto-load] Benchmark "cropped_crossclothes_family_crosscamera": 150 cases
[auto-load] Model "sft-qwen3b-DINOv2" → "cropped_crossclothes_family_crosscamera": 77.3%
 * Running on http://127.0.0.1:5000
```

The `[auto-load]` lines appear when `.saved_paths.json` has previously saved paths — the server restores the last session automatically.

Open **http://localhost:5000** in your browser.

To stop the server, press `Ctrl+C` in the terminal.

> **Note:** The server runs in Flask's development mode (`debug=True`). It auto-reloads when you edit `app.py` and shows detailed error tracebacks in the terminal. Do not expose it on a public network.

> **Remote server tip:** If the server is running on a remote machine and your browser is local, use the server path input fields (see §7) to load files — the browser's file picker opens the *local* machine's filesystem, which won't have the data.

---

## 7. Using the App — UI Walkthrough

### Layout overview

```
┌─────────────────────────────────────────────────────┐
│  Header bar  (title + Hide Upload button)           │
├──────────────────────┬──────────────────────────────┤
│  1 · Benchmarks      │  2 · Model Predictions       │  ← Upload panel
│  [bench chips]       │  [model list]                │    (collapsible)
│  [drop zone / path]  │  [+ Add Model form]          │
├──────────────────────┴──────────────────────────────┤
│  [bench1] [bench2] [bench3]  ←  Benchmark bar       │
├─────────────────────────────────────────────────────┤
│  [ModelA] [ModelB] [⇄ Compare]  ←  Model tab bar   │
├─────────────────────────────────────────────────────┤
│  Show: [Failures] [Correct] [All]  ←  Controls bar  │
├─────────────────────────────────────────────────────┤
│  Showing 1–20 of 47 cases   ‹ 1/3 ›                │  ← Status bar
├─────────────────────────────────────────────────────┤
│  [Case cards...]                                    │  ← Main content
└─────────────────────────────────────────────────────┘
```

### Step 1 — Load benchmarks

**Option A — File upload (local machine):**
Drag and drop a `.json` file onto the "Add benchmark JSON" drop zone, or click it to open a file picker.

**Option B — Server path (recommended for remote servers):**
Type or paste an absolute path into the server path input and press **Enter** or click **Load**:
- `/path/to/benchmark.json` — loads a single benchmark
- `/path/to/folder/` — scans the folder for all `*.json` files with an `eval_cases` key and loads them all at once

On success, a green chip for each loaded benchmark appears in the panel, and a pill appears in the **Benchmark bar** below the panel.

> Each benchmark maintains its own independent set of models. Loading a new benchmark does **not** clear models from other benchmarks.

### Step 2 — Switch between benchmarks

Click any pill in the **Benchmark bar** to switch the active benchmark. The model tabs, model list, and case grid all update to reflect the selected benchmark.

Each benchmark chip in the upload panel has:
- An **ⓘ** button — hover to see the full server path the file was loaded from
- A **✕** button — removes the benchmark and all its models

### Step 3 — Add model predictions

Click **+ Add Model**. A form appears with:

1. **Model name** — a display name (e.g. `Gemini 2.5 Pro`). Optional if using a server path with the standard filename convention — it will be auto-parsed.
2. **CSV source** — either drop a file, or type/paste a server path:
   - Single file: `/path/to/predictions_mymodel_mybenchmark.csv`
   - Folder: `/path/to/run_folder/` — scans for all `predictions_*.csv` files, auto-parses model name and benchmark from each filename
3. **Benchmark selector** — pre-filled with the active benchmark; auto-updated when a filename is typed or a file is dropped. Can be overridden manually.

On success, the model appears in the list with a colored dot and accuracy badge. Models are **sorted by accuracy (descending)** in both the list and the tab bar.

Each model item has:
- A colored **dot** (the model's assigned color, used throughout the UI)
- An **ⓘ** button — hover to see the full server path
- A **saved** badge — shown when the path is saved and will auto-reload on next startup
- A **✕** button — removes the model

### Step 4 — Browse single-model results

Click any model tab. The **Controls bar** shows three filter pills:

| Filter | Shows |
|---|---|
| **Failures** *(default)* | Cases where `prediction ≠ label` |
| **Correct** | Cases where `prediction = label` |
| **All** | All cases regardless of outcome |

### Step 5 — Compare two models

Once two or more models are loaded for the active benchmark, a **⇄ Compare** tab appears. Click it. The controls bar shows:

- **Left model** and **Right model** dropdowns
- A **cross-mode** selector:

| Mode | Meaning |
|---|---|
| Left fails, Right succeeds | Left is wrong AND Right is correct |
| Left succeeds, Right fails | Left is correct AND Right is wrong |
| Both fail | Both models are wrong |
| Both correct | Both models are correct |

Changing any selector immediately reloads the results.

### Reading a case card

Each case is displayed as a horizontal strip:

```
┌─────────────────────────────────────────────────────────────────┐
│  #42   GT: 3   ModelA: 2 ✗   ModelB: 3 ✓              [⤢ zoom] │
├──────┬──────────────────────────────────────────────────────────┤
│  Q   │  1      2      3      4      5                           │
│[img] │ [img]  [img]  [img]  [img]  [img]                        │
│      │  1     2     GT     4      5                             │
│      │       [A]  [B][GT]                                       │
└──────┴──────────────────────────────────────────────────────────┘
```

- **Q** — the query image, always shown first.
- **Numbered images** — the gallery; labels below show the 1-based position.
- **GT badge** (green) — the ground-truth position.
- **Model-name badge** (in the model's color) under the GT image — models that correctly predicted this position.
- **Model-name badge** under a non-GT image — models that wrongly predicted this position.
- **Green border** — ground-truth image.
- **Colored box-shadow** — wrong prediction (one ring per model, stacked outward).
- Hovering over any image shows a tooltip with the full file path.

### Zoom view

Click the **⤢** button in any card's header to open a full-size modal showing the same case with larger images (260 px height). Close with **✕**, clicking the backdrop, or pressing **Escape**.

### Pagination

Results are shown 20 per page. Use **‹** / **›** in the status bar to navigate. Any filter or model change resets to page 1.

### Collapsing the upload panel

Click **Hide Upload** in the header to collapse the panel and maximise the case grid. Click **Show Upload** to restore it.

### Session persistence

Paths loaded via server path are saved to `.saved_paths.json` automatically. On the next server startup, all benchmarks and models are restored — the browser will show the full session without any re-uploading. Deleting a model or benchmark removes it from the saved paths too.

File-upload sessions (drag-and-drop from your local machine) are **not** persisted — only server paths are.

---

## 8. Architecture

The app follows a minimal client–server architecture with no database and no build pipeline.

```
Browser (app.js + index.html)
        │  HTTP (fetch API)
        ▼
Flask server (app.py)
        │  os.path / send_file
        ▼
Local filesystem (images, JSON, CSV)
        │  read/write
        ▼
.saved_paths.json  (session persistence)
```

### 8.1 Backend (Flask)

**File:** `model_inspector/app.py`

All runtime state lives in a single module-level dict:

```python
_state = {
    'benchmarks': {
        'cropped_crossclothes_family_crosscamera': {
            'eval_cases':   [...],   # list of {query, gallery} dicts
            'display_name': 'cropped_crossclothes_family_crosscamera.json',
            'models': {
                'sft-qwen3b-DINOv2': {
                    'predictions': {0: {'label': 2, 'prediction': 2}, ...},
                    'accuracy': 77.3
                }
            }
        }
    }
}
```

Each benchmark is keyed by its **benchmark key** (JSON filename stem). Models are nested under their benchmark. This means models from different benchmarks are fully independent.

**Routes:**

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Serves `index.html` |
| `/api/upload_benchmark` | POST | Parses uploaded benchmark JSON (file upload) |
| `/api/load_benchmark_path` | POST | Loads benchmark from server path (file or folder) |
| `/api/upload_model` | POST | Parses uploaded prediction CSV (file upload) |
| `/api/load_model_path` | POST | Loads model predictions from server path (file or folder) |
| `/api/delete_model` | POST | Removes a model from a benchmark |
| `/api/delete_benchmark` | POST | Removes a benchmark and all its models |
| `/api/state` | GET | Returns full state summary (all benchmarks + models) |
| `/api/saved_paths` | GET | Returns the contents of `.saved_paths.json` |
| `/api/cases` | GET | Returns filtered + paginated cases for a benchmark/model |
| `/api/image` | GET | Streams an image from disk; returns grey placeholder if not found |

**Filename parsing** (`_parse_predictions_filename`):
When loading a folder of CSVs, each file is parsed as `predictions_{model_name}_{benchmark_key}.csv`. Two strategies are tried in order:
1. Match against loaded benchmark keys (longest first) — handles model names with underscores
2. Fallback: split at the first `_cropped_` occurrence

**Persistence** (`.saved_paths.json`):
```json
{
  "benchmarks": {
    "cropped_crossclothes_family_crosscamera": {
      "path": "/abs/path/cropped_crossclothes_family_crosscamera.json",
      "models": [
        {"name": "sft-qwen3b-DINOv2", "path": "/abs/path/predictions_sft-qwen3b-DINOv2_cropped_crossclothes_family_crosscamera.csv"}
      ]
    }
  }
}
```
Written on every `load_*_path` call; read at server startup by `_auto_load()`.

### 8.2 Frontend (Vanilla JS)

**Files:** `model_inspector/static/app.js`, `model_inspector/static/style.css`, `model_inspector/templates/index.html`

No framework, no build step. The frontend is organized around a single global state object `S`:

```javascript
const S = {
  benchmarks: {},       // bk -> {displayName, numCases, serverPath,
                        //        models: {name -> {accuracy, color, savedPath}}}
  activeBenchmark: null,

  activeTab:  null,     // model name | '__compare__'
  filter:     'failures',
  compareM1:  null,
  compareM2:  null,
  crossMode:  'fail_succeed',

  cases:     [],
  total:     0,
  page:      0,
  PAGE_SIZE: 20,
};
```

The rendering pipeline is unidirectional — user actions update `S`, then call render functions:

```
User action
    │
    ▼
Update S
    │
    ├── renderBenchmarkList()  → benchmark chips in upload panel
    ├── renderBenchmarkBar()   → benchmark pills below upload panel
    ├── renderModels()         → model list in upload panel (sorted by accuracy)
    ├── renderTabs()           → model tab bar (sorted by accuracy)
    ├── renderControls()       → filter pills or compare dropdowns
    ├── loadCases()            → fetches /api/cases, then:
    │       └── renderCases() → builds case card HTML
    └── renderStatusBar()      → case count + pagination
```

On page load, `initFromServer()` calls `/api/state` and `/api/saved_paths` in parallel to restore the full previous session without any user action.

**Model color assignment:** Each model receives the next color from a 6-entry palette (red → blue → orange → purple → pink → teal), cycling for more than 6 models. Colors are consistent across the model list, tab bar, case card badges, and image borders.

**Card rendering** (`renderCard`): For each gallery image:
- Is it the ground truth? → green border (`gt-border` class) + `GT` badge
- Did any model **correctly** predict it (i.e. it's the GT)? → colored badge per model
- Did any model **wrongly** predict it? → colored box-shadow ring + colored badge
- Both GT badges and correct-prediction badges appear under the GT image, making it easy to see at a glance which models got it right

### 8.3 Request / Response Flow

A walkthrough of loading a folder of CSVs and viewing a case:

```
1. User types a folder path and clicks Add Model
   → POST /api/load_model_path  {"path": "/run_dir/", "name": "", "benchmark": ""}
   ← {"batch": true, "loaded": [{"name":"sft-qwen3b-DINOv2", "benchmark_key":"cropped_...", "accuracy":77.3}, ...], "skipped": []}
   → For each loaded item: S.benchmarks[bk].models[name] = {accuracy, color, savedPath}
   → renderModels(), renderTabs(), switchTab(first model)

2. switchTab("sft-qwen3b-DINOv2") → loadCases()
   → GET /api/cases?benchmark=cropped_...&view=single&model=sft-qwen3b-DINOv2&type=failures&page=0&page_size=20
   ← {"cases": [...], "total": 34}
   → renderCases() → injects card HTML into #cases div
   → renderStatusBar() → "Showing 1–20 of 34 cases"

3. Browser renders <img src="/api/image?path=/abs/path/img.jpg">
   → GET /api/image?path=/abs/path/img.jpg
   ← image bytes with Cache-Control: public, max-age=3600
   (cache hit on subsequent loads of the same image)

4. User clicks ⤢ on a card
   → openZoom() reads data-case JSON from the card element
   → builds modal HTML from the same case data (no server call)
   → modal opens with 260px-tall images
```

---

## 9. API Reference

### `POST /api/upload_benchmark`

**Request:** `multipart/form-data` with field `file` (`.json`). Path is **not** saved (no stable server path for uploaded files).

**Success response:**
```json
{ "status": "ok", "benchmark_key": "cropped_crossclothes_family_crosscamera",
  "num_cases": 150, "name": "cropped_crossclothes_family_crosscamera.json" }
```

---

### `POST /api/load_benchmark_path`

**Request:** `application/json` — `{ "path": "/abs/path/benchmark.json" }` or `{ "path": "/abs/folder/" }`

**Single file success:**
```json
{ "status": "ok", "benchmark_key": "cropped_crossclothes_family_crosscamera",
  "num_cases": 150, "name": "cropped_crossclothes_family_crosscamera.json" }
```

**Folder success:**
```json
{ "batch": true,
  "loaded": [{"benchmark_key": "...", "num_cases": 150, "name": "..."}],
  "skipped": ["other.json"] }
```

---

### `POST /api/upload_model`

**Request:** `multipart/form-data` with fields `name`, `file` (`.csv`), and optionally `benchmark` (benchmark key). Path is **not** saved.

**Success response:**
```json
{ "status": "ok", "name": "ModelA", "benchmark_key": "cropped_...", "accuracy": 72.5 }
```

---

### `POST /api/load_model_path`

**Request:** `application/json` — `{ "path": "/abs/path/predictions.csv", "name": "ModelA", "benchmark": "cropped_..." }` or `{ "path": "/abs/folder/" }`. `name` and `benchmark` are optional when using the standard filename convention.

**Single file success:** same shape as `upload_model`.

**Folder success:**
```json
{ "batch": true,
  "loaded": [{"name": "sft-qwen3b-DINOv2", "benchmark_key": "cropped_...", "accuracy": 77.3}],
  "skipped": [{"file": "predictions_xyz.csv", "reason": "benchmark \"xyz\" not loaded"}] }
```

---

### `POST /api/delete_model`

**Request:** `application/json` — `{ "name": "ModelA", "benchmark": "cropped_..." }`

**Response:** `{ "status": "ok" }`

---

### `POST /api/delete_benchmark`

**Request:** `application/json` — `{ "benchmark": "cropped_..." }`

**Response:** `{ "status": "ok" }`

---

### `GET /api/state`

**Response:**
```json
{
  "benchmarks": {
    "cropped_crossclothes_family_crosscamera": {
      "display_name": "cropped_crossclothes_family_crosscamera.json",
      "num_cases": 150,
      "models": {
        "sft-qwen3b-DINOv2": { "accuracy": 77.3 }
      }
    }
  }
}
```

---

### `GET /api/saved_paths`

**Response:**
```json
{
  "benchmarks": {
    "cropped_crossclothes_family_crosscamera": {
      "path": "/abs/path/cropped_crossclothes_family_crosscamera.json",
      "models": [
        {"name": "sft-qwen3b-DINOv2", "path": "/abs/path/predictions_sft-qwen3b-DINOv2_cropped_crossclothes_family_crosscamera.csv"}
      ]
    }
  }
}
```

---

### `GET /api/cases`

**Query parameters:**

| Parameter | Values | Default | Description |
|---|---|---|---|
| `benchmark` | benchmark key | `""` | Which benchmark to query |
| `view` | `single`, `compare` | `single` | Single-model or cross-model view |
| `model` | model name | `""` | Primary model |
| `type` | `failures`, `correct`, `all` | `failures` | Filter (single view only) |
| `model2` | model name | `""` | Secondary model (compare view only) |
| `cross_mode` | `fail_succeed`, `succeed_fail`, `both_fail`, `both_correct` | `fail_succeed` | Cross-model subset (compare view only) |
| `page` | int ≥ 0 | `0` | 0-based page index |
| `page_size` | int > 0 | `20` | Results per page |

**Response:**
```json
{
  "cases": [
    {
      "idx": 5,
      "query": "/abs/path/query.jpg",
      "gallery": ["/abs/path/g1.jpg", "/abs/path/g2.jpg"],
      "label": 2,
      "models": { "ModelA": 1, "ModelB": 2 }
    }
  ],
  "total": 47
}
```

---

### `GET /api/image`

**Query parameters:** `path` — absolute filesystem path to the image.

**Response:** Raw image bytes with `Cache-Control: public, max-age=3600`. Returns a 100×150 grey PNG placeholder if the path does not exist.

---

## 10. Visual Encoding Reference

| Visual element | Meaning |
|---|---|
| **Green border** on gallery image | Ground-truth match |
| **Colored box-shadow** on gallery image | A model wrongly predicted this position (one ring per model, stacked outward) |
| **GT badge** (green) below image | This is the ground-truth position |
| **Colored model-name badge** under GT image | This model correctly predicted this position |
| **Colored model-name badge** under non-GT image | This model incorrectly predicted this position |
| **Header tag** `ModelA: 2 ✗` | Model A predicted position 2 (wrong) |
| **Header tag** `ModelA: 3 ✓` | Model A predicted position 3 (correct) |
| **Colored dot** in model list | The model's assigned color — consistent across list, tabs, badges, borders |
| **saved badge** in model list | Path is saved; model will be auto-loaded on next server startup |
| **ⓘ button** on benchmark / model | Hover to see the full server path of the loaded file |

---

## 11. Adapting for Your Own Task

The app is built around a specific data contract (re-ID with query + gallery), but it is straightforward to adapt.

### Support multiple benchmarks out of the box

The app already supports multiple benchmarks simultaneously — just load multiple JSON files. Each benchmark maintains its own model predictions and is accessible via its pill in the benchmark bar.

### Change the task structure

If your task doesn't have a gallery (e.g. binary classification), simplify `renderCard` in `app.js` to just show the query image and label/prediction tags. The backend `_make_case` function controls what fields are sent — add or remove fields there and update the card renderer.

### Change the answer space

The app assumes 1-based integer positions. For string labels or class names:
1. Remove the `int()` casts in `_ingest_model` in `app.py`.
2. In `app.js → renderCard`, update comparisons from `pos === label` to string equality.

### Change the benchmark JSON key

The backend looks for `data["eval_cases"]`. To use a different key:
```python
# app.py
if 'eval_cases' not in data:   # ← change 'eval_cases' to your key
```

### Change the CSV column names

```python
# app.py — in _ingest_model()
if not {'gt', 'pred'}.issubset(df.columns):   # rename as needed
    ...
preds = {
    int(idx): {'label': int(row['gt']), 'prediction': int(row['pred'])}
    ...
}
```

### Change the filename convention for auto-parsing

The `_parse_predictions_filename` fallback looks for `_cropped_` as the separator between model name and benchmark key. For a different naming scheme, update the `marker` variable:
```python
# app.py — in _parse_predictions_filename()
marker = '_cropped_'   # ← change to match your convention
```

### Change the page size

```javascript
// app.js
PAGE_SIZE: 20,   // change to 50, 100, etc.
```

### Change the color palette

```javascript
// app.js — top of file
const PALETTE = [
  { border: '#ef4444', bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444' }, // red
  // add or change entries — each needs: border, bg, text, dot
];
```

### Run on a different port

```python
# app.py
app.run(debug=True, port=8080)
```

---

## 12. Extending the App

**Sorting cases** — Add a sort dropdown (by case index, GT position, etc.) and apply it on the results list before pagination in `app.py`.

**Export current view** — Add a "Download" button that calls `/api/cases` with `page_size=9999` and converts the JSON to a CSV.

**Top-K predictions** — Extend the CSV format with `prediction_2`, `prediction_3`, etc. and show rank-2/3 predictions with lighter borders.

**Confidence scores** — Add a `score` column to the CSV, pass it through `_make_case`, and render a small bar or number under each gallery image.

**Cross-benchmark model comparison** — Show the same model's accuracy across all loaded benchmarks in a summary table at the top of each model tab.

**Persistent notes** — Add a text field per case card that saves observations to a JSON file for later review.
