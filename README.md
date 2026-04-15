# Visualization

A collection of visual diagnostic tools for **person re-identification** research.

---

## Directory Structure

```
Visualization/
│
├── README.md                          ← This file (directory overview)
│
├── model_inspector/                   ← Web app: inspect model prediction failures
│   ├── README.md
│   ├── app.py
│   ├── requirements.txt
│   ├── templates/index.html
│   └── static/{app.js, style.css}
│
├── data_inspector/                    ← Web app: review gallery image quality
│   ├── README.md
│   ├── app.py
│   ├── requirements.txt
│   ├── templates/index.html
│   └── static/{app.js, style.css}
│
└── python_plots/                      ← Standalone matplotlib scripts
    ├── visual_examples/               ← Plot query+gallery grids from benchmark JSON
    │   └── plot_visual_examles.py
    └── benchmark_bar_plot/            ← Bar charts comparing model accuracy
        └── plot_bar_benchmarks.py
```

---

## Tools at a Glance

### Model Inspector &nbsp;·&nbsp; `model_inspector/`

Browses **model prediction failures and comparisons** for re-ID benchmarks.

- Load one or more benchmark JSONs and per-model prediction CSVs
- Filter by failures / correct predictions
- Side-by-side cross-model comparison (who fails where the other succeeds)
- Highlights ground-truth and wrong-prediction images with colored borders
- Supports multiple benchmarks simultaneously via tabs

**Run:**
```bash
cd model_inspector
conda activate visualization
python app.py          # → http://localhost:5000
```

→ See [`model_inspector/README.md`](model_inspector/README.md) for full documentation.

---

### Data Inspector &nbsp;·&nbsp; `data_inspector/`

Browses **raw gallery images** for quality review, organized by household → identity → camera.

- Load one or more household-info JSON files
- Summary stats: households, identities, images, singleton vs. family households
- Filter by household, search by identity ID, sort by various criteria
- All images for each identity shown in one card (grouped by MAC address when multiple cameras)
- Click any image to enlarge with full-screen zoom and keyboard navigation

**Run:**
```bash
cd data_inspector
conda activate visualization
python app.py          # → http://localhost:5001
```

→ See [`data_inspector/README.md`](data_inspector/README.md) for full documentation.

---

### Python Plots &nbsp;·&nbsp; `python_plots/`

Standalone matplotlib scripts — no server required.

| Script | What it does |
|---|---|
| `visual_examples/plot_visual_examles.py` | Renders query + gallery image grids for a benchmark JSON |
| `benchmark_bar_plot/plot_bar_benchmarks.py` | Bar chart comparing model accuracies across benchmarks |

---

## Shared Setup

Both web apps use the same conda environment:

```bash
# Create once
conda create -n visualization python=3.11 flask pandas pillow -y

# Activate each session
conda activate visualization
```

Both apps are **local-only** — they read images directly from absolute paths on disk and expose no data externally. Loaded file paths persist across restarts via `.saved_paths.json` (git-ignored) in each app directory.
