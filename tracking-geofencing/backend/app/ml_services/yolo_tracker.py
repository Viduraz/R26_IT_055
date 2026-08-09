"""
Persistent person tracking engine with IoU-based matching.
Maintains stable person IDs across frames.
Uses real YOLOv8 inference only — no mock/fallback detections.
"""

import os, time, math, traceback
from pathlib import Path
from typing import Dict, List, Optional
from dotenv import load_dotenv

load_dotenv("../../.env")
load_dotenv(".env")

# ── Resolve model path once at module level ─────────────────────
_MODEL_PATH = None
for candidate in [
    Path(__file__).resolve().parents[2] / "yolov8n.pt",   # backend/yolov8n.pt
    Path.cwd() / "yolov8n.pt",
    Path("yolov8n.pt"),
]:
    if candidate.exists():
        _MODEL_PATH = str(candidate)
        break

if _MODEL_PATH:
    print(f"[YOLO] Model found: {_MODEL_PATH}")
else:
    print("[YOLO] ⚠ yolov8n.pt not found — will download on first inference")


class TrackedPerson:
    def __init__(self, person_id: str, bbox: dict, confidence: float):
        self.person_id = person_id
        self.bbox = bbox
        self.confidence = confidence
        self.first_seen = time.time()
        self.last_seen = time.time()
        self.frame_count = 1
        self.trajectory = [self._centroid(bbox)]
        self.zone_status = "unknown"

    def _centroid(self, bbox):
        return (bbox["x"] + bbox["w"] / 2, bbox["y"] + bbox["h"] / 2)

    def update(self, bbox: dict, confidence: float):
        self.bbox = bbox
        self.confidence = confidence
        self.last_seen = time.time()
        self.frame_count += 1
        self.trajectory.append(self._centroid(bbox))
        if len(self.trajectory) > 50:
            self.trajectory.pop(0)

    def is_stale(self, timeout_seconds=3.0) -> bool:
        return (time.time() - self.last_seen) > timeout_seconds

    def to_dict(self):
        return {
            "person_id": self.person_id,
            "bbox": self.bbox,
            "confidence": self.confidence,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "frame_count": self.frame_count,
            "trajectory": self.trajectory[-10:],
            "zone_status": self.zone_status,
            "duration_seconds": round(time.time() - self.first_seen, 1),
        }


