// gateway-dashboard/frontend/src/services/dashboardApi.js
import axios from "axios";

const DASHBOARD_BASE = import.meta.env.VITE_DASHBOARD_BACKEND_URL
  || (import.meta.env.VITE_GATEWAY_BACKEND_URL?.replace("/api/gateway", "/api/dashboard"))
  || "http://localhost:8005/api/dashboard";

export const getAdminSummary = async (token) => {
  const res = await axios.get(`${DASHBOARD_BASE}/admin/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
};

export const getCaregiverProfile = async (token) => {
  const res = await axios.get(`${DASHBOARD_BASE}/caregiver/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
};

export const getFamilyAlerts = async (token) => {
  const res = await axios.get(`${DASHBOARD_BASE}/family/alerts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
};
