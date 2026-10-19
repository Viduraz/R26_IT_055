// shared/frontend/components/ProtectedRoute.jsx
// Wraps routes requiring authentication.
// Redirects to VITE_AUTH_FRONTEND_URL/login if no token,
// falling back to relative /login for same-origin deployments.
import { Navigate } from "react-router-dom";

const AUTH_URL = import.meta.env.VITE_AUTH_FRONTEND_URL || "";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) {
    // If AUTH_URL is empty, Navigate resolves relative to current origin.
    // If set (e.g. https://auth.example.com), it redirects cross-domain via window.location.
    if (AUTH_URL) {
      window.location.replace(`${AUTH_URL}/login`);
      return null;
    }
    return <Navigate to="/login" replace />;
  }
  return children;
};

export default ProtectedRoute;
