// face-verification/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import FaceDashboard from "./pages/FaceDashboard";
import FaceLogs from "./pages/FaceLogs";
import AuthorizedPersons from "./pages/AuthorizedPersons";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) return <Navigate to="http://localhost:5173/login" />;
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProtectedRoute><FaceDashboard /></ProtectedRoute>} />
        <Route path="/logs" element={<ProtectedRoute><FaceLogs /></ProtectedRoute>} />
        <Route path="/authorized" element={<ProtectedRoute><AuthorizedPersons /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
