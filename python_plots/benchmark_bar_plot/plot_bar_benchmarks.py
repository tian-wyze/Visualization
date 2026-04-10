import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

plt.rcParams.update({
    "font.family": "serif",
    "font.serif":  ["STIXGeneral"],
    "mathtext.fontset": "stix",
})

# ─────────────────────────────────────────────
# Data
# Each entry: (display_name, category, scores_dict)
# scores_dict keys: (clothes, camera)
#   clothes ∈ {"same", "cross"}
#   camera  ∈ {"same", "cross"}
# ─────────────────────────────────────────────

RESULTS = [
    # (display_name, category, {(clothes, camera): score})
    ("DINOv2 (ViT-L/14)\nTMLR'24",         "embedding",
     {("same","same"): 52.0, ("same","cross"): 60.6,
      ("cross","same"): 37.5, ("cross","cross"): 37.3}),

    ("PLIP (RN50)\nNeurIPS'24",             "embedding",
     {("same","same"): 70.7, ("same","cross"): 66.7,
      ("cross","same"): 43.8, ("cross","cross"): 32.7}),

    ("WYZE Embed\n(50k, RN34)",             "embedding",
     {("same","same"): 81.3, ("same","cross"): 78.8,
      ("cross","same"): 47.9, ("cross","cross"): 32.7}),

    ("WYZE Embed\n(v02_02_reid, RN50)",     "embedding",
     {("same","same"): 89.3, ("same","cross"): 78.8,
      ("cross","same"): 54.2, ("cross","cross"): 62.0}),

    ("WYZE Embed\n(v03_23_token)\nAAAI'23", "embedding",
     {("same","same"): 88.0, ("same","cross"): 87.9,
      ("cross","same"): 56.2, ("cross","cross"): 77.3}),

    ("Gemini 2.5\nFlash-Lite",              "vlm",
     {("same","same"): 26.7, ("same","cross"): 36.4,
      ("cross","same"): 27.1, ("cross","cross"): 26.7}),

    ("Gemini 2.5\nFlash",                   "vlm",
     {("same","same"): 85.3, ("same","cross"): 87.9,
      ("cross","same"): 72.9, ("cross","cross"): 70.7}),

    ("Gemini 2.5\nPro",                     "vlm",
     {("same","same"): 86.7, ("same","cross"): 91.9,
      ("cross","same"): 72.9, ("cross","cross"): 82.0}),

    ("Qwen2.5-VL-3B",                       "vlm",
     {("same","same"): 24.0, ("same","cross"): 23.2,
      ("cross","same"):  2.1, ("cross","cross"): 19.3}),

    ("Qwen2.5-VL-7B",                        "vlm",
     {("same","same"): 42.7, ("same","cross"): 51.5,
      ("cross","same"): 27.1, ("cross","cross"): 24.0}),

    ("Qwen2.5-VL-3B\nFT w/o expert",       "vlm-ft-plain",
     {("same","same"): 90.7, ("same","cross"): 96.0,
      ("cross","same"): 79.2, ("cross","cross"): 77.3}),

    ("Qwen2.5-VL-3B\nFT w/ PLIP",          "vlm-ft",
     {("same","same"): 88.0, ("same","cross"): 93.9,
      ("cross","same"): 72.9, ("cross","cross"): 77.3}),

    ("Qwen2.5-VL-3B\nFT w/ v02_02_reid",   "vlm-ft",
     {("same","same"): 84.0, ("same","cross"): 94.9,
      ("cross","same"): 68.8, ("cross","cross"): 75.3}),

    ("Qwen2.5-VL-3B\nFT w/ v03_23_token",  "vlm-ft",
     {("same","same"): 86.7, ("same","cross"): 96.0,
      ("cross","same"): 79.2, ("cross","cross"): 83.3}),

    ("Qwen2.5-VL-7B\nFT w/o expert",       "vlm-ft-plain",
     {("same","same"): 82.7, ("same","cross"): 95.0,
      ("cross","same"): 75.0, ("cross","cross"): 41.3}),
]

# ─────────────────────────────────────────────
# Color per category
# ─────────────────────────────────────────────
CATEGORY_COLORS = {
    "embedding":  "#2E86C1",   # strong blue
    "vlm":        "#E67E22",   # orange
    "vlm-ft":     "#27AE60",   # green (hatched)
    "vlm-ft-plain": "#27AE60", # green (no hatch)
}
CATEGORY_ALPHA = {
    "embedding":  0.85,
    "vlm":        0.85,
    "vlm-ft":     0.85,
    "vlm-ft-plain": 0.85,
}
CATEGORY_HATCH = {
    "embedding":  None,
    "vlm":        None,
    "vlm-ft":     "//",
    "vlm-ft-plain": None,
}

