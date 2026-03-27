// gateway-dashboard/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AdminDashboard from "./pages/AdminDashboard";
import CaregiverDashboard from "./pages/CaregiverDashboard";
import FamilyDashboard from "./pages/FamilyDashboard";
import { parseJwt } from "../../../shared/frontend/utils/helpers";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) {
    window.location.href = `http://localhost:5173/login`;
    return null;
  }
  return children;
};

const AuthCallback = () => {
  const token = new URLSearchParams(window.location.search).get("token");
  if (token) {
    localStorage.setItem("access_token", token);
    return <Navigate to="/" replace />;
  }
  window.location.href = `http://localhost:5173/login`;
  return null;
};

const RoleBasedRouter = () => {
  const token = localStorage.getItem("access_token");
  if (!token) {
    window.location.href = `http://localhost:5173/login`;
    return null;
  }
  
  const payload = parseJwt(token);
  if (!payload) {
    window.location.href = `http://localhost:5173/login`;
    return null;
  }

  if (payload.role === "admin") return <AdminDashboard />;
  if (payload.role === "caregiver") return <CaregiverDashboard />;
  
  // Default to family
  return <FamilyDashboard />;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth-callback" element={<AuthCallback />} />
        <Route path="/" element={<ProtectedRoute><RoleBasedRouter /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
