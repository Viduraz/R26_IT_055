// schedule-monitoring/frontend/src/services/scheduleApi.js
import axios from "axios";

const BASE = import.meta.env.VITE_SCHEDULE_BACKEND_URL || "http://localhost:8004";

const api = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
});

// Attach token if present (no-op when auth is bypassed)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  return config;
});

// ========== Schedule Management ==========
export const getSchedule = () => scheduleApi.get("/");
export const createSchedule = (activities, description = "") =>
  scheduleApi.post("/", { activities, description });
export const deleteSchedule = (scheduleId) => scheduleApi.delete(`/${scheduleId}`);

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

// ── Schedule CRUD ─────────────────────────────────────────────────────────
export const getAllSchedules       = ()             => api.get("/api/schedule/");
export const getSchedulesByPatient = (patientId)   => api.get(`/api/schedule/patient/${patientId}`);
export const createSchedule        = (data)        => api.post("/api/schedule/", data);
export const updateSchedule        = (id, data)    => api.put(`/api/schedule/${id}`, data);
export const deleteSchedule        = (id)          => api.delete(`/api/schedule/${id}`);

// ── Monitoring ────────────────────────────────────────────────────────────
export const sendDetectionEvent    = (event)       => api.post("/api/monitoring/detection-event", event);
export const getTodayStatus        = (patientId)   => api.get(`/api/monitoring/today/${patientId}`);
export const getActivityLogs       = (patientId)   => api.get(`/api/monitoring/logs/${patientId}`);

// ── Notifications ─────────────────────────────────────────────────────────
export const getNotifications      = (patientId)   => api.get(`/api/monitoring/notifications/${patientId}`);
export const markNotificationRead  = (notifId)     => api.put(`/api/monitoring/notifications/${notifId}/read`);
export const markAllNotificationsRead = (patientId)=> api.put(`/api/monitoring/notifications/${patientId}/read-all`);
export const triggerMissedEval     = (patientId)   => api.post(`/api/monitoring/evaluate-missed/${patientId}`);

// ── Legacy ────────────────────────────────────────────────────────────────
export const getSchedule           = ()            => api.get("/api/schedule/");
export const getReports            = ()            => api.get("/api/schedule/reports");
export const getDeviations         = ()            => api.get("/api/schedule/deviations");


export default api;
