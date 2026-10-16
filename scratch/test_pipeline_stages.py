"""
scratch/test_pipeline_stages.py
Systematic stage-by-stage testing of the caregiver detection and identity verification flow.
"""
import sys, os, time, base64, io
from pathlib import Path
import cv2
import numpy as np
import torch
from PIL import Image

# Ensure project root is in sys.path
PROJECT_ROOT = Path(r"c:\Users\minid\R26_IT_055")
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "tracking-geofencing" / "backend"))
sys.path.insert(0, str(PROJECT_ROOT / "face-verification" / "backend"))

from shared.backend.config.database import get_db

print("=" * 60)
print("TEST 1: HUMAN DETECTION (YOLOv8)")
print("=" * 60)

# 1. Check Camera resolution and frame grabbing
cap = cv2.VideoCapture(0)
has_webcam = cap.isOpened()
if not has_webcam:
    print("Webcam 0 could not be opened. Falling back to test video.")
    cap = cv2.VideoCapture(str(PROJECT_ROOT / "scratch" / "vtest.avi"))

ret, live_frame = cap.read()
if not ret or live_frame is None:
    print("[ERROR] Could not read any frame from camera or test source!")
    cap.release()
    sys.exit(1)

cam_h, cam_w = live_frame.shape[:2]
print(f"Camera frame grabbed successfully: {cam_w}x{cam_h}")

# Save snapshot to scratch for verification
snapshot_path = str(PROJECT_ROOT / "scratch" / "live_snapshot.jpg")
cv2.imwrite(snapshot_path, live_frame)
print(f"Snapshot saved to: {snapshot_path}")

# Load YOLO model
from app.ml_services.yolo_tracker import PersonTrackerEngine, DEVICE

tracker_engine = PersonTrackerEngine()
model_loaded = tracker_engine._ensure_models()

print(f"YOLO Model Path: {tracker_engine._get_model('bytetrack').ckpt_path}")
print(f"Model Loaded: {model_loaded}")
print(f"Compute Device: {tracker_engine.device}")
print(f"Inference Image Size: {tracker_engine.imgsz}")
print(f"Confidence Threshold: {tracker_engine.conf_threshold}")
print(f"IoU Threshold: {tracker_engine.iou_threshold}")
print(f"Target Classes: [0] (Person only)")

# Run YOLO inference on live frame
t_start = time.perf_counter()
model = tracker_engine._get_model("bytetrack")
results = model.track(
    live_frame,
    persist=True,
    tracker="bytetrack.yaml",
    classes=[0],
    conf=tracker_engine.conf_threshold,
    iou=0.5,
    imgsz=tracker_engine.imgsz,
    device=tracker_engine.device,
    verbose=False,
)
inference_latency_ms = (time.perf_counter() - t_start) * 1000
fps = 1000.0 / inference_latency_ms if inference_latency_ms > 0 else 0

yolo_detections = []
timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
for r in results:
    if hasattr(r, "boxes") and r.boxes is not None:
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            cls_name = r.names.get(cls_id, "unknown")
            track_id = int(box.id[0].item()) if (hasattr(box, "id") and box.id is not None) else None
            yolo_detections.append({
                "timestamp": timestamp_str,
                "bbox": {"x": int(x1), "y": int(y1), "w": int(x2 - x1), "h": int(y2 - y1)},
                "class_name": cls_name,
                "confidence": round(conf, 4),
                "track_id": track_id,
                "fps": round(fps, 1),
                "latency_ms": round(inference_latency_ms, 2),
            })

print(f"YOLO Human Detections count: {len(yolo_detections)}")
for det in yolo_detections:
    print(f"  Timestamp:    {det['timestamp']}")
    print(f"  Class:        {det['class_name']}")
    print(f"  Bounding Box: {det['bbox']}")
    print(f"  Confidence:   {det['confidence']}")
    print(f"  Tracking ID:  {det['track_id']}")
    print(f"  FPS:          {det['fps']}")
    print(f"  Latency:      {det['latency_ms']} ms")

human_detection_pass = len(yolo_detections) > 0
print(f"\nTEST 1 RESULT: {'PASS' if human_detection_pass else 'FAIL (No person detected)'}")


print("\n" + "=" * 60)
print("TEST 2: TRACKING STABILITY (ByteTrack)")
print("=" * 60)

# Stream 10 frames through tracker_engine.update
tracked_history = []
for f_idx in range(10):
    ret, frame = cap.read()
    if not ret:
        break
    tracked_persons = tracker_engine.update(frame, tracker_type="bytetrack")
    p_ids = [p["person_id"] for p in tracked_persons]
    confs = [p["confidence"] for p in tracked_persons]
    tracked_history.append((f_idx, p_ids, confs))
    time.sleep(0.05)

cap.release()

print("Tracking sequence across 10 frames:")
all_ids = set()
for f_idx, p_ids, confs in tracked_history:
    print(f"  Frame {f_idx:02d}: IDs = {p_ids}, Confs = {confs}")
    for pid in p_ids:
        all_ids.add(pid)

tracking_pass = len(all_ids) > 0 and len(all_ids) <= 2  # Stable ID(s)
print(f"Unique Tracking IDs observed: {all_ids}")
print(f"TEST 2 RESULT: {'PASS' if tracking_pass else ('FAIL' if len(all_ids) == 0 else 'WARNING (ID switches)')}")


print("\n" + "=" * 60)
print("TEST 3: FACE DETECTION (MTCNN)")
print("=" * 60)

