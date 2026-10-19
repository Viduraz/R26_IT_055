// gateway-dashboard/frontend/src/services/dashboardApi.js
import axios from "axios";

const DASHBOARD_BASE = import.meta.env.VITE_DASHBOARD_BACKEND_URL
  || (import.meta.env.VITE_GATEWAY_BACKEND_URL?.replace("/api/gateway", "/api/dashboard"))
  || "http://localhost:8005/api/dashboard";

const authHeader = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

export const getAdminSummary = async (token) => {
  const res = await axios.get(`${DASHBOARD_BASE}/admin/summary`, authHeader(token));
  return res.data;
};

export const getCaregiverProfile = async (token) => {
  const res = await axios.get(`${DASHBOARD_BASE}/caregiver/profile`, authHeader(token));
  return res.data;
};

export const getFamilyAlerts = async (token) => {
  const res = await axios.get(`${DASHBOARD_BASE}/family/alerts`, authHeader(token));
  return res.data;
};

export const getCaregiverStatusGlobal = async (token) => {
  const res = await axios.get(`${DASHBOARD_BASE}/caregiver-status`, authHeader(token));
  return res.data;
};

export const getGlobalAlerts = async (token) => {
  const res = await axios.get(`${DASHBOARD_BASE}/alerts`, authHeader(token));
  return res.data;
};

export const getAllUsers = async (token) => {
  const res = await axios.get(`${DASHBOARD_BASE}/admin/users`, authHeader(token));
  return res.data;
};

export const updateUserStatus = async (token, userId, status) => {
  const res = await axios.patch(
    `${DASHBOARD_BASE}/admin/users/${userId}/status`,
    { status },
    authHeader(token)
  );
  return res.data;
};

export const deleteUser = async (token, userId) => {
  const res = await axios.delete(
    `${DASHBOARD_BASE}/admin/users/${userId}`,
    authHeader(token)
  );
  return res.data;
};

