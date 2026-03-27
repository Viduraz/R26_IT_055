// schedule-monitoring/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ScheduleDashboard from "./pages/ScheduleDashboard";
import RoutineSetup from "./pages/RoutineSetup";
import Reports from "./pages/Reports";

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
        <Route path="/" element={<ProtectedRoute><ScheduleDashboard /></ProtectedRoute>} />
        <Route path="/routine-setup" element={<ProtectedRoute><RoutineSetup /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
