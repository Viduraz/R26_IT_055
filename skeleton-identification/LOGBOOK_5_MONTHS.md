# 🦴 Skeleton-Based Person Identification System
## 5-Month Project Development Logbook

---

### 📌 Project Metadata
- **Project Title:** Secure Elder Care — AI-Powered Elder Care Monitoring Platform
- **Component Name:** Skeleton-Based Person Identification & Biometric Gait Analysis (`skeleton-identification`)
- **Project Registration ID:** R26_IT_055
- **Technology Stack:**
  - **Backend & ML:** Python 3.10+, MediaPipe Pose, PyTorch (BiLSTM), scikit-learn (SVM RBF), OpenCV, FastAPI, MongoDB (Motor/PyMongo), WebSockets.
  - **Frontend & UI:** React 18, Vite, Tailwind CSS, Lucide React, Canvas API, jsPDF (Biometric Incident Reporting).
- **Duration:** 5 Months (20 Weeks)
- **Primary Supervisor:** _______________________
- **Student Name / ID:** _______________________

---

## 🗓️ 5-Month Project Timeline Roadmap

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ MONTH 1 (W1-W4): Requirements, Literature Review & Base Architecture Design           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ MONTH 2 (W5-W8): Pose Estimation, 42-D Static & 15-D Gait Feature Engineering        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ MONTH 3 (W9-W12): Machine Learning Models (SVM + BiLSTM) & Dynamic Ensemble Fusion    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ MONTH 4 (W13-W16): FastAPI Gateway, WebSocket Streaming & React Canvas Dashboard       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ MONTH 5 (W17-W20): Automated PDF Incident Reports, System Optimization & Final Testing │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📅 MONTH 1: Literature Review, System Design & Foundation Setup

### 🔹 Week 1: Requirements Gathering & Literature Survey
- **Objectives:**
  - Research non-intrusive biometric identification methods for elderly care where facial visibility is often compromised (e.g., poor lighting, dynamic head poses, low camera angles).
  - Benchmark MediaPipe Pose Estimation against OpenPose and YOLOv8-pose regarding inference latency and joint tracking stability on lightweight edge hardware.
- **Activities & Implementation:**
  - Reviewed papers on skeletal biometric gait analysis, body segment ratio normalization, and dynamic temporal sequence classification.
  - Formulated technical specifications for the `skeleton-identification` microservice within the overall monorepo structure.
- **Challenges & Solutions:**
  - *Challenge:* Traditional face recognition fails when elders look down or sleep on side angles.
  - *Solution:* Selected skeleton-based biometric keypoints (33 3D landmarks) combined with spatio-temporal gait metrics to achieve privacy-preserving, posture-independent identification.
- **Deliverables:** Literature Review Summary & Requirements Specification Document.

---

### 🔹 Week 2: Monorepo Architecture & Development Environment Setup
- **Objectives:**
  - Setup unified environment with Python 3.10+, PyTorch, MediaPipe, FastAPI, Node.js 18, and Vite.
  - Establish clear microservice directory structure (`backend/`, `frontend/`, `scripts/`, `models/`, `gateway/`).
- **Activities & Implementation:**
  - Created initial repository layout for `skeleton-identification`.
  - Configured `requirements.txt` containing dependencies (`torch`, `scikit-learn`, `mediapipe`, `fastapi`, `uvicorn`, `pymongo`, `opencv-python`, `pydantic`).
  - Implemented centralized settings file `config.py` using Pydantic BaseSettings to handle environment variables (`MONGODB_URI`, `CONFIDENCE_THRESHOLD=0.65`, `SVM_WEIGHT=0.5`, `LSTM_WEIGHT=0.5`, `LSTM_SEQUENCE_LENGTH=30`).
- **Challenges & Solutions:**
  - *Challenge:* Managing modular python imports from root project settings across microservices.
  - *Solution:* Standardized `run.py` launcher script to automatically add project root directory to system `PYTHONPATH`.
