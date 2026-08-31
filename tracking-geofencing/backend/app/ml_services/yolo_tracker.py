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
    def __init__(self, person_id: str, bbox: dict, confidence: float, tracker_name: str = "ByteTrack"):
        self.person_id = person_id
        self.bbox = bbox
        self.confidence = confidence
        self.first_seen = time.time()
        self.last_seen = time.time()
        self.frame_count = 1
        self.trajectory = [self._centroid(bbox)]
        self.zone_status = "unknown"
        self.tracker_name = tracker_name
        self.identity = None           # Matched caregiver/user name (e.g. "Sarah Connor")
        self.role = None               # e.g. "caregiver", "elder", "admin"
        self.confidence_id = 0.0       # Biometric match confidence
        self.is_identified = False

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

    def update_identity(self, name: str, role: str = "caregiver", confidence_id: float = 0.0):
        if name:
            self.identity = name
            self.role = role
            self.confidence_id = confidence_id
            self.is_identified = True

    def is_stale(self, timeout_seconds=3.0) -> bool:
        return (time.time() - self.last_seen) > timeout_seconds

    def to_dict(self):
        w = self.bbox.get("w", 0) if self.bbox else 0
        h = self.bbox.get("h", 0) if self.bbox else 0
        aspect_ratio = round(w / h, 2) if h > 0 else 0.0
        is_sitting = aspect_ratio >= 0.55
        display_name = f"{self.identity} ({self.tracker_name})" if self.identity else self.person_id
        return {
            "person_id": self.person_id,
            "identity": self.identity or self.person_id,
            "name": self.identity,
            "role": self.role or "unidentified",
            "is_identified": self.is_identified,
            "confidence_id": self.confidence_id,
            "display_name": display_name,
            "bbox": self.bbox,
            "confidence": self.confidence,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "frame_count": self.frame_count,
            "trajectory": self.trajectory[-10:],
            "zone_status": self.zone_status,
            "duration_seconds": round(time.time() - self.first_seen, 1),
            "tracker_name": self.tracker_name,
            "aspect_ratio": aspect_ratio,
            "is_sitting": is_sitting,
        }


