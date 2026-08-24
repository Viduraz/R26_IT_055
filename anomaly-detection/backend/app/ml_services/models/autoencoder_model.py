"""
anomaly-detection/backend/app/ml_services/models/autoencoder_model.py

PyTorch Pose Sequence Autoencoder.
Trained on NORMAL pose sequences only.
High reconstruction error → abnormal behavior detected.

Architecture is fully defined. Weights load automatically if file exists.
Falls back gracefully if no weights are present.
"""
import os
import numpy as np

AE_WEIGHTS_PATH = os.path.join(
    os.path.dirname(__file__), "..", "trained_models", "ae_weights.pt"
)

_ae = None
_ae_loaded = False
INPUT_DIM   = 48    # must match feature_engineer output size
SEQ_LEN     = 30    # must match SEQUENCE_WINDOW


def _build_model():
    import torch.nn as nn

    class PoseAutoencoder(nn.Module):
        def __init__(self, input_size=INPUT_DIM * SEQ_LEN, bottleneck=64):
            super().__init__()
            flat = input_size
            self.encoder = nn.Sequential(
                nn.Linear(flat, 256),
                nn.ReLU(),
                nn.Linear(256, 128),
                nn.ReLU(),
                nn.Linear(128, bottleneck),
            )
            self.decoder = nn.Sequential(
                nn.Linear(bottleneck, 128),
                nn.ReLU(),
                nn.Linear(128, 256),
                nn.ReLU(),
                nn.Linear(256, flat),
            )

        def forward(self, x):
            # x: (batch, seq_len * input_size) — flattened sequence
            z = self.encoder(x)
            return self.decoder(z)

    return PoseAutoencoder()


def get_autoencoder():
    global _ae, _ae_loaded
    if _ae_loaded:
        return _ae

    _ae_loaded = True
    if not os.path.exists(AE_WEIGHTS_PATH):
        _ae = None
        return None

    try:
        import torch
        model = _build_model()
        model.load_state_dict(torch.load(AE_WEIGHTS_PATH, map_location="cpu"))
        model.eval()
        _ae = model
        print("[INFO] Autoencoder weights loaded from", AE_WEIGHTS_PATH)
    except Exception as e:
        print(f"[WARN] Could not load Autoencoder weights: {e}")
        _ae = None

    return _ae


def reconstruction_error(sequence: list) -> float | None:
    """
    Args:
        sequence: list of np.ndarray feature vectors, each shape (48,)
    Returns:
        Mean squared reconstruction error (float), or None if model unavailable.
        High error → anomaly.
    """
    model = get_autoencoder()
    if model is None or len(sequence) < SEQ_LEN:
        return None

    try:
        import torch
        arr = np.stack(sequence[-SEQ_LEN:], axis=0)          # (30, 48)
        x   = torch.tensor(arr.flatten(), dtype=torch.float32).unsqueeze(0)  # (1, 1440)
        with torch.no_grad():
            recon = model(x)
        mse = float(((recon - x) ** 2).mean().item())
        return round(mse, 6)
    except Exception as e:
        print(f"[ERROR] Autoencoder reconstruction_error: {e}")
        return None