# Per-subplot overrides: ensure model A appears immediately before model B after sorting
# List of (model_a, model_b) pairs — model_a will be moved to just before model_b
ORDER_OVERRIDES = {
    ("cross", "same"): [("Gemini 2.5\nPro", "Gemini 2.5\nFlash")],
}

# Subplot layout: (row, col) → (clothes, camera, title)
SUBPLOTS = {
    (0, 0): ("same",  "same",  "Same Clothes — Same Camera\n(family scenario)"),
    (0, 1): ("same",  "cross", "Same Clothes — Cross Camera\n(family scenario)"),
    (1, 0): ("cross", "same",  "Cross Clothes — Same Camera\n(family scenario)"),
    (1, 1): ("cross", "cross", "Cross Clothes — Cross Camera\n(family scenario)"),
}

# ─────────────────────────────────────────────
# Plot — one figure per subplot
# ─────────────────────────────────────────────
bar_w = 0.65

legend_handles = [
    mpatches.Patch(color=CATEGORY_COLORS["embedding"], alpha=CATEGORY_ALPHA["embedding"],
                   label="Embedding-based"),
    mpatches.Patch(color=CATEGORY_COLORS["vlm"],       alpha=CATEGORY_ALPHA["vlm"],
                   label="VLM-based (zero-shot)"),
    mpatches.Patch(facecolor=CATEGORY_COLORS["vlm-ft-plain"], alpha=CATEGORY_ALPHA["vlm-ft-plain"],
                   edgecolor="black",
                   label="VLM-based (FT w/o expert, ours)"),
    mpatches.Patch(facecolor=CATEGORY_COLORS["vlm-ft"], alpha=CATEGORY_ALPHA["vlm-ft"],
                   hatch=CATEGORY_HATCH["vlm-ft"],     edgecolor="black",
                   label="VLM-based (FT w/ expert, ours)"),
]

FILENAMES = {
    ("same",  "same"):  "sameclothes_family_samecamera.png",
    ("same",  "cross"): "sameclothes_family_crosscamera.png",
    ("cross", "same"):  "crossclothes_family_samecamera.png",
    ("cross", "cross"): "crossclothes_family_crosscamera.png",
}

for (_, __), (clothes, camera, title) in SUBPLOTS.items():
    fig, ax = plt.subplots(figsize=(14, 7))

    # Sort models by decreasing score
    sorted_results = sorted(RESULTS, key=lambda r: r[2][(clothes, camera)], reverse=True)
    for model_a, model_b in ORDER_OVERRIDES.get((clothes, camera), []):
        names_tmp = [r[0] for r in sorted_results]
        if model_a in names_tmp and model_b in names_tmp:
            idx_a, idx_b = names_tmp.index(model_a), names_tmp.index(model_b)
            if idx_a > idx_b:  # a is after b — move a to just before b
                entry = sorted_results.pop(idx_a)
                sorted_results.insert(idx_b, entry)
    names  = [r[0] for r in sorted_results]
    scores = [r[2][(clothes, camera)] for r in sorted_results]
    x      = np.arange(len(names))

    bars = [
        ax.bar(xi, score, width=bar_w,
               color=CATEGORY_COLORS[r[1]],
               alpha=CATEGORY_ALPHA[r[1]],
               hatch=CATEGORY_HATCH[r[1]],
               edgecolor="black" if CATEGORY_HATCH[r[1]] else "white",
               linewidth=0.6)[0]
        for xi, score, r in zip(x, scores, sorted_results)
    ]

    # Value labels on top of each bar
    for bar, score in zip(bars, scores):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.8,
                f"{score}", ha="center", va="bottom", fontsize=17)

    ax.set_title(title, fontsize=17, fontweight="bold", pad=16)
    ax.set_ylabel("Accuracy (%)", fontsize=21)
    ax.set_ylim(0, 115)
    ax.set_xticks(x)
    ax.set_xticklabels(names, rotation=45, ha="right", fontsize=15)
    for label in ax.get_xticklabels():
        if "Gemini 2.5\nPro" in label.get_text():
            label.set_color("red")
    ax.tick_params(axis="y", labelsize=19)
    ax.yaxis.grid(True, linestyle="--", alpha=0.5)
    ax.set_axisbelow(True)
    ax.spines[["top", "right"]].set_visible(False)

    ax.legend(handles=legend_handles, fontsize=18, frameon=True, loc="upper right", bbox_to_anchor=(1.0, 1.08))

    plt.tight_layout()
    fname = FILENAMES[(clothes, camera)]
    plt.savefig(fname, dpi=150, bbox_inches="tight")
    print(f"Saved {fname}")
    plt.close(fig)