- **Deliverables:** Working repository environment with initialized dependencies and `config.py`.

---

### 🔹 Week 3: Database Schema & Core Data Model Design
- **Objectives:**
  - Design data storage schemas in MongoDB for biometric feature profiles, enrollment landmarks, and incident audit logs.
- **Activities & Implementation:**
  - Developed Pydantic and PyMongo collection schemas for storing user feature profiles (`users` collection) and frame sequences.
  - Schema includes: `user_id`, `name`, `created_at`, `static_features` (42-dimensional normalized vectors), `sequence_data` (30-frame temporal gait sliding windows), and `enrolled_frames_count`.
  - Implemented `database/connection.py` for async MongoDB connection pooling.
- **Challenges & Solutions:**
  - *Challenge:* Storing raw landmark coordinates for hundreds of frames causes high database bloat.
  - *Solution:* Extracted and saved pre-computed normalized feature vectors rather than raw pixel coordinates.
- **Deliverables:** MongoDB Database connection scripts and User Biometric Feature Schema.

---

### 🔹 Week 4: Frame Preprocessing & OpenCV Capture Pipeline
- **Objectives:**
  - Build baseline OpenCV frame ingest and video processing module (`services/video_processing/`).
- **Activities & Implementation:**
  - Created video stream processing class capable of capturing webcam feeds at standard 30 FPS.
  - Added frame resize, RGB color format conversion (`cv2.cvtColor`), and aspect ratio preservation logic.
  - Implemented frame-level timestamping and frame-drop handler to prevent buffer accumulation during low CPU hardware execution.
- **Challenges & Solutions:**
  - *Challenge:* Camera frame latency under varying video resolutions.
  - *Solution:* Downsampled video frames to 640x480 resolution prior to landmark extraction to optimize FPS throughput.
- **Deliverables:** Operational OpenCV frame stream ingester (`services/video_processing/frame_capture.py`).

---

## 📅 MONTH 2: Pose Estimation & Feature Engineering (Static + Gait Features)

### 🔹 Week 5: MediaPipe Pose Estimator Integration
- **Objectives:**
  - Integrate MediaPipe Pose Estimation solution (`services/pose_estimation/pose_estimator.py`).
  - Extract 33 3D skeletal landmarks per detected individual.
- **Activities & Implementation:**
  - Instantiated `mediapipe.solutions.pose.Pose` with configurable parameters: `static_image_mode=False`, `model_complexity=1`, `min_detection_confidence=0.5`, `min_tracking_confidence=0.5`.
  - Created keypoint extraction wrapper converting raw MediaPipe normalized landmarks $(x, y, z, \text{visibility})$ into structured NumPy arrays.
  - Added low-visibility landmark filter (discarding keypoint confidence $< 0.5$).
- **Challenges & Solutions:**
  - *Challenge:* Sudden joint location jitter in low-light environments.
  - *Solution:* Applied Exponential Moving Average (EMA) smoothing filter ($\alpha = 0.7$) across frame keypoint coordinates.
- **Deliverables:** Robust MediaPipe keypoint extraction service (`pose_estimator.py`).

---

### 🔹 Week 6: 42-Dimensional Static Feature Extraction
- **Objectives:**
  - Engineer scale-invariant static anthropometric features based on skeletal bone structures (`services/feature_extraction/static_features.py`).
- **Activities & Implementation:**
  - Implemented 42-dimensional static feature vector calculation:
    - **Limb Length Ratios:** Torso length (shoulder-to-hip distance) used as baseline normalization factor to achieve scale invariance regardless of camera distance.
    - **Bone Segment Lengths:** Upper arm, forearm, thigh, shank, shoulder width, hip width normalized by torso height.
    - **Joint Angles:** Euclidean 3D angles at elbow, shoulder, hip, and knee joints computed via vector dot products: $\theta = \arccos\left(\frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\| \|\mathbf{v}\|}\right)$.
