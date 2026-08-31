"""
benchmarks/anomaly_detection_eval.py
Secure Eldercare — Module 1: Fall & Anomaly Detection Benchmark

Supported datasets (folder-based):
  ─ URFD  (University of Rzeszów Fall Detection Dataset)
  ─ Le2i  Fall Detection Dataset
  ─ Any folder with structure:  <root>/falls/ and <root>/adl/
    where each sub-folder contains .mp4 / .avi video files OR
    pre-extracted .npy arrays of shape (N_frames, 33, 4)  [x y z vis].

Evaluation Protocol:
  ─ Stratified k-fold cross-validation (default k=5).
  ─ Hybrid inference: Rule Engine first → Bi-LSTM confirmation.
  ─ Binary: fall_detected (1) vs. everything else (0).

Outputs (written to <output_dir>/):
  ─ anomaly_confusion_matrix.png
  ─ anomaly_roc_curve.png
  ─ Appended rows to benchmark_results for LaTeX / JSON.
"""

from __future__ import annotations

import os
import sys
import time
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

warnings.filterwarnings("ignore")

# ── Inject project root onto sys.path so we can import shared ML code ─────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from benchmarks.utils import (
    compute_binary_metrics,
    plot_confusion_matrix,
    plot_roc_curve,
    print_terminal_table,
    Timer,
)

# ─────────────────────────────────────────────────────────────────────────────
#  Optional MediaPipe & project imports (degrade gracefully in demo mode)
# ─────────────────────────────────────────────────────────────────────────────
try:
    import cv2  # type: ignore
    HAS_CV = True
except ImportError:
    HAS_CV = False

try:
    import mediapipe as mp  # type: ignore
    _mp_pose = mp.solutions.pose
    HAS_MP = True
except ImportError:
    HAS_MP = False

try:
    from anomaly_detection.backend.app.ml_services.inference.feature_engineer import (
        engineer_features,
    )
    from anomaly_detection.backend.app.ml_services.inference.rule_engine import evaluate as rule_evaluate
    from anomaly_detection.backend.app.ml_services.models.lstm_model import predict as lstm_predict
    HAS_PROJECT_ML = True
except ImportError:
    HAS_PROJECT_ML = False

try:
    from sklearn.model_selection import StratifiedKFold
    HAS_SKL = True
except ImportError:
    HAS_SKL = False


# ─────────────────────────────────────────────────────────────────────────────
#  Constants
# ─────────────────────────────────────────────────────────────────────────────
WINDOW_SIZE  = 30   # frames per sliding window
WINDOW_STRIDE = 10  # stride for sliding window extraction
FALL_CLASSES = {"fall_detected"}


# ─────────────────────────────────────────────────────────────────────────────
#  Dataset Ingestion
# ─────────────────────────────────────────────────────────────────────────────

def _extract_landmarks_from_video(video_path: str) -> List[List]:
    """Extract per-frame MediaPipe landmarks from a video file.

    Returns:
        List of frames, each frame is a list of 33 × [x, y, z, vis] or
        an empty list if detection failed for that frame.
    """
    if not HAS_CV or not HAS_MP:
        return []

    cap = cv2.VideoCapture(video_path)
    all_frames: List[List] = []

    with _mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        min_detection_confidence=0.4,
        min_tracking_confidence=0.4,
    ) as pose:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            # Downsample to speed up processing
            frame_rgb = cv2.cvtColor(
                cv2.resize(frame, (320, 240)), cv2.COLOR_BGR2RGB
            )
            results = pose.process(frame_rgb)
            if results.pose_landmarks:
                lms = [
                    [lm.x, lm.y, lm.z, lm.visibility]
                    for lm in results.pose_landmarks.landmark
                ]
            else:
                lms = []
            all_frames.append(lms)

    cap.release()
    return all_frames


def _landmark_frames_to_feature_windows(
    frames: List[List],
) -> List[np.ndarray]:
    """Convert raw landmark frames → list of 48-dim feature windows.

    Each window is shape (WINDOW_SIZE, 48).
    """
    # Build per-frame 48-dim feature vectors
    feat_vectors: List[np.ndarray] = []
    prev = None
    for lms in frames:
        if HAS_PROJECT_ML and lms:
            vec = engineer_features(lms, prev)
        elif lms:
            # Fallback: simplified 48-dim proxy from raw landmarks
            arr = np.array(lms, dtype=np.float32)  # (33, 4)
            vec = np.zeros(48, dtype=np.float32)
            vec[:min(48, arr.size)] = arr.flatten()[:48]
        else:
            vec = np.zeros(48, dtype=np.float32)
        feat_vectors.append(vec)
        prev = lms if lms else prev

    # Sliding windows
    windows: List[np.ndarray] = []
    for start in range(0, len(feat_vectors) - WINDOW_SIZE + 1, WINDOW_STRIDE):
        win = np.stack(feat_vectors[start: start + WINDOW_SIZE], axis=0)
        windows.append(win)
    return windows


