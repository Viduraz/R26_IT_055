// anomaly-detection/frontend/src/services/anomalyApi.js
import axios from "axios";

const anomalyApi = axios.create({
  baseURL: import.meta.env.VITE_ANOMALY_BACKEND_URL || "http://localhost:8003/api/anomaly",
  headers: { "Content-Type": "application/json" },
});

anomalyApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  return config;
});

anomalyApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("access_token");
      window.location.href = `${window.location.origin}/auth/login`;
    }
    return Promise.reject(error);
  }
);

// ── Core inference ─────────────────────────────────────────────────────────────
export const detectAnomaly = (frameB64) => anomalyApi.post("/process", { live_frame: frameB64 });

// ── History & logs ─────────────────────────────────────────────────────────────
export const getAnomalyHistory = () => anomalyApi.get("/history");
export const getSessionLogs = () => anomalyApi.get("/session-logs");

// ── Model & metrics ────────────────────────────────────────────────────────────
export const getModelStatus = () => anomalyApi.get("/model-status");
export const getMetrics = () => anomalyApi.get("/metrics");
export const getHealth = () => anomalyApi.get("/health");

// ── Session management ─────────────────────────────────────────────────────────
export const resetSession = () => anomalyApi.post("/reset-session");

// ── Simulation (demo scenarios) ────────────────────────────────────────────────
export const simulateFall = (personId = "demo_patient") => anomalyApi.post("/simulate/fall", null, { params: { person_id: personId } });
export const simulateAggression = (personId = "demo_patient") => anomalyApi.post("/simulate/aggression", null, { params: { person_id: personId } });
export const simulateInactivity = (personId = "demo_patient") => anomalyApi.post("/simulate/inactivity", null, { params: { person_id: personId } });
export const simulateNormal = (personId = "demo_patient") => anomalyApi.post("/simulate/normal", null, { params: { person_id: personId } });

// ── Camera ─────────────────────────────────────────────────────────────────────
export const getCameraSnapshot = () => anomalyApi.get("/camera-snapshot");
export const probCamera = () => anomalyApi.get("/camera-probe");

export default anomalyApi;