- **Challenges & Solutions:**
  - *Challenge:* Changing distances between person and camera altered absolute Euclidean measurements.
  - *Solution:* Strict torso-length scale normalization ($L_{\text{normalized}} = \frac{L_{\text{segment}}}{L_{\text{torso}}}$), making vectors invariant to camera distance.
- **Deliverables:** Verified 42-D static feature extraction module with torso normalization.

---

### 🔹 Week 7: 15-Dimensional Temporal Gait Feature Extraction
- **Objectives:**
  - Formulate dynamic spatio-temporal gait metrics over sequential frames (`services/feature_extraction/gait_features.py`).
- **Activities & Implementation:**
  - Developed sliding window buffer ($N = 30$ consecutive frames $\approx 1$ second of movement) capturing movement kinematics.
  - Extracted 15 dynamic gait metrics per frame:
    - Hip-knee angle angular velocities ($d\theta/dt$).
    - Ankle step stride distance and step frequency/cadence.
    - Vertical torso oscillations and center-of-mass trajectory displacement.
- **Challenges & Solutions:**
  - *Challenge:* Static standing postures generated noisy velocity values.
  - *Solution:* Added motion magnitude threshold filter to skip gait velocity accumulation during stationary poses.
- **Deliverables:** Spatio-temporal gait sequence feature extractor (`gait_features.py`).

---

### 🔹 Week 8: Biometric User Enrollment Pipeline & Data Collector
- **Objectives:**
  - Build automated CLI and backend enrollment service for registering new individuals (`scripts/enroll_user.py` / `/api/enroll/frame`).
- **Activities & Implementation:**
  - Programmed CLI script allowing caregivers to register a subject by name and capture a 60-second webcam stream (approx. 1800 valid skeletal frames).
  - Enforced continuous landmark visibility checks during enrollment (requiring at least 90% full-body visibility per frame).
  - Stored normalized feature matrices into MongoDB under the target user profile.
- **Challenges & Solutions:**
  - *Challenge:* Users moving out of camera view corrupted enrollment feature averages.
  - *Solution:* Implemented automated frame validation that pauses sampling when key joint landmarks (shoulders, hips, ankles) drop below visibility thresholds.
- **Deliverables:** Completed user enrollment pipeline script (`enroll_user.py`) and MongoDB batch writer.

---

## 📅 MONTH 3: Machine Learning Model Development & Ensemble Fusion

### 🔹 Week 9: Static Classifier Implementation (SVM with RBF Kernel)
- **Objectives:**
  - Train Support Vector Machine (SVM) classifier on 42-D static feature profiles (`services/identification/svm_classifier.py`).
- **Activities & Implementation:**
  - Configured `sklearn.svm.SVC` with Radial Basis Function (`C=10.0`, `gamma='scale'`, `probability=True`).
  - Applied `StandardScaler` to zero-mean and scale variance across static feature dimensions.
  - Computed class prediction probabilities using Platt scaling.
  - Performed 5-fold cross-validation during initial training experiments.
- **Challenges & Solutions:**
  - *Challenge:* Small sample size per enrolled user led to over-fitting on specific static postures.
  - *Solution:* Applied synthetic noise injection data augmentation ($\pm 2\%$ landmark Gaussian jitter) during feature dataset generation.
- **Deliverables:** Trained SVM model pipeline with standard scaling preprocessor (`svm_classifier.py`).

---

### 🔹 Week 10: Deep Gait Sequence Classifier (PyTorch BiLSTM)
- **Objectives:**
  - Build deep neural network sequence classifier using Bidirectional LSTM for gait dynamics (`services/identification/lstm_classifier.py`).
- **Activities & Implementation:**
  - Designed PyTorch model architecture:
    - **Input Layer:** $30 \times 8$ tensor (30 temporal frames, 8 key joint angular metrics).
    - **Hidden Layers:** 2-layer Bidirectional LSTM with `hidden_dim=64`, `dropout=0.3`.
    - **Output Layer:** Linear Layer $\rightarrow$ Softmax output for user identity classes.
  - Implemented Adam optimizer (`learning_rate=0.001`), Cross-Entropy Loss, and trained for 100 epochs.
