"""
benchmarks/utils.py
Secure Eldercare — Shared Benchmark Utilities

Provides:
  - compute_binary_metrics(y_true, y_pred, y_score)  → dict
  - compute_multiclass_metrics(y_true, y_pred, labels) → dict
  - plot_confusion_matrix(cm, labels, title, save_path, subtitle)
  - plot_roc_curve(fpr, tpr, auc, title, save_path)
  - plot_fnmr_fmr_curve(thresholds, fnmr, fmr, eer_thresh, save_path)
  - print_terminal_table(headers, rows, title)
  - build_latex_table(rows)                          → str
  - save_json(result_dict, path)
  - timing_context()                                 → context manager
"""

import json
import time
import contextlib
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

# ─────────────────────────────────────────────────────────────────────────────
#  Optional heavy imports (degrade gracefully)
# ─────────────────────────────────────────────────────────────────────────────
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mticker
    HAS_MPL = True
except ImportError:
    HAS_MPL = False
    print("[WARN] matplotlib not installed — plots will be skipped.")

try:
    import seaborn as sns
    HAS_SNS = True
except ImportError:
    HAS_SNS = False

try:
    from sklearn.metrics import (
        accuracy_score,
        precision_score,
        recall_score,
        f1_score,
        roc_auc_score,
        roc_curve,
        confusion_matrix,
        classification_report,
    )
    HAS_SKL = True
except ImportError:
    HAS_SKL = False
    print("[WARN] scikit-learn not installed — metrics will be calculated manually.")

try:
    from tabulate import tabulate
    HAS_TAB = True
except ImportError:
    HAS_TAB = False


# ─────────────────────────────────────────────────────────────────────────────
#  Core metrics helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_div(a: float, b: float, default: float = 0.0) -> float:
    return a / b if b != 0 else default


def compute_binary_metrics(
    y_true: Sequence[int],
    y_pred: Sequence[int],
    y_score: Optional[Sequence[float]] = None,
) -> Dict[str, Any]:
    """Compute full binary classification metrics.

    Args:
        y_true:  Ground-truth binary labels (0 = negative, 1 = positive).
        y_pred:  Predicted binary labels.
        y_score: Predicted probabilities for the positive class (for AUC/ROC).

    Returns:
        Dict with keys:
          accuracy, precision, recall (sensitivity), specificity,
          f1_score, roc_auc, fpr, fnr, tp, tn, fp, fn,
          roc_fpr_arr, roc_tpr_arr (arrays for plotting, or None).
    """
    yt = np.asarray(y_true, dtype=int)
    yp = np.asarray(y_pred, dtype=int)

    if HAS_SKL:
        cm = confusion_matrix(yt, yp, labels=[0, 1])
        tn, fp, fn, tp = cm.ravel()
        acc  = accuracy_score(yt, yp)
        prec = precision_score(yt, yp, zero_division=0)
        rec  = recall_score(yt, yp, zero_division=0)
        f1   = f1_score(yt, yp, zero_division=0)
    else:
        tp = int(np.sum((yt == 1) & (yp == 1)))
        tn = int(np.sum((yt == 0) & (yp == 0)))
        fp = int(np.sum((yt == 0) & (yp == 1)))
        fn = int(np.sum((yt == 1) & (yp == 0)))
        acc  = _safe_div(tp + tn, tp + tn + fp + fn)
        prec = _safe_div(tp, tp + fp)
        rec  = _safe_div(tp, tp + fn)
        f1   = _safe_div(2 * prec * rec, prec + rec)

    spec       = _safe_div(tn, tn + fp)            # Specificity / True Negative Rate
    fpr_scalar = _safe_div(fp, fp + tn)            # False Positive Rate
    fnr_scalar = _safe_div(fn, fn + tp)            # False Negative Rate / Miss Rate

    roc_auc_val   = None
    roc_fpr_arr   = None
    roc_tpr_arr   = None

    if y_score is not None and HAS_SKL:
        ys = np.asarray(y_score, dtype=float)
        try:
            roc_auc_val = roc_auc_score(yt, ys)
            roc_fpr_arr, roc_tpr_arr, _ = roc_curve(yt, ys)
        except ValueError:
            pass

    return {
        "tp": int(tp), "tn": int(tn), "fp": int(fp), "fn": int(fn),
        "accuracy":    round(float(acc),       4),
        "precision":   round(float(prec),      4),
        "recall":      round(float(rec),       4),
        "specificity": round(float(spec),      4),
        "f1_score":    round(float(f1),        4),
        "fpr":         round(float(fpr_scalar), 4),
        "fnr":         round(float(fnr_scalar), 4),
        "roc_auc":     round(float(roc_auc_val), 4) if roc_auc_val is not None else None,
        "roc_fpr_arr": roc_fpr_arr,
        "roc_tpr_arr": roc_tpr_arr,
    }


