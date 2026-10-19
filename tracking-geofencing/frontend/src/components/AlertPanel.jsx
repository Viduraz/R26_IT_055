import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { geofenceApi } from "../services/trackingApi";

let lastPanelSpeechText = "";
let lastPanelSpeechTime = 0;

const speakAlert = (message) => {
  try {
    const now = Date.now();
    if (message === lastPanelSpeechText && now - lastPanelSpeechTime < 4000) {
      return; // Debounce identical voice alert for 4s
    }
    lastPanelSpeechText = message;
    lastPanelSpeechTime = now;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      }, 50);
    }
  } catch (e) { /* ignore */ }
};

const AlertPanel = forwardRef(({ backendOnline, toastRef, monitoring = false, sessionStartTime = null, onClearAlerts }, ref) => {
  const [alerts, setAlerts] = useState([]);
  const [retryVisible, setRetryVisible] = useState(false);
  const intervalRef = useRef(null);
  const failCountRef = useRef(0);
  const prevAlertIdsRef = useRef(new Set());
  const isInitialLoadRef = useRef(true);

  const monitoringRef = useRef(monitoring);
  useEffect(() => {
    monitoringRef.current = monitoring;
  }, [monitoring]);

  const sessionStartTimeRef = useRef(sessionStartTime);
  useEffect(() => {
    sessionStartTimeRef.current = sessionStartTime;
  }, [sessionStartTime]);

  // Imperative handle to inject real-time alert instantly from live feed (same millisecond as box)
  useImperativeHandle(ref, () => ({
    pushAlert: (newAlert) => {
      if (!newAlert) return;
      const alertId = newAlert.alert_id || `alert-${Date.now()}`;
      const alertObj = {
        alert_id: alertId,
        person_id: newAlert.person_id || "Caregiver",
        zone_id: newAlert.zone_id || "restricted",
        zone_name: newAlert.zone_name || "Restricted Area",
        breach_type: newAlert.breach_type || "Restricted Zone Entry",
        timestamp: newAlert.timestamp || new Date().toISOString(),
        resolved: false,
        ...newAlert,
      };

      prevAlertIdsRef.current.add(alertId);

      // Add to state immediately so it renders in the alert box
      setAlerts((prev) => {
        if (prev.some((a) => a.alert_id === alertId)) return prev;
        return [alertObj, ...prev];
      });

      // Trigger toast notification instantly
      if (toastRef && toastRef.current && typeof toastRef.current.addToast === "function") {
        toastRef.current.addToast(
          `🚨 Breach: ${alertObj.person_id} entered ${alertObj.zone_name}`
        );
      }
    },
    clearAlerts: () => {
      setAlerts([]);
      prevAlertIdsRef.current.clear();
    },
  }));

  const fetchAlerts = useCallback(async () => {
    if (!backendOnline || !monitoringRef.current) return;
    try {
      const sinceParam = sessionStartTimeRef.current || null;
      const res = await geofenceApi.getAlerts(null, sinceParam);

      if (res.data && Array.isArray(res.data)) {
        const sessionTimeMs = sessionStartTimeRef.current ? new Date(sessionStartTimeRef.current).getTime() : 0;

        // Numeric timestamp filtering: ensure alerts older than current session never show or trigger popups
        const validAlerts = res.data.filter((alert) => {
          if (!sessionTimeMs) return true;
          const alertTimeMs = new Date(alert.timestamp).getTime();
          return !isNaN(alertTimeMs) && alertTimeMs >= sessionTimeMs - 2000;
        });

        const newIds = new Set(res.data.map((a) => a.alert_id));

        // On initial load (or page refresh), populate prevAlertIdsRef silently
        if (isInitialLoadRef.current) {
          prevAlertIdsRef.current = newIds;
          isInitialLoadRef.current = false;
        } else {
          // Check for new alerts on polling tick
          validAlerts.forEach((alert) => {
            if (!prevAlertIdsRef.current.has(alert.alert_id) && !alert.resolved) {
              if (toastRef && toastRef.current) {
                toastRef.current.addToast(
                  `🚨 Breach: ${alert.person_id} entered ${alert.zone_name}`
                );
              }
              const displayName = alert.identity && alert.identity !== "Unknown"
                ? alert.identity
                : (alert.person_id ? (alert.person_id.startsWith("P-") ? `Person ${alert.person_id.split(" ")[0]}` : alert.person_id) : "Caregiver");
              speakAlert(`Warning. ${displayName} has entered the restricted area.`);
            }
          });
          // Merge newly seen IDs into prevAlertIdsRef
          newIds.forEach((id) => prevAlertIdsRef.current.add(id));
        }

        // Merge with existing session alerts without overwriting live pushed alerts
        setAlerts((prev) => {
          const map = new Map();
          prev.forEach((a) => map.set(a.alert_id, a));
          validAlerts.forEach((a) => map.set(a.alert_id, a));
          return Array.from(map.values()).sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
        });

        failCountRef.current = 0;
        setRetryVisible(false);
      }
    } catch {
      failCountRef.current++;
      if (failCountRef.current >= 3) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setRetryVisible(true);
      }
    }
  }, [backendOnline, toastRef]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    failCountRef.current = 0;
    setRetryVisible(false);
    fetchAlerts();
    intervalRef.current = setInterval(fetchAlerts, 3000);
  }, [fetchAlerts]);

  useEffect(() => {
    if (backendOnline && monitoring) {
      startPolling();
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [backendOnline, monitoring, startPolling]);

  // When monitoring mode stops or starts, clear state cleanly as requested
  useEffect(() => {
    setAlerts([]);
    prevAlertIdsRef.current.clear();
    isInitialLoadRef.current = true;
  }, [monitoring]);

  const handleResolve = async (alertId) => {
    try {
      await geofenceApi.resolveAlert(alertId);
      setAlerts((prev) =>
        prev.map((a) => (a.alert_id === alertId ? { ...a, resolved: true } : a))
      );
    } catch {}
  };

  const handleClear = async () => {
    try {
      await geofenceApi.clearAlerts();
      setAlerts([]);
      prevAlertIdsRef.current.clear();
      if (onClearAlerts) onClearAlerts();
    } catch {
      setAlerts([]);
    }
  };

  const formatTime = (ts) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return ts;
    }
  };

  const unresolvedCount = alerts.filter((a) => !a.resolved).length;

  return (
    <div className="panel" style={{ width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="icon">🚨</span> Alerts
          {monitoring ? (
            <span style={{
              fontSize: "0.6rem", background: "rgba(0, 255, 157, 0.15)", color: "#00FF9D",
              border: "1px solid rgba(0, 255, 157, 0.3)", padding: "1px 6px", borderRadius: 4,
              fontFamily: "var(--font-mono)", fontWeight: "bold"
            }}>
              LIVE SESSION
            </span>
          ) : (
            <span style={{
              fontSize: "0.6rem", background: "rgba(255, 255, 255, 0.08)", color: "var(--text-muted)",
              padding: "1px 6px", borderRadius: 4, fontFamily: "var(--font-mono)"
            }}>
              HISTORY
            </span>
          )}
          {unresolvedCount > 0 && (
            <span style={{
              marginLeft: 4, background: "rgba(255,59,92,0.2)", color: "#FF3B5C",
              padding: "2px 8px", borderRadius: 10, fontSize: "0.7rem", fontFamily: "var(--font-mono)",
            }}>
              {unresolvedCount}
            </span>
          )}
        </h2>
        {alerts.length > 0 && (
          <button
            className="btn btn-ghost btn-xs"
            onClick={handleClear}
            style={{ fontSize: "0.65rem", padding: "2px 8px" }}
            title="Clear current alert messages"
          >
            🗑️ Clear
          </button>
        )}
      </div>
      <div className="panel-body" style={{ width: "100%", boxSizing: "border-box", padding: "14px", overflow: "hidden" }}>
        {retryVisible ? (
          <div className="backend-offline-msg">
            <div className="offline-icon">⚠️</div>
            <p style={{ marginBottom: 12 }}>Alert polling stopped after 3 failures</p>
            <button className="btn btn-ghost btn-sm" onClick={startPolling}>🔄 Retry</button>
          </div>
        ) : alerts.length === 0 ? (
          <div className="alert-empty">
            <div className="empty-icon">🛡️</div>
            <p>{monitoring ? "No alerts in active session — all zones clear" : "No past alerts log"}</p>
          </div>
        ) : (
          <div className="alert-list" style={{ maxHeight: "300px", overflowY: "auto", overflowX: "hidden", width: "100%", boxSizing: "border-box" }}>
            {alerts.map((alert) => (
              <div key={alert.alert_id} className={`alert-item ${alert.resolved ? "resolved" : "unresolved"}`} style={{ width: "100%", boxSizing: "border-box", wordBreak: "break-word", flexShrink: 0 }}>
                <div className="alert-header">
                  <span className="alert-person">
                    {alert.resolved ? "✅" : "🔴"} {alert.person_id}
                  </span>
                  <span className="alert-time">{formatTime(alert.timestamp)}</span>
                </div>
                <div className="alert-zone">
                  {alert.breach_type} → <strong>{alert.zone_name}</strong>
                </div>
                {!alert.resolved && (
                  <div className="alert-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleResolve(alert.alert_id)}
                    >
                      ✓ Resolve
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default AlertPanel;
