import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ScheduleDashboard from "./pages/ScheduleDashboard";
import RoutineSetup from "./pages/RoutineSetup";
import Reports from "./pages/Reports";
import Layout from "./components/Layout";

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
      <Layout>
        <Routes>
          <Route path="/" element={<ScheduleDashboard />} />
          <Route path="/routine-setup" element={<RoutineSetup />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
