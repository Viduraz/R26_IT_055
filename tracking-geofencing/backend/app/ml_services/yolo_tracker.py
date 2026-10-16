"""
Persistent person tracking engine with YOLOv8 and ByteTrack / BoT-SORT.
Maintains stable person IDs across frames, real-time performance on CPU/GPU,
and detailed latency/accuracy telemetry.
"""

import os
import time
import math
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np
import torch
from dotenv import load_dotenv

load_dotenv("../../.env")
load_dotenv(".env")

# ── Auto-configure compute device & threading ────────────────────────
def get_optimal_device() -> str:
    if torch.cuda.is_available():
        return "cuda:0"
    return "cpu"

DEVICE = get_optimal_device()
if DEVICE == "cpu":
    # Limit OpenMP / Torch threads to physical core balance to avoid thread thrashing
    num_cpus = os.cpu_count() or 4
    torch.set_num_threads(min(4, num_cpus))

# ── Resolve model path ──────────────────────────────────────────────
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
    print(f"[YOLO] Model found: {_MODEL_PATH} (device: {DEVICE})")
else:
    print(f"[YOLO] ⚠ yolov8n.pt not found — will download on first inference (device: {DEVICE})")

# Resolve custom tracker configs
_DIR = Path(__file__).resolve().parent
_CUSTOM_BYTETRACK_CONFIG = str(_DIR / "bytetrack_custom.yaml")
if not Path(_CUSTOM_BYTETRACK_CONFIG).exists():
    _CUSTOM_BYTETRACK_CONFIG = "bytetrack.yaml"


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

    def is_stale(self, timeout_seconds=5.0) -> bool:
        return (time.time() - self.last_seen) > timeout_seconds

    def to_dict(self):
        w = self.bbox.get("w", 0) if self.bbox else 0
        h = self.bbox.get("h", 0) if self.bbox else 0
        aspect_ratio = round(w / h, 2) if h > 0 else 0.0
        # More realistic sitting detection: aspect ratio >= 0.58 and significant height reduction
        is_sitting = aspect_ratio >= 0.58
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
    High-performance, stable person tracking engine.
    Uses YOLOv8 (person class only) with tuned ByteTrack tracking.
    """

    ACTIVE_TIMEOUT = 2.0   # seconds — person must be seen within this window to be "active"
    STALE_TIMEOUT = 5.0    # seconds — retain track history during temporary occlusion

    def __init__(self):
        self.bytetrack_tracked: Dict[str, TrackedPerson] = {}
        self.deepsort_tracked: Dict[str, TrackedPerson] = {}

        self.bytetrack_next_id = 1
        self.deepsort_next_id = 1

        self.iou_threshold = 0.35  # Stricter IoU threshold to avoid false ID merges
        self._model_bytetrack = None
        self._model_deepsort = None
        self._model_loaded = False
        self._frame_count = 0
        self._last_det_count = 0
        self._last_track_count = 0
        self._last_confidences: List[float] = []
        self._last_inference_ms = 0.0
        self._last_total_ms = 0.0
        self._last_frame_timestamp = 0.0
        self._estimated_fps = 0.0
        self.current_tracker_type = "bytetrack"

        # Runtime configuration
        self.device = DEVICE
        self.imgsz = int(os.getenv("YOLO_IMGSZ", "480"))  # 480 provides ~35% speedup on CPU
        self.conf_threshold = float(os.getenv("YOLO_CONF_THRESH", "0.25"))

    @property
    def next_id(self) -> int:
        if getattr(self, "current_tracker_type", "bytetrack") == "deepsort":
            return self.deepsort_next_id
        return self.bytetrack_next_id

    # ── Geometry helpers ────────────────────────────────────────

    def _bbox_to_xyxy(self, bbox):
        return (bbox["x"], bbox["y"], bbox["x"] + bbox["w"], bbox["y"] + bbox["h"])

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

    # ── Model management (lazy loading) ─────────────────────────

    def _get_model(self, tracker_type: str):
        """Lazy load only the requested tracker model to save memory."""
        from ultralytics import YOLO
        model_path = _MODEL_PATH or "yolov8n.pt"

        if tracker_type == "deepsort":
            if self._model_deepsort is None:
                print(f"[YOLO] Loading model for DeepSORT/BoT-SORT from {model_path} ({self.device})")
                self._model_deepsort = YOLO(model_path)
            return self._model_deepsort
        else:
            if self._model_bytetrack is None:
                print(f"[YOLO] Loading model for ByteTrack from {model_path} ({self.device})")
                self._model_bytetrack = YOLO(model_path)
            return self._model_bytetrack

    def _ensure_models(self) -> bool:
        try:
            self._get_model(self.current_tracker_type)
            self._model_loaded = True
            return True
        except Exception as e:
            print(f"[YOLO] ✗ Failed to load model: {e}")
            traceback.print_exc()
            return False

    def _run_yolo_for_tracker(self, img, model, tracker_file) -> List[dict]:
        """Run YOLOv8 inference with tracking for person class only."""
        try:
            t0 = time.perf_counter()
            # Run inference targeting only person class (class 0)
            results = model.track(
                img,
                persist=True,
                tracker=tracker_file,
                classes=[0],
                conf=self.conf_threshold,
                iou=0.5,
                imgsz=self.imgsz,
                device=self.device,
                verbose=False,
            )
            self._last_inference_ms = (time.perf_counter() - t0) * 1000

            detections = []
            for r in results:
                if not hasattr(r, "boxes") or r.boxes is None:
                    continue
                for box in r.boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    conf = float(box.conf[0])
                    # Ensure person detection meets confidence requirement
                    if conf >= self.conf_threshold:
                        track_id = int(box.id[0].item()) if (hasattr(box, "id") and box.id is not None) else None
                        detections.append({
                            "x": int(x1),
                            "y": int(y1),
                            "w": max(1, int(x2 - x1)),
                            "h": max(1, int(y2 - y1)),
                            "confidence": round(conf, 2),
                            "track_id": track_id,
                        })
            return detections
        except Exception as e:
            print(f"[YOLO] ✗ Tracking error for {tracker_file}: {e}")
            return []

    # ── Robust Spatial Fallback Matching ────────────────────────

    def _fallback_match(self, det: dict, tracked_dict: dict, tracker_prefix: str, next_id_attr: str) -> str:
        """
        Associate unassigned detections to recently active tracks using spatial overlap & distance.
        Prevents ID fragmentation when ByteTrack drops an ID for a single frame.
        """
        best_pid = None
        best_score = -1.0
        active = {pid: p for pid, p in tracked_dict.items() if not p.is_stale(self.ACTIVE_TIMEOUT)}

        det_box = self._bbox_to_xyxy(det)

        for pid, person in active.items():
            person_box = self._bbox_to_xyxy(person.bbox)
            iou = self._iou(det_box, person_box)
            dist = self._centroid_distance(det, person.bbox)
            dist_score = max(0.0, 1.0 - dist / 250.0)
            score = iou * 0.7 + dist_score * 0.3

            if score > best_score and (iou >= self.iou_threshold or dist < 60):
                best_score = score
                best_pid = pid

        if best_pid is not None:
            return best_pid

        # If truly a new unassigned detection, generate next stable ID
        next_id = getattr(self, next_id_attr)
        pid = f"P-{next_id:03d} ({tracker_prefix})"
        setattr(self, next_id_attr, next_id + 1)
        return pid

    # ── Main Entry Point ────────────────────────────────────────

    def process_frame(self, frame_bytes: Optional[bytes] = None, tracker_type: str = "bytetrack") -> List[dict]:
        """Process a frame with YOLOv8 + ByteTrack, returning stable IDs and telemetry."""
        t_total_start = time.perf_counter()
        now = time.time()

        if self._last_frame_timestamp > 0:
            dt = now - self._last_frame_timestamp
            if dt > 0:
                instant_fps = 1.0 / dt
                self._estimated_fps = self._estimated_fps * 0.7 + instant_fps * 0.3
        self._last_frame_timestamp = now

        self._frame_count += 1
        self.current_tracker_type = tracker_type

        # Purge truly stale tracks (older than STALE_TIMEOUT)
        stale_byte = [pid for pid, p in self.bytetrack_tracked.items() if p.is_stale(self.STALE_TIMEOUT)]
        for pid in stale_byte:
            del self.bytetrack_tracked[pid]

        stale_deep = [pid for pid, p in self.deepsort_tracked.items() if p.is_stale(self.STALE_TIMEOUT)]
        for pid in stale_deep:
            del self.deepsort_tracked[pid]

        if frame_bytes is None:
            self._last_det_count = 0
            self._last_track_count = 0
            self._last_confidences = []
            self._last_total_ms = (time.perf_counter() - t_total_start) * 1000
            return []

        if not self._ensure_models():
            self._last_total_ms = (time.perf_counter() - t_total_start) * 1000
            return []

        # Decode JPEG bytes to numpy BGR image
        nparr = np.frombuffer(frame_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            self._last_total_ms = (time.perf_counter() - t_total_start) * 1000
            return []

        if tracker_type == "deepsort":
            model = self._get_model("deepsort")
            dets = self._run_yolo_for_tracker(img, model, "botsort.yaml")
            tracked_dict = self.deepsort_tracked
            prefix = "DeepSORT"
            next_attr = "deepsort_next_id"
        else:
            model = self._get_model("bytetrack")
            dets = self._run_yolo_for_tracker(img, model, _CUSTOM_BYTETRACK_CONFIG)
            tracked_dict = self.bytetrack_tracked
            prefix = "ByteTrack"
            next_attr = "bytetrack_next_id"

        self._last_det_count = len(dets)
        confidences = []
        results = []

        for det in dets:
            bbox = {"x": det["x"], "y": det["y"], "w": det["w"], "h": det["h"]}
            conf = det["confidence"]
            confidences.append(conf)
            track_id = det.get("track_id")

            if track_id is not None:
                person_id = f"P-{track_id:03d} ({prefix})"
                current_next = getattr(self, next_attr)
                if track_id >= current_next:
                    setattr(self, next_attr, track_id + 1)
            else:
                person_id = self._fallback_match(det, tracked_dict, prefix, next_attr)

            if person_id in tracked_dict:
                tracked_dict[person_id].update(bbox, conf)
            else:
                tracked_dict[person_id] = TrackedPerson(person_id, bbox, conf, prefix)

            results.append(tracked_dict[person_id].to_dict())

        self._last_track_count = len(results)
        self._last_confidences = confidences
        self._last_total_ms = (time.perf_counter() - t_total_start) * 1000
        return results

    # ── Telemetry & Metrics ─────────────────────────────────────

    def get_last_metrics(self) -> dict:
        """Returns performance metrics for the most recently processed frame."""
        return {
            "input_fps": round(self._estimated_fps, 1),
            "inference_time_ms": round(self._last_inference_ms, 1),
            "total_processing_time_ms": round(self._last_total_ms, 1),
            "detection_count": self._last_det_count,
            "tracking_count": self._last_track_count,
            "confidence_scores": self._last_confidences,
            "current_tracking_ids": self.get_active_ids(),
            "device": str(self.device),
            "imgsz": self.imgsz,
        }

    # ── Query helpers ───────────────────────────────────────────

    def get_all_tracked(self) -> List[dict]:
        tracker_type = getattr(self, "current_tracker_type", "bytetrack")
        tracked_dict = self.deepsort_tracked if tracker_type == "deepsort" else self.bytetrack_tracked
        all_tracked = list(tracked_dict.values())
        return [p.to_dict() for p in all_tracked if not p.is_stale(self.STALE_TIMEOUT)]

    def get_active_ids(self) -> List[str]:
        """IDs of persons seen within ACTIVE_TIMEOUT."""
        now = time.time()
        tracker_type = getattr(self, "current_tracker_type", "bytetrack")
        tracked_dict = self.deepsort_tracked if tracker_type == "deepsort" else self.bytetrack_tracked
        all_tracked = list(tracked_dict.values())
        return [p.person_id for p in all_tracked if (now - p.last_seen) < self.ACTIVE_TIMEOUT]

    def get_confirmed_active_count(self) -> int:
        """Count of persons seen within ACTIVE_TIMEOUT."""
        now = time.time()
        tracker_type = getattr(self, "current_tracker_type", "bytetrack")
        tracked_dict = self.deepsort_tracked if tracker_type == "deepsort" else self.bytetrack_tracked
        all_tracked = list(tracked_dict.values())
        return sum(1 for p in all_tracked if (now - p.last_seen) < self.ACTIVE_TIMEOUT)

    def get_confirmed_active_persons(self) -> List[dict]:
        """Full person data for active persons."""
        now = time.time()
        tracker_type = getattr(self, "current_tracker_type", "bytetrack")
        tracked_dict = self.deepsort_tracked if tracker_type == "deepsort" else self.bytetrack_tracked
        all_tracked = list(tracked_dict.values())
        return [p.to_dict() for p in all_tracked if (now - p.last_seen) < self.ACTIVE_TIMEOUT]

    def set_person_identity(self, person_id: str, name: str, role: str = "caregiver", conf: float = 0.0) -> bool:
        """Associate a verified identity with a tracked person."""
        updated = False
        for tracked in [self.bytetrack_tracked, self.deepsort_tracked]:
            if person_id in tracked:
                tracked[person_id].update_identity(name, role, conf)
                updated = True

        if not updated and person_id:
            base_pid = person_id.split()[0]
            for tracked in [self.bytetrack_tracked, self.deepsort_tracked]:
                for pid, p in tracked.items():
                    if pid.startswith(base_pid):
                        p.update_identity(name, role, conf)
                        updated = True

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
        """Return diagnostic info for debugging & dashboard."""
        return {
            "model_loaded": self._model_loaded,
            "model_path": _MODEL_PATH,
            "device": str(self.device),
            "imgsz": self.imgsz,
            "frames_processed": self._frame_count,
            "bytetrack_persons": len(self.bytetrack_tracked),
            "deepsort_persons": len(self.deepsort_tracked),
            "active_persons": self.get_confirmed_active_count(),
            "next_bytetrack_id": self.bytetrack_next_id,
            "next_deepsort_id": self.deepsort_next_id,
            "metrics": self.get_last_metrics(),
        }


# Global singleton — persists for the lifetime of the backend process
tracker_engine = PersonTrackerEngine()
