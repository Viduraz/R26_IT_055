"""
scratch/live_camera_verify.py
Live interactive test: Opens webcam, runs YOLOv8 tracking + FaceNet verification in real time.
Press 'q' in the video window to stop.
"""
import sys, os, time, base64, io, importlib.util
from pathlib import Path
import cv2
import numpy as np
import torch
from PIL import Image

PROJECT_ROOT = Path(r"c:\Users\minid\R26_IT_055")
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "tracking-geofencing" / "backend"))

# Load FaceNet & MTCNN
face_embedder_path = PROJECT_ROOT / "face-verification" / "backend" / "app" / "ml_services" / "inference" / "face_embedder.py"
spec = importlib.util.spec_from_file_location("face_embedder", str(face_embedder_path))
face_embedder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(face_embedder)

from shared.backend.config.database import get_db
from app.ml_services.yolo_tracker import PersonTrackerEngine

def run_live():
    print("\n" + "="*60)
    print("LIVE CAREGIVER DETECTION & VERIFICATION MONITOR")
    print("="*60)
    
    db = get_db()
    enrolled_users = list(db["users"].find({"face_embeddings": {"$exists": True, "$ne": None}}))
    print(f"[DB] Loaded {len(enrolled_users)} enrolled caregiver profile(s):")
    for u in enrolled_users:
        print(f"     -> {u.get('name')} ({u.get('role', 'caregiver')}) - ID: {u.get('_id')}")

    tracker = PersonTrackerEngine()
    tracker._ensure_models()

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] Could not open webcam 0.")
        return

    print("\n[INFO] Webcam connected! Starting live stream.")
    print("[INFO] Stand in front of the camera to verify.")
    print("[INFO] Press 'q' on the OpenCV window or Ctrl+C in terminal to exit.\n")

    frame_count = 0
    verified_identity = None

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                break
            
            frame_count += 1
            t0 = time.perf_counter()

            # 1. Human Tracking
            _, enc = cv2.imencode(".jpg", frame)
            tracks = tracker.process_frame(enc.tobytes(), tracker_type="bytetrack")
            latency_ms = (time.perf_counter() - t0) * 1000

            # 2. Face Verification every 5 frames
            if frame_count % 5 == 1 and len(tracks) > 0:
                b64_str = base64.b64encode(enc.tobytes()).decode("utf-8")
                live_emb = face_embedder.get_embedding(b64_str)
                if live_emb is not None:
                    best_sim = -1.0
                    best_user = None
                    for u in enrolled_users:
                        stored_emb = u.get("face_embeddings")
                        if stored_emb and len(stored_emb) == 512:
                            sim = face_embedder.calculate_similarity(live_emb, stored_emb)
                            if sim > best_sim:
                                best_sim = sim
                                best_user = u

                    if best_user and best_sim >= 0.58:
                        verified_identity = {
                            "name": best_user.get("name"),
                            "role": best_user.get("role", "caregiver"),
                            "similarity": round(best_sim, 4),
                            "confidence": round(((best_sim + 1.0) / 2.0) * 100, 1),
                        }
                    else:
                        verified_identity = None

            # Terminal log
            if len(tracks) > 0:
                p = tracks[0]
                status_str = f"AUTHORIZED: {verified_identity['name']} (Sim: {verified_identity['similarity']})" if verified_identity else "UNVERIFIED / UNKNOWN"
                print(f"[Frame {frame_count:04d}] Person ID={p['person_id']} | Conf={p['confidence']} | {status_str} | Latency: {latency_ms:.1f}ms")
            else:
                if frame_count % 15 == 0:
                    print(f"[Frame {frame_count:04d}] No person in view (empty camera feed).")

            time.sleep(0.03)

    except KeyboardInterrupt:
        print("\nStopping live monitor...")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("Live monitor stopped.")

if __name__ == "__main__":
    run_live()
