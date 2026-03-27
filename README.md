# 🛡️ Secure Elder Care

An **AI-powered elder care monitoring platform** built as a production-ready monorepo. The system continuously monitors elderly individuals using computer vision, anomaly detection, geofencing, and activity tracking — all unified through a central gateway dashboard.

---

## 📋 System Overview

Secure Elder Care integrates six independent microservices:

| Service | Role |
|---|---|
| **Auth Service** | Handles JWT-based signup/login |
| **Face Verification** | MTCNN + FaceNet real-time face recognition |
| **Tracking & Geofencing** | YOLOv8 + ByteTrack person tracking with zone alerts |
| **Anomaly Detection** | MediaPipe + LSTM/Autoencoder pose-based fall/anomaly detection |
| **Schedule Monitoring** | Activity classification and routine deviation detection |
| **Gateway Dashboard** | Central aggregator dashboard for all modules |

---

## 🏗️ Architecture Summary

```
Browser/Client
     │
     ▼
Gateway Dashboard (Port 8005 / 5178)
     │
     ├── Auth Service      (Port 8000 / 5173)
     ├── Face Verification (Port 8001 / 5174)
     ├── Tracking          (Port 8002 / 5175)
     ├── Anomaly Detection (Port 8003 / 5176)
     └── Schedule Monitor  (Port 8004 / 5177)
                │
                ▼
         MongoDB Atlas (shared DB)
```

Each module is a **self-contained FastAPI backend + React+Vite frontend**. They share a single MongoDB cluster and JWT auth system.

---

## 📁 Folder Structure

```
secure-elder-care/
├── .env                      # Shared environment variables
├── .gitignore
├── README.md
├── docker-compose.yml
├── shared/                   # Reusable backend + frontend utilities
│   ├── backend/
│   │   ├── config/           # settings.py, database.py
│   │   ├── auth/             # jwt_handler.py, token_validator.py
│   │   ├── models/
│   │   ├── schemas/
│   │   └── utils/
│   └── frontend/
│       ├── components/       # ProtectedRoute.jsx
│       ├── hooks/            # useAuth.js
│       ├── services/         # api.js (axios instance)
│       └── utils/
├── auth-service/
├── face-verification/
├── tracking-geofencing/
├── anomaly-detection/
├── schedule-monitoring/
├── gateway-dashboard/
└── docs/
```

---

## ✅ Prerequisites

- Python 3.10+
- Node.js 18+ and npm 9+
- MongoDB Atlas account (or local MongoDB 6+)
- Git

---

## ⚙️ Environment Setup

1. Copy the root `.env` (already pre-filled):

```bash
# Edit .env and set your JWT_SECRET_KEY
JWT_SECRET_KEY=your_super_secret_key_change_this
```

2. The `MONGODB_URI` is already configured for the project cluster.

---

## 🐍 Install Backend Dependencies

Each backend has its own `requirements.txt`. Install per module:

```bash
# Example: auth-service
cd auth-service/backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

Repeat for each module: `face-verification/backend`, `tracking-geofencing/backend`, `anomaly-detection/backend`, `schedule-monitoring/backend`, `gateway-dashboard/backend`.

---

## ⚛️ Install Frontend Dependencies

```bash
# Example: auth-service
cd auth-service/frontend
npm install
```

Repeat for each module's `frontend/` folder.

---

## 🚀 Running the Backends

```bash
# Terminal 1 — Auth Service (port 8000)
cd auth-service/backend && python run.py

# Terminal 2 — Face Verification (port 8001)
cd face-verification/backend && python run.py

# Terminal 3 — Tracking & Geofencing (port 8002)
cd tracking-geofencing/backend && python run.py

# Terminal 4 — Anomaly Detection (port 8003)
cd anomaly-detection/backend && python run.py

# Terminal 5 — Schedule Monitoring (port 8004)
cd schedule-monitoring/backend && python run.py

# Terminal 6 — Gateway Dashboard (port 8005)
cd gateway-dashboard/backend && python run.py
```

---

## 🌐 Running the Frontends

```bash
# Terminal 7 — Auth Frontend (port 5173)
cd auth-service/frontend && npm run dev

# Terminal 8 — Face Frontend (port 5174)
cd face-verification/frontend && npm run dev

# Terminal 9 — Tracking Frontend (port 5175)
cd tracking-geofencing/frontend && npm run dev

# Terminal 10 — Anomaly Frontend (port 5176)
cd anomaly-detection/frontend && npm run dev

# Terminal 11 — Schedule Frontend (port 5177)
cd schedule-monitoring/frontend && npm run dev

# Terminal 12 — Gateway Frontend (port 5178) ← main entry point
cd gateway-dashboard/frontend && npm run dev
```

---

## 🔐 How JWT Authentication Works

1. User signs up/logs in via **Auth Service** (`POST /api/auth/login`)
2. Auth Service returns a **JWT access token**
3. Frontend stores the token in `localStorage` as `access_token`
4. All subsequent API calls include the header:
   ```
   Authorization: Bearer <token>
   ```
5. Each protected backend's `middleware/verify_token.py` validates the token using the shared `JWT_SECRET_KEY`.

---

## 🔗 How Modules Communicate

- All frontends call their **own backend** via Axios (`src/services/<module>Api.js`)
- The **Gateway Dashboard backend** aggregates data from all other backends using `httpx` async HTTP calls
- All modules share the **same MongoDB Atlas cluster** (`secure_elder_care` database)
- JWT is issued by Auth Service and validated independently by each backend using the shared secret

---

## 🗂️ Default Ports

| Service | Backend | Frontend |
|---|---|---|
| Auth Service | 8000 | 5173 |
| Face Verification | 8001 | 5174 |
| Tracking & Geofencing | 8002 | 5175 |
| Anomaly Detection | 8003 | 5176 |
| Schedule Monitoring | 8004 | 5177 |
| Gateway Dashboard | 8005 | 5178 |

---

## 🔄 Sample Development Workflow

```bash
# 1. Start MongoDB (Atlas connection is pre-configured in .env)
# 2. Start all backends (6 terminals)
# 3. Start all frontends (6 terminals)
# 4. Open http://localhost:5173 to register/login
# 5. Open http://localhost:5178 for the central gateway dashboard
```

---

## 🐳 Docker (Optional)

```bash
docker-compose up --build
```

All services and frontends are defined in `docker-compose.yml`.

---

## 🔮 Future Improvements

- [ ] WebSocket-based real-time alerts across all modules
- [ ] Centralized notification service (SMS/email via Twilio/SendGrid)
- [ ] Mobile app (React Native) consuming the same APIs
- [ ] Model retraining pipeline with MLflow
- [ ] Kubernetes deployment manifests
- [ ] Role-based access control (Admin / Caregiver / Family)
- [ ] Edge deployment with ONNX-optimized models
- [ ] Audit logging and GDPR compliance module

---

## 👥 Authors

Developed as a Final Year University Project — *Secure Elder Care AI Monitoring System*.

---

## 📄 License

MIT License — for academic and educational use.
