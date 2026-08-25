import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:8002",
  timeout: 10000,
});

// Request interceptor: attach JWT
API.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401 and 404
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      if (error.response.status === 401) {
        // Auth disabled for now — just log it, don't redirect
        console.warn("401 Unauthorized — auth is disabled for development");
        return Promise.reject(error);
      }
      if (error.response.status === 404) {
        return Promise.resolve({ data: null });
      }
    }
    return Promise.reject(error);
  }
);

// Health check (no auth needed)
export async function checkBackendHealth() {
  try {
    const res = await axios.get("http://localhost:8002/health", { timeout: 5000 });
    return res.data && res.data.status === "ok";
  } catch {
    return false;
  }
}

// Tracking API
export const trackingApi = {
  processFrame: (frameBase64, trackerType = "bytetrack") =>
    API.post("/api/tracking/process-frame", { frame: frameBase64, tracker_type: trackerType }),
  getHistory: (page = 1, pageSize = 50) =>
    API.get("/api/tracking/history", { params: { page, page_size: pageSize } }),
  getActive: () => API.get("/api/tracking/active"),
  getStats: () => API.get("/api/tracking/stats"),
  identifyPerson: (frameBase64) =>
    API.post("/api/tracking/identify-person", { frame_data: frameBase64 }),
  getExitAlerts: () => API.get("/api/tracking/exit-alerts"),
};

// Geofence API
export const geofenceApi = {
  createZone: (data) => API.post("/api/geofence/zones", data),
  getZones: () => API.get("/api/geofence/zones"),
  getZone: (zoneId) => API.get(`/api/geofence/zones/${zoneId}`),
  updateZone: (zoneId, data) => API.put(`/api/geofence/zones/${zoneId}`, data),
  deleteZone: (zoneId) => API.delete(`/api/geofence/zones/${zoneId}`),
  checkBreach: (data) => API.post("/api/geofence/check-breach", data),
  getAlerts: (resolved, since) => {
    const params = {};
    if (resolved !== undefined && resolved !== null) params.resolved = resolved;
    if (since) params.since = since;
    return API.get("/api/geofence/alerts", { params });
  },
  resolveAlert: (alertId) => API.put(`/api/geofence/alerts/${alertId}/resolve`),
  clearAlerts: () => API.delete("/api/geofence/alerts"),
  pushMobileGps: (lat, lng, accuracy, sessionId) =>
    API.post("/api/geofence/mobile-gps", { lat, lng, accuracy, session_id: sessionId }),
  getMobileGps: () => API.get("/api/geofence/mobile-gps"),
};

export default API;
