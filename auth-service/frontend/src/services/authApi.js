// auth-service/frontend/src/services/authApi.js
import axios from "axios";

const AUTH_BASE = import.meta.env.VITE_AUTH_BACKEND_URL || "http://localhost:8000/api/auth";

export const loginUser = async (email, password) => {
  const res = await axios.post(`${AUTH_BASE}/login`, { email, password });
  return res.data;
};

export const registerUser = async (name, email, password, role = "family") => {
  const res = await axios.post(`${AUTH_BASE}/register`, { name, email, password, role });
  return res.data;
};

export const getProfile = async (token) => {
  const res = await axios.get(`${AUTH_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
};
