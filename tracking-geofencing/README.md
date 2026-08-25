# 2. Devindu Liyanage — Tracking and Geofencing

## 2.1 Person Detection
- **Detector Used & Version**: Ultralytics YOLOv8 (specifically `yolov8n.pt` - YOLOv8 Nano model). Inference class filtering is strictly set to `classes=[0]` (the `person` class in the COCO dataset).
- **Valid Detection Threshold**: A confidence threshold of `confidence > 0.3` (30%) is enforced. Bounding box detections with a confidence score below 0.3 are discarded to eliminate background false positives.
- **Handling Overlapping / Occluded People**: Non-Maximum Suppression (NMS) built into YOLOv8 handles spatial bounding box overlaps during detection. Partially occluded individuals producing lower confidence scores are retained and processed by the secondary stage of the tracking pipeline (ByteTrack) rather than being discarded immediately.

## 2.2 Multi-Object Tracking
- **Tracking Algorithm Used & Rationale**: A dual concurrent tracking engine supporting **ByteTrack** (`bytetrack.yaml`) as the default and **BoT-SORT / DeepSORT** (`botsort.yaml`) as an alternate mode. ByteTrack is selected as primary because it preserves both high-confidence and low-confidence detection boxes across consecutive frames using Intersection over Union (IoU) matching, significantly reducing track loss during severe occlusions.
- **Track ID Assignment**: Primary track IDs are assigned by the tracker's motion prediction (`model.track(..., persist=True)`). Detections without an assigned track ID use a custom **IoU + Centroid Distance Fallback Matcher** score:
  $$\text{Score} = \text{IoU} \times 0.7 + \left(1 - \frac{\text{centroid\_distance}}{300}\right) \times 0.3$$
  If $\text{Score} \ge 0.15$, the detection is matched to an existing track; otherwise, a new persistent track ID (e.g., `P-001 (ByteTrack)`) is generated and incremented (`bytetrack_next_id`).
- **Re-association After Brief Occlusion**: Tracked individuals are maintained in memory in the `bytetrack_tracked` dictionary. If a person is briefly occluded (< 1.5 seconds), their record remains registered alongside their `last_seen` timestamp. Upon re-emergence, IoU matching and Kalman filter motion state re-associate the detection with their existing `person_id`.
- **Track Loss & Timeout Handling**:
  - `ACTIVE_TIMEOUT` = 1.5 seconds: A person must be detected within 1.5 seconds to be considered actively present.
  - `STALE_TIMEOUT` = 3.0 seconds: If a person is undetected for > 3.0 seconds, their tracking record is purged from active memory. If re-detected later, a new track ID (`P-xxx`) is assigned.

## 2.3 Reference Point Selection (Centroid)
- **Reference Point Used**: **Foot Point** $(x + w/2, y + h)$ (the bottom-center of the bounding box) is used for geofence occupancy and boundary breach detection. Bounding box center $(x + w/2, y + h/2)$ is recorded separately for trajectory mapping.
- **Justification**: The foot point directly corresponds to the person's physical contact point on the floor in 2D perspective space. Bounding box centers fluctuate erratically during movement, sitting, or arm extensions, causing spurious boundary breach triggers.
- **Testing & Design Selection**: Selected by design for 2D perspective floor mapping and validated empirically in indoor room tests. To prevent false breaches from sitting postures near zone edges, foot-point checking is augmented with:
  - Posture Aspect Ratio Analysis: $\text{aspect\_ratio} = w / h \ge 0.55$ indicates a sitting posture.
  - Bounding Box Depth Estimation: $\text{distance\_meters} = 850.0 / \text{effective\_h}$, ensuring sitting individuals or people walking in front of a zone boundary do not trigger false alerts.

## 2.4 Zone / Geofence Definition
- **Zone Representation**: Represented as 2D arbitrary polygons defined by vertex coordinates `[[x1, y1], [x2, y2], ...]`, mapped directly onto the camera's 2D image pixel space (Field of View).
- **Zone Administration & Capacity**: Defined by administrators or caregivers via an interactive canvas UI in the Gateway/Tracking frontend. The system supports unlimited active polygon zones per camera feed (typically 3–5 active zones per setup).
- **Real-World Zone Examples**:
  - `Restricted Exit` (Doorway / Main entrance — restricted zone type triggering entry and exit alerts).
  - `Bedroom` (Safe zone type for routine monitoring).
  - `Bathroom / Hazardous Area` (Restricted zone type for dwell and exit monitoring).

## 2.5 Entry/Exit Detection Logic
- **Point-in-Polygon Algorithm**: Calculated using Shapely's `shapely.geometry.Polygon.contains(Point(feet))` (Ray-casting / Winding number algorithm).
- **Edge & Boundary Case Handling**:
  - Posture aspect ratio checks ($\text{aspect\_ratio} \ge 0.55$) adjust effective height to prevent sitting individuals near boundary lines from causing false alerts.
  - Camera distance thresholding ($\text{distance\_meters} < \text{zone\_dist} - 0.5$) ignores persons passing between the camera and the zone.
  - Smart Exit Detection uses **Depth-Aware Bounding Box Shrinkage**: Exits are confirmed when bounding box area shrinks ($\text{area} < \text{max\_area\_in\_zone} \times 0.85$) combined with foot position elevation, confirming the elder moved away/behind the doorway boundary.
- **Dwell Time & Disappearance Window**: A strict disappearance window of **1.0 to 5.0 seconds** ($1.0 < \text{time\_since\_seen} < 5.0$) is enforced before an exit alert is finalized, preventing false triggers from single-frame drops or momentary camera noise.

## 2.6 Alert Management
- **Cooldown & Duplicate Suppression**: Managed via an in-memory `person_exit_tracker` singleton. When an exit alert is triggered for a `person_id` in a specific `zone_name`, an `exit_alerted` flag is set to `True`. Subsequent frames suppress duplicate alerts for the same person in the same zone. The flag is reset (`exit_alerted = False`) only when the person explicitly re-enters an active geofence zone.
- **Alert Storage & Schema**: Generated alerts are assigned a unique UUID (`alert_id`), timestamped in UTC ISO-8601 format, tagged with severity (`high`), and saved asynchronously to the MongoDB `geofence_alerts` collection.

## 2.7 Known Limitations
- **Camera Coverage Gaps (Blind Spots)**: Single monocular camera setups cannot track persons moving behind opaque obstacles (walls, tall furniture) or outside the camera's FOV.
- **Camera Calibration & Depth Inaccuracy**: Depth estimation relies on heuristic height scaling ($850.0 / \text{effective\_h}$) without full 3D camera intrinsic matrix calibration. Posture changes (crouching, lying down) alter bounding box height, affecting estimated distance.
- **Lighting & Background Clutter**: Low-light conditions or heavy background clutter degrade YOLOv8 feature extraction, causing confidence scores to fall below the $0.3$ threshold.
- **Identity / Track ID Switches**: Extended occlusions (> 3.0s) or overlapping paths of multiple individuals in crowded scenes can lead to track ID re-assignment (e.g., `P-001` re-emerging as `P-002`).
