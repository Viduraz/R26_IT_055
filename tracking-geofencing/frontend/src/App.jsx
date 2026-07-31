import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TrackingDashboard from "./pages/TrackingDashboard";
import MobileTrackerPage from "./pages/MobileTrackerPage";

function App() {
  // Auth guard disabled for now — will be implemented later
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<TrackingDashboard />} />
        <Route path="/live-tracking" element={<TrackingDashboard />} />
        <Route path="/mobile-tracker" element={<MobileTrackerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
