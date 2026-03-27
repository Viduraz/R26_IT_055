"""
face-verification/backend/app/ml_services/models/mtcnn_model.py
MTCNN face detector model loader.
"""
# TODO: Install facenet-pytorch: pip install facenet-pytorch
# from facenet_pytorch import MTCNN as _MTCNN
# import torch

_mtcnn = None


def get_mtcnn():
    """Return a singleton MTCNN detector."""
    global _mtcnn
    if _mtcnn is None:
        # _mtcnn = _MTCNN(keep_all=True, device=torch.device("cuda" if torch.cuda.is_available() else "cpu"))
        pass  # TODO: initialise MTCNN
    return _mtcnn
