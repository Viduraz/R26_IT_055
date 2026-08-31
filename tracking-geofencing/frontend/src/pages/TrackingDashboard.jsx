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

// Helper for status mapping matching LiveStream.jsx
function mapCaregiverStatus(status) {
  switch (status) {
    case "verified_present":
      return { label: "Caregiver Present", color: "#00FF9D", bg: "rgba(0, 255, 157, 0.12)", border: "rgba(0, 255, 157, 0.35)", pulse: false };
    case "warning":
      return { label: "Caregiver Warning", color: "#FFB800", bg: "rgba(255, 184, 0, 0.12)", border: "rgba(255, 184, 0, 0.35)", pulse: true };
    case "missing":
      return { label: "Caregiver Missing", color: "#FF8C00", bg: "rgba(255, 140, 0, 0.15)", border: "rgba(255, 140, 0, 0.4)", pulse: true };
    case "missing_critical":
      return { label: "CRITICAL — Caregiver Absent!", color: "#FF3B5C", bg: "rgba(255, 59, 92, 0.18)", border: "rgba(255, 59, 92, 0.5)", pulse: true };
    default:
      return { label: "Awaiting Caregiver Data…", color: "#94A3B8", bg: "rgba(148, 163, 184, 0.08)", border: "rgba(148, 163, 184, 0.2)", pulse: false };
  }
}

