// gateway-dashboard/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import AlertsCenter from "./pages/AlertsCenter";
import SystemOverview from "./pages/SystemOverview";

// Redirect to auth service login if no token
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) return <Navigate to={`http://localhost:5173/login`} />;
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/alerts" element={<ProtectedRoute><AlertsCenter /></ProtectedRoute>} />
        <Route path="/overview" element={<ProtectedRoute><SystemOverview /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