class PersonTrackerEngine:
    """
    Singleton tracker that remembers persons across frames.
    Uses IoU (Intersection over Union) matching to assign consistent IDs.
    Strictly uses real YOLOv8 — no mock detections.
    """

    ACTIVE_TIMEOUT = 1.5   # seconds — person must be seen within this window to be "active"
    STALE_TIMEOUT = 3.0    # seconds — remove from tracker entirely after this

    def __init__(self):
        self.tracked: Dict[str, TrackedPerson] = {}
        self.next_id = 1
        self.iou_threshold = 0.15
        self._yolo_model = None
        self._model_loaded = False
        self._frame_count = 0        # total frames processed (for logging)
        self._last_det_count = 0     # last detection count (for logging)

    # ── ID management ───────────────────────────────────────────

    def _get_next_id(self) -> str:
        pid = f"P-{self.next_id:03d}"
        self.next_id += 1
        return pid

    # ── Geometry helpers ────────────────────────────────────────

    def _bbox_to_xyxy(self, bbox):
        return (bbox["x"], bbox["y"],
                bbox["x"] + bbox["w"], bbox["y"] + bbox["h"])

    def _iou(self, bbox1, bbox2) -> float:
        x1 = max(bbox1[0], bbox2[0])
        y1 = max(bbox1[1], bbox2[1])
        x2 = min(bbox1[2], bbox2[2])
        y2 = min(bbox1[3], bbox2[3])
        inter = max(0, x2 - x1) * max(0, y2 - y1)
        if inter == 0:
            return 0.0
        area1 = (bbox1[2] - bbox1[0]) * (bbox1[3] - bbox1[1])
        area2 = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1])
        return inter / (area1 + area2 - inter)

    def _centroid_distance(self, bbox1_dict, bbox2_dict) -> float:
        cx1 = bbox1_dict["x"] + bbox1_dict["w"] / 2
        cy1 = bbox1_dict["y"] + bbox1_dict["h"] / 2
        cx2 = bbox2_dict["x"] + bbox2_dict["w"] / 2
        cy2 = bbox2_dict["y"] + bbox2_dict["h"] / 2
        return math.sqrt((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2)

    # ── Detection matching ──────────────────────────────────────

    def _match_detections(self, detections: List[dict]) -> List[tuple]:
        """
        Match new detections to existing tracked persons.
        Returns list of (detection, matched_person_id or None).
        """
        matched = {}
        active = {pid: p for pid, p in self.tracked.items() if not p.is_stale(2.0)}
        used_pids = set()

        for det_idx, det in enumerate(detections):
            best_pid = None
            best_score = -1

            for pid, person in active.items():
                if pid in used_pids:
                    continue

                iou = self._iou(
                    self._bbox_to_xyxy(det),
                    self._bbox_to_xyxy(person.bbox)
                )
                dist = self._centroid_distance(det, person.bbox)
                dist_score = max(0, 1 - dist / 300)
                score = iou * 0.7 + dist_score * 0.3

                if score > best_score and iou >= self.iou_threshold:
                    best_score = score
                    best_pid = pid

            if best_pid is not None:
                used_pids.add(best_pid)
            matched[det_idx] = best_pid

        return [(detections[i], matched[i]) for i in range(len(detections))]

    # ── YOLO inference ──────────────────────────────────────────

    def _ensure_model(self):
        """Load the YOLO model once on first use."""
        if self._yolo_model is not None:
            return True
        try:
            from ultralytics import YOLO
            model_path = _MODEL_PATH or "yolov8n.pt"
            print(f"[YOLO] Loading model from: {model_path}")
            self._yolo_model = YOLO(model_path)
            self._model_loaded = True
            print("[YOLO] ✓ Model loaded successfully")
            return True
        except Exception as e:
            print(f"[YOLO] ✗ Failed to load model: {e}")
            traceback.print_exc()
            return False

    def _run_yolo(self, frame_bytes: bytes) -> List[dict]:
        """Run real YOLOv8 inference on raw JPEG bytes."""
        try:
            if not self._ensure_model():
                return []

            import cv2
            import numpy as np

            # Decode JPEG bytes → OpenCV image
            nparr = np.frombuffer(frame_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is None:
                print(f"[YOLO] ✗ cv2.imdecode returned None (bytes len={len(frame_bytes)})")
                return []

            h, w = img.shape[:2]
            if self._frame_count % 20 == 0:
                print(f"[YOLO] Frame #{self._frame_count}: {w}x{h}, {len(frame_bytes)} bytes")

            # Run inference — class 0 = "person"
            results = self._yolo_model(img, classes=[0], verbose=False)

            detections = []
            all_confs = []   # for debug logging

            for r in results:
                for box in r.boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    conf = float(box.conf[0])
                    all_confs.append(conf)

                    # Accept any person detection above 0.3 confidence
                    if conf > 0.3:
                        detections.append({
                            "x": int(x1), "y": int(y1),
                            "w": int(x2 - x1), "h": int(y2 - y1),
                            "confidence": round(conf, 2),
                        })

            # Log every 10th frame, or whenever detection count changes
            if self._frame_count % 10 == 0 or len(detections) != self._last_det_count:
                conf_str = ", ".join(f"{c:.2f}" for c in all_confs) if all_confs else "none"
                print(f"[YOLO] Frame #{self._frame_count}: "
                      f"{len(detections)} persons detected "
                      f"(raw boxes: {len(all_confs)}, confs: [{conf_str}])")
                self._last_det_count = len(detections)

            return detections

        except Exception as e:
            print(f"[YOLO] ✗ Inference error: {e}")
            traceback.print_exc()
            return []

    # ── Main entry point ────────────────────────────────────────

    def process_frame(self, frame_bytes: Optional[bytes] = None) -> List[dict]:
        """Main method: process a frame, match to existing persons, return stable IDs."""
        self._frame_count += 1

        # Remove stale persons (not seen for STALE_TIMEOUT)
        stale = [pid for pid, p in self.tracked.items() if p.is_stale(self.STALE_TIMEOUT)]
        for pid in stale:
            del self.tracked[pid]

        # Must have real frame data
        if frame_bytes is None:
            return []

        # Run real YOLO detection
        raw_detections = self._run_yolo(frame_bytes)

        if not raw_detections:
            return self.get_all_tracked()   # return existing tracked persons even if current frame has no new detections

        # Match detections to existing tracked persons
        matched = self._match_detections(raw_detections)

        results = []
        for det, person_id in matched:
            bbox = {"x": det["x"], "y": det["y"], "w": det["w"], "h": det["h"]}
            conf = det["confidence"]

            if person_id is not None:
                self.tracked[person_id].update(bbox, conf)
            else:
                person_id = self._get_next_id()
                self.tracked[person_id] = TrackedPerson(person_id, bbox, conf)

            results.append(self.tracked[person_id].to_dict())

        return results

    # ── Query helpers ───────────────────────────────────────────

    def get_all_tracked(self) -> List[dict]:
        return [p.to_dict() for p in self.tracked.values() if not p.is_stale(self.STALE_TIMEOUT)]

    def get_active_ids(self) -> List[str]:
        """IDs of persons seen within ACTIVE_TIMEOUT (strict)."""
        now = time.time()
        return [pid for pid, p in self.tracked.items()
                if (now - p.last_seen) < self.ACTIVE_TIMEOUT]

    def get_confirmed_active_count(self) -> int:
        """Exact count of persons seen within the last ACTIVE_TIMEOUT seconds."""
        now = time.time()
        return sum(1 for p in self.tracked.values()
                   if (now - p.last_seen) < self.ACTIVE_TIMEOUT)

    def get_confirmed_active_persons(self) -> List[dict]:
        """Full person data for persons seen within ACTIVE_TIMEOUT."""
        now = time.time()
        return [p.to_dict() for p in self.tracked.values()
                if (now - p.last_seen) < self.ACTIVE_TIMEOUT]

    def get_diagnostics(self) -> dict:
        """Return diagnostic info for debugging."""
        return {
            "model_loaded": self._model_loaded,
            "model_path": _MODEL_PATH,
            "frames_processed": self._frame_count,
            "tracked_persons": len(self.tracked),
            "active_persons": self.get_confirmed_active_count(),
            "next_id": self.next_id,
            "last_detection_count": self._last_det_count,
        }


# Global singleton — persists for the lifetime of the backend process
tracker_engine = PersonTrackerEngine()
