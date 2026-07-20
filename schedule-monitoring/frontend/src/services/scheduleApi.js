import axios from "axios";

const BASE = import.meta.env.VITE_SCHEDULE_BACKEND_URL || "http://localhost:8004";
const DEFAULT_PATIENT_ID = "patient_001";

const api = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const normalizeSchedulePayload = (activitiesOrData, description = "") => {
  if (Array.isArray(activitiesOrData)) {
    return { activities: activitiesOrData, description };
  }
  if (activitiesOrData && typeof activitiesOrData === "object") {
    return activitiesOrData;
  }
  return { activities: [], description };
};

const normalizeUnreadQuery = (value) => {
  if (typeof value === "boolean") {
    return `?unread_only=${value}`;
  }
  return "";
};

export const getSchedule = () => api.get("/api/schedule/");
export const getAllSchedules = () => api.get("/api/schedule/");
export const getSchedulesByPatient = (patientId) => api.get(`/api/schedule/patient/${patientId}`);
export const createSchedule = (activitiesOrData, description = "") =>
  api.post("/api/schedule/", normalizeSchedulePayload(activitiesOrData, description));
export const updateSchedule = (id, data) => api.put(`/api/schedule/${id}`, data);
export const deleteSchedule = (id) => api.delete(`/api/schedule/${id}`);

export const getTodayStatus = (patientId = DEFAULT_PATIENT_ID) =>
  api.get(`/api/monitoring/today/${patientId}`);

export const sendDetectionEvent = (event) =>
  api.post("/api/monitoring/detection-event", event);

// FIX: was posting to `/api/monitoring/logs/${scheduleId}/detect` — a URL
// that doesn't exist in the backend at all (it mixed the "/api/monitoring/"
// prefix with the "/logs/{id}/detect" path style from a different router).
// Every call silently 404'd, meaning every webcam detection was being
// dropped before it ever reached MonitoringService, regardless of any
// threshold tuning in activityDetection.js.
//
// Corrected to the real route in schedule_routes.py, which now (after the
// vocabulary-mismatch fix) correctly delegates to
// MonitoringService.process_detection_event() under the hood.
export const logDetectedActivity = (scheduleId, activity) =>
  api.post(`/api/schedule/logs/${scheduleId}/detect`, activity);

export const triggerMissedEval = (patientId = DEFAULT_PATIENT_ID) =>
  api.post(`/api/monitoring/evaluate-missed/${patientId}`);
export const getActivityLogs = (patientId = DEFAULT_PATIENT_ID) =>
  api.get(`/api/monitoring/logs/${patientId}`);
export const getNotifications = (arg = DEFAULT_PATIENT_ID) => {
  if (typeof arg === "boolean") {
    return api.get(`/api/monitoring/notifications${normalizeUnreadQuery(arg)}`);
  }
  return api.get(`/api/monitoring/notifications/${arg}`);
};
export const markNotificationRead = (notificationId) =>
  api.put(`/api/monitoring/notifications/${notificationId}/read`);
export const markAllNotificationsRead = (patientId = DEFAULT_PATIENT_ID) =>
  api.put(`/api/monitoring/notifications/${patientId}/read-all`);
export const getReports = () => api.get("/api/schedule/reports");
export const getDeviations = () => api.get("/api/schedule/deviations");

export default api;