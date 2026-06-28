# 🛡️ Secure Elder Care — Project Context

## 📋 Project Overview
Secure Elder Care is an AI-powered elder care monitoring platform built as a production-ready monorepo. It integrates multiple microservices to provide real-time monitoring of elderly individuals using computer vision and machine learning.

### Key Technologies
- **Backend:** Python 3.10+, FastAPI, Uvicorn, MongoDB (Motor/Pymongo), JWT.
- **Frontend:** React 18 (Vite), Tailwind CSS, Axios, Lucide React.
- **Machine Learning:** YOLOv8 (Tracking), MediaPipe (Pose/Anomaly), MTCNN + FaceNet (Face Recognition).
- **Infrastructure:** Docker Compose.

### Architecture
The project follows a microservices architecture with 6 primary modules, each having its own backend and frontend:
1.  **Auth Service:** (Port 8000/5173) Identity provider using JWT.
2.  **Face Verification:** (Port 8001/5174) Real-time face recognition.
3.  **Tracking & Geofencing:** (Port 8002/5175) Person tracking and zone alerts.
4.  **Anomaly Detection:** (Port 8003/5176) Pose-based fall and anomaly detection.
5.  **Schedule Monitoring:** (Port 8004/5177) Activity and routine deviation detection.
6.  **Gateway Dashboard:** (Port 8005/5178) Central aggregator and analytics dashboard.

Shared utilities are located in the `shared/` directory at the root level.

## ⚙️ Building and Running

### Prerequisites
- Python 3.10+
- Node.js 18+ & npm 9+
- MongoDB Atlas account (configured in `.env`)

### Setup
1.  **Environment:** Ensure `.env` is present in the root directory.
2.  **Shared Module:** Backends require the project root to be in `PYTHONPATH` to import from `shared/`. The `run.py` script in each backend handles this automatically.

### Running Services (Manual)
For each service module (e.g., `auth-service`):
- **Backend:**
    ```bash
    cd <module>/backend
    python -m venv venv
    # Activate venv
    pip install -r requirements.txt
    python run.py
    ```
- **Frontend:**
    ```bash
    cd <module>/frontend
    npm install
    npm run dev
    ```

### Running with Docker
```bash
docker-compose up --build
```

## 🛠️ Development Conventions

### Code Structure
Each microservice follows a consistent layout:
- `backend/app/`: Controllers, Routes, Models, Schemas, and Services.
- `backend/app/ml_services/`: (Optional) Machine Learning inference logic and model files.
- `frontend/src/`: Pages, Components, and Services (API clients).

### Shared Utilities
- **Backend:** `shared/backend/auth` for JWT, `shared/backend/config` for global settings.
- **Frontend:** `shared/frontend/components` for common UI (e.g., `ProtectedRoute`), `shared/frontend/services` for base API configurations.

### Authentication
- Authentication is handled via JWT.
- Tokens are issued by the **Auth Service** and stored in `localStorage` as `access_token`.
- All protected endpoints require an `Authorization: Bearer <token>` header.
- The `shared/backend/auth/token_validator.py` (referenced by `middleware/verify_token.py` in services) validates tokens using the shared `JWT_SECRET_KEY`.

### API Communication
- Frontends communicate with their respective backends.
- The **Gateway Dashboard** backend aggregates data from other services using `httpx` for asynchronous internal API calls.

### Naming Conventions
- **Python:** PEP 8 (snake_case for functions/variables, PascalCase for classes).
- **JavaScript/React:** camelCase for variables/functions, PascalCase for components.
- **API Routes:** `/api/<resource>` pattern.