def compute_multiclass_metrics(
    y_true: Sequence[int],
    y_pred: Sequence[int],
    labels: Sequence[str],
) -> Dict[str, Any]:
    """Compute per-class and macro-averaged metrics for multi-class problems.

    Returns:
        Dict with 'per_class' (list of per-label dicts) and 'macro' averages.
        Also includes 'classification_report' string and 'confusion_matrix' array.
    """
    yt = np.asarray(y_true, dtype=int)
    yp = np.asarray(y_pred, dtype=int)
    n_classes = len(labels)

    if HAS_SKL:
        cm = confusion_matrix(yt, yp, labels=list(range(n_classes)))
        precs = precision_score(yt, yp, average=None, labels=list(range(n_classes)), zero_division=0)
        recs  = recall_score   (yt, yp, average=None, labels=list(range(n_classes)), zero_division=0)
        f1s   = f1_score       (yt, yp, average=None, labels=list(range(n_classes)), zero_division=0)
        acc   = accuracy_score(yt, yp)
        report_str = classification_report(yt, yp, target_names=labels, zero_division=0)
    else:
        cm = np.zeros((n_classes, n_classes), dtype=int)
        for t, p in zip(yt, yp):
            if 0 <= t < n_classes and 0 <= p < n_classes:
                cm[t][p] += 1
        precs = np.zeros(n_classes)
        recs  = np.zeros(n_classes)
        f1s   = np.zeros(n_classes)
        for i in range(n_classes):
            tp_i = cm[i, i]
            fp_i = cm[:, i].sum() - tp_i
            fn_i = cm[i, :].sum() - tp_i
            precs[i] = _safe_div(tp_i, tp_i + fp_i)
            recs[i]  = _safe_div(tp_i, tp_i + fn_i)
            f1s[i]   = _safe_div(2 * precs[i] * recs[i], precs[i] + recs[i])
        acc = _safe_div(np.trace(cm), cm.sum())
        report_str = "scikit-learn not installed — install to get detailed report."

    per_class = [
        {
            "label": labels[i],
            "precision": round(float(precs[i]), 4),
            "recall":    round(float(recs[i]),  4),
            "f1_score":  round(float(f1s[i]),   4),
            "support":   int(cm[i].sum()),
        }
        for i in range(n_classes)
    ]

    return {
        "accuracy":              round(float(acc), 4),
        "macro_precision":       round(float(precs.mean()), 4),
        "macro_recall":          round(float(recs.mean()),  4),
        "macro_f1":              round(float(f1s.mean()),   4),
        "per_class":             per_class,
        "confusion_matrix":      cm,
        "classification_report": report_str,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Plot helpers
# ─────────────────────────────────────────────────────────────────────────────

_PALETTE = {
    "bg":      "#0F1117",
    "panel":   "#1A1D27",
    "accent1": "#6C63FF",
    "accent2": "#FF6584",
    "text":    "#E8E9EF",
    "grid":    "#2A2D3E",
}


def _apply_dark_style(fig, ax):
    """Apply consistent dark publication style to a figure/axis."""
    fig.patch.set_facecolor(_PALETTE["bg"])
    ax.set_facecolor(_PALETTE["panel"])
    for spine in ax.spines.values():
        spine.set_edgecolor(_PALETTE["grid"])
    ax.tick_params(colors=_PALETTE["text"], labelsize=9)
    ax.xaxis.label.set_color(_PALETTE["text"])
    ax.yaxis.label.set_color(_PALETTE["text"])
    ax.title.set_color(_PALETTE["text"])


def plot_confusion_matrix(
    cm: np.ndarray,
    labels: Sequence[str],
    title: str,
    save_path: str,
    subtitle: str = "",
) -> None:
    """Render and save a styled confusion matrix heatmap.

    Args:
        cm:        Confusion matrix array (N×N).
        labels:    Class label names.
        title:     Plot title.
        save_path: Absolute path to save the `.png` file.
        subtitle:  Optional second line of title.
    """
    if not HAS_MPL:
        print(f"[SKIP] Cannot save {save_path} — matplotlib not available.")
        return

    Path(save_path).parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(max(6, len(labels) * 1.4), max(5, len(labels) * 1.2)))
    _apply_dark_style(fig, ax)

    cmap = "Blues" if HAS_SNS else "Blues"
    im = ax.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)

    # Color bar
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.ax.yaxis.set_tick_params(color=_PALETTE["text"])
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color=_PALETTE["text"])

    # Ticks
    tick_marks = np.arange(len(labels))
    ax.set_xticks(tick_marks)
    ax.set_xticklabels(labels, rotation=35, ha="right", fontsize=9)
    ax.set_yticks(tick_marks)
    ax.set_yticklabels(labels, fontsize=9)

    # Annotate cells
    thresh = cm.max() / 2.0
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            color = "white" if cm[i, j] > thresh else _PALETTE["text"]
            ax.text(j, i, f"{cm[i, j]:,}", ha="center", va="center",
                    color=color, fontsize=10, fontweight="bold")

    ax.set_xlabel("Predicted Label", fontsize=10, labelpad=8)
    ax.set_ylabel("True Label", fontsize=10, labelpad=8)

    full_title = title + (f"\n{subtitle}" if subtitle else "")
    ax.set_title(full_title, fontsize=12, fontweight="bold", pad=12)

    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"  [SAVED] Confusion matrix → {save_path}")


