import json
import os
import pandas as pd
import matplotlib.pyplot as plt
from PIL import Image

# ─────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────
DIR = os.path.dirname(os.path.abspath(__file__))
JSON_PATH   = os.path.join(DIR, "cropped_crossclothes_family_crosscamera.json")
CSV_GEMINI  = os.path.join(DIR, "predictions_gemini_gemini-2.5-pro_cropped_crossclothes_family_crosscamera.csv")
# CSV_SFT     = os.path.join(DIR, "predictions_sft-qwen3b-noexpert_cropped_crossclothes_family_crosscamera.csv")
CSV_SFT     = os.path.join(DIR, "predictions_sft-qwen3b-WYZEv03_23_token_cropped_crossclothes_family_crosscamera.csv")

_json_stem  = os.path.splitext(os.path.basename(JSON_PATH))[0]  # cropped_crossclothes_family_crosscamera
_case_name  = _json_stem.replace("cropped_", "")                # crossclothes_family_crosscamera
OUT_DIR     = os.path.join(DIR, f"examples_{_case_name}")
os.makedirs(OUT_DIR, exist_ok=True)

# ─────────────────────────────────────────────
# Load data
# ─────────────────────────────────────────────
with open(JSON_PATH) as f:
    eval_cases = json.load(f)["eval_cases"]

df_gemini = pd.read_csv(CSV_GEMINI).set_index("idx")
df_sft    = pd.read_csv(CSV_SFT).set_index("idx")

# ─────────────────────────────────────────────
# Accuracy
# ─────────────────────────────────────────────
acc_gemini = (df_gemini["label"] == df_gemini["prediction"]).mean() * 100
acc_sft    = (df_sft["label"]    == df_sft["prediction"]).mean()    * 100
print(f"Gemini 2.5 Pro accuracy : {acc_gemini:.1f}%")
print(f"SFT Qwen3B accuracy     : {acc_sft:.1f}%")

# ─────────────────────────────────────────────
# Find cases: gemini fails, sft succeeds
# ─────────────────────────────────────────────
common_idx = df_gemini.index.intersection(df_sft.index)
gemini_fail    = df_gemini.loc[common_idx, "label"] != df_gemini.loc[common_idx, "prediction"]
gemini_succeed = df_gemini.loc[common_idx, "label"] == df_gemini.loc[common_idx, "prediction"]
sft_fail       = df_sft.loc[common_idx, "label"]    != df_sft.loc[common_idx, "prediction"]
sft_succeed    = df_sft.loc[common_idx, "label"]    == df_sft.loc[common_idx, "prediction"]

fail_succeed_idx = common_idx[gemini_fail    & sft_succeed].tolist()
succeed_fail_idx = common_idx[gemini_succeed & sft_fail].tolist()

print(f"\nGemini fails,    SFT succeeds: {len(fail_succeed_idx)} cases")
print(f"Indices: {fail_succeed_idx}")
print(f"\nGemini succeeds, SFT fails:    {len(succeed_fail_idx)} cases")
print(f"Indices: {succeed_fail_idx}")

# ─────────────────────────────────────────────
# Plot helpers
# ─────────────────────────────────────────────
plt.rcParams.update({
    "font.family": "serif",
    "font.serif":  ["STIXGeneral"],
})

def add_border(ax, color, lw=6):
    for spine in ax.spines.values():
        spine.set_edgecolor(color)
        spine.set_linewidth(lw)
        spine.set_visible(True)

def load_image(path):
    return Image.open(path).convert("RGB")

# ─────────────────────────────────────────────
# Plot one figure per example
# mode: "gemini_fail_ours_succeed" or "gemini_succeed_ours_fail"
# ─────────────────────────────────────────────
def plot_example(idx, mode):
    case       = eval_cases[idx]
    query_path = case["query"]
    gallery    = case["gallery"]
    gt_label   = df_gemini.loc[idx, "label"]
    gem_pred   = df_gemini.loc[idx, "prediction"]
    sft_pred   = df_sft.loc[idx, "prediction"]

    fig, axes = plt.subplots(1, 6, figsize=(18, 4))

    # Query image
    axes[0].imshow(load_image(query_path))
    axes[0].set_title("Query", fontsize=18, fontweight="bold")
    axes[0].axis("off")
    for spine in axes[0].spines.values():
        spine.set_visible(False)

    # Gallery images
    for i, gpath in enumerate(gallery):
        label_1idx = i + 1
        ax = axes[i + 1]
        ax.imshow(load_image(gpath))
        ax.axis("off")

        is_gt      = label_1idx == gt_label
        is_gemini  = label_1idx == gem_pred
        is_sft     = label_1idx == sft_pred

        if is_gt and mode == "gemini_fail_ours_succeed":
            # GT == our pred (green); gemini predicted elsewhere
            add_border(ax, "green")
            ax.set_title(f"Gallery {label_1idx} (GT / our pred)", fontsize=16, color="green", fontweight="bold")
        elif is_gemini and not is_gt and mode == "gemini_fail_ours_succeed":
            add_border(ax, "red")
            ax.set_title(f"Gallery {label_1idx} (Gemini)", fontsize=16, color="red", fontweight="bold")
        elif is_gt and mode == "gemini_succeed_ours_fail":
            # GT == gemini pred (green); our model predicted elsewhere
            add_border(ax, "green")
            ax.set_title(f"Gallery {label_1idx} (GT / Gemini)", fontsize=16, color="green", fontweight="bold")
        elif is_sft and not is_gt and mode == "gemini_succeed_ours_fail":
            add_border(ax, "red")
            ax.set_title(f"Gallery {label_1idx} (our pred)", fontsize=16, color="red", fontweight="bold")
        else:
            ax.set_title(f"Gallery {label_1idx}", fontsize=16, fontweight="bold")
            for spine in ax.spines.values():
                spine.set_visible(False)

    plt.tight_layout()
    out_path = os.path.join(OUT_DIR, f"{mode}_{idx}.png")
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out_path}")


for idx in fail_succeed_idx:
    plot_example(idx, "gemini_fail_ours_succeed")

for idx in succeed_fail_idx:
    plot_example(idx, "gemini_succeed_ours_fail")
