// schedule-monitoring/frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ScheduleDashboard from "./pages/ScheduleDashboard";
import RoutineSetup from "./pages/RoutineSetup";
import NotificationsPanel from "./pages/NotificationsPanel";
import ActivityLog from "./pages/ActivityLog";
import { getNotifications } from "./services/scheduleApi";

// TODO: Re-enable auth guard once login integration is ready
const ProtectedRoute = ({ children }) => children;

const PATIENT_ID = "patient_001";

function Layout({ children }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const fetchUnread = () => {
      getNotifications(PATIENT_ID)
        .then((r) => setUnread(r.data?.unread_count ?? 0))
        .catch(() => {});
    };
    fetchUnread();
    const id = setInterval(fetchUnread, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar unread={unread} />
      <main className="flex-1 ml-60 min-h-screen overflow-y-auto">{children}</main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout>
                <ScheduleDashboard patientId={PATIENT_ID} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/routine-setup"
          element={
            <ProtectedRoute>
              <Layout>
                <RoutineSetup patientId={PATIENT_ID} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <Layout>
                <NotificationsPanel patientId={PATIENT_ID} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity-log"
          element={
            <ProtectedRoute>
              <Layout>
                <ActivityLog patientId={PATIENT_ID} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
