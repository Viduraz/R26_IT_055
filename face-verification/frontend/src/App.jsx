// face-verification/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import FaceDashboard from "./pages/FaceDashboard";
import FaceLogs from "./pages/FaceLogs";
import AuthorizedPersons from "./pages/AuthorizedPersons";
import FamilyScanCaregiver from "./pages/FamilyScanCaregiver";
import VerificationLogs from "./pages/VerificationLogs";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) {
    window.location.href = `${import.meta.env.VITE_AUTH_FRONTEND_URL || "http://localhost:5173"}/login`;
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
  window.location.href = `${import.meta.env.VITE_AUTH_FRONTEND_URL || "http://localhost:5173"}/login`;
  return null;
};

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/auth-callback" element={<AuthCallback />} />
        <Route path="/" element={<ProtectedRoute><FaceDashboard /></ProtectedRoute>} />
        <Route path="/logs" element={<ProtectedRoute><FaceLogs /></ProtectedRoute>} />
        <Route path="/verification-logs" element={<ProtectedRoute><VerificationLogs /></ProtectedRoute>} />
        <Route path="/authorized" element={<ProtectedRoute><AuthorizedPersons /></ProtectedRoute>} />
        <Route path="/scan-caregiver" element={<ProtectedRoute><FamilyScanCaregiver /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
