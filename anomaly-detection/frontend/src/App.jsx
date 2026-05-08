// anomaly-detection/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AnomalyDashboard  from "./pages/AnomalyDashboard";
import DetectionHistory  from "./pages/DetectionHistory";
import ModelStatus       from "./pages/ModelStatus";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"              element={<AnomalyDashboard />} />
        <Route path="/history"       element={<DetectionHistory />} />
        <Route path="/model-status"  element={<ModelStatus />} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
