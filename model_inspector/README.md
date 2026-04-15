# Model Inspector

A local web application for visually diagnosing failure cases in **image-retrieval / re-identification** models. Given one or more benchmark JSON files and model prediction CSVs, the app lets you browse failures, correct predictions, and cross-model comparisons side by side in the browser — across multiple benchmarks simultaneously.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Dependencies](#2-dependencies)
3. [Environment Setup](#3-environment-setup)
4. [Data Format Specification](#4-data-format-specification)
5. [Running the App](#5-running-the-app)
6. [Using the App — UI Walkthrough](#6-using-the-app--ui-walkthrough)
7. [Architecture](#7-architecture)
   - [Backend (Flask)](#71-backend-flask)
   - [Frontend (Vanilla JS)](#72-frontend-vanilla-js)
   - [Request / Response Flow](#73-request--response-flow)
8. [API Reference](#8-api-reference)
9. [Visual Encoding Reference](#9-visual-encoding-reference)
10. [Adapting for Your Own Task](#10-adapting-for-your-own-task)
11. [Extending the App](#11-extending-the-app)

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

## 2. Dependencies

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

## 3. Environment Setup

```bash
# Create the environment (only needed once)
conda create -n visualization python=3.11 flask pandas pillow -y

# Activate it every time you start a new terminal session
conda activate visualization
```

### Alternative: install into an existing environment

```bash
conda activate <your-env>
pip install -r requirements.txt
```

---

## 4. Data Format Specification

The app expects two types of input files: **benchmark JSONs** and **prediction CSVs**.

### 4.1 Benchmark JSON

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
- Gallery size can vary across cases.
- Case indices are **implicit**: `eval_cases[0]` is case `idx=0`, etc.
- The **benchmark key** is derived from the JSON filename stem (e.g. `cropped_crossclothes_family_crosscamera.json` → key `cropped_crossclothes_family_crosscamera`).
- If an image path does not exist on disk, the app shows a grey "Not Found" placeholder.

### 4.2 Prediction CSV

One CSV file per model per benchmark. Each row records the model's prediction for one test case.

```
idx,label,prediction
0,3,3
1,2,1
2,5,5
3,1,4
4,2,2
```

| Column | Type | Description |
|---|---|---|
| `idx` | int | 0-based index into `eval_cases` |
| `label` | int | Ground-truth gallery position (1-indexed) |
| `prediction` | int | Model's predicted gallery position (1-indexed) |

Rows where `label == prediction` are correct; all others are failures.

### 4.3 Prediction CSV filename convention

```
predictions_{model_name}_{benchmark_key}.csv
```

Examples:
```
predictions_sft-qwen3b-DINOv2_cropped_crossclothes_family_crosscamera.csv
  → model: sft-qwen3b-DINOv2   benchmark: cropped_crossclothes_family_crosscamera

predictions_gemini_gemini-2.5-pro_cropped_crossclothes_family_crosscamera.csv
  → model: gemini              benchmark: gemini-2.5-pro_cropped_crossclothes_family_crosscamera
```

When benchmarks are already loaded, the server strips the longest matching benchmark key from the end — this correctly handles model names containing underscores. If the filename doesn't follow the convention, enter the model name and benchmark manually in the Add Model form.

---

## 5. Running the App

```bash
# 1. Navigate to this directory
cd /path/to/Visualization/model_inspector

# 2. Activate the environment
conda activate visualization

# 3. Start the server
python app.py
```

Expected output:
```
Starting Model Inspector on http://localhost:5000
[auto-load] Benchmark "cropped_crossclothes_family_crosscamera": 150 cases
[auto-load] Model "sft-qwen3b-DINOv2" → "cropped_crossclothes_family_crosscamera": 77.3%
 * Running on http://127.0.0.1:5000
```

Open **http://localhost:5000** in your browser. Press `Ctrl+C` to stop.

> **Remote server tip:** If running on a remote machine, use the server path inputs to load files — the browser's file picker opens the *local* filesystem, which won't have the data.

---

## 6. Using the App — UI Walkthrough

### Layout overview

```
┌─────────────────────────────────────────────────────┐
│  Header bar  (title + Hide Upload button)           │
├──────────────────────┬──────────────────────────────┤
│  1 · Benchmarks      │  2 · Model Predictions       │  ← Upload panel (collapsible)
│  [bench chips]       │  [model list]                │
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
│  [Case cards…]                                      │  ← Main content
└─────────────────────────────────────────────────────┘
```

### Step 1 — Load benchmarks

**File upload:** Drag and drop a `.json` onto the drop zone, or click to pick a file.

**Server path:** Type or paste an absolute path and press **Enter** or click **Load**:
- `/path/to/benchmark.json` — single file
- `/path/to/folder/` — scans for all `*.json` files with an `eval_cases` key

### Step 2 — Switch between benchmarks

Click any pill in the **Benchmark bar**. Each benchmark maintains its own independent model set.

### Step 3 — Add model predictions

Click **+ Add Model** and provide:
1. **Model name** — display label (auto-parsed when using the standard filename convention)
2. **CSV source** — file upload or server path (folder scan supported)
3. **Benchmark** — auto-detected from filename; can be overridden

Models are sorted by accuracy (descending) in the list and tab bar.

### Step 4 — Browse single-model results

Click any model tab. Use the **Controls bar** filter pills:

| Filter | Shows |
|---|---|
| **Failures** *(default)* | `prediction ≠ label` |
| **Correct** | `prediction = label` |
| **All** | All cases |

### Step 5 — Compare two models

With two or more models loaded, click **⇄ Compare**. Select left/right models and a cross-mode:

| Mode | Meaning |
|---|---|
| Left fails, Right succeeds | Left wrong AND Right correct |
| Left succeeds, Right fails | Left correct AND Right wrong |
| Both fail | Both wrong |
| Both correct | Both correct |

### Reading a case card

```
┌──────────────────────────────────────────────────────────────────┐
│  #42   GT: 3   ModelA: 2 ✗   ModelB: 3 ✓              [⤢ zoom] │
├──────┬───────────────────────────────────────────────────────────┤
│  Q   │  1      2      3      4      5                            │
│[img] │ [img]  [img]  [img]  [img]  [img]                         │
│      │        [A]  [B][GT]                                        │
└──────┴───────────────────────────────────────────────────────────┘
```

- **Green border** — ground-truth image
- **Colored box-shadow** — wrong prediction (one ring per model)
- **Model-name badge** under GT image — models that predicted correctly
- **Model-name badge** under non-GT image — models that predicted this (incorrectly)
- Click **⤢** for a full-size zoom modal (260 px height); close with **✕**, backdrop, or `Esc`

---

## 7. Architecture

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

### 7.1 Backend (Flask)

All runtime state lives in a single module-level dict:

```python
_state = {
    'benchmarks': {
        'cropped_crossclothes_family_crosscamera': {
            'eval_cases':   [...],
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

**Routes:**

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Serves `index.html` |
| `/api/upload_benchmark` | POST | Parses uploaded benchmark JSON |
| `/api/load_benchmark_path` | POST | Loads benchmark from server path or folder |
| `/api/upload_model` | POST | Parses uploaded prediction CSV |
| `/api/load_model_path` | POST | Loads model predictions from server path or folder |
| `/api/delete_model` | POST | Removes a model |
| `/api/delete_benchmark` | POST | Removes a benchmark and all its models |
| `/api/state` | GET | Full state summary |
| `/api/saved_paths` | GET | Contents of `.saved_paths.json` |
| `/api/cases` | GET | Filtered + paginated cases |
| `/api/image` | GET | Streams image; grey placeholder if not found |

### 7.2 Frontend (Vanilla JS)

Global state object `S` drives all rendering:

```javascript
const S = {
  benchmarks: {},       // bk -> {displayName, numCases, serverPath, models: {...}}
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

Rendering is unidirectional: user actions update `S`, then call render functions. On page load, `initFromServer()` restores the full previous session by calling `/api/state` and `/api/saved_paths` in parallel.

### 7.3 Request / Response Flow

```
1. User loads a folder of CSVs
   → POST /api/load_model_path  {"path": "/run_dir/"}
   ← {"batch": true, "loaded": [...], "skipped": [...]}

2. switchTab("sft-qwen3b-DINOv2") → loadCases()
   → GET /api/cases?benchmark=...&view=single&model=...&type=failures&page=0
   ← {"cases": [...], "total": 34}

3. <img src="/api/image?path=/abs/path/img.jpg">
   ← image bytes (Cache-Control: max-age=3600)

4. Click ⤢ → openZoom() reads data from card element → modal, no server call
```

---

## 8. API Reference

### `POST /api/upload_benchmark`
`multipart/form-data` with `file` (`.json`). Path not saved.

**Response:** `{ "status": "ok", "benchmark_key": "...", "num_cases": 150, "name": "..." }`

### `POST /api/load_benchmark_path`
`{ "path": "/abs/path/benchmark.json" }` or `{ "path": "/abs/folder/" }`

Folder response: `{ "batch": true, "loaded": [...], "skipped": ["other.json"] }`

### `POST /api/upload_model`
`multipart/form-data` with `name`, `file` (`.csv`), optional `benchmark`.

**Response:** `{ "status": "ok", "name": "ModelA", "benchmark_key": "...", "accuracy": 72.5 }`

### `POST /api/load_model_path`
`{ "path": "...", "name": "ModelA", "benchmark": "..." }` — `name` and `benchmark` optional with standard filename convention.

### `POST /api/delete_model`
`{ "name": "ModelA", "benchmark": "..." }`

### `POST /api/delete_benchmark`
`{ "benchmark": "..." }`

### `GET /api/cases`

| Parameter | Values | Default | Description |
|---|---|---|---|
| `benchmark` | benchmark key | `""` | Which benchmark |
| `view` | `single`, `compare` | `single` | Single-model or cross-model |
| `model` | model name | `""` | Primary model |
| `type` | `failures`, `correct`, `all` | `failures` | Filter (single view) |
| `model2` | model name | `""` | Secondary model (compare view) |
| `cross_mode` | `fail_succeed`, `succeed_fail`, `both_fail`, `both_correct` | `fail_succeed` | Cross-model subset |
| `page` | int ≥ 0 | `0` | 0-based page |
| `page_size` | int > 0 | `20` | Results per page |

**Response:** `{ "cases": [...], "total": 47 }`

### `GET /api/image`
`?path=/abs/path/img.jpg` — raw image bytes with `Cache-Control: max-age=3600`, or 100×150 grey PNG placeholder.

---

## 9. Visual Encoding Reference

| Element | Meaning |
|---|---|
| Green border on gallery image | Ground-truth match |
| Colored box-shadow on gallery image | A model wrongly predicted this position |
| **GT badge** (green) below image | Ground-truth position |
| Colored model-name badge under GT image | This model predicted correctly |
| Colored model-name badge under non-GT image | This model predicted incorrectly |
| Header tag `ModelA: 2 ✗` | Model A predicted position 2 (wrong) |
| Header tag `ModelA: 3 ✓` | Model A predicted position 3 (correct) |
| Colored dot in model list | Model's assigned color — consistent throughout UI |
| **saved** badge | Path is saved; will auto-load on next restart |

---

## 10. Adapting for Your Own Task

### Support a different gallery structure

The app assumes 1-based integer positions. For string labels:
1. Remove the `int()` casts in `_ingest_model` in `app.py`.
2. In `renderCard` in `app.js`, update comparisons from `pos === label` to string equality.

### Change the benchmark JSON key

```python
# app.py
if 'eval_cases' not in data:   # ← change to your key
```

### Change the CSV column names

```python
# app.py — in _ingest_model()
if not {'label', 'prediction'}.issubset(df.columns):  # rename as needed
```

### Change the filename convention separator

```python
# app.py — in _parse_predictions_filename()
marker = '_cropped_'   # ← change to match your scheme
```

### Change the page size

```javascript
// app.js
PAGE_SIZE: 20,  // change to 50, 100, etc.
```

### Run on a different port

```python
# app.py
app.run(debug=True, port=8080)
```

---

## 11. Extending the App

- **Sorting cases** — Add a sort dropdown and apply it before pagination in `app.py → /api/cases`.
- **Export current view** — "Download CSV" button calling `/api/cases` with `page_size=9999`.
- **Top-K predictions** — Extend CSV with `prediction_2`, `prediction_3`; show rank-2/3 with lighter borders.
- **Confidence scores** — Add a `score` column; render a bar or number under each gallery image.
- **Cross-benchmark model summary** — Table showing the same model's accuracy across all benchmarks.
- **Persistent notes** — Per-case text field saved to a sidecar JSON file.
