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

// ========== Schedule Management ==========
export const getSchedule = () => scheduleApi.get("/");
export const createSchedule = (activities, description = "") => 
  scheduleApi.post("/", { activities, description });

// ========== Activity Logs ==========
export const getActivityLogs = () => scheduleApi.get("/logs");
export const logDetectedActivity = (scheduleId, activity) =>
  scheduleApi.post(`/logs/${scheduleId}/detect`, activity);

// ========== Activity Validation (NEW - Phase 1) ==========
// Validates activity with adaptive thresholds and returns status info
export const validateActivityWithAdaptive = (scheduleId, activity) =>
  scheduleApi.post(`/logs/${scheduleId}/validate`, activity);

// ========== Notifications ==========
export const getNotifications = (unreadOnly = false) =>
  scheduleApi.get(`/notifications?unread_only=${unreadOnly}`);
export const markNotificationRead = (notificationId) =>
  scheduleApi.post(`/notifications/${notificationId}/read`);

// ========== Reports & Deviations ==========
export const getReports = () => scheduleApi.get("/reports");
export const getDeviations = () => scheduleApi.get("/deviations");

export default scheduleApi;
