import { useState, useEffect, useRef, useCallback } from "react";
import { geofenceApi } from "../services/trackingApi";

export default function AlertPanel({ backendOnline, toastRef }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [retryVisible, setRetryVisible] = useState(false);
  const intervalRef = useRef(null);
  const failCountRef = useRef(0);
  const prevAlertIdsRef = useRef(new Set());

  const fetchAlerts = useCallback(async () => {
    if (!backendOnline) return;
    try {
      const res = await geofenceApi.getAlerts();
      if (res.data && Array.isArray(res.data)) {
        // Check for new alerts
        const newIds = new Set(res.data.map((a) => a.alert_id));
        res.data.forEach((alert) => {
          if (!prevAlertIdsRef.current.has(alert.alert_id) && !alert.resolved) {
            // New unresolved alert — toast
            if (toastRef && toastRef.current) {
              toastRef.current.addToast(
                `🚨 Breach: ${alert.person_id} entered ${alert.zone_name}`
              );
            }
          }
        });
        prevAlertIdsRef.current = newIds;
        setAlerts(res.data);
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
    if (backendOnline) {
      startPolling();
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [backendOnline, startPolling]);

  const handleResolve = async (alertId) => {
    try {
      await geofenceApi.resolveAlert(alertId);
      setAlerts((prev) =>
        prev.map((a) => (a.alert_id === alertId ? { ...a, resolved: true } : a))
      );
    } catch {}
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
    <div className="panel">
      <div className="panel-header">
        <h2>
          <span className="icon">🚨</span> Alerts
          {unresolvedCount > 0 && (
            <span style={{
              marginLeft: 8, background: "rgba(255,59,92,0.2)", color: "#FF3B5C",
              padding: "2px 8px", borderRadius: 10, fontSize: "0.7rem", fontFamily: "var(--font-mono)",
            }}>
              {unresolvedCount}
            </span>
          )}
        </h2>
      </div>
      <div className="panel-body">
        {retryVisible ? (
          <div className="backend-offline-msg">
            <div className="offline-icon">⚠️</div>
            <p style={{ marginBottom: 12 }}>Alert polling stopped after 3 failures</p>
            <button className="btn btn-ghost btn-sm" onClick={startPolling}>🔄 Retry</button>
          </div>
        ) : alerts.length === 0 ? (
          <div className="alert-empty">
            <div className="empty-icon">🛡️</div>
            <p>No alerts — all zones clear</p>
          </div>
        ) : (
          <div className="alert-list">
            {alerts.map((alert) => (
              <div key={alert.alert_id} className={`alert-item ${alert.resolved ? "resolved" : "unresolved"}`}>
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
}
