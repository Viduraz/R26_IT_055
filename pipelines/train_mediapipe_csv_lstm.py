"""Train an LSTM or GRU model on MediaPipe Pose landmark CSV sequences.

The input is expected to be the output of extract_mediapipe_csv.py: one CSV
per clip, with 33 landmarks (x, y, z) for each frame and a label column.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight
import tensorflow as tf


SEQ_LEN = 30
STEP = 15


def landmark_feature_columns() -> list[str]:
    columns: list[str] = []
    for landmark_index in range(33):
        columns.extend(
            [
                f"l{landmark_index}_x",
                f"l{landmark_index}_y",
                f"l{landmark_index}_z",
            ]
        )
    return columns


def load_sequences(data_dir: Path, sequence_length: int, step: int):
    csv_files = sorted(data_dir.rglob("*.csv"))
    if not csv_files:
        raise SystemExit(f"No CSV files found under {data_dir}")

    feature_columns = landmark_feature_columns()
    samples: list[np.ndarray] = []
    labels: list[str] = []

    for csv_path in csv_files:
        frame_data = pd.read_csv(csv_path)
        missing = [column for column in feature_columns if column not in frame_data.columns]
        if missing:
            print(f"[skip] {csv_path} is missing expected columns")
            continue

        if "label" not in frame_data.columns:
            print(f"[skip] {csv_path} has no label column")
            continue

        label = str(frame_data["label"].iloc[0])
        feature_matrix = frame_data[feature_columns].to_numpy(dtype=np.float32)

        if len(feature_matrix) < sequence_length:
            continue

        for start in range(0, len(feature_matrix) - sequence_length + 1, step):
            window = feature_matrix[start : start + sequence_length]
            samples.append(window)
            labels.append(label)

    if not samples:
        raise SystemExit("No training samples were created. Check the input CSVs.")

    return np.array(samples, dtype=np.float32), np.array(labels, dtype=object), feature_columns


def normalize_data(x_train, x_val, x_test):
    mean = x_train.mean(axis=(0, 1), keepdims=True)
    std = x_train.std(axis=(0, 1), keepdims=True) + 1e-8
    return (
        (x_train - mean) / std,
        (x_val - mean) / std,
        (x_test - mean) / std,
        mean.squeeze(),
        std.squeeze(),
    )


def build_model(model_type: str, sequence_length: int, num_features: int, num_classes: int):
    layers = [tf.keras.layers.Input(shape=(sequence_length, num_features))]

    recurrent_layer = tf.keras.layers.GRU if model_type == "gru" else tf.keras.layers.LSTM
    layers.extend(
        [
            recurrent_layer(96, return_sequences=True, dropout=0.2),
            tf.keras.layers.BatchNormalization(),
            recurrent_layer(64, dropout=0.2),
            tf.keras.layers.Dropout(0.3),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.Dense(num_classes, activation="softmax"),
        ]
    )

    model = tf.keras.Sequential(layers, name=f"mediapipe_{model_type}_har")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def plot_history(history, output_path: Path):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    axes[0].plot(history.history["accuracy"], label="train")
    axes[0].plot(history.history["val_accuracy"], label="val")
    axes[0].set_title("Accuracy")
    axes[0].legend()
    axes[1].plot(history.history["loss"], label="train")
    axes[1].plot(history.history["val_loss"], label="val")
    axes[1].set_title("Loss")
    axes[1].legend()
    plt.tight_layout()
    fig.savefig(output_path)


def export_tfjs(model, output_dir: Path):
    try:
        import tensorflowjs as tfjs
    except ImportError:
        print("[warn] tensorflowjs is not installed; skipping TF.js export")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    tfjs.converters.save_keras_model(model, str(output_dir))


def main() -> None:
    parser = argparse.ArgumentParser(description="Train an LSTM/GRU on MediaPipe CSV sequences")
    parser.add_argument("--data-dir", required=True, help="Directory containing CSV files")
    parser.add_argument("--sequence-length", type=int, default=SEQ_LEN)
    parser.add_argument("--step", type=int, default=STEP)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--model-type", choices=["lstm", "gru"], default="lstm")
    parser.add_argument("--output-dir", default="./artifacts/mediapipe_activity_model")
    parser.add_argument("--export-tfjs", action="store_true")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    x, y_labels, feature_columns = load_sequences(data_dir, args.sequence_length, args.step)
    class_names = sorted(np.unique(y_labels).tolist())
    label_to_index = {label: index for index, label in enumerate(class_names)}
    y = np.array([label_to_index[label] for label in y_labels], dtype=np.int32)

    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.10,
        random_state=42,
        stratify=y,
    )
    x_train, x_val, y_train, y_val = train_test_split(
        x_train,
        y_train,
        test_size=0.12,
        random_state=42,
        stratify=y_train,
    )

    x_train, x_val, x_test, norm_mean, norm_std = normalize_data(x_train, x_val, x_test)

    class_weights = compute_class_weight(
        class_weight="balanced",
        classes=np.unique(y_train),
        y=y_train,
    )
    class_weight_map = {index: weight for index, weight in enumerate(class_weights)}

    model = build_model(args.model_type, args.sequence_length, x.shape[-1], len(class_names))
    model.summary()

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy",
            patience=8,
            restore_best_weights=True,
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=4,
            min_lr=1e-5,
        ),
    ]

    history = model.fit(
        x_train,
        y_train,
        validation_data=(x_val, y_val),
        epochs=args.epochs,
        batch_size=args.batch_size,
        class_weight=class_weight_map,
        callbacks=callbacks,
        verbose=1,
    )

    loss, accuracy = model.evaluate(x_test, y_test, verbose=0)
    print(f"Test accuracy: {accuracy:.4f}, loss: {loss:.4f}")

    keras_path = output_dir / f"mediapipe_{args.model_type}_har.keras"
    model.save(keras_path)

    plot_history(history, output_dir / "training_history.png")

    metadata = {
        "sequence_length": args.sequence_length,
        "feature_columns": feature_columns,
        "class_names": class_names,
        "label_to_index": label_to_index,
        "mean": norm_mean.tolist(),
        "std": norm_std.tolist(),
    }
    with open(output_dir / "norm_stats.json", "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)

    with open(output_dir / "label_map.json", "w", encoding="utf-8") as handle:
        json.dump(label_to_index, handle, indent=2)

    if args.export_tfjs:
        export_tfjs(model, output_dir / "tfjs")
        with open(output_dir / "tfjs" / "norm_stats.json", "w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2)
        with open(output_dir / "tfjs" / "label_map.json", "w", encoding="utf-8") as handle:
            json.dump(label_to_index, handle, indent=2)

    print(f"Artifacts saved in {output_dir}")


if __name__ == "__main__":
    main()