import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Home from "./pages/Home";
import ScheduleDashboard from "./pages/ScheduleDashboard";
import RoutineSetup from "./pages/RoutineSetup";
import Reports from "./pages/Reports";
import Layout from "./components/Layout";
import NotificationsPanel from "./pages/NotificationsPanel";
import ActivityLog from "./pages/ActivityLog";

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<ScheduleDashboard />} />
          <Route path="/routine-setup" element={<RoutineSetup />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/notifications" element={<NotificationsPanel />} />
          <Route path="/activity-log" element={<ActivityLog />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
