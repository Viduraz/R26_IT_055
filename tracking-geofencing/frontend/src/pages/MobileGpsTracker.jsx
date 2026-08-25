import { useState, useEffect, useRef } from "react";

const BACKEND_URL = "http://localhost:8002";
const PUSH_INTERVAL_MS = 2000; // Push every 2 seconds

export default function MobileGpsTracker() {
  const [status, setStatus] = useState("idle"); // idle | requesting | active | denied | error
  const [coords, setCoords] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [pushCount, setPushCount] = useState(0);
  const [lastPush, setLastPush] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const watchIdRef = useRef(null);
  const pushIntervalRef = useRef(null);
  const latestCoordsRef = useRef(null);

  const sessionId = useRef("mobile-" + Date.now());

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (pushIntervalRef.current) {
      clearInterval(pushIntervalRef.current);
      pushIntervalRef.current = null;
    }
    setStatus("idle");
  };

  const pushToBackend = async (lat, lng, acc) => {
    try {
      await fetch(`${BACKEND_URL}/api/geofence/mobile-gps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat,
          lng,
          accuracy: acc || null,
          session_id: sessionId.current,
        }),
      });
      setPushCount((c) => c + 1);
      setLastPush(new Date().toLocaleTimeString());
    } catch (e) {
      console.warn("[MobileGPS] Push failed:", e);
    }
  };

  const startTracking = () => {
    if (!navigator.geolocation) {
      setStatus("error");
      setErrorMsg("GPS not supported on this device.");
      return;
    }
    setStatus("requesting");
    setErrorMsg("");

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const acc = position.coords.accuracy;
        latestCoordsRef.current = { lat, lng, accuracy: acc };
        setCoords({ lat, lng });
        setAccuracy(acc);
        setStatus("active");
      },
      (err) => {
        console.warn("[MobileGPS] Error:", err);
        setStatus(err.code === 1 ? "denied" : "error");
        setErrorMsg(err.message);
        stopTracking();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    // Push interval — sends latest coords every 2s
    pushIntervalRef.current = setInterval(() => {
      if (latestCoordsRef.current) {
        const { lat, lng, accuracy: acc } = latestCoordsRef.current;
        pushToBackend(lat, lng, acc);
      }
    }, PUSH_INTERVAL_MS);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopTracking();
  }, []);

  const statusColor = {
    idle: "#a0aec0",
    requesting: "#f6e05e",
    active: "#48bb78",
    denied: "#fc8181",
    error: "#fc8181",
  }[status] || "#a0aec0";

  const statusLabel = {
    idle: "⏹ Idle — Tap to Start",
    requesting: "⏳ Requesting GPS Permission…",
    active: "🟢 Live Tracking Active",
    denied: "🚫 GPS Permission Denied",
    error: "❌ GPS Error",
  }[status];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0f1e 0%, #0d1b2a 60%, #0a1628 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      color: "#e2e8f0",
      padding: "24px 16px",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>📱</div>
        <h1 style={{
          fontSize: "1.3rem",
          fontWeight: 700,
          color: "#00D4FF",
          margin: 0,
          letterSpacing: "0.05em",
        }}>
          Mobile GPS Tracker
        </h1>
        <p style={{ fontSize: "0.8rem", color: "#718096", marginTop: "6px" }}>
          Secure Elder Care — Geofence Companion
        </p>
      </div>

      {/* Status Card */}
      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${statusColor}44`,
        borderRadius: "16px",
        padding: "20px 24px",
        width: "100%",
        maxWidth: "340px",
        marginBottom: "20px",
        textAlign: "center",
        boxShadow: `0 0 24px ${statusColor}22`,
      }}>
        <div style={{ fontSize: "0.75rem", color: statusColor, fontWeight: 600, marginBottom: "8px", letterSpacing: "0.08em" }}>
          STATUS
        </div>
        <div style={{ fontSize: "1rem", fontWeight: 600, color: statusColor }}>
          {statusLabel}
        </div>
        {errorMsg && (
          <div style={{ fontSize: "0.7rem", color: "#fc8181", marginTop: "8px" }}>
            {errorMsg}
          </div>
        )}
      </div>

      {/* Coordinates Card */}
      {coords && (
        <div style={{
          background: "rgba(0, 212, 255, 0.05)",
          border: "1px solid rgba(0, 212, 255, 0.2)",
          borderRadius: "12px",
          padding: "16px 20px",
          width: "100%",
          maxWidth: "340px",
          marginBottom: "20px",
          fontFamily: "monospace",
        }}>
          <div style={{ fontSize: "0.65rem", color: "#00D4FF", marginBottom: "8px", letterSpacing: "0.08em" }}>
            📍 LIVE COORDINATES
          </div>
          <div style={{ fontSize: "0.85rem", color: "#e2e8f0" }}>
            Lat: <span style={{ color: "#00FF9D" }}>{coords.lat.toFixed(7)}°</span>
          </div>
          <div style={{ fontSize: "0.85rem", color: "#e2e8f0", marginTop: "4px" }}>
            Lng: <span style={{ color: "#00FF9D" }}>{coords.lng.toFixed(7)}°</span>
          </div>
          {accuracy && (
            <div style={{ fontSize: "0.75rem", color: "#718096", marginTop: "8px" }}>
              Accuracy: ±{accuracy.toFixed(1)}m
            </div>
          )}
        </div>
      )}

      {/* Push Stats */}
      {status === "active" && (
        <div style={{
          fontSize: "0.72rem",
          color: "#718096",
          marginBottom: "20px",
          textAlign: "center",
        }}>
          📡 Pushed to dashboard: <strong style={{ color: "#00D4FF" }}>{pushCount}</strong> times
          {lastPush && <> · Last: <strong>{lastPush}</strong></>}
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={status === "active" ? stopTracking : startTracking}
        disabled={status === "requesting"}
        style={{
          width: "100%",
          maxWidth: "340px",
          padding: "16px",
          borderRadius: "12px",
          border: "none",
          cursor: status === "requesting" ? "not-allowed" : "pointer",
          fontSize: "1rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
          transition: "all 0.2s ease",
          background: status === "active"
            ? "linear-gradient(135deg, #fc8181, #e53e3e)"
            : "linear-gradient(135deg, #00D4FF, #0099CC)",
          color: "#fff",
          boxShadow: status === "active"
            ? "0 4px 20px rgba(252, 129, 129, 0.35)"
            : "0 4px 20px rgba(0, 212, 255, 0.35)",
        }}
      >
        {status === "active" ? "⏹ Stop Tracking" : status === "requesting" ? "⏳ Initializing…" : "▶ Start GPS Tracking"}
      </button>

      <p style={{ fontSize: "0.65rem", color: "#4a5568", marginTop: "24px", textAlign: "center", maxWidth: "280px" }}>
        Keep this page open and screen awake. Your live location will appear on the dashboard radar.
      </p>
    </div>
  );
}