export default function TrackingDashboard() {
  const [backendOnline, setBackendOnline] = useState(false);
  const [checking, setChecking] = useState(true);
  const [zones, setZones] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [persons, setPersons] = useState([]);
  const [monitoring, setMonitoring] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [zoneRefreshKey, setZoneRefreshKey] = useState(0);

  // ── Caregiver Identification & Continuity State (matching LiveStream.jsx) ──
  const [caregiver, setCaregiver] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [caregiverStatus, setCaregiverStatus] = useState("idle");
  const [absenceSecs, setAbsenceSecs] = useState(0);
  const [trackingSessionId, setTrackingSessionId] = useState(null);
  const [lastRecognizedAt, setLastRecognizedAt] = useState(null);

  const healthIntervalRef = useRef(null);
  const toastRef = useRef(null);

  // Receive telemetry updates from TrackingFeed
  const handleCaregiverUpdate = useCallback((data) => {
    if (!data) {
      setCaregiver(null);
      setConfidence(null);
      setCaregiverStatus("idle");
      setAbsenceSecs(0);
      setTrackingSessionId(null);
      setLastRecognizedAt(null);
      return;
    }
    if (data.caregiver) setCaregiver(data.caregiver);
    if (data.confidence !== undefined) setConfidence(data.confidence);
    if (data.status) setCaregiverStatus(data.status);
    if (data.absenceSecs !== undefined) setAbsenceSecs(data.absenceSecs);
    if (data.sessionId) setTrackingSessionId(data.sessionId);
    if (data.lastSeen) setLastRecognizedAt(data.lastSeen);
  }, []);

  // Manage session start timestamp when monitoring state changes
  const handleSetMonitoring = useCallback((val) => {
    setMonitoring(val);
    if (val) {
      setSessionStartTime(new Date().toISOString());
    } else {
      setSessionStartTime(null);
      handleCaregiverUpdate(null);
    }
  }, [handleCaregiverUpdate]);

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

  const statusConfig = mapCaregiverStatus(caregiverStatus);
  const isCaregiverCritical = caregiverStatus === "missing_critical";

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
            <div className="subtitle">Secure Elder Care — AI Person Tracking & Caregiver Continuity</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {caregiver && (
              <span style={{
                background: "rgba(0, 212, 255, 0.15)",
                border: "1px solid rgba(0, 212, 255, 0.4)",
                color: "#00D4FF",
                padding: "4px 10px",
                borderRadius: "6px",
                fontSize: "0.75rem",
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
              }}>
                👤 Caregiver: {caregiver.name}
              </span>
            )}
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </div>
          </div>
        </div>

        {/* Critical Caregiver Absence Alert (matching LiveStream.jsx) */}
        {isCaregiverCritical && (
          <div style={{
            marginBottom: "1rem",
            padding: "1rem 1.5rem",
            borderRadius: "12px",
            background: "rgba(255, 59, 92, 0.18)",
            border: "1px solid #FF3B5C",
            color: "#FF3B5C",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            animation: "pulse-banner 1.5s infinite"
          }}>
            <span style={{ fontSize: "1.8rem" }}>🚨</span>
            <div>
              <div style={{ fontWeight: 800, letterSpacing: "0.5px", fontSize: "1rem" }}>
                CRITICAL ALERT — CAREGIVER ABSENT
              </div>
              <div style={{ fontSize: "0.85rem", color: "#FFA4B2" }}>
                Caregiver {caregiver?.name || "assigned"} has been absent for {absenceSecs.toFixed(0)}s. Immediate attention required.
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        <StatsBar backendOnline={backendOnline} />

        {/* Main grid: Feed + Alerts + Caregiver Continuity Panel */}
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
            onCaregiverUpdate={handleCaregiverUpdate}
          />

          <div className="alerts-column">
            {/* ── Caregiver Recognition & Continuity Status Panel (LiveStream.jsx parity) ── */}
            <div className="panel" style={{ border: `1px solid ${statusConfig.border}`, background: statusConfig.bg, transition: "all 0.3s ease" }}>
              <div className="panel-header" style={{ borderBottom: `1px solid ${statusConfig.border}` }}>
                <span className="panel-title" style={{ color: statusConfig.color, display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>👤</span> Caregiver Biometrics & Continuity
                </span>
                <span style={{
                  fontSize: "0.7rem",
                  fontFamily: "var(--font-mono)",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: statusConfig.bg,
                  color: statusConfig.color,
                  border: `1px solid ${statusConfig.border}`,
                  fontWeight: 700
                }}>
                  {statusConfig.label}
                </span>
              </div>

              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {caregiver ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        background: "rgba(0, 212, 255, 0.15)",
                        border: "1px solid rgba(0, 212, 255, 0.4)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1.2rem",
                      }}>
                        👤
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: "#fff", fontWeight: 700, fontSize: "0.95rem" }}>
                          {caregiver.name}
                        </div>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                          Registered Caregiver {caregiver.id_number ? `· ID: ${caregiver.id_number}` : ""}
                        </div>
                      </div>
                    </div>

                    {confidence !== null && (
                      <div style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "0.75rem",
                        fontFamily: "var(--font-mono)",
                        color: "#00FF9D",
                        background: "rgba(0, 255, 157, 0.1)",
                        border: "1px solid rgba(0, 255, 157, 0.25)",
                        padding: "3px 8px",
                        borderRadius: "6px",
                        alignSelf: "flex-start"
                      }}>
                        <span>✔</span> {confidence}% Biometric Match
                      </div>
                    )}

                    {/* Absence Timer Meter */}
                    <div style={{ background: "rgba(10, 15, 30, 0.6)", padding: "10px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.05)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "4px" }}>
                        <span>Absence Elapsed</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: absenceSecs > 30 ? "#FF3B5C" : absenceSecs > 10 ? "#FFB800" : "#00FF9D" }}>
                          {absenceSecs.toFixed(0)}s
                        </span>
                      </div>
                      <div style={{ width: "100%", height: "6px", background: "rgba(255, 255, 255, 0.1)", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${Math.min((absenceSecs / 60) * 100, 100)}%`,
                          background: absenceSecs > 30 ? "#FF3B5C" : absenceSecs > 10 ? "#FFB800" : "#00FF9D",
                          transition: "width 0.5s ease"
                        }} />
                      </div>
                    </div>

                    {trackingSessionId && (
                      <div style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)", wordBreak: "break-all" }}>
                        SESSION: {trackingSessionId}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-muted)", padding: "8px 0" }}>
                    <span style={{ fontSize: "1.2rem", opacity: 0.5 }}>👤</span>
                    <span style={{ fontSize: "0.8rem" }}>
                      {monitoring ? "AI scanning for registered caregiver face…" : "Start monitoring to begin caregiver biometric scan"}
                    </span>
                  </div>
                )}
              </div>
            </div>

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
