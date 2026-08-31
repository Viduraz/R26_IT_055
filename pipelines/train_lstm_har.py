"""
SecureElderCare — LSTM-HAR Training Script
==========================================
Trains a 2-layer LSTM on pose-feature sequences extracted from
Kinetics-700 / UCF101 / HMDB51 by extract_pose_sequences.py.

Exports:
  public/lstm_har_model/model.json         ← TF.js LayersModel
  public/lstm_har_model/norm_stats.json    ← mean & std for normalisation
  pipelines/models/lstm_har.keras          ← Keras checkpoint

Usage
-----
  pip install tensorflow tensorflowjs scikit-learn matplotlib
  python3 train_lstm_har.py

  # Optional — use only some datasets:
  python3 train_lstm_har.py --data data/hmdb51      (fastest start)
  python3 train_lstm_har.py --data data/kinetics700 data/ucf101 data/hmdb51

Activity Classes (must match activityDetection.js)
---------------------------------------------------
  0  Sleep          4  Walking
  1  Eating         5  Sitting / rest
  2  Drinking       6  Standing up
  3  Talking        7  Movement
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")           # headless — no display needed
import matplotlib.pyplot as plt

# ── Argument parsing ──────────────────────────────────────────────────────────
def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument(
        "--data", nargs="+",
        default=["data/kinetics700", "data/ucf101", "data/hmdb51"],
        help="One or more dataset prefixes (without _X.npy / _y.npy suffix)"
    )
    p.add_argument("--epochs",    type=int,   default=100)
    p.add_argument("--batch",     type=int,   default=32)
    p.add_argument("--lr",        type=float, default=0.001)
    p.add_argument("--out_dir",   default="../schedule-monitoring/frontend/public/lstm_har_model",
                   help="Where to save the TF.js model")
    p.add_argument("--model_dir", default="models",
                   help="Where to save the Keras checkpoint")
    return p.parse_args()


ACTIVITY_NAMES = [
    "Sleep", "Eating", "Drinking", "Talking",
    "Walking", "Sitting / rest", "Standing up", "Movement"
]
NUM_CLASSES  = len(ACTIVITY_NAMES)
SEQ_LEN      = 30   # frames per window
NUM_FEATURES = 14   # biomechanical features


# ── Data loading ──────────────────────────────────────────────────────────────
def load_datasets(prefixes):
    Xs, ys = [], []
    for prefix in prefixes:
        x_path = Path(str(prefix) + "_X.npy")
        y_path = Path(str(prefix) + "_y.npy")
        if not x_path.exists():
            print(f"  [warn] {x_path} not found — skipping")
            continue
        X = np.load(x_path).astype(np.float32)
        y = np.load(y_path).astype(np.int32)
        print(f"  Loaded {x_path.name}: {X.shape[0]} sequences")
        Xs.append(X)
        ys.append(y)

    if not Xs:
        sys.exit("No data found. Run extract_pose_sequences.py first.")

    X_all = np.concatenate(Xs, axis=0)   # (N, 30, 14)
    y_all = np.concatenate(ys, axis=0)   # (N,)
    return X_all, y_all


# ── Normalisation ─────────────────────────────────────────────────────────────
def normalise(X_train, X_val, X_test):
    """Per-feature z-score normalisation (fit on train only)."""
    mean = X_train.mean(axis=(0, 1), keepdims=True)   # (1, 1, 14)
    std  = X_train.std(axis=(0, 1),  keepdims=True) + 1e-8
    return (
        (X_train - mean) / std,
        (X_val   - mean) / std,
        (X_test  - mean) / std,
        mean.squeeze(),   # (14,)
        std.squeeze()     # (14,)
    )


# ── Model ─────────────────────────────────────────────────────────────────────
def build_model():
    import tensorflow as tf

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(SEQ_LEN, NUM_FEATURES)),

        # Layer 1 — return sequences for second LSTM
        tf.keras.layers.LSTM(
            128,
            return_sequences=True,
            dropout=0.2,
            recurrent_dropout=0.1,
            name="lstm_1"
        ),
        tf.keras.layers.BatchNormalization(),

        # Layer 2 — temporal compression
        tf.keras.layers.LSTM(
            64,
            dropout=0.2,
            name="lstm_2"
        ),
        tf.keras.layers.BatchNormalization(),

        # Dense head
        tf.keras.layers.Dense(64, activation="relu", name="dense_1"),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(NUM_CLASSES, activation="softmax", name="output")
    ], name="lstm_har")

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    model.summary()
    return model


# ── Training ──────────────────────────────────────────────────────────────────
def train(model, X_train, y_train, X_val, y_val,
          epochs, batch_size, class_weight_dict):
    import tensorflow as tf

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy",
            patience=12,
            restore_best_weights=True,
            verbose=1
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=6,
            min_lr=1e-5,
            verbose=1
        ),
        tf.keras.callbacks.ModelCheckpoint(
            "models/best_lstm_har.keras",
            monitor="val_accuracy",
            save_best_only=True,
            verbose=0
        )
    ]

    history = model.fit(
        X_train, y_train,
        epochs=epochs,
        batch_size=batch_size,
        validation_data=(X_val, y_val),
        class_weight=class_weight_dict,
        callbacks=callbacks,
        verbose=1
    )
    return history


# ── Evaluation helpers ────────────────────────────────────────────────────────
def evaluate(model, X_test, y_test):
    import tensorflow as tf

    loss, acc = model.evaluate(X_test, y_test, verbose=0)
    print(f"\nTest accuracy: {acc:.1%}   loss: {loss:.4f}")

    probs = model.predict(X_test, verbose=0)
    preds = np.argmax(probs, axis=1)

    print("\nPer-class accuracy:")
    for cls in range(NUM_CLASSES):
        mask = y_test == cls
        if mask.sum() == 0:
            print(f"  {ACTIVITY_NAMES[cls]:15s}  — (no test samples)")
            continue
        cls_acc = (preds[mask] == cls).mean()
        print(f"  {ACTIVITY_NAMES[cls]:15s}  {cls_acc:.1%}  ({mask.sum()} samples)")

    return acc, preds


def plot_history(history, out_path="models/training_history.png"):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    axes[0].plot(history.history["accuracy"],     label="train")
    axes[0].plot(history.history["val_accuracy"], label="val")
    axes[0].set_title("Accuracy"); axes[0].legend()
    axes[1].plot(history.history["loss"],     label="train")
    axes[1].plot(history.history["val_loss"], label="val")
    axes[1].set_title("Loss"); axes[1].legend()
    plt.tight_layout()
    plt.savefig(out_path)
    print(f"Training history saved → {out_path}")


# ── Export to TF.js ───────────────────────────────────────────────────────────
def export_tfjs(model, out_dir, norm_mean, norm_std):
    try:
        import tensorflowjs as tfjs
    except ImportError:
        sys.exit("Install: pip install tensorflowjs")

    os.makedirs(out_dir, exist_ok=True)
    tfjs.converters.save_keras_model(model, out_dir)
    print(f"TF.js model saved → {out_dir}/")

    # Save normalisation stats as JSON (loaded in browser)
    norm_stats = {
        "mean": norm_mean.tolist(),
        "std":  norm_std.tolist(),
        "activity_names": ACTIVITY_NAMES,
        "seq_len":      SEQ_LEN,
        "num_features": NUM_FEATURES
    }
    stats_path = os.path.join(out_dir, "norm_stats.json")
    with open(stats_path, "w") as f:
        json.dump(norm_stats, f, indent=2)
    print(f"Normalisation stats → {stats_path}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()

    try:
        import tensorflow as tf
        from sklearn.model_selection import train_test_split
        from sklearn.utils.class_weight import compute_class_weight
        print(f"TensorFlow {tf.__version__}")
    except ImportError as e:
        sys.exit(f"Missing dependency: {e}\n"
                 "Run: pip install tensorflow scikit-learn")

    # 1. Load data
    print("\n── Loading datasets ────────────────────────────────────────────")
    X, y = load_datasets(args.data)
    print(f"\nTotal: {X.shape[0]} sequences, {X.shape[1]} frames, {X.shape[2]} features")
    print("Class distribution:")
    for i, count in enumerate(np.bincount(y, minlength=NUM_CLASSES)):
        print(f"  {i}  {ACTIVITY_NAMES[i]:15s}  {count} clips")

    # 2. Split — stratified
    X_tmp,  X_test,  y_tmp,  y_test  = train_test_split(
        X, y, test_size=0.10, stratify=y, random_state=42)
    X_train, X_val, y_train, y_val   = train_test_split(
        X_tmp, y_tmp, test_size=0.11, stratify=y_tmp, random_state=42)
    # Final split ≈  80% / 10% / 10%
    print(f"\nSplit → train: {len(X_train)}, val: {len(X_val)}, test: {len(X_test)}")

    # 3. Normalise
    X_train, X_val, X_test, norm_mean, norm_std = normalise(X_train, X_val, X_test)

    # 4. Class weights (handle imbalanced Sleep / Drinking / Talking)
    weights = compute_class_weight(
        "balanced", classes=np.unique(y_train), y=y_train)
    class_weight_dict = dict(enumerate(weights))
    print("\nClass weights:")
    for i, w in class_weight_dict.items():
        print(f"  {ACTIVITY_NAMES[i]:15s}  {w:.3f}")

    # 5. Build & train
    print("\n── Building model ──────────────────────────────────────────────")
    os.makedirs(args.model_dir, exist_ok=True)
    model = build_model()

    print("\n── Training ────────────────────────────────────────────────────")
    history = train(
        model, X_train, y_train, X_val, y_val,
        epochs=args.epochs,
        batch_size=args.batch,
        class_weight_dict=class_weight_dict
    )

    # 6. Evaluate
    print("\n── Evaluation ──────────────────────────────────────────────────")
    evaluate(model, X_test, y_test)
    plot_history(history, out_path=os.path.join(args.model_dir, "training_history.png"))

    # 7. Save Keras checkpoint
    keras_path = os.path.join(args.model_dir, "lstm_har.keras")
    model.save(keras_path)
    print(f"Keras model saved → {keras_path}")

    # 8. Export TF.js (for browser)
    print("\n── Exporting to TF.js ──────────────────────────────────────────")
    export_tfjs(model, args.out_dir, norm_mean, norm_std)

    print("\n✅ Done! Model ready for browser inference.")
    print(f"   Copy {args.out_dir}/ into your Vite public/ folder if not already there.")


if __name__ == "__main__":
    main()