from facenet_pytorch import MTCNN, InceptionResnetV1

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
mtcnn = MTCNN(
    image_size=160, margin=0, min_face_size=20,
    thresholds=[0.6, 0.7, 0.7], factor=0.709, post_process=True,
    device=device, keep_all=False
)
mtcnn_multi = MTCNN(
    image_size=160, margin=0, min_face_size=20,
    thresholds=[0.6, 0.7, 0.7], factor=0.709, post_process=True,
    device=device, keep_all=True
)

# Convert live_frame (BGR) to RGB PIL image
live_rgb = cv2.cvtColor(live_frame, cv2.COLOR_BGR2RGB)
pil_img = Image.fromarray(live_rgb)

# 1. Test MTCNN on full frame
boxes, probs = mtcnn.detect(pil_img)
print(f"Full Frame MTCNN detection: boxes={boxes}, probs={probs}")

face_detected = boxes is not None and len(boxes) > 0
if face_detected:
    for i, (b, p) in enumerate(zip(boxes, probs)):
        print(f"  Face #{i+1}: bbox=[x1={int(b[0])}, y1={int(b[1])}, x2={int(b[2])}, y2={int(b[3])}], "
              f"size={int(b[2]-b[0])}x{int(b[3]-b[1])}, prob={p:.3f}")
else:
    print("  No face detected in full frame by MTCNN.")

# 2. If person was detected by YOLO, also test MTCNN on cropped person bounding box
if human_detection_pass and yolo_detections:
    bx = yolo_detections[0]["bbox"]
    x1, y1 = max(0, bx["x"]), max(0, bx["y"])
    x2, y2 = min(cam_w, bx["x"] + bx["w"]), min(cam_h, bx["y"] + bx["h"])
    person_crop = live_rgb[y1:y2, x1:x2]
    if person_crop.size > 0:
        crop_pil = Image.fromarray(person_crop)
        crop_boxes, crop_probs = mtcnn.detect(crop_pil)
        print(f"Person Crop MTCNN detection: boxes={crop_boxes}, probs={crop_probs}")
        if crop_boxes is not None and len(crop_boxes) > 0:
            face_detected = True

print(f"TEST 3 RESULT: {'PASS' if face_detected else 'FAIL (No face detected by MTCNN)'}")


print("\n" + "=" * 60)
print("TEST 4: FACE EMBEDDING & VERIFICATION")
print("=" * 60)

# Check database for registered caregiver
db = get_db()
enrolled_users = list(db["users"].find({"face_embeddings": {"$exists": True, "$ne": None}}))
print(f"Enrolled users found in DB: {len(enrolled_users)}")

devindu_user = None
for u in enrolled_users:
    emb = u.get("face_embeddings")
    is_list = isinstance(emb, list)
    emb_dim = len(emb) if is_list else 0
    print(f"  User: {u.get('name')} | Role: {u.get('role')} | Email: {u.get('email')}")
    print(f"  Embedding exists: {emb is not None} | Dim: {emb_dim} | Valid: {emb_dim == 512}")
    if u.get("name") == "devindu" or u.get("role") == "caregiver":
        devindu_user = u

registered_embedding_pass = devindu_user is not None and len(devindu_user.get("face_embeddings", [])) == 512
print(f"Registered Embedding Check: {'PASS' if registered_embedding_pass else 'FAIL'}")

# Now test live embedding extraction and similarity
from app.ml_services.inference.face_embedder import get_embedding, get_all_embeddings, calculate_similarity

# Encode live frame as base64 JPEG
_, buf = cv2.imencode(".jpg", live_frame)
live_b64 = base64.b64encode(buf).decode("utf-8")

live_emb = get_embedding(live_b64)
face_verification_pass = False
similarity_score = 0.0

if live_emb is not None:
    print(f"Live embedding extracted: length = {len(live_emb)}")
    if registered_embedding_pass:
        stored_emb = devindu_user["face_embeddings"]
        similarity_score = calculate_similarity(live_emb, stored_emb)
        print(f"Cosine Similarity with registered caregiver ({devindu_user.get('name')}): {similarity_score:.4f}")
        print(f"Threshold required: 0.58")
        if similarity_score >= 0.58:
            face_verification_pass = True
            print("Similarity >= 0.58 -> Caregiver MATCH!")
        else:
            print(f"Similarity {similarity_score:.4f} < 0.58 -> UNKNOWN / MISMATCH")
else:
    print("Could not extract live embedding (no face detected or MTCNN failed).")

print(f"TEST 4 RESULT: {'PASS' if face_verification_pass else 'FAIL'}")


print("\n" + "=" * 60)
print("TEST 5: END-TO-END PIPELINE RESULT")
print("=" * 60)
print(f"Human Detection:          {'PASS' if human_detection_pass else 'FAIL'}")
print(f"Tracking:                 {'PASS' if tracking_pass else 'FAIL'}")
print(f"Face Detection:           {'PASS' if face_detected else 'FAIL'}")
print(f"Registered Embedding:     {'PASS' if registered_embedding_pass else 'FAIL'}")
print(f"Face Verification:        {'PASS' if face_verification_pass else 'FAIL'}")
if face_verification_pass:
    print(f"Caregiver Identity:       {devindu_user.get('name')}")
    print(f"Authorization:            PASS")
else:
    print(f"Caregiver Identity:       UNKNOWN")
    print(f"Authorization:            FAIL")
    if not human_detection_pass:
        print("Reason: No human detected by YOLO")
    elif not face_detected:
        print("Reason: No face detected by MTCNN")
    elif not registered_embedding_pass:
        print("Reason: Registered caregiver embedding missing or corrupted in DB")
    else:
        print(f"Reason: Similarity {similarity_score:.4f} below threshold 0.58 (Face does not match registered caregiver 'devindu')")
print("=" * 60)
