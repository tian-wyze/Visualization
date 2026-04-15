# Data Inspector

A local web application for **visually reviewing the quality of gallery images** used in person re-identification research. Load one or more household-info JSON files, browse all images for each identity, and quickly spot labeling errors, low-quality crops, or unexpected appearances — all in the browser.

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
8. [API Reference](#8-api-reference)
9. [Adapting for Your Own Data](#9-adapting-for-your-own-data)

---

## 1. Overview

The input is a **household-info JSON** — a three-level hierarchy:

```
household_id  →  identity_id  →  mac_addr  →  [image_paths]
```

This structure comes from `clean_gallery.py`, which groups person re-ID images by the household they belong to, the person's identity within that household, and the camera (MAC address) that captured them.

The app addresses the core quality-review workflow:

| Need | What the app provides |
|---|---|
| "How many households / identities / images do I have?" | Stats bar on every page load |
| "Show me all images for one person" | Identity cards — one card per identity, all images inline |
| "Show me everyone in one household" | Household filter dropdown |
| "Find a specific identity" | Text search on identity ID or household ID |
| "Look closely at one image" | Click any thumbnail → full-screen zoom with ←/→ navigation |
| "Compare images across cameras" | Multi-MAC identities group images by camera within each card |
| "Work across multiple datasets" | Load several JSON files; switch via the gallery tab bar |

The app is **local-only** — images are served directly from their absolute paths on disk. No data leaves your machine.

Loaded server paths are **automatically restored** on restart via `.saved_paths.json`.

---

## 2. Dependencies

| Package | Purpose | Minimum version |
|---|---|---|
| `flask` | HTTP server and routing | 3.0 |
| `pillow` | Placeholder images for missing paths | 10.0 |

No `pandas` required. The frontend is plain HTML + CSS + JavaScript — no build step, no Node.js.

---

## 3. Environment Setup

```bash
# Create the shared environment (only needed once)
conda create -n visualization python=3.11 flask pandas pillow -y

# Activate each session
conda activate visualization
```

Or install into an existing environment:

```bash
pip install -r requirements.txt
```

---

## 4. Data Format Specification

### 4.1 Household-info JSON

```json
{
  "10026312": {
    "10026312_0": {
      "D03F278DF935": {
        "query":   ["/abs/path/query/10026312_0_D03F278DF935_..._000.jpg", "..."],
        "gallery": ["/abs/path/gallery/10026312_0_D03F278DF935_..._000.jpg", "..."]
      }
    },
    "10026312_1": {
      "D03F27D378A0": { "query": [],   "gallery": ["/abs/path/gallery/..."] },
      "D03F278E4D88": { "query": ["..."], "gallery": [] }
    }
  },
  "10061519_10063716": { ... }
}
```

**Key rules:**
- Top-level keys are **household IDs**.
- Second-level keys are **identity IDs** (convention: `{household_id}_{person_index}`).
- Third-level keys are **MAC addresses** (camera identifiers).
- Leaf values are dicts with two keys: **`"query"`** and **`"gallery"`**, each a list of absolute image paths.
- An identity may appear under multiple MAC addresses. In cross-camera scenarios a MAC may have only query images (probe camera) or only gallery images (gallery camera), or both.
- Either list may be empty; the app renders only the non-empty list(s).
- The app also accepts the older flat-list format (`{mac: [paths]}`, treated as gallery-only) for backward compatibility.
- This is the exact format produced by `clean_gallery.py → check_household_info()`.

### 4.2 How this file is generated

```python
# clean_gallery.py (excerpt)
household_dict = get_household_info(gallery_image_list, data_folder)
save_json(household_dict, 'household_info_v2_cross_clothes.json')
```

The JSON is keyed by filename stems — household IDs and identity IDs are parsed from image filenames using `parse_household_id()` and `parse_id()` in `clean_gallery.py`.

### 4.3 Multiple JSON files

You can load both `household_info_v2_same_clothes.json` and `household_info_v2_cross_clothes.json` simultaneously. Each appears as a separate tab in the gallery bar and maintains independent filter state.

---

## 5. Running the App

```bash
# 1. Navigate to this directory
cd /path/to/Visualization/data_inspector

# 2. Activate the environment
conda activate visualization

# 3. Start the server
python app.py
```

Expected output:
```
Starting Data Inspector on http://localhost:5001
[auto-load] Gallery "household_info_v2_cross_clothes": 404 households, 626 identities, 9405 images
 * Running on http://127.0.0.1:5001
```

Open **http://localhost:5001** in your browser. Press `Ctrl+C` to stop.

> **Note:** The server runs in Flask development mode (`debug=True`). It auto-reloads when you edit `app.py`. Do not expose it on a public network.

> **Remote server tip:** If the server is running on a remote machine, use the server path input to load files — the browser's file picker opens the *local* filesystem, which won't have the data.

---

## 6. Using the App — UI Walkthrough

### Layout overview

```
┌─────────────────────────────────────────────────────┐
│  Header bar  (title + Hide Upload button)           │
├─────────────────────────────────────────────────────┤
│  Upload panel  [gallery list] [drop zone / path]    │  ← collapsible
├─────────────────────────────────────────────────────┤
│  [gallery1] [gallery2]  ←  Gallery tab bar          │
├─────────────────────────────────────────────────────┤
│  404 HH | 626 ids | 9,405 imgs | 235 single | ...   │  ← Stats bar
├─────────────────────────────────────────────────────┤
│  Household: [All ▼]  HH size: [Any ▼]  Search: [……]  Sort: […▼]  10▼ │  ← Controls
├─────────────────────────────────────────────────────┤
│  Showing 1–10 of 626 identities  ‹ 1/63 ›          │  ← Status bar
├─────────────────────────────────────────────────────┤
│  [Identity cards…]                                  │  ← Main content
└─────────────────────────────────────────────────────┘
```

### Step 1 — Load a gallery JSON

**Option A — File upload (local machine):**
Drag and drop a `.json` onto the drop zone, or click it to open a file picker.

**Option B — Server path (recommended for remote servers):**
Type or paste an absolute path and press **Enter** or click **Load**:
- `/path/to/household_info.json` — single file
- `/path/to/folder/` — scans for all `*.json` files in the folder

On success, a green chip appears in the upload panel and a tab appears in the gallery bar. The stats bar and identity cards load immediately.

Each gallery chip has:
- An **ⓘ** button — hover to see the full server path
- A **saved** badge — shown when the path will be auto-reloaded on next restart
- A **✕** button — removes the gallery

### Step 2 — Switch between galleries

Click any tab in the **Gallery bar** (visible when two or more galleries are loaded). Each gallery has independent filter and sort state.

### Step 3 — Read the stats bar

| Stat | Meaning |
|---|---|
| **Households** | Total distinct household IDs |
| **Identities** | Total distinct identity IDs |
| **Query imgs** *(blue)* | Total query images across all identities |
| **Gallery imgs** *(green)* | Total gallery images across all identities |
| **Singleton HH** | Households with exactly one identity |
| **Family HH** | Households with two or more identities |
| **Avg imgs / id** | Mean total images (query + gallery) per identity |
| **Min–Max imgs** | Range of per-identity total image counts |

### Step 4 — Filter and search

**Household filter** — dropdown listing every household ID with its identity count and image count. Select one to show only identities from that household. Selecting a specific household clears the HH size filter.

**HH size filter** — dropdown showing the full household-size distribution for the active gallery (e.g. "1 identity (235 households)", "2 identities (131 households)", …). Select a size to show only identities from households with exactly that many members. Selecting a size clears the specific-household filter.

**Search box** — type any substring to filter on identity ID or household ID (300 ms debounce).

**Sort** — four options:
| Option | Order |
|---|---|
| By household *(default)* | Household ID alphabetically, then identity ID |
| By identity ID | Identity ID alphabetically |
| Most images first | Descending by total image count |
| Fewest images first | Ascending by total image count |

**Per page** — 10 / 20 / 50 identity cards per page.

### Step 5 — Browse identity cards

Each card represents one identity:

```
┌─────────────────────────────────────────────────────────────────────┐
│ HOUSEHOLD  10026312   IDENTITY  10026312_1   Q 20  G 18  2 cameras  │
├─────────────────────────────────────────────────────────────────────┤
│ MAC  D03F278E4D88   Q: 20                                           │
│ [Q] [img][img][img][img][img][img][img][img][img][img]... →         │
│ MAC  D03F27D378A0   G: 18                                           │
│ [G] [img][img][img][img][img][img][img][img][img][img]... →         │
└─────────────────────────────────────────────────────────────────────┘
```

- The card **header** shows labeled fields: `HOUSEHOLD`, `IDENTITY`, query/gallery image counts (**Q** in blue, **G** in green), and a cameras badge when multiple MACs are present.
- The **MAC header** is always shown (even for single-MAC identities), labeled with `MAC` in purple.
- Each MAC group has **two rows**: query images on top (blue `Q` pill), gallery images below (green `G` pill). Only non-empty rows are rendered — a MAC with only query images shows one row; a MAC with only gallery images shows one row.
- Images use `loading="lazy"` — only visible thumbnails are fetched initially.
- Hover any thumbnail to see its full file path as a tooltip.

### Step 6 — Zoom into an image

Click any thumbnail to open the **zoom modal**:
- The image is displayed at up to 60 % of the viewport height.
- The full file path is shown below the image.
- A counter shows the position within the identity (e.g. `3 / 20`).
- Use the **←** / **→** buttons, or the **left / right arrow keys**, to navigate through all images for that identity across all cameras.
- Close with **✕**, by clicking the backdrop, or pressing **Escape**.

### Pagination

Use **‹** / **›** in the status bar to move between pages. Any filter or sort change resets to page 1. The page counter updates live.

### Collapsing the upload panel

Click **Hide Upload** in the header to collapse the panel and maximise the card grid. Click **Show Upload** to restore it.

### Session persistence

Paths loaded via server path are saved to `.saved_paths.json`. On the next `python app.py`, all galleries are restored automatically. File-upload sessions (drag-and-drop from local machine) are **not** persisted.

---

## 7. Architecture

```
Browser (app.js + index.html)
        │  HTTP (fetch API)
        ▼
Flask server (app.py)                     port 5001
        │  os.path / send_file
        ▼
Local filesystem (images, JSON)
        │  read/write
        ▼
.saved_paths.json  (session persistence)
```

### 7.1 Backend (Flask)

All runtime state lives in a single module-level dict:

```python
_state = {
    'galleries': {
        'household_info_v2_cross_clothes': {
            'display_name': 'household_info_v2_cross_clothes.json',
            'server_path':  '/abs/path/household_info_v2_cross_clothes.json',
            'identities': [
                {
                    'identity_id':  '10026312_0',
                    'household_id': '10026312',
                    'images_by_mac': {
                        'D03F278DF935': {
                            'query':   ['/abs/path/query/img1.jpg', ...],
                            'gallery': ['/abs/path/gallery/img1.jpg', ...],
                        }
                    },
                    'num_query':    19,
                    'num_gallery':  20,
                    'total_images': 39,
                    'num_macs':     1,
                },
                ...
            ],
            'stats': {
                'num_households':           404,
                'num_identities':           626,
                'num_images':               18645,
                'num_query_images':         9240,
                'num_gallery_images':       9405,
                'num_singleton_households': 235,
                'num_family_households':    169,
                'avg_images_per_identity':  29.8,
                'max_images_per_identity':  40,
                'min_images_per_identity':  10,
            }
        }
    }
}
```

The `identities` list is **pre-sorted** by `(household_id, identity_id)` at load time. All filtering and sorting for `/api/identities` is done in Python at request time (no database).

**Routes:**

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Serves `index.html` |
| `/api/upload_gallery` | POST | Parses uploaded JSON (file upload; path not saved) |
| `/api/load_gallery_path` | POST | Loads JSON from server path or folder |
| `/api/delete_gallery` | POST | Removes a gallery from state and saved paths |
| `/api/state` | GET | Summary of all loaded galleries (stats, no image lists) |
| `/api/saved_paths` | GET | Contents of `.saved_paths.json` |
| `/api/households` | GET | Per-household identity and image counts |
| `/api/identities` | GET | Filtered, sorted, paginated identity list with full image data |
| `/api/image` | GET | Streams image from disk; grey placeholder if not found |

### 7.2 Frontend (Vanilla JS)

Global state object `S`:

```javascript
const S = {
  galleries:       {},     // gk -> {displayName, stats, serverPath}
  activeGallery:   null,
  households:      [],     // [{household_id, num_identities, num_images}]
  householdFilter: '',
  searchQuery:     '',
  sortBy:          'household',
  identities:      [],     // current page
  total:           0,
  page:            0,
  PAGE_SIZE:       10,
  zoomImages:      [],     // [{path, mac, identity_id, household_id}]
  zoomIndex:       0,
};
```

Image click handlers use a module-level `_cardImages` map (keyed by `"{page}-{cardIndex}"`) rather than embedding JSON in HTML attributes — this keeps the rendered HTML clean and avoids attribute-escaping issues.

On page load, `initFromServer()` calls `/api/state` and `/api/saved_paths` in parallel to restore the full previous session.

---

## 8. API Reference

### `POST /api/upload_gallery`
`multipart/form-data` with `file` (`.json`). Path is not saved.

**Response:** `{ "status": "ok", "gallery_key": "...", "display_name": "...", "stats": {...} }`

### `POST /api/load_gallery_path`
`{ "path": "/abs/path/household_info.json" }` or `{ "path": "/abs/folder/" }`

**Single file:** same shape as `upload_gallery`.

**Folder:** `{ "batch": true, "loaded": [...], "skipped": [{"file": "...", "reason": "..."}] }`

### `POST /api/delete_gallery`
`{ "gallery": "gallery_key" }` → `{ "status": "ok" }`

### `GET /api/state`
```json
{
  "galleries": {
    "household_info_v2_cross_clothes": {
      "display_name": "household_info_v2_cross_clothes.json",
      "server_path": "/abs/path/...",
      "stats": { "num_households": 404, "num_identities": 626, ... }
    }
  }
}
```

### `GET /api/households`
`?gallery=household_info_v2_cross_clothes`

```json
{
  "households": [
    { "household_id": "10026312", "num_identities": 2, "num_images": 38 },
    ...
  ]
}
```

### `GET /api/identities`

| Parameter | Values | Default | Description |
|---|---|---|---|
| `gallery` | gallery key | `""` | Which gallery to query |
| `household` | household ID | `""` | Filter to one specific household |
| `hh_size` | int string | `""` | Filter to households with exactly this many identities |
| `search` | string | `""` | Substring match on identity/household ID |
| `sort_by` | `household`, `identity`, `images_desc`, `images_asc` | `household` | Sort order |
| `page` | int ≥ 0 | `0` | 0-based page index |
| `page_size` | int > 0 | `10` | Results per page |

```json
{
  "identities": [
    {
      "identity_id":  "10026312_0",
      "household_id": "10026312",
      "images_by_mac": {
        "D03F278DF935": {
          "query":   ["/abs/path/query/img1.jpg", "..."],
          "gallery": ["/abs/path/gallery/img1.jpg", "..."]
        }
      },
      "num_query":    19,
      "num_gallery":  20,
      "total_images": 39,
      "num_macs":     1
    }
  ],
  "total": 626
}
```

### `GET /api/image`
`?path=/abs/path/image.jpg` — raw image bytes with `Cache-Control: max-age=3600`.
Returns an 80×120 grey PNG placeholder if the path does not exist.

---

## 9. Adapting for Your Own Data

### Use a different JSON hierarchy

The backend looks for three nesting levels: household → identity → mac → images. To use a different structure, update `_ingest_gallery()` in `app.py` and adjust the `renderCard()` function in `app.js`.

### Remove MAC-address grouping

If your data has no camera-level split, flatten `images_by_mac` to a single `"all"` key in `_ingest_gallery`:

```python
images_by_mac = {'all': [path for paths in identity_data.values() for path in paths]}
```

Then in `app.js → renderCard`, set `multiMac = false` unconditionally so the MAC header is never shown.

### Change the page size default

```javascript
// app.js
PAGE_SIZE: 10,  // change to 20, 50, etc.
```

### Change the thumbnail height

```css
/* style.css */
.img-thumb img { height: 110px; }   /* change to 80px, 150px, etc. */
```

### Change the zoom image height

```css
/* style.css */
#zoom-img { max-height: 60vh; }     /* change to 70vh, 80vh, etc. */
```

### Run on a different port

```python
# app.py
app.run(debug=True, port=5002)
```
