"""
SecureElderCare — Pose Feature Extraction Pipeline
===================================================
Processes video clips from Kinetics-700 / UCF101 / HMDB51 and extracts
the exact same 14-feature pose vectors that activityDetection.js computes
in the browser, then saves them as numpy arrays for LSTM training.

Usage
-----
  pip install tensorflow tensorflow-hub opencv-python-headless numpy tqdm
  python3 extract_pose_sequences.py --dataset kinetics700 --root ./datasets/kinetics700
  python3 extract_pose_sequences.py --dataset ucf101      --root ./datasets/UCF-101
  python3 extract_pose_sequences.py --dataset hmdb51      --root ./datasets/hmdb51

Output
------
  data/<dataset>_X.npy   shape (N, 30, 14)  — pose-feature sequences
  data/<dataset>_y.npy   shape (N,)          — integer activity labels

Activity label map
------------------
  0 = Sleep          4 = Walking
  1 = Eating         5 = Sitting / rest
  2 = Drinking       6 = Standing up
  3 = Talking        7 = Movement (fallback)
"""

import argparse
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

# ── Activity label map ────────────────────────────────────────────────────────
ACTIVITY_LABELS = {
    "sleep":        0,
    "eating":       1,
    "drinking":     2,
    "talking":      3,
    "walking":      4,
    "sitting":      5,
    "standing_up":  6,
    "movement":     7,
}

LABEL_NAMES = {v: k for k, v in ACTIVITY_LABELS.items()}

# ── Dataset folder-name → system activity mapping ─────────────────────────────
DATASET_FOLDER_MAP = {
    # ---- Kinetics-700 -------------------------------------------------------
    "sleeping":                 "sleep",
    "eating_food":              "eating",
    "eating_cake":              "eating",
    "eating_chips":             "eating",
    "eating_hotdog":            "eating",
    "eating_ice_cream":         "eating",
    "eating_doughnuts":         "eating",
    "drinking_beer":            "drinking",
    "drinking_shots":           "drinking",
    "drinking_wine":            "drinking",
    "tasting_beer":             "drinking",
    "talking_on_cell_phone":    "talking",
    "answering_questions":      "talking",
    "getting_up":               "standing_up",
    "standing_up":              "standing_up",
    "walking_the_dog":          "walking",
    "power_walking":            "walking",
    "jogging":                  "walking",
    "sitting":                  "sitting",
    # ---- UCF101 ------------------------------------------------------------
    "Eating":                   "eating",
    "WalkingWithDog":           "walking",
    "Walking":                  "walking",
    "AnswerPhone":              "talking",
    # ---- HMDB51 ------------------------------------------------------------
    "eat":                      "eating",
    "drink":                    "drinking",
    "talk":                     "talking",
    "walk":                     "walking",
    "sit":                      "sitting",
    "stand":                    "standing_up",
    "sleep":                    "sleep",
    "get_up":                   "standing_up",
}

SEQUENCE_LEN = 30   # frames per sequence  (~1 second @ 30fps)
NUM_FEATURES = 14   # must match activityDetection.js extractPoseFeatures()
VIDEO_EXTS   = {".mp4", ".avi", ".mov", ".mkv"}


# ── MoveNet loader (lazy — avoids import cost if not needed) ──────────────────
_movenet = None
_tf      = None

def _get_movenet():
    """Load MoveNet Lightning once."""
    global _movenet, _tf
    if _movenet is not None:
        return _movenet
    try:
        import tensorflow as tf
        import tensorflow_hub as hub
        _tf = tf
    except ImportError:
        sys.exit("Install: pip install tensorflow tensorflow-hub")

    print("Loading MoveNet Lightning from TF Hub …")
    model = hub.load("https://tfhub.dev/google/movenet/singlepose/lightning/4")
    _movenet = model.signatures["serving_default"]
    print("✓ MoveNet loaded")
    return _movenet


# ── Geometry helpers ──────────────────────────────────────────────────────────
def _angle(a, b, c):
    """Angle (degrees) at joint b, given points a, b, c as (x,y) arrays."""
    ba = a - b
    bc = c - b
    norm = np.linalg.norm(ba) * np.linalg.norm(bc)
    if norm < 1e-8:
        return 0.0
    cos_a = np.dot(ba, bc) / norm
    return float(np.degrees(np.arccos(np.clip(cos_a, -1.0, 1.0))))


def _kp_xy(kps, idx):
    """Return (x, y) of keypoint idx from MoveNet output (y, x, score)."""
    return kps[idx, :2][::-1].copy()   # flip y,x → x,y