- **Challenges & Solutions:**
  - *Challenge:* Sequence length variation when individuals walked at different speeds.
  - *Solution:* Standardized sliding window length to 30 frames with zero-padded sequences for shorter segments.
- **Deliverables:** Operational PyTorch BiLSTM Gait Classifier (`lstm_classifier.py`).

---

### 🔹 Week 11: Dynamic Ensemble Fusion Architecture
- **Objectives:**
  - Fuse SVM static predictions and BiLSTM dynamic gait predictions into a unified identification decision engine (`services/identification/ensemble.py`).
- **Activities & Implementation:**
  - Formulated weighted ensemble scoring model:
    $$\text{Score}_{\text{final}}(i) = w_{\text{svm}} \cdot P_{\text{svm}}(\text{User}_i) + w_{\text{lstm}} \cdot P_{\text{lstm}}(\text{User}_i)$$
    where $w_{\text{svm}} = 0.5$ and $w_{\text{lstm}} = 0.5$.
  - Integrated dynamic confidence thresholding (`CONFIDENCE_THRESHOLD = 0.65`). If maximum ensemble score is below $0.65$, identity is categorized as `"Unknown / Alert"`.
- **Challenges & Solutions:**
  - *Challenge:* Misclassifications occurred when a person stood stationary for long periods (biasing the BiLSTM classifier).
  - *Solution:* Implemented dynamic weight shifting: increased $w_{\text{svm}}$ to $0.8$ when movement velocity $< \epsilon$.
- **Deliverables:** Weighted Ensemble Fusion Engine (`ensemble.py`).

---

### 🔹 Week 12: Continuous Model Training & Model Serialization Pipeline
- **Objectives:**
  - Automate model training, evaluation, and artifact saving (`scratch_train.py`, `scripts/train_model.py`).
- **Activities & Implementation:**
  - Built training orchestrator script that pulls enrolled user profiles from MongoDB, performs train/test split (80/20 ratio), trains both SVM and BiLSTM models concurrently.
  - Serialized model weights: `.joblib` for SVM & Scaler, `.pt` for PyTorch BiLSTM model weights to `models/` directory.
  - Generated classification report (Precision, Recall, F1-Score, Confusion Matrix).
- **Challenges & Solutions:**
  - *Challenge:* Model file locking errors during background retraining while live inference service was active.
  - *Solution:* Implemented atomic file swap mechanism for loading updated model weights.
- **Deliverables:** Training script `scratch_train.py` and serialized model artifacts in `models/`.

---

## 📅 MONTH 4: Backend Microservice, WebSocket Gateway & React Dashboard

### 🔹 Week 13: FastAPI REST Service & API Gateway
- **Objectives:**
  - Construct central backend API router (`gateway/main.py` & `gateway/routes/`).
- **Activities & Implementation:**
  - Created REST API endpoints:
    - `GET /health`: Microservice health check.
    - `GET /api/users/`: Retrieve enrolled users list.
    - `POST /api/users/`: Create user record.
    - `DELETE /api/users/{id}`: Unenroll user.
    - `POST /api/identify`: Predict identity from uploaded feature vectors.
    - `POST /api/train`: Trigger background model re-training.
    - `GET /api/stats`: Fetch overall system monitoring metrics.
  - Added Swagger openapi documentation (`/docs`).
- **Challenges & Solutions:**
  - *Challenge:* Handling CORS issues during development requests from React Vite port 5175.
  - *Solution:* Configured `CORSMiddleware` in FastAPI with explicit origins list.
- **Deliverables:** Production-ready RESTful FastAPI application (`gateway/main.py`).

---

### 🔹 Week 14: WebSocket Real-Time Stream Engine
- **Objectives:**
  - Build high-speed WebSocket pipeline for live video inference streaming (`/ws/stream`).
