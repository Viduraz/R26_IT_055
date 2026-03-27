"""
face-verification/backend/app/ml_services/inference/face_embedder.py
Handles face detection, alignment, and 512D embedding extraction using FaceNet.
"""
import base64
import io
import torch
import numpy as np
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1

# Device Configuration
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# 1. MTCNN for Face Detection and Alignment
# keep_all=False ensures we only grab the most prominent face per image
mtcnn = MTCNN(
    image_size=160, margin=0, min_face_size=20,
    thresholds=[0.6, 0.7, 0.7], factor=0.709, post_process=True,
    device=device, keep_all=False
)

# 2. InceptionResnetV1 for Embedding Extraction (FaceNet)
resnet = InceptionResnetV1(pretrained='vggface2').eval().to(device)


def decode_base64_image(base64_str: str) -> Image.Image:
    """Decodes a base64 string (optionally containing data URI prefix) to a PIL RGB Image."""
    if "," in base64_str:
        base64_str = base64_str.split(",")[1]
    image_bytes = base64.b64decode(base64_str)
    image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    return image


def get_embedding(base64_img: str) -> list[float] | None:
    """
    Detects face, aligns, and extracts a 512D embedding vector.
    Returns None if no face is detected.
    """
    try:
        img = decode_base64_image(base64_img)
        
        # Detect and align face
        # returns a 4D tensor (1, C, H, W) because keep_all=False
        face_tensor = mtcnn(img)
        
        if face_tensor is None:
            return None
        
        # Determine if MTCNN returned a 3D or 4D tensor
        if face_tensor.dim() == 3:
            face_tensor = face_tensor.unsqueeze(0)
            
        face_tensor = face_tensor.to(device)
        
        # Extract Embedding
        with torch.no_grad():
            embedding = resnet(face_tensor)
            
        # Return as a flattened Python 1D list (512 dimensions)
        return embedding.squeeze().cpu().numpy().tolist()
    except Exception as e:
        print(f"[FaceEmbedder] Error extracting embedding: {e}")
        return None


def calculate_similarity(embed1: list[float], embed2: list[float]) -> float:
    """Calculates cosine similarity between two embeddings. Returns [-1.0, 1.0]."""
    t1 = torch.tensor(embed1).unsqueeze(0)
    t2 = torch.tensor(embed2).unsqueeze(0)
    cos_sim = torch.nn.functional.cosine_similarity(t1, t2)
    return cos_sim.item()