# ── Keypoint extraction ───────────────────────────────────────────────────────
def extract_keypoints(frame_rgb: np.ndarray) -> np.ndarray:
    """
    Run MoveNet on one RGB frame.
    Returns kps: (17, 3) — [y_norm, x_norm, score].
    """
    tf = _tf
    img = tf.image.resize_with_pad(
        tf.expand_dims(tf.cast(frame_rgb, tf.int32), axis=0), 192, 192
    )
    out = _get_movenet()(tf.cast(img, tf.int32))
    return out["output_0"].numpy()[0, 0, :, :]   # (17, 3)


# ── 14-feature extractor (mirrors activityDetection.js exactly) ──────────────
#  MoveNet COCO keypoint indices
_IDX = {
    "nose": 0, "l_sh": 5,  "r_sh": 6,
    "l_el": 7, "r_el": 8,  "l_wr": 9,  "r_wr": 10,
    "l_hip": 11, "r_hip": 12,
    "l_kn": 13, "r_kn": 14,
    "l_an": 15, "r_an": 16,
}

def extract_14_features(kps: np.ndarray, prev_kps: np.ndarray = None) -> np.ndarray:
    """
    Compute the same 14 biomechanical features as activityDetection.js.

    kps:      (17, 3) current frame  — [y_norm, x_norm, score]
    prev_kps: (17, 3) previous frame — used for velocity / oscillation
    Returns: (14,) float32 feature vector
    """
    I = _IDX
    p = lambda i: _kp_xy(kps, i)           # (x, y) for current frame

    # 1. Torso height
    sh_mid  = (p(I["l_sh"])  + p(I["r_sh"]))  / 2
    hip_mid = (p(I["l_hip"]) + p(I["r_hip"])) / 2
    torso_h = float(abs(hip_mid[1] - sh_mid[1]))

    # 2-3. Leg angles
    l_leg = _angle(p(I["l_hip"]), p(I["l_kn"]), p(I["l_an"]))
    r_leg = _angle(p(I["r_hip"]), p(I["r_kn"]), p(I["r_an"]))

    # 4-5. Arm angles
    l_arm = _angle(p(I["l_sh"]), p(I["l_el"]), p(I["l_wr"]))
    r_arm = _angle(p(I["r_sh"]), p(I["r_el"]), p(I["r_wr"]))

    # 6. Body height (nose to ankle) — using y-coord (normalised 0-1)
    body_h = float(abs(max(kps[I["l_an"], 0], kps[I["r_an"], 0]) - kps[0, 0]))

    # 7. Shoulder width
    sh_w = float(abs(p(I["l_sh"])[0] - p(I["r_sh"])[0]))

    # 8. Hand-to-mouth distance
    nose = p(I["nose"])
    h2m = float(min(
        np.linalg.norm(p(I["l_wr"]) - nose),
        np.linalg.norm(p(I["r_wr"]) - nose)
    ))

    # 9. Whole-body velocity
    velocity = 0.0
    if prev_kps is not None:
        pp = lambda i: _kp_xy(prev_kps, i)
        track = [0, I["l_wr"], I["r_wr"], I["l_an"], I["r_an"]]
        moves = [
            np.linalg.norm(p(i) - pp(i))
            for i in track
            if kps[i, 2] > 0.3 and prev_kps[i, 2] > 0.3
        ]
        velocity = float(np.mean(moves)) if moves else 0.0

    # 10. Leg asymmetry
    leg_asym = float(abs(l_leg - r_leg))

    # 11. Hip height (y-coord; large = lower in frame)
    hip_h = float((kps[I["l_hip"], 0] + kps[I["r_hip"], 0]) / 2)

    # 12. Wrist height (min y = highest in frame)
    wrist_h = float(min(kps[I["l_wr"], 0], kps[I["r_wr"], 0]))

    # 13. Elbow above shoulder (positive = elbow higher than shoulder)
    sh_avg_y   = float((kps[I["l_sh"], 0] + kps[I["r_sh"], 0]) / 2)
    min_el_y   = float(min(kps[I["l_el"], 0], kps[I["r_el"], 0]))
    elbow_abv  = sh_avg_y - min_el_y

    # 14. Wrist oscillation (vs previous frame)
    wrist_osc = 0.0
    if prev_kps is not None:
        for i in [I["l_wr"], I["r_wr"]]:
            if kps[i, 2] > 0.3 and prev_kps[i, 2] > 0.3:
                wrist_osc += float(np.linalg.norm(p(i) - _kp_xy(prev_kps, i)))
        wrist_osc /= 2

    return np.array([
        torso_h, l_leg, r_leg, l_arm, r_arm,
        body_h, sh_w, h2m, velocity, leg_asym,
        hip_h, wrist_h, elbow_abv, wrist_osc
    ], dtype=np.float32)


