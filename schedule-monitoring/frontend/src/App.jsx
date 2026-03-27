// schedule-monitoring/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ScheduleDashboard from "./pages/ScheduleDashboard";
import Reports from "./pages/Reports";
import RoutineSetup from "./pages/RoutineSetup";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) return <Navigate to="http://localhost:5173/login" />;
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProtectedRoute><ScheduleDashboard /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="/routine-setup" element={<ProtectedRoute><RoutineSetup /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