- **Activities & Implementation:**
  - Implemented async WebSocket handler receiving base64 encoded video frames from client browsers.
  - Processed frame through MediaPipe, computed static/gait features, ran ensemble inference, and returned JSON payload containing:
    - Detected bounding boxes $[x_{\text{min}}, y_{\text{min}}, x_{\text{max}}, y_{\text{max}}]$.
    - 33 skeleton landmark coordinates $[x, y, \text{visibility}]$.
    - Predicted User Name & Confidence Score.
    - Alert flag for unauthorized/unknown persons.
- **Challenges & Solutions:**
  - *Challenge:* Base64 decoding overhead caused FPS drops over WebSocket connections.
  - *Solution:* Implemented frame skipping (process 1 out of every 2 frames for ML inference while maintaining smooth skeleton rendering).
- **Deliverables:** High-performance WebSocket live streaming router (`gateway/routes/stream.py`).

---

### 🔹 Week 15: React Frontend Dashboard & Canvas Overlay
- **Objectives:**
  - Develop modern interactive React UI dashboard (`frontend/src/pages/` and `components/`).
- **Activities & Implementation:**
  - Built **Live Feed Dashboard** (`FaceRecognitionPage.jsx` / `LiveFeed.jsx`) featuring HTML5 Canvas skeleton drawing overlay.
  - Rendered bone connection lines (green for recognized, red for unknown/unauthorized) connecting joint landmarks.
  - Created **Enrollment Page** (`EnrollPage.jsx`) displaying real-time frame capture progress bar, landmark quality indicator, and step-by-step user onboarding.
- **Challenges & Solutions:**
  - *Challenge:* HTML5 Canvas resolution mismatch with camera video stream aspect ratio.
  - *Solution:* Dynamically scaled canvas width/height according to input video track settings.
- **Deliverables:** Responsive React Frontend App with real-time skeleton overlay drawing.

---

### 🔹 Week 16: System Authentication & Security Integration
- **Objectives:**
  - Secure service endpoints by integrating JWT verification middleware with central Auth Service.
- **Activities & Implementation:**
  - Integrated `shared/backend/auth/token_validator.py` middleware into FastAPI app.
  - Protected sensitive endpoints (`/api/train`, `/api/users/delete`) requiring `Authorization: Bearer <token>`.
  - Added frontend Axios request interceptor injecting JWT tokens from `localStorage`.
- **Challenges & Solutions:**
  - *Challenge:* Token expiration causing silent WebSocket stream failures.
  - *Solution:* Implemented WebSocket handshake token validation and auto-reconnect logic on client UI.
- **Deliverables:** Secure JWT-authenticated microservice endpoints and HTTP/WS interceptors.

---

## 📅 MONTH 5: Automated PDF Incident Reporting, Optimization & Final Testing

### 🔹 Week 17: Biometric PDF Security Incident Reporting
- **Objectives:**
  - Implement automated PDF incident log export utility (`frontend/src/utils/reportGenerator.js`) using `jspdf`.
- **Activities & Implementation:**
  - Developed client-side document generator producing official security evidence reports when an unauthorized person is detected.
  - Included report details:
    - Incident ID, Timestamp, Location / Camera ID.
    - Captured snapshot image of detected skeleton & unknown individual.
    - Biometric confidence scores and anomaly indicators.
    - Audit log history and supervisor sign-off lines.
  - Added "Download Biometric Incident Report" button in Security Alerts UI panel.
- **Challenges & Solutions:**
  - *Challenge:* Rendering base64 canvas video frame directly into PDF document without stretching artifacts.
  - *Solution:* Utilized `jspdf` aspect-ratio scaling method `addImage()` with calculated bounding rectangle parameters.
- **Deliverables:** Client-side Biometric Evidence PDF Generator (`reportGenerator.js`).

---

### 🔹 Week 18: System Optimization & Threshold Sensitivity Tuning
- **Objectives:**
  - Fine-tune system hyperparameters and landmark confidence thresholds to eliminate false positives.
