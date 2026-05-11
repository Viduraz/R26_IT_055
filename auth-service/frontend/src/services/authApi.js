// auth-service/frontend/src/services/authApi.js
import axios from "axios";

const AUTH_BASE = import.meta.env.VITE_AUTH_BACKEND_URL || "http://localhost:8000/api/auth";

export const loginUser = async (email, password) => {
  const res = await axios.post(`${AUTH_BASE}/login`, { email, password });
  return res.data;
};

export const loginWithFace = async (email, password, liveFaceSample) => {
  const res = await axios.post(`${AUTH_BASE}/caregiver/verify-face-login`, {
    email,
    password,
    live_face_sample: liveFaceSample,
  });
  return res.data;
};

export const registerUser = async (payload) => {
  const res = await axios.post(`${AUTH_BASE}/register`, payload);
  return res.data;
};

export const getProfile = async (token) => {
  const res = await axios.get(`${AUTH_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
};

/**
 * Fetch the latest IP camera frame from the auth-service backend.
 * Returns { frame: "data:image/jpeg;base64,..." }
 * The auth-service uses a persistent RTSP thread so this resolves in ~1–5 ms.
 */
export const getCameraSnapshot = async () => {
  const res = await axios.get(`${AUTH_BASE}/camera-snapshot`, { timeout: 10000 });
  return res.data; // { frame: "data:image/jpeg;base64,..." }
};

