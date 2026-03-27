# AI & Machine Learning Pipeline Details

The system heavily utilizes deep learning and computer vision to monitor the environment in real time without compromising privacy (processing is done locally before alerts are fired).

## 1. Face Verification Pipeline
**Folder:** `face-verification/backend/app/ml_services/`
- **Detection**: Uses **MTCNN** (Multi-task Cascaded Convolutional Networks) to find bounding boxes of faces in video frames.
- **Embedding**: Cropped faces are fed into **FaceNet** (PyTorch) to generate 512-dimensional embeddings.
- **Matching**: Cosine similarity is used to compare the live frame embedding against a pre-registered database of authorized embeddings. Threshold is typically set to `>0.7`.

## 2. Tracking & Geofencing Pipeline
**Folder:** `tracking-geofencing/backend/app/ml_services/`
- **Detection**: Uses **YOLOv8** (Ultralytics) trained for human detection.
- **Tracking**: Integrates ByteTrack or DeepSORT to assign unique IDs across sequential frames.
- **Geofencing**: Uses Ray-Casting (Point-in-Polygon) algorithms to check if a tracked centroid falls inside an administratively defined geometric zone.

## 3. Pose-Based Anomaly Detection Pipeline
**Folder:** `anomaly-detection/backend/app/ml_services/`
- **Keypoint Extraction**: Uses **MediaPipe Pose** to extract 33 skeletal keypoints from the subjects.
- **Sequential Context**: Normalizes keypoints and passes them into an **LSTM** over a rolling window (e.g., 30 frames) to capture movement dynamics.
- **Reconstruction**: An **Autoencoder** attempts to reconstruct the pose sequence. High reconstruction error indicates an anomaly (e.g., falling or collapsing).

## 4. Hardware and Performance Notes
- Pipelines are designed to leverage CUDA via PyTorch and ONNX Runtime if NVIDIA GPUs are present.
- In CPU-only environments, models may require quantization or smaller input sizes for real-time inference.
- API requests passing base64 images should ideally be compressed to minimize HTTP overhead. Moving to WebSockets is recommended for actual continuous video streams.
