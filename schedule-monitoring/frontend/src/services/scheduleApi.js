// schedule-monitoring/frontend/src/services/scheduleApi.js
import axios from "axios";

const scheduleApi = axios.create({
  baseURL: import.meta.env.VITE_SCHEDULE_BACKEND_URL || "http://localhost:8004/api/schedule",
  headers: { "Content-Type": "application/json" },
});

scheduleApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  return config;
});

export const getSchedule = () => scheduleApi.get("/");
export const getReports = () => scheduleApi.get("/reports");
export const getDeviations = () => scheduleApi.get("/deviations");

export default scheduleApi;
