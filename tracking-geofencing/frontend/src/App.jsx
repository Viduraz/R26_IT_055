// tracking-geofencing/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TrackingDashboard from "./pages/TrackingDashboard";
import ZoneManagement from "./pages/ZoneManagement";
import TrackingHistory from "./pages/TrackingHistory";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) return <Navigate to="http://localhost:5173/login" />;
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProtectedRoute><TrackingDashboard /></ProtectedRoute>} />
        <Route path="/zones" element={<ProtectedRoute><ZoneManagement /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><TrackingHistory /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
