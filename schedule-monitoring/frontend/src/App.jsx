import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import ScheduleDashboard from "./pages/ScheduleDashboard";
import RoutineSetup from "./pages/RoutineSetup";
import Reports from "./pages/Reports";
import Layout from "./components/Layout";
import NotificationsPanel from "./pages/NotificationsPanel";
import ActivityLog from "./pages/ActivityLog";
import DataCollector from "./pages/DataCollector";
import ScheduleProgress from "./pages/ScheduleProgress";
import TrainHAR from './pages/TrainHAR';

function App() {
  return (
    <BrowserRouter basename="/schedule">
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<ScheduleDashboard />} />
          <Route path="/routine-setup" element={<RoutineSetup />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/notifications" element={<NotificationsPanel />} />
          <Route path="/activity-log" element={<ActivityLog />} />
          <Route path="/data-collector" element={<DataCollector />} />
          <Route path="/schedule-progress" element={<ScheduleProgress />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          <Route path="/train-har" element={<TrainHAR />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;