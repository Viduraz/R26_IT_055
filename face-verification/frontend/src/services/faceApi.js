// face-verification/frontend/src/services/faceApi.js
import axios from "axios";

const faceApi = axios.create({
  baseURL: import.meta.env.VITE_FACE_BACKEND_URL || "http://localhost:8001/api/face",
  headers: { "Content-Type": "application/json" },
});

faceApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  return config;
});

export const verifyFace = (frameB64) => faceApi.post("/verify", { frame_b64: frameB64 });
export const getFaceLogs = () => faceApi.get("/logs");
export const getAuthorizedPersons = () => faceApi.get("/authorized");

export default faceApi;
