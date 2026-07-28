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
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export const detectAnomaly = (frameB64) => anomalyApi.post("/process", { live_frame: frameB64 });
export const getAnomalyHistory = () => anomalyApi.get("/history");
export const getModelStatus = () => anomalyApi.get("/model-status");

export default anomalyApi;
