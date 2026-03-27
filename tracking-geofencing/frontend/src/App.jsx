// tracking-geofencing/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TrackingDashboard from "./pages/TrackingDashboard";
import ZoneManagement from "./pages/ZoneManagement";
import TrackingHistory from "./pages/TrackingHistory";
import LiveTracking from "./pages/LiveTracking";

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
        <Route path="/" element={<ProtectedRoute><TrackingDashboard /></ProtectedRoute>} />
        <Route path="/live-tracking" element={<ProtectedRoute><LiveTracking /></ProtectedRoute>} />
        <Route path="/zones" element={<ProtectedRoute><ZoneManagement /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><TrackingHistory /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
