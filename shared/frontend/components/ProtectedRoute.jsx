// shared/frontend/components/ProtectedRoute.jsx
// Wraps routes that require authentication. Redirects to /login if no token.
import { Navigate } from "react-router-dom";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export default ProtectedRoute;
