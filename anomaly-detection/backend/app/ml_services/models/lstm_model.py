"""
anomaly-detection/backend/app/ml_services/models/lstm_model.py
LSTM model loader for sequential pose anomaly classification.
"""
# import torch

_lstm = None
LSTM_WEIGHTS_PATH = "app/ml_services/trained_models/lstm_weights.pt"


def get_lstm():
    global _lstm
    if _lstm is None:
        # from app.ml_services.models.architectures import LSTMClassifier
        # _lstm = LSTMClassifier(input_size=33*4, hidden_size=128, num_layers=2, num_classes=2)
        # _lstm.load_state_dict(torch.load(LSTM_WEIGHTS_PATH, map_location="cpu"))
        # _lstm.eval()
        pass  # TODO: define LSTMClassifier architecture and load weights
    return _lstm
