import { useState, useEffect, useRef } from "react";
import { geofenceApi } from "../services/trackingApi";

export default function MobileTrackerPage() {
  const [coords, setCoords] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [status, setStatus] = useState("initializing");
  const [errorMsg, setErrorMsg] = useState(null);
  const [sendCount, setSendCount] = useState(0);
  const [lastSentTime, setLastSentTime] = useState(null);
  const [isPaused, setIsPaused] = useState(false);

  const watchIdRef = useRef(null);
  const isPausedRef = useRef(isPaused);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus("error");
      setErrorMsg("GPS Geolocation is not supported by your mobile browser.");
      return;
    }

    setStatus("requesting");

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        if (isPausedRef.current) return;

        if (position && position.coords) {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const acc = position.coords.accuracy;

          if (typeof lat === "number" && typeof lng === "number" && !isNaN(lat) && !isNaN(lng)) {
            setCoords({ lat, lng });
            setAccuracy(acc);
            setStatus("active");
            setErrorMsg(null);

            try {
              await geofenceApi.sendMobileLocation(lat, lng, acc);
              setSendCount((c) => c + 1);
              setLastSentTime(new Date().toLocaleTimeString());
            } catch (err) {
              console.warn("Failed to stream mobile location:", err);
            }
          }
        }
      },
      (err) => {
        console.error("GPS Watch error:", err);
        setStatus("error");
        if (err.code === 1) {
          setErrorMsg("Location permission denied. Please allow Location access in your mobile browser settings.");
        } else if (err.code === 2) {
          setErrorMsg("GPS signal unavailable. Please ensure Location/GPS is turned ON on your phone.");
        } else {
          setErrorMsg("Location request timed out. Retrying...");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0A0F1E",
      color: "#F3F4F6",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: "20px 16px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      alignItems: "center"
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 20, width: "100%", maxWidth: 400 }}>
        <div style={{ fontSize: "2.2rem", marginBottom: 6 }}>📱</div>
        <h1 style={{
          fontSize: "1.3rem",
          fontWeight: 700,
          margin: 0,
          background: "linear-gradient(135deg, #00D4FF, #7C3AED)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent"
        }}>
          Caregiver Mobile GPS Tracker
        </h1>
        <p style={{ fontSize: "0.75rem", color: "#9CA3AF", marginTop: 4 }}>
          Secure Elder Care Platform — Live Location Stream
        </p>
      </div>

      {/* Main Status HUD Card */}
      <div style={{
        width: "100%",
        maxWidth: 400,
        background: "rgba(15, 23, 42, 0.8)",
        border: "1px solid rgba(0, 212, 255, 0.2)",
        borderRadius: "16px",
        padding: "20px",
        boxSizing: "border-box",
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        marginBottom: 20
      }}>
        {/* Status Indicator */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: status === "active" ? "rgba(0, 255, 157, 0.1)" : "rgba(255, 59, 92, 0.1)",
          border: `1px solid ${status === "active" ? "rgba(0, 255, 157, 0.3)" : "rgba(255, 59, 92, 0.3)"}`,
          borderRadius: "10px",
          marginBottom: 16
        }}>
          <span style={{ fontSize: "0.8rem", fontWeight: "bold", color: status === "active" ? "#00FF9D" : "#FF3B5C" }}>
            {status === "active" ? (isPaused ? "⏸ GPS PAUSED" : "🟢 LIVE HARDWARE GPS STREAMING") : "🟡 CONNECTING GPS..."}
          </span>
          <span style={{ fontSize: "0.7rem", color: "#9CA3AF", fontFamily: "monospace" }}>
            {sendCount > 0 ? `#${sendCount}` : ""}
          </span>
        </div>

        {errorMsg && (
          <div style={{
            background: "rgba(255, 59, 92, 0.15)",
            border: "1px solid rgba(255, 59, 92, 0.4)",
            color: "#FF3B5C",
            padding: "10px 14px",
            borderRadius: "8px",
            fontSize: "0.8rem",
            marginBottom: 16
          }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {/* Live Coordinates Grid */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{
            background: "rgba(0,0,0,0.3)",
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.05)"
          }}>
            <div style={{ fontSize: "0.7rem", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Latitude
            </div>
            <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#00D4FF", fontFamily: "monospace" }}>
              {coords ? `${coords.lat.toFixed(6)}°` : "Searching..."}
            </div>
          </div>

          <div style={{
            background: "rgba(0,0,0,0.3)",
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.05)"
          }}>
            <div style={{ fontSize: "0.7rem", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Longitude
            </div>
            <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#00D4FF", fontFamily: "monospace" }}>
              {coords ? `${coords.lng.toFixed(6)}°` : "Searching..."}
            </div>
          </div>

          {accuracy && (
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.75rem",
              color: "#9CA3AF",
              padding: "4px 6px"
            }}>
              <span>GPS Precision:</span>
              <span style={{ color: "#00FF9D", fontWeight: "bold" }}>± {accuracy.toFixed(1)} meters</span>
            </div>
          )}

          {lastSentTime && (
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.75rem",
              color: "#9CA3AF",
              padding: "2px 6px"
            }}>
              <span>Last Transmitted:</span>
              <span style={{ color: "#F3F4F6", fontFamily: "monospace" }}>{lastSentTime}</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ marginTop: 20 }}>
          <button
            onClick={() => setIsPaused((p) => !p)}
            style={{
              width: "100%",
              padding: "12px",
              background: isPaused ? "linear-gradient(135deg, #00D4FF, #0891B2)" : "rgba(255,255,255,0.1)",
              color: isPaused ? "#000" : "#FFF",
              border: "none",
              borderRadius: "10px",
              fontWeight: "bold",
              fontSize: "0.9rem",
              cursor: "pointer"
            }}
          >
            {isPaused ? "▶ Resume Tracking" : "⏸ Pause Tracking"}
          </button>
        </div>
      </div>

      {/* Footer Info */}
      <div style={{
        textAlign: "center",
        maxWidth: 360,
        fontSize: "0.75rem",
        color: "#6B7280",
        lineHeight: 1.4
      }}>
        💡 Keep this webpage open on your mobile phone while caring for the elder. Your phone location is streaming live to the central dashboard radar.
      </div>
    </div>
  );
}