# ── Video → feature sequence ──────────────────────────────────────────────────
def video_to_sequence(video_path: Path) -> np.ndarray | None:
    """
    Read a video file, run MoveNet on each frame, extract 14 features.
    Returns (SEQUENCE_LEN, 14) or None if the video cannot be opened.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None

    features, prev_kps = [], None
    while len(features) < SEQUENCE_LEN:
        ret, frame = cap.read()
        if not ret:
            break
        rgb  = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        kps  = extract_keypoints(rgb)
        feat = extract_14_features(kps, prev_kps)
        features.append(feat)
        prev_kps = kps

    cap.release()

    if not features:
        return None

    # Pad short clips by repeating the last frame
    while len(features) < SEQUENCE_LEN:
        features.append(features[-1])

    return np.stack(features[:SEQUENCE_LEN])   # (30, 14)


# ── Dataset builder ───────────────────────────────────────────────────────────
def build_dataset(root: Path, output_prefix: str, max_per_class: int = 500):
    """
    Walk *root*, map folder names via DATASET_FOLDER_MAP, extract sequences.

    root/
      eating_food/   ← folder name must be in DATASET_FOLDER_MAP
        clip001.mp4
        clip002.avi
      drinking_beer/
        ...

    Saves:
      <output_prefix>_X.npy  (N, 30, 14)
      <output_prefix>_y.npy  (N,)
    """
    _get_movenet()   # ensure model is loaded before processing

    X, y = [], []
    class_counts = {k: 0 for k in ACTIVITY_LABELS}

    all_folders = [f for f in sorted(root.iterdir()) if f.is_dir()]
    print(f"\nFound {len(all_folders)} folders under {root}\n")

    for folder in all_folders:
        key = folder.name.lower().replace(" ", "_").replace("-", "_")
        if key not in DATASET_FOLDER_MAP:
            print(f"  [skip] {folder.name}  (not in DATASET_FOLDER_MAP)")
            continue

        activity   = DATASET_FOLDER_MAP[key]
        label      = ACTIVITY_LABELS[activity]
        clips      = [f for f in folder.iterdir() if f.suffix.lower() in VIDEO_EXTS]
        n_take     = min(len(clips), max_per_class - class_counts[activity])

        if n_take <= 0:
            print(f"  [skip] {folder.name}  (class cap reached for '{activity}')")
            continue

        print(f"  {folder.name:40s} → {activity:15s}  ({n_take} clips)")
        ok = fail = 0

        for clip in tqdm(clips[:n_take], leave=False, desc=f"    {activity}"):
            seq = video_to_sequence(clip)
            if seq is not None:
                X.append(seq)
                y.append(label)
                class_counts[activity] += 1
                ok += 1
            else:
                fail += 1

        print(f"    ✓ {ok} extracted, {fail} failed")

    X_arr = np.array(X, dtype=np.float32)   # (N, 30, 14)
    y_arr = np.array(y, dtype=np.int32)     # (N,)

    os.makedirs(Path(output_prefix).parent, exist_ok=True)
    np.save(output_prefix + "_X.npy", X_arr)
    np.save(output_prefix + "_y.npy", y_arr)

    print(f"\n{'─'*60}")
    print(f"Saved {len(X_arr)} sequences → {output_prefix}_X/y.npy")
    print("\nClass distribution:")
    for label_id, count in enumerate(np.bincount(y_arr, minlength=8)):
        print(f"  {label_id}  {LABEL_NAMES[label_id]:15s}  {count:4d} clips")


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Extract MoveNet pose sequences from HAR video datasets"
    )
    parser.add_argument("--dataset", required=True,
                        choices=["kinetics700", "ucf101", "hmdb51", "custom"],
                        help="Which dataset you are processing")
    parser.add_argument("--root", required=True,
                        help="Path to the dataset root (contains class subfolders)")
    parser.add_argument("--out_dir", default="./data",
                        help="Where to save _X.npy and _y.npy (default: ./data)")
    parser.add_argument("--max_per_class", type=int, default=500,
                        help="Max clips per activity class (default: 500)")
    args = parser.parse_args()

    build_dataset(
        root=Path(args.root),
        output_prefix=os.path.join(args.out_dir, args.dataset),
        max_per_class=args.max_per_class
    )