def plot_roc_curve(
    fpr: np.ndarray,
    tpr: np.ndarray,
    auc: float,
    title: str,
    save_path: str,
) -> None:
    """Render and save an ROC curve plot."""
    if not HAS_MPL:
        return
    Path(save_path).parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(6, 5))
    _apply_dark_style(fig, ax)

    ax.plot(fpr, tpr, color=_PALETTE["accent1"], lw=2.0,
            label=f"ROC (AUC = {auc:.3f})")
    ax.plot([0, 1], [0, 1], "--", color=_PALETTE["grid"], lw=1.2, label="Random")
    ax.fill_between(fpr, tpr, alpha=0.15, color=_PALETTE["accent1"])
    ax.set_xlim([0.0, 1.0])
    ax.set_ylim([0.0, 1.05])
    ax.set_xlabel("False Positive Rate (1 – Specificity)", fontsize=10)
    ax.set_ylabel("True Positive Rate (Sensitivity)", fontsize=10)
    ax.set_title(title, fontsize=12, fontweight="bold")
    legend = ax.legend(loc="lower right", fontsize=9)
    for text in legend.get_texts():
        text.set_color(_PALETTE["text"])
    legend.get_frame().set_facecolor(_PALETTE["panel"])
    ax.grid(True, color=_PALETTE["grid"], linewidth=0.6, alpha=0.7)

    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"  [SAVED] ROC curve     → {save_path}")


def plot_fnmr_fmr_curve(
    thresholds: np.ndarray,
    fnmr: np.ndarray,
    fmr: np.ndarray,
    eer_thresh: float,
    save_path: str,
) -> None:
    """Render FNMR / FMR trade-off curve with EER operating point."""
    if not HAS_MPL:
        return
    Path(save_path).parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(6, 5))
    _apply_dark_style(fig, ax)

    ax.plot(thresholds, fnmr, color=_PALETTE["accent1"], lw=2.0, label="FNMR (Miss Rate)")
    ax.plot(thresholds, fmr,  color=_PALETTE["accent2"], lw=2.0, label="FMR (False Match Rate)")
    ax.axvline(x=eer_thresh, color="#FFFFFF", lw=1.2, linestyle="--",
               label=f"EER threshold ≈ {eer_thresh:.3f}")
    ax.set_xlabel("Cosine Similarity Threshold", fontsize=10)
    ax.set_ylabel("Error Rate", fontsize=10)
    ax.set_title("FNMR / FMR Trade-off Curve (Face Verification)", fontsize=11, fontweight="bold")
    ax.set_ylim([0, 1.05])
    legend = ax.legend(fontsize=9)
    for t in legend.get_texts():
        t.set_color(_PALETTE["text"])
    legend.get_frame().set_facecolor(_PALETTE["panel"])
    ax.grid(True, color=_PALETTE["grid"], linewidth=0.6, alpha=0.7)

    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"  [SAVED] FNMR/FMR curve → {save_path}")


