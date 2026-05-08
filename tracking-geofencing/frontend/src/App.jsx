// tracking-geofencing/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TrackingDashboard from "./pages/TrackingDashboard";
import ZoneManagement from "./pages/ZoneManagement";
import TrackingHistory from "./pages/TrackingHistory";
import LiveTracking from "./pages/LiveTracking";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TrackingDashboard />} />
        <Route path="/live-tracking" element={<LiveTracking />} />
        <Route path="/zones" element={<ZoneManagement />} />
        <Route path="/history" element={<TrackingHistory />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
