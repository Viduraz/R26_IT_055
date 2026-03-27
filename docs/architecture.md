# Architecture Overview

## Monorepo Structure
The **Secure Elder Care** platform follows a microservices architecture hosted in a monorepo. It consists of 6 independent modules (each containing a backend and a frontend) and shared utilities.

### Core Modules
1. **Auth Service**: Issues JWT access tokens. Handles user registration and login.
2. **Face Verification**: ML service using MTCNN & FaceNet to identify authorized personnel and elders.
3. **Tracking & Geofencing**: ML service using YOLOv8 & ByteTrack to monitor locations and send zone-breach alerts.
4. **Anomaly Detection**: ML service using MediaPipe, LSTMs, and Autoencoders to detect falls, prolonged stillness, or unusual behavior patterns.
5. **Schedule Monitoring**: Rule-based engine comparing actual detected behavior against expected daily routines (e.g., missed medication, skipped meals).
6. **Gateway Dashboard**: Aggregates alerts, service health, and feeds from the other modules into a unified UI.

## Tech Stack
- **Backend**: Python 3.10+, FastAPI, Uvicorn, PyMongo, PyJWT.
- **Frontend**: React 18, Vite, Tailwind CSS, Axios, React Router.
- **Database**: MongoDB (Shared replica set/cluster).
- **AI/ML**: PyTorch, OpenCV, MediaPipe, Ultralytics YOLOv8, facenet-pytorch.
- **Infrastructure**: Docker Compose for local orchestration.

## Data Flow
- All frontend calls (except `/login` and `/signup`) must include a `Bearer <token>` in the `Authorization` header.
- Backends validate the token against `JWT_SECRET_KEY` using shared middleware (`shared/backend/auth/token_validator.py`).
- Data is stored in isolated collections per module under a single MongoDB cluster.
- The `gateway-dashboard` service pulls telemetry and alerts via internal HTTP requests to other microservices.