- **Activities & Implementation:**
  - Conducted grid-search experiments on `CONFIDENCE_THRESHOLD` ($0.50$ to $0.85$). Set optimal default to $0.65$.
  - Increased `min_enrollment_frames` from 300 to 1800 frames to ensure higher quality spatial feature distributions.
  - Reduced MediaPipe model processing complexity option under steady lighting conditions to boost processing speed to 32 FPS.
- **Challenges & Solutions:**
  - *Challenge:* Partial occlusions (e.g. subject behind furniture) triggered false "Unknown" security alerts.
  - *Solution:* Added keypoint visibility check ($> 70\%$ body joints must be visible before evaluating recognition confidence).
- **Deliverables:** Optimized configuration parameters in `config.py` and benchmark latency reports.

---

### 🔹 Week 19: Comprehensive System Field Testing & Evaluation
- **Objectives:**
  - Execute end-to-end multi-person testing scenarios to evaluate system robustness.
- **Activities & Implementation:**
  - Tested 10 subjects under 4 environmental scenarios:
    1. Direct front facing light vs backlighting.
    2. Occluded face (mask / looking down) with full skeleton visible.
    3. Normal walking pace vs slow elderly gait pace.
    4. Multiple subjects in single camera view.
  - Evaluated quantitative metrics:
    - **Identification Accuracy:** 94.2% on enrolled subjects.
    - **Face-Occluded Identification Rate:** 91.8% (outperforming standard face-recognition baseline of 34.5%).
    - **Average Inference Latency:** 28 ms per frame.
- **Challenges & Solutions:**
  - *Challenge:* Skeleton crossover when two subjects crossed paths in frame.
  - *Solution:* Applied Kalman filter tracking ID association per bounding box before feeding keypoints to model pipeline.
- **Deliverables:** Final Evaluation Report with Confusion Matrix and Latency Benchmarks.

---

### 🔹 Week 20: Final Documentation, Code Polish & Project Handover
- **Objectives:**
  - Finalize logbook, complete developer README, prepare user guide, and archive codebase artifacts.
- **Activities & Implementation:**
  - Verified all source code PEP-8 formatting and added comprehensive inline docstrings across all modules.
  - Updated main `README.md` with complete CLI setup steps, API endpoint tables, model architecture diagrams, and architecture overview.
  - Formatted final logbook entries and validated integration with the Gateway Dashboard module.
- **Challenges & Solutions:**
  - *Challenge:* Ensuring seamless startup across all backend and frontend services.
  - *Solution:* Created unified launcher script `run_all_services.py` for one-command startup of database connection checks, backend server, and frontend dev server.
- **Deliverables:** Fully documented, polished, end-to-end verified `skeleton-identification` microservice repository.

---

## 📊 Summary Matrix of 5-Month Milestones

| Month | Focus Area | Key Technical Deliverables | Status |
| :--- | :--- | :--- | :---: |
| **Month 1** | Requirement Analysis & Setup | Literature review, `config.py`, MongoDB Schema, OpenCV capture baseline | ✅ Completed |
| **Month 2** | Pose & Feature Extraction | MediaPipe integration, 42-D static features, 15-D gait features, `enroll_user.py` | ✅ Completed |
| **Month 3** | Machine Learning & Ensemble | SVM (RBF) Classifier, PyTorch BiLSTM Gait model, Weighted Ensemble Fusion | ✅ Completed |
| **Month 4** | Web Gateway & React UI | FastAPI REST APIs, WebSocket live feed, React Canvas skeleton overlay | ✅ Completed |
| **Month 5** | PDF Reporting & Optimization | `jspdf` incident reporting, latency tuning, 94.2% accuracy validation, docs | ✅ Completed |

---

### ✍️ Verification & Supervisor Approval

**Student Signature:** ___________________________  
**Date:** ____ / ____ / ________

**Supervisor Signature:** ________________________  
**Date:** ____ / ____ / ________  
**Comments:** ____________________________________________________________________________________________
