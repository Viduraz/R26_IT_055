# Setup Guide

## Prerequisites
- Python 3.10+
- Node.js 18+
- Docker & Docker Compose
- A local or remote MongoDB URI.

## Global Environment
1. In the `C:\Secure-Eldercare-Project\` root directory, copy `.env.example` to `.env` (if applicable) or ensure `.env` has valid values for:
   - `MONGO_URI` (e.g., `mongodb://localhost:27017/eldercare`)
   - `JWT_SECRET_KEY`

## Option A: Docker Compose (Recommended)
You can build and start all 12 services (6 frontends, 6 backends) using Docker Compose:
```bash
docker-compose up --build
```

## Option B: Local Python/Node Execution

If you prefer testing modules individually to save memory:

### 1. Start the Backend
Navigate to the module backend directory:
```bash
cd auth-service/backend
pip install -r requirements.txt
python run.py
```
*(Repeat for other modules inside their respective `backend` folders).*

### 2. Start the Frontend
Navigate to the module frontend directory:
```bash
cd auth-service/frontend
npm install
npm run dev
```
*(Repeat for other modules inside their respective `frontend` folders).*

### Module Ports Memory Refresher
- **Auth**: BE: 8000 | FE: 5173
- **Face**: BE: 8001 | FE: 5174
- **Tracking**: BE: 8002 | FE: 5175
- **Anomaly**: BE: 8003 | FE: 5176
- **Schedule**: BE: 8004 | FE: 5177
- **Gateway**: BE: 8005 | FE: 5178
