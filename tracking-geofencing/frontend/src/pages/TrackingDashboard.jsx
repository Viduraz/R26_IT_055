import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { checkBackendHealth, geofenceApi } from "../services/trackingApi";
import StatsBar from "../components/StatsBar";
import TrackingFeed from "../components/TrackingFeed";
import AlertPanel from "../components/AlertPanel";
import ExitAlertPanel from "../components/ExitAlertPanel";
import ZoneManager from "../components/ZoneManager";

/* ── Toast System ───────────────────────────────────────────────── */
const ToastContainer = forwardRef((props, ref) => {
  const [toasts, setToasts] = useState([]);

  useImperativeHandle(ref, () => ({
    addToast: (message) => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
  }));

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-icon">🚨</span>
          <span className="toast-message">{t.message}</span>
          <button
            className="toast-close"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
});

export default function TrackingDashboard() {
  const [backendOnline, setBackendOnline] = useState(false);
  const [checking, setChecking] = useState(true);
  const [zones, setZones] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [persons, setPersons] = useState([]);
  const [monitoring, setMonitoring] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [zoneRefreshKey, setZoneRefreshKey] = useState(0);
  const healthIntervalRef = useRef(null);
  const toastRef = useRef(null);

  // Manage session start timestamp when monitoring state changes
  const handleSetMonitoring = useCallback((val) => {
    setMonitoring(val);
    if (val) {
      setSessionStartTime(new Date().toISOString());
    } else {
      setSessionStartTime(null);
    }
  }, []);

  const pollHealth = useCallback(async () => {
    const online = await checkBackendHealth();
    setBackendOnline(online);
    setChecking(false);
  }, []);

  useEffect(() => {
    pollHealth();
    healthIntervalRef.current = setInterval(pollHealth, 10000);
    return () => {
      if (healthIntervalRef.current) clearInterval(healthIntervalRef.current);
    };
  }, [pollHealth]);

  // Fetch zones
  const fetchZones = useCallback(async () => {
    if (!backendOnline) return;
    try {
      const res = await geofenceApi.getZones();
      if (res.data && Array.isArray(res.data)) setZones(res.data);
    } catch {}
  }, [backendOnline]);

  useEffect(() => { fetchZones(); }, [fetchZones, zoneRefreshKey]);

  const handleZoneSaved = () => {
    setZoneRefreshKey((k) => k + 1);
  };

  const alertPanelRef = useRef(null);

  const handleNewAlert = useCallback((alert) => {
    if (alertPanelRef.current && typeof alertPanelRef.current.pushAlert === "function") {
      alertPanelRef.current.pushAlert(alert);
    }
  }, []);

  return (
    <>
      <ToastContainer ref={toastRef} />

      {/* Status Banner */}
      <div className={`status-banner ${backendOnline ? "online" : "offline"}`}>
        <span className={`status-dot ${backendOnline ? "online" : "offline"}`} />
        {checking
          ? "Checking backend status..."
          : backendOnline
          ? "System Online — Tracking & Geofencing Service Connected"
          : "Backend Offline — Attempting reconnection every 10s"}
      </div>

      <div className="dashboard">
        {/* Header */}
        <div className="dashboard-header">
          <div>
            <h1>🛡️ Tracking & Geofencing</h1>
            <div className="subtitle">Secure Elder Care — Real-time Monitoring</div>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            {new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>

        {/* Stats */}
        <StatsBar backendOnline={backendOnline} />

        {/* Main 3-column grid: Feed + Alerts + Exit Alerts */}
        <div className="main-grid">
          <TrackingFeed
            backendOnline={backendOnline}
            zones={zones}
            alerts={alerts}
            onZoneSaved={handleZoneSaved}
            persons={persons}
            setPersons={setPersons}
            monitoring={monitoring}
            setMonitoring={handleSetMonitoring}
            onNewAlert={handleNewAlert}
          />
          <div className="alerts-column">
            <AlertPanel
              ref={alertPanelRef}
              backendOnline={backendOnline}
              toastRef={toastRef}
              monitoring={monitoring}
              sessionStartTime={sessionStartTime}
            />
            <ExitAlertPanel backendOnline={backendOnline} persons={persons} toastRef={toastRef} monitoring={monitoring} />
          </div>
        </div>

        {/* Zone Manager */}
        <ZoneManager backendOnline={backendOnline} refreshKey={zoneRefreshKey} onZonesChanged={handleZoneSaved} />
      </div>
    </>
  );
}

