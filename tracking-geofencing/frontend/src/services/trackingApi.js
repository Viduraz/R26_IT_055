// tracking-geofencing/frontend/src/services/trackingApi.js
import axios from "axios";

const trackingApi = axios.create({
  baseURL: import.meta.env.VITE_TRACKING_BACKEND_URL || "http://localhost:8002/api/tracking",
  headers: { "Content-Type": "application/json" },
});

trackingApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  return config;
});

export const getZones = () => trackingApi.get("/zones");
export const createZone = (zone) => trackingApi.post("/zones", zone);
export const getHistory = () => trackingApi.get("/history");

export default trackingApi;
