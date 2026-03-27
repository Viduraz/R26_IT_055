"""
face-verification/backend/app/ml_services/utils/model_loader.py
Central model warming utility.
"""
from app.ml_services.models.mtcnn_model import get_mtcnn
from app.ml_services.models.facenet_model import get_facenet


def warm_models():
    """Call at app startup to pre-load models into memory."""
    get_mtcnn()
    get_facenet()
