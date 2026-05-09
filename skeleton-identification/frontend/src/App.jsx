import { useState, useEffect, useCallback } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { fetchHealth } from './services/api';

import Sidebar from './components/Sidebar';
import Navbar  from './components/Navbar';

import LiveFeedPage  from './pages/LiveFeedPage';
import EnrollPage    from './pages/EnrollPage';
import UsersPage     from './pages/UsersPage';
import TrainingPage  from './pages/TrainingPage';
import StatsPage     from './pages/StatsPage';

// ── Inner layout needs AppContext ─────────────────────────────────────────────
function DashboardLayout() {
  const { activeTab, setSystemOnline } = useApp();
  const [fps, setFps] = useState(0);

  // Periodic health check
  const checkHealth = useCallback(async () => {
    try {
      const data = await fetchHealth();
      setSystemOnline(data.status === 'healthy');
    } catch {
      setSystemOnline(false);
    }
  }, [setSystemOnline]);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar fps={fps} />

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'live'     && <LiveFeedPage onFpsChange={setFps} />}
          {activeTab === 'enroll'   && <EnrollPage />}
          {activeTab === 'users'    && <UsersPage />}
          {activeTab === 'training' && <TrainingPage />}
          {activeTab === 'stats'    && <StatsPage />}
        </div>
      </div>
    </div>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <DashboardLayout />
      </ToastProvider>
    </AppProvider>
  );
}