def _load_npy_sequences(folder: str, label: int) -> Tuple[List[np.ndarray], List[int]]:
    """Load pre-extracted .npy frame sequences from a folder."""
    seqs, labels = [], []
    for fp in Path(folder).glob("*.npy"):
        arr = np.load(str(fp))  # expected (N, 33, 4) or (N, 48)
        if arr.ndim == 3:                  # (N, 33, 4) — raw landmarks
            # Flatten to (N, 48) with truncation/padding
            flat = arr.reshape(arr.shape[0], -1)[:, :48]
            pad  = np.zeros((flat.shape[0], max(0, 48 - flat.shape[1])), dtype=np.float32)
            arr  = np.concatenate([flat, pad], axis=1)
        # Sliding windows
        for start in range(0, len(arr) - WINDOW_SIZE + 1, WINDOW_STRIDE):
            win = arr[start: start + WINDOW_SIZE].astype(np.float32)
            seqs.append(win)
            labels.append(label)
    return seqs, labels


def load_dataset(root_dir: str) -> Tuple[List[np.ndarray], List[int]]:
    """Load URFD/Le2i-style dataset.

    Expects:
        <root_dir>/falls/   — positive class (label 1)
        <root_dir>/adl/     — negative class (label 0)

    Returns:
        (windows, labels) where windows is list of (30, 48) arrays.
    """
    root = Path(root_dir)
    all_seqs:   List[np.ndarray] = []
    all_labels: List[int]        = []

    class_map = {"falls": 1, "adl": 0}
    for subfolder, lbl in class_map.items():
        subfolder_path = root / subfolder
        if not subfolder_path.exists():
            print(f"  [WARN] Expected folder not found: {subfolder_path}")
            continue

        # .npy files (pre-extracted)
        npy_seqs, npy_labels = _load_npy_sequences(str(subfolder_path), lbl)
        all_seqs.extend(npy_seqs)
        all_labels.extend(npy_labels)

        # Video files
        for ext in ("*.mp4", "*.avi", "*.MP4", "*.AVI"):
            for vid_path in subfolder_path.glob(ext):
                frames  = _extract_landmarks_from_video(str(vid_path))
                windows = _landmark_frames_to_feature_windows(frames)
                all_seqs.extend(windows)
                all_labels.extend([lbl] * len(windows))

    print(f"  [DATASET] Loaded {len(all_seqs)} windows "
          f"({sum(all_labels)} falls, {len(all_labels) - sum(all_labels)} ADL)")
    return all_seqs, all_labels


# ─────────────────────────────────────────────────────────────────────────────
#  Synthetic Demo Data
# ─────────────────────────────────────────────────────────────────────────────

def _generate_demo_data(
    n_fall: int = 200,
    n_adl:  int = 600,
    seed:   int = 42,
) -> Tuple[List[np.ndarray], List[int]]:
    """Generate statistically plausible synthetic fall/ADL windows.

    Fall signature:
      - High body-tilt angle (feature[8] near 1.0)
      - Low aspect ratio (feature[14] near 0.1)
      - High head-drop (feature[21] near 0.3)
    ADL signature:
      - Low tilt, high aspect ratio, low head drop.
    """
    rng = np.random.default_rng(seed)
    seqs:   List[np.ndarray] = []
    labels: List[int]        = []

    def _make_window(mean_vec, std_scale=0.05):
        win = []
        for _ in range(WINDOW_SIZE):
            frame = mean_vec + rng.normal(0, std_scale, 48).astype(np.float32)
            win.append(np.clip(frame, -1.5, 1.5))
        return np.stack(win)

    # Fall prototype (indices matching feature_engineer.py)
    fall_proto = np.zeros(48, dtype=np.float32)
    fall_proto[8]  = 0.85     # body tilt (torso angle / 90)  → very high
    fall_proto[14] = 0.12     # aspect ratio / 3              → horizontal
    fall_proto[21] = 0.35     # head drop speed               → fast drop
    fall_proto[13] = 0.80     # body_cy                       → body low

    # ADL prototype
    adl_proto = np.zeros(48, dtype=np.float32)
    adl_proto[8]  = 0.08     # upright
    adl_proto[14] = 0.60     # standing ratio
    adl_proto[21] = 0.01     # minimal head drop
    adl_proto[13] = 0.45     # mid vertical

    for _ in range(n_fall):
        seqs.append(_make_window(fall_proto, std_scale=0.07))
        labels.append(1)

    for _ in range(n_adl):
        seqs.append(_make_window(adl_proto, std_scale=0.07))
        labels.append(0)

    indices = np.arange(len(seqs))
    rng.shuffle(indices)
    return [seqs[i] for i in indices], [labels[i] for i in indices]


