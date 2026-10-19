#!/usr/bin/env python3
"""Convert single-label webcam exports into posture/action annotations.

The collector historically stored one mutually-exclusive ``activity`` label.
That is not expressive enough for real scenes such as sitting while drinking.
This script preserves the original label, deduplicates cumulative exports by
timestamp, and adds independent ``posture`` and ``action`` labels.

The source recordings are never modified.  The output is suitable for
inspection and for downstream training code that understands the new fields.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

ACTION_LABELS = {"Eating", "Drinking"}
POSTURE_LABELS = {"Walking", "Sitting", "Standing", "Sleeping", "Unknown"}


def _number(features: list[Any], index: int, default: float = 0.0) -> float:
    try:
        value = float(features[index])
    except (IndexError, TypeError, ValueError):
        return default
    return value


def infer_posture(frame: dict[str, Any], source_label: str) -> tuple[str, float, str]:
    """Infer posture conservatively from the old label and pose features."""
    if source_label == "Walking":
        return "Walking", 0.99, "legacy_activity_label"
    if source_label == "Sleeping":
        return "Sleeping", 0.99, "legacy_activity_label"
    if source_label == "Sitting / rest":
        return "Sitting", 0.99, "legacy_activity_label"

    features = frame.get("features")
    if not isinstance(features, list) or len(features) < 15:
        return "Unknown", 0.0, "missing_features"

    left_leg = _number(features, 1)
    right_leg = _number(features, 2)
    body_height = _number(features, 5)
    hip_height = _number(features, 10)
    torso_alignment = _number(features, 14)
    velocity = _number(features, 8)

    # Lying-down geometry has a strongly non-upright torso or a short visible
    # body span.  This deliberately requires multiple signals.
    if (
        (torso_alignment > 1.1 and velocity < 0.08)
        or (hip_height > 0.45 and body_height < 0.60 and velocity < 0.04)
    ):
        return "Sleeping", 0.72, "geometry_lying_down"

    legs_straight = left_leg > 150 and right_leg > 150
    if legs_straight and body_height >= 0.50:
        return "Standing", 0.68, "geometry_upright"

    return "Sitting", 0.62, "geometry_non_upright"


def relabel_frame(frame: dict[str, Any]) -> dict[str, Any]:
    source_label = str(frame.get("activity") or frame.get("label") or "").strip()
    if source_label not in {"Walking", "Sitting / rest", "Sleeping", "Eating", "Drinking"}:
        source_label = "Unknown"

    if source_label in ACTION_LABELS:
        action = source_label
        action_confidence = 0.99
    elif source_label in {"Walking", "Sitting / rest", "Sleeping"}:
        action = "None"
        action_confidence = 0.99
    else:
        action = "Unknown"
        action_confidence = 0.0

    posture, posture_confidence, posture_reason = infer_posture(frame, source_label)
    updated = dict(frame)
    updated.update(
        {
            "source_activity": frame.get("activity") or frame.get("label"),
            "posture": posture,
            "action": action,
            "posture_confidence": posture_confidence,
            "action_confidence": action_confidence,
            "annotation_source": posture_reason,
        }
    )
    return updated


def load_deduplicated_frames(input_dir: Path) -> list[dict[str, Any]]:
    frames_by_timestamp: dict[str, dict[str, Any]] = {}
    for source in sorted(input_dir.glob("*.json")):
        payload = json.loads(source.read_text())
        frames = payload if isinstance(payload, list) else payload.get("frames", [])
        if not isinstance(frames, list):
            continue
        for frame in frames:
            if not isinstance(frame, dict):
                continue
            timestamp = frame.get("t", frame.get("timestamp"))
            if timestamp is not None:
                frames_by_timestamp[str(timestamp)] = frame
    return sorted(
        frames_by_timestamp.values(),
        key=lambda frame: float(frame.get("t", frame.get("timestamp", 0))),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path(__file__).parent / "data",
        help="Directory containing exported JSON sessions.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).parent / "data" / "relabeled",
        help="Directory for the generated relabeled session.",
    )
    args = parser.parse_args()

    frames = load_deduplicated_frames(args.input_dir)
    if not frames:
        raise SystemExit(f"No timestamped JSON frames found in {args.input_dir}")

    relabeled = [relabel_frame(frame) for frame in frames]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / "relabeled_all_sessions.json"
    payload = {
        "schema_version": 2,
        "source": "webcam_exports_relabelled",
        "label_semantics": {
            "posture": sorted(POSTURE_LABELS),
            "action": ["None", "Eating", "Drinking", "Unknown"],
        },
        "frames": relabeled,
    }
    output.write_text(json.dumps(payload, separators=(",", ":")))

    print(f"Wrote {len(relabeled)} deduplicated frames to {output}")
    print("Postures:", dict(Counter(frame["posture"] for frame in relabeled)))
    print("Actions:", dict(Counter(frame["action"] for frame in relabeled)))
    print("Source labels:", dict(Counter(frame["source_activity"] for frame in relabeled)))


if __name__ == "__main__":
    main()
