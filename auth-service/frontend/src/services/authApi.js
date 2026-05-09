// auth-service/frontend/src/services/authApi.js
import axios from "axios";

const AUTH_BASE = import.meta.env.VITE_AUTH_BACKEND_URL || "http://localhost:8000/api/auth";

export const loginUser = async (email, password) => {
  const res = await axios.post(`${AUTH_BASE}/login`, { email, password });
  return res.data;
};

export const loginWithFace = async (email, password, liveFaceSample, liveSkeletonSample) => {
  const res = await axios.post(`${AUTH_BASE}/caregiver/verify-face-login`, {
    email,
    password,
    live_face_sample: liveFaceSample,
    live_skeleton_sample: liveSkeletonSample,
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
