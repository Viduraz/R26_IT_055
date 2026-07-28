"""
anomaly-detection/backend/app/ml_services/models/lstm_model.py

PyTorch LSTM Classifier for pose-based anomaly classification.
Architecture is fully defined. Weights load automatically if file exists.
Falls back gracefully if no weights are present.

Classes:
    0 = normal_activity
    1 = fall_detected
    2 = aggression_detected
    3 = prolonged_inactivity
"""
import os
import numpy as np

LSTM_WEIGHTS_PATH = os.path.join(
    os.path.dirname(__file__), "..", "trained_models", "lstm_weights.pt"
)
CLASS_NAMES = ["normal_activity", "fall_detected", "aggression_detected", "prolonged_inactivity"]

_lstm = None
_lstm_loaded = False


def _build_model():
    import torch
    import torch.nn as nn

    class Attention(nn.Module):
        def __init__(self, hidden_size):
            super().__init__()
            self.attention = nn.Linear(hidden_size, 1)

        def forward(self, x):
            # x: (batch, seq_len, hidden_size)
            scores = self.attention(x)
            weights = torch.softmax(scores, dim=1)
            context = torch.sum(weights * x, dim=1)
            return context

    class LSTMClassifier(nn.Module):
        def __init__(self, input_size=48, hidden_size=128, num_layers=2, num_classes=4, dropout=0.3):
            super().__init__()
            self.lstm = nn.LSTM(
                input_size=input_size,
                hidden_size=hidden_size,
                num_layers=num_layers,
                batch_first=True,
                bidirectional=True,
                dropout=dropout if num_layers > 1 else 0,
            )
            self.attention = Attention(hidden_size * 2)
            self.dropout = nn.Dropout(dropout)
            self.fc1   = nn.Linear(hidden_size * 2, 64)
            self.relu  = nn.ReLU()
            self.fc2   = nn.Linear(64, num_classes)

        def forward(self, x):
            # x: (batch, seq_len, input_size)
            out, _ = self.lstm(x)
            out    = self.attention(out)
            out    = self.dropout(out)
            out    = self.relu(self.fc1(out))
            return self.fc2(out)                    # logits

    return LSTMClassifier()


def get_lstm():
    global _lstm, _lstm_loaded
    if _lstm_loaded:
        return _lstm

    _lstm_loaded = True
    if not os.path.exists(LSTM_WEIGHTS_PATH):
        _lstm = None   # weights not yet trained
        return None

    try:
        import torch
        model = _build_model()
        model.load_state_dict(torch.load(LSTM_WEIGHTS_PATH, map_location="cpu"))
        model.eval()
        _lstm = model
        print("[INFO] LSTM weights loaded from", LSTM_WEIGHTS_PATH)
    except Exception as e:
        print(f"[WARN] Could not load LSTM weights: {e}")
        _lstm = None

    return _lstm


def predict(sequence: list) -> dict | None:
    """
    Args:
        sequence: list of N np.ndarray feature vectors (each shape 40,)
    Returns:
        { "class": str, "prob": float, "probs": list[float] }
        or None if model not available
    """
    model = get_lstm()
    if model is None or len(sequence) < 2:
        return None

    try:
        import torch
        arr = np.stack(sequence, axis=0)           # (T, 48)
        x   = torch.tensor(arr, dtype=torch.float32).unsqueeze(0)  # (1, T, 48)
        with torch.no_grad():
            logits = model(x)
            probs  = torch.softmax(logits, dim=-1).squeeze(0).tolist()
        best_cls = int(np.argmax(probs))
        return {
            "class": CLASS_NAMES[best_cls],
            "prob":  round(probs[best_cls], 4),
            "probs": [round(p, 4) for p in probs],
        }
    except Exception as e:
        print(f"[ERROR] LSTM predict: {e}")
        return None
