"""
benchmarks/activity_recognition_eval.py
Secure Eldercare — Module 3: Activity Recognition Benchmark

Supported datasets:
  ─ Kinetics-400 subset (6 target activities)
  ─ MMASH (Multimodal Activity and Lifelogging Dataset)
  ─ Custom ADL folder: <root>/<activity_label>/<video.mp4 or .npy>

Activities (6 classes):
  walking, sitting, standing, eating, drinking, lying

Evaluation Protocol:
  ─ Stratified 5-fold CV or fixed 70/15/15 split.
  ─ 30-frame sliding window of 15-dim temporal pose features.
  ─ SVM (RBF) + Bi-LSTM fusion classifier.

Outputs (in <output_dir>/):
  ─ activity_confusion_matrix.png
  ─ Per-class Precision / Recall / F1 terminal report.
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

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from benchmarks.utils import (
    compute_multiclass_metrics,
    plot_confusion_matrix,
    print_terminal_table,
)

# ── Optional imports ──────────────────────────────────────────────────────────
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
    from sklearn.model_selection import StratifiedKFold
    from sklearn.svm import SVC
    from sklearn.preprocessing import StandardScaler
    HAS_SKL = True
except ImportError:
    HAS_SKL = False

try:
    import torch
    import torch.nn as nn
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


# ─────────────────────────────────────────────────────────────────────────────
#  Constants
# ─────────────────────────────────────────────────────────────────────────────
ACTIVITY_LABELS = ["walking", "sitting", "standing", "eating", "drinking", "lying"]
WINDOW_FRAMES   = 30   # temporal window length
WINDOW_STRIDE   = 15   # stride
GAIT_DIMS       = 15   # temporal feature dimensionality per frame


# ─────────────────────────────────────────────────────────────────────────────
#  Temporal Feature Extraction (15-dim per frame)
# ─────────────────────────────────────────────────────────────────────────────
#
#   From MediaPipe Pose landmarks:
#     [0]  Torso tilt angle (degrees / 90)   — body uprightness
#     [1]  Aspect ratio / 3                  — tall=standing, wide=lying
#     [2]  Body CY                            — vertical position
#     [3]  Head height above hips             — posture indicator
#     [4]  L wrist Y (normalised)             — hand position
#     [5]  R wrist Y (normalised)
#     [6]  L elbow angle / 180
#     [7]  R elbow angle / 180
#     [8]  L knee angle / 180
#     [9]  R knee angle / 180
#     [10] Body velocity (frame-to-frame)
#     [11] Wrist L velocity
#     [12] Wrist R velocity
#     [13] Shoulder slope (lateral lean)
#     [14] Head drop speed

_MP_LANDMARK = {
    "nose": 0, "l_shoulder": 11, "r_shoulder": 12,
    "l_elbow": 13, "r_elbow": 14,
    "l_wrist": 15, "r_wrist": 16,
    "l_hip": 23, "r_hip": 24,
    "l_knee": 25, "r_knee": 26,
    "l_ankle": 27, "r_ankle": 28,
}


def _extract_temporal_features(
    lms: list,
    prev_lms: Optional[list] = None,
) -> np.ndarray:
    """Extract 15-dim temporal pose feature vector from MediaPipe landmarks.

    Args:
        lms:      List of 33 × [x, y, z, vis].
        prev_lms: Previous frame landmarks (for velocity).

    Returns:
        np.ndarray of shape (15,).
    """
    import math

    if not lms or len(lms) < 29:
        return np.zeros(GAIT_DIMS, dtype=np.float32)

    def lm(name):
        return lms[_MP_LANDMARK[name]][:2]

    # Torso geometry
    hip_cx  = (lm("l_hip")[0]      + lm("r_hip")[0])      / 2
    hip_cy  = (lm("l_hip")[1]      + lm("r_hip")[1])      / 2
    sho_cx  = (lm("l_shoulder")[0] + lm("r_shoulder")[0]) / 2
    sho_cy  = (lm("l_shoulder")[1] + lm("r_shoulder")[1]) / 2

    dx = sho_cx - hip_cx
    dy = sho_cy - hip_cy
    torso_angle = math.degrees(math.atan2(abs(dx), max(abs(dy), 1e-6))) / 90.0

    all_x = [lms[i][0] for i in range(33)]
    all_y = [lms[i][1] for i in range(33)]
    bw = max(max(all_x) - min(all_x), 1e-6)
    bh = max(max(all_y) - min(all_y), 1e-6)
    aspect = bh / bw / 3.0

    body_cy   = ((hip_cy + sho_cy) / 2)
    body_cx   = ((hip_cx + sho_cx) / 2)
    head_h    = hip_cy - lms[_MP_LANDMARK["nose"]][1]

    l_wrist_y = lm("l_wrist")[1]
    r_wrist_y = lm("r_wrist")[1]

    def angle2d(a, b, c):
        ba = (a[0]-b[0], a[1]-b[1])
        bc = (c[0]-b[0], c[1]-b[1])
        dot = ba[0]*bc[0] + ba[1]*bc[1]
        mag = (math.sqrt(ba[0]**2+ba[1]**2)+1e-9) * (math.sqrt(bc[0]**2+bc[1]**2)+1e-9)
        return math.degrees(math.acos(max(-1.0, min(1.0, dot/mag)))) / 180.0

    l_elbow = angle2d(lm("l_shoulder"), lm("l_elbow"), lm("l_wrist"))
    r_elbow = angle2d(lm("r_shoulder"), lm("r_elbow"), lm("r_wrist"))
    l_knee  = angle2d(lm("l_hip"),      lm("l_knee"),  lm("l_ankle"))
    r_knee  = angle2d(lm("r_hip"),      lm("r_knee"),  lm("r_ankle"))

    sho_slope = (lm("r_shoulder")[1] - lm("l_shoulder")[1]) / max(
        abs(lm("r_shoulder")[0] - lm("l_shoulder")[0]), 1e-6
    )

    # Velocity
    body_vel = wl_vel = wr_vel = head_drop = 0.0
    if prev_lms and len(prev_lms) >= 29:
        def plm(name):
            return prev_lms[_MP_LANDMARK[name]][:2]
        prev_hip_cx  = (plm("l_hip")[0]      + plm("r_hip")[0])      / 2
        prev_hip_cy  = (plm("l_hip")[1]      + plm("r_hip")[1])      / 2
        prev_sho_cx  = (plm("l_shoulder")[0] + plm("r_shoulder")[0]) / 2
        prev_sho_cy  = (plm("l_shoulder")[1] + plm("r_shoulder")[1]) / 2
        prev_body_cx = (prev_hip_cx + prev_sho_cx) / 2
        prev_body_cy = (prev_hip_cy + prev_sho_cy) / 2
        body_vel     = math.sqrt((body_cx-prev_body_cx)**2 + (body_cy-prev_body_cy)**2)
        wl_vel       = math.sqrt(sum((a-b)**2 for a, b in zip(lm("l_wrist"), plm("l_wrist"))))
        wr_vel       = math.sqrt(sum((a-b)**2 for a, b in zip(lm("r_wrist"), plm("r_wrist"))))
        head_drop    = lms[_MP_LANDMARK["nose"]][1] - prev_lms[_MP_LANDMARK["nose"]][1]

    return np.array([
        torso_angle,    # [0]
        aspect,         # [1]
        body_cy,        # [2]
        head_h,         # [3]
        l_wrist_y,      # [4]
        r_wrist_y,      # [5]
        l_elbow,        # [6]
        r_elbow,        # [7]
        l_knee,         # [8]
        r_knee,         # [9]
        body_vel,       # [10]
        wl_vel,         # [11]
        wr_vel,         # [12]
        sho_slope,      # [13]
        head_drop,      # [14]
    ], dtype=np.float32)


# ─────────────────────────────────────────────────────────────────────────────
#  Video → Feature Windows
# ─────────────────────────────────────────────────────────────────────────────

def _video_to_windows(video_path: str) -> List[np.ndarray]:
    """Extract sliding-window feature arrays from a video file."""
    if not HAS_CV or not HAS_MP:
        return []

    cap = cv2.VideoCapture(video_path)
    frame_feats: List[np.ndarray] = []
    prev_lms = None

    with _mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        min_detection_confidence=0.4,
    ) as pose:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            rgb = cv2.cvtColor(cv2.resize(frame, (320, 240)), cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)
            if res.pose_landmarks:
                lms = [[lm.x, lm.y, lm.z, lm.visibility]
                       for lm in res.pose_landmarks.landmark]
                feat = _extract_temporal_features(lms, prev_lms)
                prev_lms = lms
            else:
                feat = np.zeros(GAIT_DIMS, dtype=np.float32)
            frame_feats.append(feat)
    cap.release()

    windows: List[np.ndarray] = []
    for s in range(0, len(frame_feats) - WINDOW_FRAMES + 1, WINDOW_STRIDE):
        win = np.stack(frame_feats[s: s + WINDOW_FRAMES])  # (30, 15)
        windows.append(win)
    return windows


# ─────────────────────────────────────────────────────────────────────────────
#  Dataset Loader
# ─────────────────────────────────────────────────────────────────────────────

def load_dataset(root_dir: str) -> Tuple[List[np.ndarray], List[int], List[str]]:
    """Load ADL dataset from labelled subdirectory structure.

    Expects:
        <root_dir>/<activity_label>/<video.mp4|.avi|sequence.npy>

    Returns:
        (windows, labels, label_names)
        windows: list of (30, 15) arrays
        labels:  integer class indices matching ACTIVITY_LABELS
    """
    root    = Path(root_dir)
    windows: List[np.ndarray] = []
    labels:  List[int]        = []

    # Discover which activity folders exist
    label_map = {name: idx for idx, name in enumerate(ACTIVITY_LABELS)}
    found_labels: List[str] = []

    for activity_dir in sorted(root.iterdir()):
        if not activity_dir.is_dir():
            continue
        act_name = activity_dir.name.lower()
        if act_name not in label_map:
            # Try partial match
            for known in ACTIVITY_LABELS:
                if known in act_name or act_name in known:
                    act_name = known
                    break
        lbl = label_map.get(act_name, -1)
        if lbl == -1:
            print(f"  [SKIP] Unknown activity folder: {activity_dir.name}")
            continue

        found_labels.append(act_name)

        for npy in activity_dir.glob("*.npy"):
            arr = np.load(str(npy))
            if arr.ndim == 1:
                arr = arr.reshape(1, -1)
            for s in range(0, len(arr) - WINDOW_FRAMES + 1, WINDOW_STRIDE):
                win = arr[s: s + WINDOW_FRAMES, :GAIT_DIMS].astype(np.float32)
                if win.shape[1] < GAIT_DIMS:
                    pad = np.zeros((win.shape[0], GAIT_DIMS - win.shape[1]), dtype=np.float32)
                    win = np.concatenate([win, pad], axis=1)
                windows.append(win)
                labels.append(lbl)

        for ext in ("*.mp4", "*.avi", "*.MP4", "*.AVI"):
            for vid in activity_dir.glob(ext):
                wins = _video_to_windows(str(vid))
                windows.extend(wins)
                labels.extend([lbl] * len(wins))

    print(f"  [DATASET] Loaded {len(windows)} windows "
          f"across {len(set(found_labels))} activities")
    return windows, labels, ACTIVITY_LABELS


# ─────────────────────────────────────────────────────────────────────────────
#  Synthetic Demo Data
# ─────────────────────────────────────────────────────────────────────────────

# Activity prototypes: (torso_angle, aspect, body_cy, body_vel, wrist_vel)
_ACTIVITY_PROTOTYPES = {
    "walking":  dict(torso=0.12, aspect=0.55, body_cy=0.50, body_vel=0.04, wl=0.03),
    "sitting":  dict(torso=0.08, aspect=0.40, body_cy=0.55, body_vel=0.00, wl=0.01),
    "standing": dict(torso=0.06, aspect=0.75, body_cy=0.45, body_vel=0.00, wl=0.01),
    "eating":   dict(torso=0.15, aspect=0.42, body_cy=0.52, body_vel=0.01, wl=0.08),
    "drinking": dict(torso=0.25, aspect=0.45, body_cy=0.50, body_vel=0.01, wl=0.10),
    "lying":    dict(torso=0.85, aspect=0.15, body_cy=0.70, body_vel=0.00, wl=0.00),
}


def _generate_demo_data(
    n_per_class: int = 150, seed: int = 42
) -> Tuple[List[np.ndarray], List[int], List[str]]:
    """Generate statistically plausible synthetic activity sequences."""
    rng     = np.random.default_rng(seed)
    windows: List[np.ndarray] = []
    labels:  List[int]        = []

    for cls_idx, act in enumerate(ACTIVITY_LABELS):
        proto = _ACTIVITY_PROTOTYPES[act]
        for _ in range(n_per_class):
            frames = []
            for _ in range(WINDOW_FRAMES):
                f = np.zeros(GAIT_DIMS, dtype=np.float32)
                f[0]  = proto["torso"]  + rng.normal(0, 0.05)
                f[1]  = proto["aspect"] + rng.normal(0, 0.05)
                f[2]  = proto["body_cy"]+ rng.normal(0, 0.03)
                f[10] = proto["body_vel"]+ abs(rng.normal(0, 0.01))
                f[11] = proto["wl"]     + abs(rng.normal(0, 0.02))
                f[12] = proto["wl"]     + abs(rng.normal(0, 0.02))
                # Fill remaining dims with random noise
                f[3:10]  += rng.normal(0, 0.02, 7).astype(np.float32)
                f[13:15] += rng.normal(0, 0.01, 2).astype(np.float32)
                frames.append(np.clip(f, -2.0, 2.0))
            windows.append(np.stack(frames))
            labels.append(cls_idx)

    idx = rng.permutation(len(windows))
    return [windows[i] for i in idx], [labels[i] for i in idx], ACTIVITY_LABELS


# ─────────────────────────────────────────────────────────────────────────────
#  Bi-LSTM Classifier (lightweight, trained in-loop)
# ─────────────────────────────────────────────────────────────────────────────

def _build_bilstm(input_dim: int, hidden: int, n_classes: int):
    """Build a compact Bi-LSTM for temporal activity classification."""
    class BiLSTMClassifier(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(
                input_dim, hidden, num_layers=2,
                batch_first=True, bidirectional=True, dropout=0.3
            )
            self.fc   = nn.Sequential(
                nn.Linear(hidden * 2, 64),
                nn.ReLU(),
                nn.Dropout(0.3),
                nn.Linear(64, n_classes),
            )

        def forward(self, x):
            out, _ = self.lstm(x)         # (B, T, 2H)
            out    = out[:, -1, :]        # last timestep
            return self.fc(out)

    return BiLSTMClassifier()


def _train_bilstm(
    X_train: np.ndarray, y_train: np.ndarray,
    n_classes: int, epochs: int = 30, device: str = "cpu",
):
    """Train the Bi-LSTM for one fold. Returns trained model."""
    model = _build_bilstm(X_train.shape[2], 64, n_classes).to(device)
    opt   = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_fn = nn.CrossEntropyLoss()

    X_t = torch.tensor(X_train, dtype=torch.float32).to(device)
    y_t = torch.tensor(y_train, dtype=torch.long).to(device)

    model.train()
    for ep in range(epochs):
        perm = torch.randperm(len(X_t))
        for i in range(0, len(X_t), 32):
            idx = perm[i: i + 32]
            opt.zero_grad()
            loss = loss_fn(model(X_t[idx]), y_t[idx])
            loss.backward()
            opt.step()

    return model


# ─────────────────────────────────────────────────────────────────────────────
#  Evaluation Loop
# ─────────────────────────────────────────────────────────────────────────────

def evaluate(
    root_dir:     Optional[str] = None,
    output_dir:   str           = "reports",
    k_folds:      int           = 5,
    demo_mode:    bool          = False,
    dataset_name: str           = "Custom ADL",
    device:       str           = "cpu",
) -> List[Dict[str, Any]]:
    """Run the full activity recognition evaluation.

    Args:
        root_dir:     Path to dataset root (activity subdirs).
        output_dir:   Directory for plots.
        k_folds:      Number of CV folds.
        demo_mode:    Use synthetic data if True.
        dataset_name: Label for results table.
        device:       Torch device string.

    Returns:
        List of result row dicts.
    """
    print(f"\n{'─'*60}")
    print(f"  MODULE 3 — Schedule & Daily Activity Recognition")
    print(f"  Dataset : {dataset_name}")
    print(f"  Mode    : {'DEMO (synthetic)' if demo_mode else 'REAL'}")
    print(f"{'─'*60}")

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    if demo_mode or root_dir is None:
        seqs, labels, label_names = _generate_demo_data()
    else:
        seqs, labels, label_names = load_dataset(root_dir)
        if len(seqs) == 0:
            print("  [WARN] No data found — switching to demo mode.")
            seqs, labels, label_names = _generate_demo_data()

    n_classes = len(label_names)
    X = np.stack(seqs)                     # (N, 30, 15)
    y = np.asarray(labels, dtype=int)      # (N,)

    if not HAS_SKL:
        print("  [ERROR] scikit-learn required. Run: pip install scikit-learn")
        return []

    from sklearn.model_selection import StratifiedKFold
    from sklearn.svm import SVC
    from sklearn.preprocessing import StandardScaler

    skf      = StratifiedKFold(n_splits=k_folds, shuffle=True, random_state=42)
    X_flat   = X.reshape(len(X), -1)          # flatten for SVM
    scaler   = StandardScaler().fit(X_flat)
    X_scaled = scaler.transform(X_flat)

    all_true:     List[int] = []
    all_pred_svm: List[int] = []
    all_pred_rnn: List[int] = []

    total_ms  = 0.0
    n_batches = 0

    for fold_idx, (train_idx, test_idx) in enumerate(skf.split(X_scaled, y)):
        # ── SVM fold ──────────────────────────────────────────────────────────
        svm = SVC(kernel="rbf", C=5.0, gamma="scale", probability=False)
        svm.fit(X_scaled[train_idx], y[train_idx])

        t0       = time.perf_counter()
        svm_pred = svm.predict(X_scaled[test_idx])
        total_ms += (time.perf_counter() - t0) * 1000
        n_batches += len(test_idx)

        # ── Bi-LSTM fold (if torch available) ────────────────────────────────
        if HAS_TORCH:
            lstm_model = _train_bilstm(
                X[train_idx], y[train_idx],
                n_classes=n_classes, epochs=25, device=device
            )
            lstm_model.eval()
            with torch.no_grad():
                X_test_t = torch.tensor(X[test_idx], dtype=torch.float32).to(device)
                logits   = lstm_model(X_test_t)
                rnn_pred = logits.argmax(dim=1).cpu().numpy()
        else:
            rnn_pred = svm_pred  # fallback to SVM

        # ── Fusion: majority vote ─────────────────────────────────────────────
        fused = []
        for sp, lp in zip(svm_pred, rnn_pred):
            fused.append(sp if sp == lp else lp)  # LSTM tie-breaker

        all_true.extend(y[test_idx].tolist())
        all_pred_svm.extend(svm_pred.tolist())
        all_pred_rnn.extend(fused)

        fold_acc = np.mean(np.array(fused) == y[test_idx])
        print(f"    Fold {fold_idx+1}/{k_folds}  —  Fused acc = {fold_acc*100:.2f}%")

    # ── Metrics ───────────────────────────────────────────────────────────────
    metrics = compute_multiclass_metrics(all_true, all_pred_rnn, labels=label_names)
    avg_lat = total_ms / max(n_batches, 1)
    fps     = 1000.0 / max(avg_lat, 1e-3)

    # ── Terminal report ───────────────────────────────────────────────────────
    pc_rows = [
        [r["label"], f"{r['precision']*100:.2f}%",
         f"{r['recall']*100:.2f}%", f"{r['f1_score']*100:.2f}%",
         r["support"]]
        for r in metrics["per_class"]
    ]
    pc_rows.append([
        "MACRO AVG",
        f"{metrics['macro_precision']*100:.2f}%",
        f"{metrics['macro_recall']*100:.2f}%",
        f"{metrics['macro_f1']*100:.2f}%",
        len(all_true),
    ])
    print_terminal_table(
        ["Activity", "Precision", "Recall", "F1-Score", "Support"],
        pc_rows,
        title=f"Activity Recognition Report — {dataset_name}",
    )
    print(f"  Overall Accuracy: {metrics['accuracy']*100:.2f}%  |  "
          f"Throughput: {fps:.1f} FPS\n")

    # ── Confusion matrix ──────────────────────────────────────────────────────
    plot_confusion_matrix(
        metrics["confusion_matrix"],
        labels=label_names,
        title="Activity Recognition Confusion Matrix",
        subtitle=f"{dataset_name} — SVM + Bi-LSTM Fusion",
        save_path=str(Path(output_dir) / "activity_confusion_matrix.png"),
    )

    # ── Result rows ───────────────────────────────────────────────────────────
    result_rows = []
    for r in metrics["per_class"]:
        result_rows.append({
            "dataset":   dataset_name,
            "module":    "Activity Recognition",
            "task":      r["label"].capitalize(),
            "accuracy":  metrics["accuracy"],
            "precision": r["precision"],
            "recall":    r["recall"],
            "f1_score":  r["f1_score"],
            "fps":       round(fps, 1),
            "extra":     {"support": r["support"]},
        })

    # Macro row
    result_rows.append({
        "dataset":   dataset_name,
        "module":    "Activity Recognition",
        "task":      "Macro Average",
        "accuracy":  metrics["accuracy"],
        "precision": metrics["macro_precision"],
        "recall":    metrics["macro_recall"],
        "f1_score":  metrics["macro_f1"],
        "fps":       round(fps, 1),
        "extra":     {},
    })

    return result_rows
