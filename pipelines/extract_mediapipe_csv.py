"""Extract MediaPipe Pose landmark CSV files from activity videos.

The script walks a class-based video dataset, runs MediaPipe Pose on each
frame, and stores 33 landmarks (x, y, z) per frame as CSV files that can be
fed directly into sequence models.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
from tqdm import tqdm


VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}
NUM_LANDMARKS = 33


def landmark_columns() -> list[str]:
    columns: list[str] = ["frame_index", "label", "video_id"]
    for landmark_index in range(NUM_LANDMARKS):
        columns.extend(
            [
                f"l{landmark_index}_x",
                f"l{landmark_index}_y",
                f"l{landmark_index}_z",
            ]
        )
    return columns


def extract_frame_landmarks(pose, frame_bgr: np.ndarray) -> np.ndarray:
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    results = pose.process(frame_rgb)

    if not results.pose_landmarks:
        return np.zeros((NUM_LANDMARKS, 3), dtype=np.float32)

    landmarks = np.array(
        [[lm.x, lm.y, lm.z] for lm in results.pose_landmarks.landmark],
        dtype=np.float32,
    )

    if landmarks.shape[0] != NUM_LANDMARKS:
        padded = np.zeros((NUM_LANDMARKS, 3), dtype=np.float32)
        padded[: landmarks.shape[0]] = landmarks
        return padded

    return landmarks


def extract_video_csv(video_path: Path, label: str, output_dir: Path) -> Path | None:
    mp_pose = mp.solutions.pose
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"{video_path.stem}.csv"

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        return None

    rows = []
    frame_index = 0

    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:
        while True:
            success, frame = capture.read()
            if not success:
                break

            landmarks = extract_frame_landmarks(pose, frame)
            row = [frame_index, label, video_path.stem]
            row.extend(landmarks.reshape(-1).tolist())
            rows.append(row)
            frame_index += 1

    capture.release()

    if not rows:
        return None

    dataframe = pd.DataFrame(rows, columns=landmark_columns())
    dataframe.to_csv(csv_path, index=False)
    return csv_path


def iter_class_videos(root: Path):
    for class_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        label = class_dir.name.lower().replace(" ", "_").replace("/", "_")
        for video_path in sorted(class_dir.iterdir()):
            if video_path.suffix.lower() in VIDEO_EXTENSIONS:
                yield label, video_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract MediaPipe CSV landmarks from videos")
    parser.add_argument("--root", required=True, help="Dataset root with class subfolders")
    parser.add_argument("--output-dir", default="./data/mediapipe_csv", help="Where CSV files are saved")
    args = parser.parse_args()

    root = Path(args.root)
    output_dir = Path(args.output_dir)

    if not root.exists():
        raise SystemExit(f"Dataset root not found: {root}")

    videos = list(iter_class_videos(root))
    if not videos:
        raise SystemExit(f"No videos found under {root}")

    print(f"Found {len(videos)} video clips under {root}")

    saved = 0
    for label, video_path in tqdm(videos, desc="Extracting", unit="clip"):
        class_output_dir = output_dir / label
        csv_path = extract_video_csv(video_path, label, class_output_dir)
        if csv_path is not None:
            saved += 1
            print(f"Saved {csv_path}")

    print(f"\nExtraction complete: {saved}/{len(videos)} clips written to {output_dir}")


if __name__ == "__main__":
    main()