import { useState, useEffect, useRef, useCallback } from "react";
import { trackingApi, geofenceApi } from "../services/trackingApi";

export default function ExitAlertPanel({ backendOnline }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);
  const failCountRef = useRef(0);
  const [retryVisible, setRetryVisible] = useState(false);

  const fetchAlerts = useCallback(async () => {
    if (!backendOnline) return;
    try {
      const res = await trackingApi.getExitAlerts();
      if (res.data && Array.isArray(res.data)) {
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
  }, [backendOnline]);

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

  const handleAcknowledge = async (alertId) => {
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
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  const unresolvedCount = alerts.filter((a) => !a.resolved).length;

  return (
    <div className="panel exit-alert-panel">
      <div className="panel-header">
        <h2>
          <span className="icon">🚪</span> Exit Alerts
          {unresolvedCount > 0 && (
            <span className="exit-alert-badge">{unresolvedCount}</span>
          )}
        </h2>
      </div>
      <div className="panel-body">
        {retryVisible ? (
          <div className="backend-offline-msg">
            <div className="offline-icon">⚠️</div>
            <p style={{ marginBottom: 12 }}>
              Exit alert polling stopped after 3 failures
            </p>
            <button className="btn btn-ghost btn-sm" onClick={startPolling}>
              🔄 Retry
            </button>
          </div>
        ) : alerts.length === 0 ? (
          <div className="alert-empty">
            <div className="empty-icon">✅</div>
            <p>No exit alerts — all persons accounted for</p>
          </div>
        ) : (
          <div className="exit-alert-list">
            {alerts.map((alert) => (
              <div
                key={alert.alert_id}
                className={`exit-alert-card ${
                  alert.resolved ? "resolved" : "unresolved"
                }`}
              >
                <div className="exit-alert-header">
                  <span className="exit-alert-type">
                    {alert.resolved ? "✅" : "⚠"} EXIT ALERT
                  </span>
                  <span className="exit-alert-time">
                    {formatTime(alert.timestamp)}
                  </span>
                </div>
                <div className="exit-alert-identity">
                  {alert.identity || alert.person_id}
                </div>
                <div className="exit-alert-message">
                  {alert.message || `Left ${alert.last_zone} area`}
                </div>
                <div className="exit-alert-zone">
                  Last zone: <strong>{alert.last_zone}</strong>
                  {alert.severity && (
                    <span className="exit-severity-badge">
                      {alert.severity}
                    </span>
                  )}
                </div>
                {!alert.resolved && (
                  <div className="exit-alert-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleAcknowledge(alert.alert_id)}
                    >
                      ✓ Acknowledge
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