# ─────────────────────────────────────────────────────────────────────────────
#  Terminal table
# ─────────────────────────────────────────────────────────────────────────────

def print_terminal_table(
    headers: Sequence[str],
    rows: Sequence[Sequence[Any]],
    title: str = "",
) -> None:
    """Print a nicely formatted terminal result table."""
    if title:
        border = "=" * max(60, len(title) + 4)
        print(f"\n{border}")
        print(f"  {title}")
        print(border)

    if HAS_TAB:
        print(tabulate(rows, headers=headers, tablefmt="fancy_grid",
                       floatfmt=".4f", numalign="right"))
    else:
        # Fallback plain text
        col_widths = [max(len(str(h)), max((len(str(r[i])) for r in rows), default=0))
                      for i, h in enumerate(headers)]
        fmt = "  ".join(f"{{:<{w}}}" for w in col_widths)
        sep = "-" * sum(col_widths + [2 * (len(col_widths) - 1)])
        print(fmt.format(*headers))
        print(sep)
        for row in rows:
            print(fmt.format(*[str(v) for v in row]))
    print()


# ─────────────────────────────────────────────────────────────────────────────
# -----------------------------------------------------------------------------
#  LaTeX export
# -----------------------------------------------------------------------------

_LATEX_HEADER = r"""\begin{table*}[!ht]
\centering
\caption{Benchmark Evaluation Results --- Secure Eldercare ML System}
\label{tab:benchmark_results}
\begin{tabular}{l l l r r r r r}
\toprule
\textbf{Dataset} & \textbf{Module / Component} & \textbf{Task} &
\textbf{Acc (\%)} & \textbf{Prec (\%)} & \textbf{Rec (\%)} &
\textbf{F1 (\%)} & \textbf{FPS} \\
\midrule
"""

_LATEX_FOOTER = r"""\bottomrule
\end{tabular}
\end{table*}"""


def build_latex_table(rows: Sequence[Dict[str, Any]]) -> str:
    """Build IEEE-format LaTeX table string from a list of result dicts.

    Each dict must have keys:
      dataset, module, task, accuracy, precision, recall, f1_score, fps
    Values for accuracy/precision/recall/f1_score should be 0–1 floats.
    """
    lines = [_LATEX_HEADER]
    prev_dataset = None
    for row in rows:
        dataset = row["dataset"]
        multirow_dataset = dataset if dataset != prev_dataset else ""
        prev_dataset = dataset

        acc   = row["accuracy"]   * 100
        prec  = row["precision"]  * 100
        rec   = row["recall"]     * 100
        f1    = row["f1_score"]   * 100
        fps   = row["fps"]

        # Escape underscores for LaTeX
        def esc(s): return str(s).replace("_", r"\_")

        lines.append(
            f"{esc(multirow_dataset)} & {esc(row['module'])} & {esc(row['task'])} & "
            f"{acc:.2f} & {prec:.2f} & {rec:.2f} & {f1:.2f} & {fps:.1f} \\\\"
        )
    lines.append(_LATEX_FOOTER)
    return "\n".join(lines)


def append_latex_results(latex_str: str, output_dir: str) -> None:
    """Append (or create) the benchmark_results.tex file."""
    path = Path(output_dir) / "benchmark_results.tex"
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(latex_str)
    print(f"  [SAVED] LaTeX table   → {path}")


# ─────────────────────────────────────────────────────────────────────────────
#  JSON export
# ─────────────────────────────────────────────────────────────────────────────

def save_json(data: Any, path: str) -> None:
    """Serialise evaluation results to JSON (numpy arrays → lists)."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    def _convert(obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=_convert)
    print(f"  [SAVED] JSON results  → {path}")


# ─────────────────────────────────────────────────────────────────────────────
#  Timing context manager
# ─────────────────────────────────────────────────────────────────────────────

class Timer:
    """Simple wall-clock timer context manager."""
    def __init__(self):
        self.elapsed_ms = 0.0

    def __enter__(self):
        self._start = time.perf_counter()
        return self

    def __exit__(self, *_):
        self.elapsed_ms = (time.perf_counter() - self._start) * 1000.0


@contextlib.contextmanager
def timing_context():
    """Yields a Timer whose elapsed_ms is populated after the block."""
    t = Timer()
    with t:
        yield t
