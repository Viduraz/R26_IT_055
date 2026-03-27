"""
anomaly-detection/backend/app/ml_services/models/autoencoder_model.py
Autoencoder model loader for pose reconstruction error-based anomaly detection.
"""
# import torch

_autoencoder = None
AE_WEIGHTS_PATH = "app/ml_services/trained_models/ae_weights.pt"


def get_autoencoder():
    global _autoencoder
    if _autoencoder is None:
        # from app.ml_services.models.architectures import PoseAutoencoder
        # _autoencoder = PoseAutoencoder(input_size=33*4)
        # _autoencoder.load_state_dict(torch.load(AE_WEIGHTS_PATH, map_location="cpu"))
        # _autoencoder.eval()
        pass  # TODO: define PoseAutoencoder architecture and load weights
    return _autoencoder