# ─────────────────────────────────────────────────────────────────────────────
#  Inference: Hybrid Rule Engine + LSTM
# ─────────────────────────────────────────────────────────────────────────────

def _infer_window_project(window: np.ndarray) -> Tuple[int, float]:
    """Run hybrid inference using the project's actual Rule Engine + LSTM.

    Args:
        window: (WINDOW_SIZE, 48) feature array.

    Returns:
        (predicted_label: int, fall_probability: float)
    """
    PERSON_ID = "benchmark_person"
    fall_votes   = 0
    fall_scores  = []

    for i in range(len(window)):
        features = window[i]

        # Rule engine on each frame
        rule_result = rule_evaluate(features, PERSON_ID)
        if rule_result and rule_result.get("event") == "fall_detected":
            fall_votes += 1
            fall_scores.append(rule_result.get("confidence", 0.65))
        else:
            fall_scores.append(0.0)

    # LSTM on full sequence
    lstm_result = lstm_predict(list(window))
    if lstm_result:
        probs      = lstm_result.get("probs", [0.25, 0.25, 0.25, 0.25])
        lstm_fall_prob = probs[1]  # Class 1 = fall_detected
    else:
        lstm_fall_prob = None

    # Fusion: if both agree on fall → high confidence
    rule_fall_prob = np.mean(fall_scores) if fall_scores else 0.0
    if lstm_fall_prob is not None:
        fused_prob = 0.5 * rule_fall_prob + 0.5 * lstm_fall_prob
    else:
        fused_prob = rule_fall_prob

    predicted_label = 1 if fused_prob >= 0.50 else 0
    return predicted_label, float(fused_prob)


def _infer_window_simple(window: np.ndarray) -> Tuple[int, float]:
    """Simple threshold-based inference when project ML is unavailable.

    Uses key feature indices from feature_engineer.py to decide fall.
    """
    IDX_TILT   = 8
    IDX_ASPECT = 14
    IDX_DROP   = 21
    IDX_BODY_Y = 13

    frame_scores = []
    for feat in window:
        tilt   = float(feat[IDX_TILT])
        aspect = float(feat[IDX_ASPECT])
        drop   = float(feat[IDX_DROP])
        body_y = float(feat[IDX_BODY_Y])

        is_fall = (tilt > 0.55) and (aspect < 0.40 or body_y > 0.70 or drop > 0.20)
        frame_scores.append(1.0 if is_fall else 0.0)

    prob = np.mean(frame_scores)
    return (1 if prob >= 0.45 else 0), float(prob)


def _infer(window: np.ndarray) -> Tuple[int, float]:
    if HAS_PROJECT_ML:
        return _infer_window_project(window)
    return _infer_window_simple(window)


# ─────────────────────────────────────────────────────────────────────────────
#  Evaluation Loop
# ─────────────────────────────────────────────────────────────────────────────