class PersonTrackerEngine:
    """
    Singleton tracker that remembers persons across frames using dual concurrent trackers:
    ByteTrack and DeepSORT (BoT-SORT).
    """

    ACTIVE_TIMEOUT = 1.5   # seconds — person must be seen within this window to be "active"
    STALE_TIMEOUT = 3.0    # seconds — remove from tracker entirely after this

    def __init__(self):
        # We maintain two separate dictionaries of tracked persons
        self.bytetrack_tracked: Dict[str, TrackedPerson] = {}
        self.deepsort_tracked: Dict[str, TrackedPerson] = {}

        self.bytetrack_next_id = 1
        self.deepsort_next_id = 1

        self.iou_threshold = 0.15
        self._model_bytetrack = None
        self._model_deepsort = None
        self._model_loaded = False
        self._frame_count = 0        # total frames processed (for logging)
        self._last_det_count = 0     # last detection count (for logging)
        self.current_tracker_type = "bytetrack"

    @property
    def next_id(self) -> int:
        if getattr(self, "current_tracker_type", "bytetrack") == "deepsort":
            return self.deepsort_next_id
        return self.bytetrack_next_id

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

    # ── YOLO model management ───────────────────────────────────

    def _ensure_models(self):
        """Load both YOLO models once on first use."""
        if self._model_bytetrack is not None and self._model_deepsort is not None:
            return True
        try:
            from ultralytics import YOLO
            model_path = _MODEL_PATH or "yolov8n.pt"
            print(f"[YOLO] Loading model for ByteTrack from: {model_path}")
            self._model_bytetrack = YOLO(model_path)
            print(f"[YOLO] Loading model for DeepSORT from: {model_path}")
            self._model_deepsort = YOLO(model_path)
            self._model_loaded = True
            print("[YOLO] ✓ Both models loaded successfully")
            return True
        except Exception as e:
            print(f"[YOLO] ✗ Failed to load models: {e}")
            traceback.print_exc()
            return False

    def _run_yolo_for_tracker(self, img, model, tracker_file) -> List[dict]:
        """Run YOLOv8 inference with tracking on the image for a specific tracker."""
        try:
            results = model.track(img, persist=True, tracker=tracker_file, classes=[0], verbose=False)
            detections = []
            for r in results:
                for box in r.boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    conf = float(box.conf[0])
                    if conf > 0.3:
                        track_id = int(box.id[0].item()) if (hasattr(box, 'id') and box.id is not None) else None
                        detections.append({
                            "x": int(x1), "y": int(y1),
                            "w": int(x2 - x1), "h": int(y2 - y1),
                            "confidence": round(conf, 2),
                            "track_id": track_id,
                        })
            return detections
        except Exception as e:
            print(f"[YOLO] ✗ Tracking error for {tracker_file}: {e}")
            return []

    # ── Fallback IoU Matching ───────────────────────────────────

    def _fallback_match(self, det: dict, tracked_dict: dict, tracker_prefix: str, next_id_attr: str) -> str:
        """Fallback to IoU matching if no track_id assigned by YOLO."""
        best_pid = None
        best_score = -1
        active = {pid: p for pid, p in tracked_dict.items() if not p.is_stale(2.0)}
        
        for pid, person in active.items():
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
            return best_pid
            
        next_id = getattr(self, next_id_attr)
        pid = f"P-{next_id:03d} ({tracker_prefix})"
        setattr(self, next_id_attr, next_id + 1)
        return pid

    # ── Main Entry Point ────────────────────────────────────────

    def process_frame(self, frame_bytes: Optional[bytes] = None, tracker_type: str = "bytetrack") -> List[dict]:
        """Main method: process a frame using the selected tracker, return stable IDs."""
        self._frame_count += 1
        self.current_tracker_type = tracker_type

        # Remove stale persons
        stale_byte = [pid for pid, p in self.bytetrack_tracked.items() if p.is_stale(self.STALE_TIMEOUT)]
        for pid in stale_byte:
            del self.bytetrack_tracked[pid]

        stale_deep = [pid for pid, p in self.deepsort_tracked.items() if p.is_stale(self.STALE_TIMEOUT)]
        for pid in stale_deep:
            del self.deepsort_tracked[pid]

        if frame_bytes is None:
            return []

        if not self._ensure_models():
            return []

        import cv2
        import numpy as np

        # Decode JPEG bytes → OpenCV image once
        nparr = np.frombuffer(frame_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return []

        if tracker_type == "deepsort":
            # 2. Process DeepSORT
            deepsort_dets = self._run_yolo_for_tracker(img, self._model_deepsort, "botsort.yaml")
            deepsort_results = []
            for det in deepsort_dets:
                bbox = {"x": det["x"], "y": det["y"], "w": det["w"], "h": det["h"]}
                conf = det["confidence"]
                track_id = det.get("track_id")

                if track_id is not None:
                    person_id = f"P-{track_id:03d} (DeepSORT)"
                    if track_id >= self.deepsort_next_id:
                        self.deepsort_next_id = track_id + 1
                else:
                    person_id = self._fallback_match(det, self.deepsort_tracked, "DeepSORT", "deepsort_next_id")

                if person_id in self.deepsort_tracked:
                    self.deepsort_tracked[person_id].update(bbox, conf)
                else:
                    self.deepsort_tracked[person_id] = TrackedPerson(person_id, bbox, conf, "DeepSORT")

                deepsort_results.append(self.deepsort_tracked[person_id].to_dict())
            return deepsort_results

        else:
            # 1. Process ByteTrack
            bytetrack_dets = self._run_yolo_for_tracker(img, self._model_bytetrack, "bytetrack.yaml")
            bytetrack_results = []
            for det in bytetrack_dets:
                bbox = {"x": det["x"], "y": det["y"], "w": det["w"], "h": det["h"]}
                conf = det["confidence"]
                track_id = det.get("track_id")

                if track_id is not None:
                    person_id = f"P-{track_id:03d} (ByteTrack)"
                    if track_id >= self.bytetrack_next_id:
                        self.bytetrack_next_id = track_id + 1
                else:
                    person_id = self._fallback_match(det, self.bytetrack_tracked, "ByteTrack", "bytetrack_next_id")

                if person_id in self.bytetrack_tracked:
                    self.bytetrack_tracked[person_id].update(bbox, conf)
                else:
                    self.bytetrack_tracked[person_id] = TrackedPerson(person_id, bbox, conf, "ByteTrack")

                bytetrack_results.append(self.bytetrack_tracked[person_id].to_dict())
            return bytetrack_results

    # ── Query helpers ───────────────────────────────────────────

    def get_all_tracked(self) -> List[dict]:
        tracker_type = getattr(self, "current_tracker_type", "bytetrack")
        tracked_dict = self.deepsort_tracked if tracker_type == "deepsort" else self.bytetrack_tracked
        all_tracked = list(tracked_dict.values())
        return [p.to_dict() for p in all_tracked if not p.is_stale(self.STALE_TIMEOUT)]

    def get_active_ids(self) -> List[str]:
        """IDs of persons seen within ACTIVE_TIMEOUT (strict)."""
        now = time.time()
        tracker_type = getattr(self, "current_tracker_type", "bytetrack")
        tracked_dict = self.deepsort_tracked if tracker_type == "deepsort" else self.bytetrack_tracked
        all_tracked = list(tracked_dict.values())
        return [p.person_id for p in all_tracked if (now - p.last_seen) < self.ACTIVE_TIMEOUT]

    def get_confirmed_active_count(self) -> int:
        """Exact count of persons seen within the last ACTIVE_TIMEOUT seconds."""
        now = time.time()
        tracker_type = getattr(self, "current_tracker_type", "bytetrack")
        tracked_dict = self.deepsort_tracked if tracker_type == "deepsort" else self.bytetrack_tracked
        all_tracked = list(tracked_dict.values())
        return sum(1 for p in all_tracked if (now - p.last_seen) < self.ACTIVE_TIMEOUT)

    def get_confirmed_active_persons(self) -> List[dict]:
        """Full person data for persons seen within ACTIVE_TIMEOUT."""
        now = time.time()
        tracker_type = getattr(self, "current_tracker_type", "bytetrack")
        tracked_dict = self.deepsort_tracked if tracker_type == "deepsort" else self.bytetrack_tracked
        all_tracked = list(tracked_dict.values())
        return [p.to_dict() for p in all_tracked if (now - p.last_seen) < self.ACTIVE_TIMEOUT]

    def set_person_identity(self, person_id: str, name: str, role: str = "caregiver", conf: float = 0.0) -> bool:
        """Associate a verified biometric name/identity to a tracked person."""
        updated = False
        for tracked in [self.bytetrack_tracked, self.deepsort_tracked]:
            if person_id in tracked:
                tracked[person_id].update_identity(name, role, conf)
                updated = True

        # If not exact match, match base track prefix e.g. "P-001"
        if not updated and person_id:
            base_pid = person_id.split()[0]
            for tracked in [self.bytetrack_tracked, self.deepsort_tracked]:
                for pid, p in tracked.items():
                    if pid.startswith(base_pid):
                        p.update_identity(name, role, conf)
                        updated = True

        # If still not matched, assign to the most recently updated active person
        if not updated:
            active_persons = self.get_confirmed_active_persons()
            if len(active_persons) == 1:
                pid = active_persons[0]["person_id"]
                for tracked in [self.bytetrack_tracked, self.deepsort_tracked]:
                    if pid in tracked:
                        tracked[pid].update_identity(name, role, conf)
                        updated = True

        return updated

    def get_diagnostics(self) -> dict:
        """Return diagnostic info for debugging."""
        return {
            "model_loaded": self._model_loaded,
            "model_path": _MODEL_PATH,
            "frames_processed": self._frame_count,
            "bytetrack_persons": len(self.bytetrack_tracked),
            "deepsort_persons": len(self.deepsort_tracked),
            "active_persons": self.get_confirmed_active_count(),
            "next_bytetrack_id": self.bytetrack_next_id,
            "next_deepsort_id": self.deepsort_next_id,
        }


# Global singleton — persists for the lifetime of the backend process
tracker_engine = PersonTrackerEngine()

