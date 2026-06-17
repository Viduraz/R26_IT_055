// gateway-dashboard/frontend/src/services/gatewayApi.js
import axios from "axios";

const gatewayApi = axios.create({
  baseURL: import.meta.env.VITE_GATEWAY_BACKEND_URL || "http://localhost:8005/api/gateway",
  headers: { "Content-Type": "application/json" },
});

gatewayApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  return config;
});

gatewayApi.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("access_token");
      window.location.href = `${import.meta.env.VITE_AUTH_FRONTEND_URL || "http://localhost:5173"}/login`;
    }
    return Promise.reject(err);
  }
);

export default gatewayApi;
