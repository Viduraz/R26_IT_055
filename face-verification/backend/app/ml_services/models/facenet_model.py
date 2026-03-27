"""
face-verification/backend/app/ml_services/models/facenet_model.py
FaceNet embedding model loader.
"""
# TODO: Install facenet-pytorch: pip install facenet-pytorch
# from facenet_pytorch import InceptionResnetV1
# import torch

_facenet = None


def get_facenet():
    """Return a singleton FaceNet model for embedding extraction."""
    global _facenet
    if _facenet is None:
        # _facenet = InceptionResnetV1(pretrained="vggface2").eval()
        pass  # TODO: initialise FaceNet
    return _facenet