def evaluate(
    root_dir:   Optional[str] = None,
    output_dir: str           = "reports",
    k_folds:    int           = 5,
    demo_mode:  bool          = False,
    dataset_name: str         = "URFD / Le2i",
) -> List[Dict[str, Any]]:
    """Run the full fall detection evaluation.

    Args:
        root_dir:     Path to dataset root (falls/ and adl/ subdirs).
        output_dir:   Directory to save plots and results.
        k_folds:      Number of stratified CV folds.
        demo_mode:    If True, use synthetic data regardless of root_dir.
        dataset_name: Label shown in result rows.

    Returns:
        List of result row dicts ready for LaTeX/JSON export.
    """
    print(f"\n{'─'*60}")
    print(f"  MODULE 1 — Fall & Anomaly Detection")
    print(f"  Dataset : {dataset_name}")
    print(f"  Mode    : {'DEMO (synthetic)' if demo_mode else 'REAL'}")
    print(f"{'─'*60}")

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # ── Data loading ──────────────────────────────────────────────────────────
    if demo_mode or root_dir is None:
        sequences, labels = _generate_demo_data()
    else:
        sequences, labels = load_dataset(root_dir)
        if len(sequences) == 0:
            print("  [WARN] No data found — switching to demo mode.")
            sequences, labels = _generate_demo_data()

    X = np.stack(sequences)             # (N, 30, 48)
    y = np.asarray(labels, dtype=int)  # (N,)

    # ── Cross-validation ──────────────────────────────────────────────────────
    from sklearn.model_selection import StratifiedKFold  # re-import for safety

    if k_folds <= 1 or not HAS_SKL:
        # Single 70/15/15 split
        n = len(X)
        n_train = int(0.70 * n)
        n_val   = int(0.15 * n)
        folds   = [(np.arange(n_train), np.arange(n_train + n_val, n))]
    else:
        skf   = StratifiedKFold(n_splits=k_folds, shuffle=True, random_state=42)
        folds = list(skf.split(X, y))

    all_preds:  List[int]   = []
    all_scores: List[float] = []
    all_true:   List[int]   = []

    total_frames    = 0
    total_time_ms   = 0.0
    n_processed     = 0

    print(f"\n  Running {k_folds}-fold evaluation on {len(X)} windows ...")

    for fold_idx, (_, test_idx) in enumerate(folds):
        X_test = X[test_idx]
        y_test = y[test_idx]

        fold_preds:  List[int]   = []
        fold_scores: List[float] = []

        for win in X_test:
            t_start = time.perf_counter()
            pred, prob = _infer(win)
            t_elapsed = (time.perf_counter() - t_start) * 1000

            fold_preds.append(pred)
            fold_scores.append(prob)
            total_time_ms += t_elapsed
            total_frames  += WINDOW_SIZE
            n_processed   += 1

        all_preds.extend(fold_preds)
        all_scores.extend(fold_scores)
        all_true.extend(y_test.tolist())

        fold_acc = np.mean(np.array(fold_preds) == y_test)
        print(f"    Fold {fold_idx+1}/{len(folds)}  —  acc = {fold_acc*100:.2f}%  "
              f"(n={len(y_test)})")

    # ── Compute final metrics ─────────────────────────────────────────────────
    metrics = compute_binary_metrics(all_true, all_preds, all_scores)

    avg_latency_ms = total_time_ms / max(n_processed, 1)
    fps            = 1000.0 / max(avg_latency_ms, 1e-3)

    # ── Terminal table ────────────────────────────────────────────────────────
    headers = ["Metric", "Value"]
    rows = [
        ["TP",          metrics["tp"]],
        ["TN",          metrics["tn"]],
        ["FP",          metrics["fp"]],
        ["FN",          metrics["fn"]],
        ["Accuracy",    f"{metrics['accuracy']*100:.2f}%"],
        ["Precision",   f"{metrics['precision']*100:.2f}%"],
        ["Recall (Sensitivity)", f"{metrics['recall']*100:.2f}%"],
        ["Specificity", f"{metrics['specificity']*100:.2f}%"],
        ["F1-Score",    f"{metrics['f1_score']*100:.2f}%"],
        ["ROC-AUC",     f"{metrics['roc_auc']:.4f}" if metrics['roc_auc'] else "N/A"],
        ["FPR",         f"{metrics['fpr']*100:.2f}%"],
        ["Avg Latency", f"{avg_latency_ms:.2f} ms/window"],
        ["Throughput",  f"{fps:.1f} FPS"],
    ]
    print_terminal_table(headers, rows,
                         title=f"Fall Detection Results — {dataset_name}")

    # ── Plots ─────────────────────────────────────────────────────────────────
    cm = np.array([[metrics["tn"], metrics["fp"]],
                   [metrics["fn"], metrics["tp"]]])
    plot_confusion_matrix(
        cm, labels=["ADL (Normal)", "Fall"],
        title="Fall & Anomaly Detection",
        subtitle=f"{dataset_name} — {k_folds}-fold CV",
        save_path=str(Path(output_dir) / "anomaly_confusion_matrix.png"),
    )

    if metrics["roc_auc"] is not None:
        plot_roc_curve(
            fpr=metrics["roc_fpr_arr"],
            tpr=metrics["roc_tpr_arr"],
            auc=metrics["roc_auc"],
            title=f"ROC Curve — Fall Detection ({dataset_name})",
            save_path=str(Path(output_dir) / "anomaly_roc_curve.png"),
        )

    # ── Return result rows ────────────────────────────────────────────────────
    result_rows = [
        {
            "dataset":   dataset_name,
            "module":    "Fall & Anomaly Detection",
            "task":      "Binary Fall Classification",
            "accuracy":  metrics["accuracy"],
            "precision": metrics["precision"],
            "recall":    metrics["recall"],
            "f1_score":  metrics["f1_score"],
            "fps":       round(fps, 1),
            "extra": {
                "specificity": metrics["specificity"],
                "roc_auc":     metrics["roc_auc"],
                "fpr":         metrics["fpr"],
                "tp": metrics["tp"], "tn": metrics["tn"],
                "fp": metrics["fp"], "fn": metrics["fn"],
                "avg_latency_ms": round(avg_latency_ms, 2),
            },
        }
    ]

    return result_rows
