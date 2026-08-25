import { useState, useEffect, useRef } from "react";
import { geofenceApi } from "../services/trackingApi";

// Helper: Play alert sound on GPS breach
const playGpsAlarmSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(988, ctx.currentTime); // B5
    osc.frequency.setValueAtTime(1318, ctx.currentTime + 0.15); // E6
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) { /* ignore */ }
};

// Haversine Distance Calculation (Meters)
const getHaversineDistance = (c1, c2) => {
  if (!c1 || !c2 || typeof c1.lat !== "number" || typeof c1.lng !== "number" || typeof c2.lat !== "number" || typeof c2.lng !== "number") {
    return 0;
  }
  if (isNaN(c1.lat) || isNaN(c1.lng) || isNaN(c2.lat) || isNaN(c2.lng)) {
    return 0;
  }
  const R = 6371000; // Earth radius in meters
  const dLat = ((c2.lat - c1.lat) * Math.PI) / 180;
  const dLng = ((c2.lng - c1.lng) * Math.PI) / 180;
  const a = Math.max(0, Math.min(1,
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((c1.lat * Math.PI) / 180) *
      Math.cos((c2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  ));
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Time formatting helper
const formatTime = (ts) => {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return String(ts);
  }
};

// Get local PC IP for QR code (user must be on same LAN as phone)
const MOBILE_URL = `http://${window.location.hostname}:5175/mobile`;

export default function ExitAlertPanel({ toastRef, monitoring = false }) {
  // Geolocation and Coordinates State
  const [baselineCoords, setBaselineCoords] = useState({ lat: 6.9271, lng: 79.8612 }); // Colombo fallback
  const [liveCoords, setLiveCoords] = useState({ lat: 6.9271, lng: 79.8612 });
  
  const [geoStatus, setGeoStatus] = useState("loading");
  const [isLocked, setIsLocked] = useState(false);
  const [gpsBreaches, setGpsBreaches] = useState([]);

  // Mobile GPS state
  const [mobileCoords, setMobileCoords] = useState(null);
  const [mobileActive, setMobileActive] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const mobileCoordsRef = useRef(null);
  const mobileHasAlertedRef = useRef(false);

  const radarCanvasRef = useRef(null);
  const radarSweepRef = useRef(0);
  const animationFrameRef = useRef(null);
  const trajectoryRef = useRef([]);
  const hasAlertedRef = useRef(false);

  const baselineCoordsRef = useRef(baselineCoords);
  useEffect(() => {
    baselineCoordsRef.current = baselineCoords;
  }, [baselineCoords]);

  const liveCoordsRef = useRef(liveCoords);
  useEffect(() => {
    liveCoordsRef.current = liveCoords;
  }, [liveCoords]);


  // ── PC Geolocation Tracking (Activated strictly on monitoring) ──
  useEffect(() => {
    let watchId = null;
    let isLockedLocal = false;

    if (!monitoring) {
      // Clear geofence states when monitoring is off
      setGeoStatus("loading");
      setIsLocked(false);
      hasAlertedRef.current = false;
      trajectoryRef.current = [];
      setGpsBreaches([]);
      return;
    }

    if (navigator.geolocation) {
      setGeoStatus("loading");

      // Start watching position continuously with high accuracy
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (position && position.coords) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            if (typeof lat === "number" && typeof lng === "number" && !isNaN(lat) && !isNaN(lng)) {
              const coords = { lat, lng };

              // Apply Exponential Moving Average (EMA) to smooth out coordinate jitter
              const prev = liveCoordsRef.current;
              let nextCoords = coords;
              if (prev && prev.lat !== 6.9271 && prev.lng !== 79.8612) {
                const alpha = 0.25;
                nextCoords = {
                  lat: prev.lat * (1 - alpha) + lat * alpha,
                  lng: prev.lng * (1 - alpha) + lng * alpha,
                };
              }

              setLiveCoords(nextCoords);
              setGeoStatus("granted");

              // Lock the baseline center on the very first received real location
              const currentBaseline = isLockedLocal ? baselineCoordsRef.current : coords;

              if (!isLockedLocal) {
                setBaselineCoords(coords);
                baselineCoordsRef.current = coords;
                setIsLocked(true);
                isLockedLocal = true;
                console.log("[GPS] Geofence baseline coordinates locked:", coords);
              }

              // Calculate radar coordinates relative to the locked baseline
              const dLatMeters = (nextCoords.lat - currentBaseline.lat) * 111320;
              const radLat = (currentBaseline.lat * Math.PI) / 180;
              const dLngMeters = (nextCoords.lng - currentBaseline.lng) * 111320 * Math.cos(radLat);

              const cx_val = 300 / 2;
              const cy_val = 260 / 2;
              const radarRadius_val = Math.min(cx_val, cy_val) - 20;
              const scale_val = radarRadius_val / 15;

              const px = dLngMeters * scale_val;
              const py = -dLatMeters * scale_val;

              // Only append to trajectory history if the movement is significant (avoids static jitter)
              const newPoint = [cx_val + px, cy_val + py];
              const lastPoint = trajectoryRef.current[trajectoryRef.current.length - 1];
              if (!lastPoint || Math.hypot(newPoint[0] - lastPoint[0], newPoint[1] - lastPoint[1]) > 0.5) {
                trajectoryRef.current.push(newPoint);
                if (trajectoryRef.current.length > 25) {
                  trajectoryRef.current.shift();
                }
              }
            }
          }
        },
        (error) => {
          console.warn("[GPS] watchPosition failed:", error);
          setGeoStatus("denied");
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      setGeoStatus("not-supported");
    }

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [monitoring]);

  // ── Mobile GPS Polling (every 2s when monitoring) ─────────────────────────
  useEffect(() => {
    if (!monitoring) {
      setMobileCoords(null);
      setMobileActive(false);
      mobileCoordsRef.current = null;
      mobileHasAlertedRef.current = false;
      return;
    }

    const poll = async () => {
      try {
        const res = await geofenceApi.getMobileGps();
        if (res && res.data && typeof res.data.lat === "number" && typeof res.data.lng === "number") {
          const mc = { lat: res.data.lat, lng: res.data.lng, accuracy: res.data.accuracy };
          mobileCoordsRef.current = mc;
          setMobileCoords(mc);
          setMobileActive(true);
        }
      } catch {
        // 404 means no mobile connected — silently ignore
        setMobileActive(false);
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [monitoring]);

  const currentDistance = monitoring && isLocked ? getHaversineDistance(baselineCoords, liveCoords) : 0;
  const isBreached = !!(monitoring && typeof currentDistance === "number" && !isNaN(currentDistance) && currentDistance > 10.0);

  const mobileDistance = monitoring && isLocked && mobileCoords ? getHaversineDistance(baselineCoords, mobileCoords) : 0;
  const isMobileBreached = !!(monitoring && isLocked && mobileCoords && typeof mobileDistance === "number" && !isNaN(mobileDistance) && mobileDistance > 10.0);

  // Manual geofence reset/re-lock baseline
  const handleLockBaseline = () => {
    if (!monitoring) return;
    if (liveCoords && typeof liveCoords.lat === "number" && typeof liveCoords.lng === "number" && !isNaN(liveCoords.lat) && !isNaN(liveCoords.lng)) {
      setBaselineCoords(liveCoords);
      setIsLocked(true);
      hasAlertedRef.current = false;
      setGpsBreaches([]);
      trajectoryRef.current = [];
      if (toastRef && toastRef.current && typeof toastRef.current.addToast === "function") {
        try {
          toastRef.current.addToast("🏠 Geofence Center locked to current location");
        } catch (e) {
          console.error("Toast failed:", e);
        }
      }
    }
  };

  // ── PC Breach logic effect ────────────────────────────────────────────────
  useEffect(() => {
    if (!monitoring) return;
    
    if (isBreached) {
      if (!hasAlertedRef.current) {
        hasAlertedRef.current = true;
        playGpsAlarmSound();

        if (toastRef && toastRef.current && typeof toastRef.current.addToast === "function") {
          try {
            toastRef.current.addToast("🚨 PC away from home");
          } catch (e) {
            console.error("Toast failed:", e);
          }
        }

        setGpsBreaches((prev) => [
          {
            alert_id: "gps-" + Date.now(),
            distance: typeof currentDistance === "number" && !isNaN(currentDistance) ? currentDistance : 0,
            message: "PC away from home",
            timestamp: new Date().toISOString(),
            resolved: false
          },
          ...prev
        ]);
      }
    } else {
      if (hasAlertedRef.current) {
        hasAlertedRef.current = false;
        if (toastRef && toastRef.current && typeof toastRef.current.addToast === "function") {
          try {
            toastRef.current.addToast("🟢 PC returned inside geofence area");
          } catch (e) {
            console.error("Toast failed:", e);
          }
        }
      }
    }
  }, [isBreached, currentDistance, toastRef, monitoring]);

  // ── Mobile Breach logic effect ────────────────────────────────────────────
  useEffect(() => {
    if (!monitoring || !mobileCoords) return;

    if (isMobileBreached) {
      if (!mobileHasAlertedRef.current) {
        mobileHasAlertedRef.current = true;
        playGpsAlarmSound();

        if (toastRef && toastRef.current && typeof toastRef.current.addToast === "function") {
          try {
            toastRef.current.addToast(`🚨 📱 Elder's phone left safe zone! (${mobileDistance.toFixed(1)}m away)`);
          } catch (e) {
            console.error("Toast failed:", e);
          }
        }

        setGpsBreaches((prev) => [
          {
            alert_id: "mobile-gps-" + Date.now(),
            distance: typeof mobileDistance === "number" && !isNaN(mobileDistance) ? mobileDistance : 0,
            message: "📱 Elder's phone left safe zone",
            timestamp: new Date().toISOString(),
            resolved: false
          },
          ...prev
        ]);
      }
    } else {
      if (mobileHasAlertedRef.current) {
        mobileHasAlertedRef.current = false;
        if (toastRef && toastRef.current && typeof toastRef.current.addToast === "function") {
          try {
            toastRef.current.addToast("🟢 📱 Elder's phone back inside geofence area");
          } catch (e) {
            console.error("Toast failed:", e);
          }
        }
      }
    }
  }, [isMobileBreached, mobileDistance, mobileCoords, toastRef, monitoring]);

  // Dismiss a breach alert card
  const handleResolveAlert = (alertId) => {
    setGpsBreaches((prev) =>
      prev.map((a) => (a.alert_id === alertId ? { ...a, resolved: true } : a))
    );
  };

  // ── Radar Animation Loop ───────────────────────────────────────
  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const animate = () => {
      // Radar fading background sweep effect
      ctx.fillStyle = "rgba(10, 15, 30, 0.15)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radarRadius = Math.min(cx, cy) - 20;
      const scale = radarRadius / 15; // 15 meters maps to radarRadius

      // Increment sweep angle
      radarSweepRef.current = (radarSweepRef.current + 0.02) % (Math.PI * 2);

      // Draw background circles
      ctx.strokeStyle = "rgba(0, 212, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radarRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, radarRadius * 0.66, 0, Math.PI * 2); // 10m
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, radarRadius * 0.33, 0, Math.PI * 2); // 5m
      ctx.stroke();

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(cx - radarRadius, cy); ctx.lineTo(cx + radarRadius, cy);
      ctx.moveTo(cx, cy - radarRadius); ctx.lineTo(cx, cy + radarRadius);
      ctx.stroke();

      // 10m Geofence safe zone ring (always green)
      const safeRadius = 10 * scale;

      ctx.strokeStyle = "rgba(0, 255, 157, 0.4)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, safeRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(0, 255, 157, 0.03)";
      ctx.beginPath();
      ctx.arc(cx, cy, safeRadius, 0, Math.PI * 2);
      ctx.fill();

      // Radar Sweep Line
      const sweepX = cx + Math.cos(radarSweepRef.current) * radarRadius;
      const sweepY = cy + Math.sin(radarSweepRef.current) * radarRadius;
      ctx.strokeStyle = "rgba(0, 212, 255, 0.25)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sweepX, sweepY);
      ctx.stroke();

      // Draw Center Baseline Marker (Geofence Origin)
      ctx.fillStyle = "#00D4FF";
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      // Outer ring for Center
      ctx.strokeStyle = "rgba(0, 212, 255, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.stroke();

      // Only calculate and plot PC location if monitoring is active and coordinates locked
      if (monitoring && isLocked) {
        // Calculate PC position relative to Geofence Center (in meters)
        const dLatMeters = (liveCoords.lat - baselineCoords.lat) * 111320;
        const radLat = (baselineCoords.lat * Math.PI) / 180;
        const dLngMeters = (liveCoords.lng - baselineCoords.lng) * 111320 * Math.cos(radLat);

        // Convert meters to pixels
        const px = dLngMeters * scale;
        const py = -dLatMeters * scale;

        // Draw PC history trail
        ctx.strokeStyle = "rgba(255, 59, 92, 0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        trajectoryRef.current.forEach(([tx, ty], idx) => {
          if (idx === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        });
        ctx.stroke();

        // Draw PC Dot Marker (red)
        const dotColor = "#FF3B5C";
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#FF3B5C";
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText("💻 PC", cx + px + 12, cy + py - 4);
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        const distStr = typeof currentDistance === "number" && !isNaN(currentDistance) ? `${currentDistance.toFixed(1)}m` : "0.0m";
        ctx.fillText(distStr, cx + px + 12, cy + py + 8);

        // ── Draw Mobile / Elder Phone Dot (orange) ──
        if (mobileCoordsRef.current) {
          const mc = mobileCoordsRef.current;
          const mdLat = (mc.lat - baselineCoords.lat) * 111320;
          const mdLng = (mc.lng - baselineCoords.lng) * 111320 * Math.cos(radLat);
          const mpx = mdLng * scale;
          const mpy = -mdLat * scale;

          // Pulsing ring for mobile dot
          const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
          ctx.strokeStyle = `rgba(255, 165, 0, ${0.3 + 0.4 * pulse})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx + mpx, cy + mpy, 14 + pulse * 4, 0, Math.PI * 2);
          ctx.stroke();

          // Orange filled dot
          ctx.fillStyle = "#FFA500";
          ctx.beginPath();
          ctx.arc(cx + mpx, cy + mpy, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#FFA500";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx + mpx, cy + mpy, 14, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = "#FFA500";
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.fillText("📱 ELDER", cx + mpx + 12, cy + mpy - 4);
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          const mDistStr = typeof mobileDistance === "number" && !isNaN(mobileDistance) ? `${mobileDistance.toFixed(1)}m` : "0.0m";
          ctx.fillText(mDistStr, cx + mpx + 12, cy + mpy + 8);
        }
      } else {
        // Draw IDLE state overlay text in center when not monitoring
        ctx.fillStyle = "rgba(0, 212, 255, 0.3)";
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = "center";
        ctx.fillText("GEOFENCE STANDBY", cx, cy + 35);
        ctx.textAlign = "left";
      }

      // Distance rings labels
      ctx.fillStyle = "rgba(0, 212, 255, 0.35)";
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText("5M RING", cx, cy - (5 * scale) + 9);
      ctx.fillStyle = "rgba(0, 255, 157, 0.5)";
      ctx.fillText("10M SAFE LIMIT", cx, cy - safeRadius - 5);
      ctx.textAlign = "left";

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [baselineCoords, liveCoords, mobileCoords, currentDistance, mobileDistance, isBreached, isMobileBreached, monitoring, isLocked]);

  return (
    <div className="panel exit-alert-panel">
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="icon">🛰️</span> PC GPS Geofence
          {gpsBreaches.filter((b) => !b.resolved).length > 0 && (
            <span className="exit-alert-badge">
              {gpsBreaches.filter((b) => !b.resolved).length}
            </span>
          )}
        </h2>
        {gpsBreaches.length > 0 && (
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setGpsBreaches([])}
            style={{ fontSize: "0.65rem", padding: "2px 8px" }}
            title="Clear GPS breach logs"
          >
            🗑️ Clear
          </button>
        )}
      </div>

      <div className="panel-body" style={{ padding: 14 }}>
        {/* Baseline locking HUD info */}
        <div style={{
          background: "rgba(0, 212, 255, 0.05)",
          border: "1px solid rgba(0, 212, 255, 0.15)",
          borderRadius: "6px",
          padding: "10px",
          marginBottom: "12px",
          fontSize: "0.75rem",
          display: "flex",
          flexDirection: "column",
          gap: "6px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <strong style={{ color: "#00D4FF" }}>Geofence Center (Baseline):</strong><br />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-primary)" }}>
                {monitoring && isLocked && baselineCoords && typeof baselineCoords.lat === "number" && typeof baselineCoords.lng === "number" && !isNaN(baselineCoords.lat) && !isNaN(baselineCoords.lng)
                  ? `Lat: ${baselineCoords.lat.toFixed(6)}° | Lng: ${baselineCoords.lng.toFixed(6)}°`
                  : "Not Locked (Start Monitoring to Lock)"}
              </span>
            </div>
            <button
              className="btn btn-ghost btn-xs"
              onClick={handleLockBaseline}
              disabled={!monitoring}
              style={{ fontSize: "0.65rem", padding: "2px 6px" }}
            >
              🏠 Re-center
            </button>
          </div>
          
          <div style={{ borderTop: "1px solid rgba(0, 212, 255, 0.1)", paddingTop: "4px" }}>
            <strong style={{ color: "var(--text-secondary)" }}>Live PC Location Status:</strong><br />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-secondary)" }}>
              {monitoring ? (
                geoStatus === "granted" ? "🟢 GPS Signal Active (High Accuracy)" : "🟡 Initializing/No GPS"
              ) : (
                "⚪ Geofencing Off (Start Monitoring to Activate)"
              )}
            </span>
          </div>

          <div style={{ borderTop: "1px solid rgba(0, 212, 255, 0.1)", paddingTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span><strong>Distance Offset:</strong></span>
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              fontWeight: "bold",
              color: !monitoring ? "var(--text-muted)" : isBreached ? "#FF3B5C" : "#00FF9D"
            }}>
              {monitoring && typeof currentDistance === "number" && !isNaN(currentDistance) ? `${currentDistance.toFixed(1)} meters` : "N/A"}
            </span>
          </div>
        </div>

        {/* Live Radar Sweep Canvas */}
        <div style={{
          position: "relative",
          width: "100%",
          background: "#0A0F1E",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          overflow: "hidden",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: "14px"
        }}>
          <canvas
            ref={radarCanvasRef}
            width={300}
            height={260}
            style={{ display: "block" }}
          />
          
          {/* Radar details overlay */}
          <div style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontSize: "0.6rem",
            color: monitoring ? (isBreached ? "#FF3B5C" : "rgba(0, 212, 255, 0.6)") : "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            background: "rgba(10, 15, 30, 0.85)",
            padding: "2px 6px",
            borderRadius: "4px",
            border: `1px solid ${monitoring ? (isBreached ? "#FF3B5C" : "rgba(0, 212, 255, 0.15)") : "var(--border)"}`
          }}>
            {!monitoring ? "⏸ STANDBY" : isBreached ? "🚨 GEOFENCE BREACHED" : "🛡️ GEOFENCE ACTIVE"}
          </div>

          <div style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            fontSize: "0.6rem",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            background: "rgba(10, 15, 30, 0.8)",
            padding: "2px 6px",
            borderRadius: "4px"
          }}>
            Radar Radius: 15m
          </div>

          {/* Mobile GPS live badge */}
          {mobileActive && (
            <div style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              fontSize: "0.6rem",
              color: isMobileBreached ? "#FFA500" : "#00FF9D",
              fontFamily: "var(--font-mono)",
              background: "rgba(10, 15, 30, 0.85)",
              padding: "2px 6px",
              borderRadius: "4px",
              border: `1px solid ${isMobileBreached ? "#FFA500" : "rgba(0,255,157,0.3)"}`
            }}>
              📱 {isMobileBreached ? `ELDER OUT ${mobileDistance.toFixed(1)}m` : `ELDER IN ${mobileDistance.toFixed(1)}m`}
            </div>
          )}
        </div>

        {/* QR Code & Mobile Tracker Section */}
        <div style={{
          background: "rgba(255, 165, 0, 0.05)",
          border: "1px solid rgba(255, 165, 0, 0.2)",
          borderRadius: "8px",
          padding: "10px 12px",
          marginBottom: "12px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "0.72rem", color: "#FFA500", fontWeight: 600 }}>📱 Mobile Elder Tracker</span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              {mobileActive && (
                <span style={{ fontSize: "0.65rem", color: "#00FF9D", fontFamily: "var(--font-mono)" }}>🟢 Connected</span>
              )}
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => setShowQr((v) => !v)}
                style={{ fontSize: "0.65rem", padding: "2px 8px", color: "#FFA500", borderColor: "rgba(255,165,0,0.3)" }}
              >
                {showQr ? "✕ Hide QR" : "📷 Show QR"}
              </button>
            </div>
          </div>

          {!mobileActive && !showQr && (
            <p style={{ fontSize: "0.68rem", color: "#718096", margin: 0 }}>
              Scan the QR code with elder's phone to track their real location on radar.
            </p>
          )}

          {showQr && (
            <div style={{ textAlign: "center", paddingTop: "6px" }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(MOBILE_URL)}&bgcolor=0a0f1e&color=00D4FF&margin=8`}
                alt="Mobile GPS QR Code"
                style={{ borderRadius: "8px", border: "1px solid rgba(0,212,255,0.2)", display: "block", margin: "0 auto 6px" }}
              />
              <div style={{ fontSize: "0.6rem", color: "#718096", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                {MOBILE_URL}
              </div>
              <p style={{ fontSize: "0.65rem", color: "#a0aec0", marginTop: "6px", marginBottom: 0 }}>
                Ensure phone is on the <strong>same Wi-Fi</strong> network as this PC.
              </p>
            </div>
          )}

          {mobileActive && mobileCoords && (
            <div style={{ fontSize: "0.68rem", color: "#a0aec0", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
              Lat: <span style={{ color: "#FFA500" }}>{mobileCoords.lat.toFixed(6)}°</span>{" "}
              Lng: <span style={{ color: "#FFA500" }}>{mobileCoords.lng.toFixed(6)}°</span>{" "}
              · <span style={{ color: isMobileBreached ? "#FC8181" : "#00FF9D" }}>{mobileDistance.toFixed(1)}m</span>
            </div>
          )}
        </div>

        {/* GPS breach alerts display */}
        <div>
          <h4 style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
            🚨 GEOFENCE ALARM LOGS
          </h4>
          {gpsBreaches.length === 0 ? (
            <div className="alert-empty" style={{ padding: "16px 8px" }}>
              <div className="empty-icon" style={{ fontSize: "1.2rem" }}>🛡️</div>
              <p style={{ fontSize: "0.7rem" }}>No GPS alerts — PC within boundary</p>
            </div>
          ) : (
            <div className="exit-alert-list" style={{ maxHeight: "150px" }}>
              {gpsBreaches.map((alert) => (
                <div
                  key={alert.alert_id}
                  className={`exit-alert-card ${alert.resolved ? "resolved" : "unresolved"}`}
                  style={{ padding: "8px 10px" }}
                >
                  <div className="exit-alert-header" style={{ marginBottom: 2 }}>
                    <span className="exit-alert-type" style={{ fontSize: "0.65rem", color: alert.resolved ? "var(--text-muted)" : "#FF3B5C" }}>
                      {alert.resolved ? "✅ RESOLVED" : "🚨 RADIUS EXIT"}
                    </span>
                    <span className="exit-alert-time" style={{ fontSize: "0.65rem" }}>
                      {formatTime(alert.timestamp)}
                    </span>
                  </div>
                  <div className="exit-alert-message" style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: 2 }}>
                    <strong>{alert.message || "away from home"}</strong> ({alert.distance.toFixed(1)}m)
                  </div>
                  {!alert.resolved && (
                    <div className="exit-alert-actions" style={{ marginTop: 4 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleResolveAlert(alert.alert_id)}
                        style={{ fontSize: "0.65rem", padding: "2px 8px" }}
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
    </div>
  );
}
