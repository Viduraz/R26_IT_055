"""
scratch/enroll_my_face.py
Interactive script to capture face from webcam and register/update caregiver face embedding in MongoDB.

Usage:
  python scratch/enroll_my_face.py --name "Your Name" --email "your_email@example.com"
"""
import sys, os, time, base64, argparse, importlib.util
from pathlib import Path
import cv2
import numpy as np
import torch

PROJECT_ROOT = Path(r"c:\Users\minid\R26_IT_055")
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "tracking-geofencing" / "backend"))

face_embedder_path = PROJECT_ROOT / "face-verification" / "backend" / "app" / "ml_services" / "inference" / "face_embedder.py"
spec = importlib.util.spec_from_file_location("face_embedder", str(face_embedder_path))
face_embedder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(face_embedder)

from shared.backend.config.database import get_db

def enroll_face(name: str, email: str, role: str = "caregiver"):
    print("=" * 60)
    print("ENROLL CAREGIVER FACE BIOMETRICS")
    print(f"Target User: {name} ({email}) | Role: {role}")
    print("=" * 60)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] Cannot access webcam 0.")
        return False

    print("\n[INFO] Look directly at the webcam...")
    print("[INFO] Collecting 5 high-quality face samples...")

    captured_embeddings = []
    attempts = 0
    max_attempts = 40

    while len(captured_embeddings) < 5 and attempts < max_attempts:
        attempts += 1
        ret, frame = cap.read()
        if not ret or frame is None:
            time.sleep(0.1)
            continue

        _, enc = cv2.imencode(".jpg", frame)
        b64 = base64.b64encode(enc.tobytes()).decode("utf-8")

        emb = face_embedder.get_embedding(b64)
        if emb is not None and len(emb) == 512:
            captured_embeddings.append(emb)
            print(f"  [✓] Sample {len(captured_embeddings)}/5 captured successfully!")
            time.sleep(0.4)
        else:
            time.sleep(0.2)

    cap.release()

    if len(captured_embeddings) < 3:
        print("\n[FAILED] Could not detect enough clear face samples. Please ensure good lighting and look directly into the camera.")
        return False

    print(f"\n[INFO] Aggregating {len(captured_embeddings)} face embeddings...")
    arr = np.array(captured_embeddings)
    mean_embedding = np.mean(arr, axis=0)
    norm = np.linalg.norm(mean_embedding)
    if norm > 0:
        mean_embedding = mean_embedding / norm

    embedding_list = mean_embedding.tolist()

    db = get_db()
    users_col = db["users"]

    # Upsert user record
    existing = users_col.find_one({"$or": [{"email": email}, {"name": name}]})
    if existing:
        users_col.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "name": name,
                    "email": email,
                    "role": role,
                    "face_embeddings": embedding_list,
                    "face_verification_status": "enrolled",
                    "face_verification_required": True,
                    "updated_at": time.strftime("%Y-%m-%d %H:%M:%S")
                }
            }
        )
        print(f"[SUCCESS] Updated existing caregiver '{name}' with new 512D face embedding!")
    else:
        new_doc = {
            "name": name,
            "email": email,
            "role": role,
            "face_embeddings": embedding_list,
            "face_verification_status": "enrolled",
            "face_verification_required": True,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        res = users_col.insert_one(new_doc)
        print(f"[SUCCESS] Registered new caregiver '{name}' with ID: {res.inserted_id}")

    print("\nEnrollment complete! You can now stand in front of the camera to verify.")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Enroll caregiver face")
    parser.add_argument("--name", type=str, default="devindu", help="Caregiver name")
    parser.add_argument("--email", type=str, default="testdevindu@gmail.com", help="Caregiver email")
    parser.add_argument("--role", type=str, default="caregiver", help="User role")
    args = parser.parse_args()

    enroll_face(args.name, args.email, args.role)
