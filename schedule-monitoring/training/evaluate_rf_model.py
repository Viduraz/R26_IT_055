#!/usr/bin/env python3
"""Evaluate Random Forest activity recognition without session leakage.

Each JSON session is treated as one group. A session is never split between
training and testing, because adjacent frames from the same recording are
highly correlated.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

from preprocess_rf_data import ACTIVITY_NAMES, extract_features


def load_sessions(data_dir: Path) -> dict[str, list[tuple[np.ndarray, int]]]:
    sessions: dict[str, list[tuple[np.ndarray, int]]] = {}
    for session_file in sorted(data_dir.glob("har_session_*.json")):
        with session_file.open() as handle:
            payload = json.load(handle)

        samples: list[tuple[np.ndarray, int]] = []
        for frame in payload.get("frames", []):
            label = frame.get("activity")
            if label not in ACTIVITY_NAMES:
                continue
            features = extract_features(frame.get("landmarks"))
            if features is not None and np.isfinite(features).all():
                samples.append((features, ACTIVITY_NAMES.index(label)))

        if samples:
            sessions[session_file.stem] = samples
    return sessions


def split_sessions(
    sessions: dict[str, list[tuple[np.ndarray, int]]],
) -> tuple[list[str], list[str]]:
    by_label: dict[int, list[str]] = defaultdict(list)
    for session_name, samples in sessions.items():
        labels = {label for _, label in samples}
        if len(labels) != 1:
            raise ValueError(
                f"{session_name} contains multiple labels; split recordings by activity "
                "before evaluation."
            )
        by_label[next(iter(labels))].append(session_name)

    missing = [
        ACTIVITY_NAMES[label]
        for label in range(len(ACTIVITY_NAMES))
        if len(by_label[label]) < 2
    ]
    if missing:
        details = ", ".join(
            f"{ACTIVITY_NAMES[label]}={len(by_label[label])}"
            for label in range(len(ACTIVITY_NAMES))
        )
        raise ValueError(
            "At least two independent sessions per activity are required for a "
            f"train/test evaluation; found {details}. Missing testable classes: "
            f"{', '.join(missing)}."
        )

    test_sessions = [by_label[label][0] for label in range(len(ACTIVITY_NAMES))]
    train_sessions = [
        name for name in sessions if name not in set(test_sessions)
    ]
    return train_sessions, test_sessions


def flatten(
    sessions: dict[str, list[tuple[np.ndarray, int]]], names: list[str]
) -> tuple[np.ndarray, np.ndarray]:
    samples = [sample for name in names for sample in sessions[name]]
    return (
        np.asarray([features for features, _ in samples], dtype=np.float32),
        np.asarray([label for _, label in samples], dtype=np.int32),
    )


def evaluate(data_dir: Path) -> None:
    sessions = load_sessions(data_dir)
    if not sessions:
        raise ValueError(f"No valid sessions found in {data_dir}.")

    train_names, test_names = split_sessions(sessions)
    X_train, y_train = flatten(sessions, train_names)
    X_test, y_test = flatten(sessions, test_names)

    mean = X_train.mean(axis=0)
    std = X_train.std(axis=0)
    std[std < 1e-8] = 1.0

    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=15,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1,
    )
    model.fit((X_train - mean) / std, y_train)
    predictions = model.predict((X_test - mean) / std)

    print(f"Training sessions: {', '.join(train_names)}")
    print(f"Test sessions:     {', '.join(test_names)}")
    print(f"Training samples:  {len(y_train)}")
    print(f"Test samples:      {len(y_test)}")
    print(f"Test accuracy:     {accuracy_score(y_test, predictions):.4f}")
    print(
        classification_report(
            y_test,
            predictions,
            labels=list(range(len(ACTIVITY_NAMES))),
            target_names=ACTIVITY_NAMES,
            zero_division=0,
        )
    )
    print("Confusion matrix (rows=true, columns=predicted):")
    print(confusion_matrix(y_test, predictions, labels=list(range(len(ACTIVITY_NAMES)))))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).parent / "data",
        help="Directory containing har_session_*.json files.",
    )
    args = parser.parse_args()
    evaluate(args.data_dir)


if __name__ == "__main__":
    main()
