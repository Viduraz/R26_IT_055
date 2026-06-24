import axios from "axios";

// Since Vite proxies /api to http://localhost:8006, we can use relative paths
const api = axios.create({
  baseURL: "/api/marketplace",
  headers: {
    "Content-Type": "application/json",
  },
});

// Interceptor to add access token to headers
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor to handle expired tokens
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("access_token");
      const isProxied = window.location.port === "8080" || window.location.port === "";
      const authUrl = import.meta.env.VITE_AUTH_FRONTEND_URL || "http://localhost:5173";
      const loginUrl = isProxied
        ? "/auth/login"
        : (authUrl.endsWith("/auth") ? `${authUrl}/login` : `${authUrl}/auth/login`);
      window.location.href = loginUrl;
    }
    return Promise.reject(error);
  }
);



export default api;
