import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TrackingDashboard from "./pages/TrackingDashboard";

function App() {
  // Auth guard disabled for now — will be implemented later
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TrackingDashboard />} />
        <Route path="/live-tracking" element={<TrackingDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
