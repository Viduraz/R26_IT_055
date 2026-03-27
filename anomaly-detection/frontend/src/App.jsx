// anomaly-detection/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AnomalyDashboard from "./pages/AnomalyDashboard";
import DetectionHistory from "./pages/DetectionHistory";
import ModelStatus from "./pages/ModelStatus";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) {
    window.location.href = "http://localhost:5173/login";
    return null;
  }
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProtectedRoute><AnomalyDashboard /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><DetectionHistory /></ProtectedRoute>} />
        <Route path="/model-status" element={<ProtectedRoute><ModelStatus /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
