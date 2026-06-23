import { useState, useRef, useCallback, useEffect } from "react";
import { trackingApi, geofenceApi } from "../services/trackingApi";

/* ── Utilities ──────────────────────────────────────────────────── */

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getTrackColor(durationSeconds) {
  if (durationSeconds < 2) return "#FFD700";
  if (durationSeconds < 10) return "#00D4FF";
  return "#00FF9D";
}

function pointInPolygon(point, polygon) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

const ZONE_COLORS = { safe: "#00FF9D", restricted: "#FF3B5C", alert: "#FFB347" };

/* ── Alert Sound ────────────────────────────────────────────────── */

const playAlertSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(440, ctx.currentTime + 0.2);
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.5);
  } catch (e) { /* ignore audio errors */ }
};

/* ── Drawing Functions ──────────────────────────────────────────── */

function drawZones(ctx, zones, scaleX, scaleY) {
  zones.forEach((zone) => {
    if (!zone.is_active || !zone.polygon || zone.polygon.length < 3) return;
    const color = ZONE_COLORS[zone.zone_type] || "#00D4FF";
    const points = zone.polygon.map(([px, py]) => [px * scaleX, py * scaleY]);

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([px, py]) => ctx.lineTo(px, py));
    ctx.closePath();
    ctx.fillStyle = hexToRgba(color, 0.13);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Zone label
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
    ctx.fillStyle = color;
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(zone.name.toUpperCase(), cx, cy);
    ctx.textAlign = "left";
  });
}

function drawPersons(ctx, persons, scaleX, scaleY, breachedIds, identityMap) {
  persons.forEach((person) => {
    const x = person.bbox.x * scaleX;
    const y = person.bbox.y * scaleY;
    const w = person.bbox.w * scaleX;
    const h = person.bbox.h * scaleY;
    const dur = person.duration_seconds || 0;
    const isBreach = breachedIds.has(person.person_id);

    // Identity-aware coloring
    const idInfo = identityMap.get(person.person_id);
    const isIdentified = idInfo && idInfo.name;
    const isCaregiver = idInfo && idInfo.role === "caregiver";

    let boxColor;
    if (isBreach) boxColor = "#FF3B5C";
    else if (isCaregiver) boxColor = "#00D4FF";
    else if (isIdentified) boxColor = "#00FF9D";
    else boxColor = "#FFB347"; // unknown/identifying

    // Trajectory trail
    if (person.trajectory && person.trajectory.length > 1) {
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = hexToRgba(boxColor, 0.5);
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;
      person.trajectory.forEach(([tx, ty], i) => {
        const px = tx * scaleX;
        const py = ty * scaleY;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Bounding box
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = boxColor;
    ctx.shadowBlur = 8;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

    // Corner accents
    const cl = Math.min(14, w * 0.2, h * 0.1);
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + h - cl); ctx.lineTo(x, y + h); ctx.lineTo(x + cl, y + h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - cl, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cl); ctx.stroke();

    // Label
    let label, sublabel, roleBadge;
    if (isIdentified) {
      label = idInfo.name;
      roleBadge = `[${idInfo.role}]`;
      sublabel = `${dur.toFixed(1)}s`;
    } else {
      label = "Identifying...";
      roleBadge = null;
      sublabel = `${dur.toFixed(1)}s`;
    }

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    const labelTextW = ctx.measureText(label).width;
    const badgeW = roleBadge ? ctx.measureText(` ${roleBadge}`).width : 0;
    const totalLabelW = labelTextW + badgeW + 16;
    const labelH = isBreach ? 50 : 36;
    ctx.fillStyle = hexToRgba(boxColor, 0.85);
    ctx.fillRect(x, y - labelH, totalLabelW, labelH);

    // Name
    ctx.fillStyle = "#0A0F1E";
    ctx.fillText(label, x + 5, y - labelH + 16);

    // Role badge
    if (roleBadge) {
      ctx.fillStyle = isCaregiver ? "#006B99" : "#333";
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillText(roleBadge, x + 5 + labelTextW + 4, y - labelH + 16);
    }

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = "#0A0F1E";
    ctx.fillText(sublabel, x + 5, y - labelH + 30);

    // Breach badge
    if (isBreach) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText("⚠ RESTRICTED", x + 5, y - labelH + 44);
    }

    // Centroid dot
    const cx = (person.bbox.x + person.bbox.w / 2) * scaleX;
    const cy = (person.bbox.y + person.bbox.h / 2) * scaleY;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = boxColor;
    ctx.shadowColor = boxColor;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
  });
}

function drawPendingPolygon(ctx, points, scaleX, scaleY, zoneType) {
  if (points.length === 0) return;
  const color = ZONE_COLORS[zoneType] || "#00D4FF";
  const scaled = points.map(([px, py]) => [px * scaleX, py * scaleY]);

  ctx.beginPath();
  ctx.moveTo(scaled[0][0], scaled[0][1]);
  scaled.slice(1).forEach(([px, py]) => ctx.lineTo(px, py));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw numbered points
  scaled.forEach(([px, py], idx) => {
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Number
    ctx.fillStyle = "#0A0F1E";
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(String(idx + 1), px, py + 3);
    ctx.textAlign = "left";
  });
}

/* ── Component ──────────────────────────────────────────────────── */

export default function TrackingFeed({ backendOnline, zones = [], alerts = [], onZoneSaved }) {
  const [monitoring, setMonitoring] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [persons, setPersons] = useState([]);
  const [breachActive, setBreachActive] = useState(false);
  const [error, setError] = useState(null);

  // Drawing mode state
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [zoneType, setZoneType] = useState("restricted");
  const [savingZone, setSavingZone] = useState(false);

  // Identity state
  const identityMapRef = useRef(new Map()); // personId -> { name, role, confidence, cachedAt }
  const frameCountRef = useRef(0);

  // Exit alert flash state
  const [exitAlertActive, setExitAlertActive] = useState(false);
  const [latestExitAlert, setLatestExitAlert] = useState(null);
  const exitAlertTimerRef = useRef(null);

  const videoRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const failCountRef = useRef(0);
  const breachLoggedRef = useRef(new Set());
  const breachedIdsRef = useRef(new Set());
  const zonesRef = useRef(zones);
  const drawingModeRef = useRef(drawingMode);
  const drawingPointsRef = useRef(drawingPoints);
  const zoneTypeRef = useRef(zoneType);

  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { drawingModeRef.current = drawingMode; }, [drawingMode]);
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);
  useEffect(() => { zoneTypeRef.current = zoneType; }, [zoneType]);

  /* ── Start / Stop ─────────────────────────────────────────────── */

  const stopMonitoring = useCallback(() => {
    setMonitoring(false);
    setVideoReady(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setPersons([]);
    setBreachActive(false);
    identityMapRef.current.clear();
    frameCountRef.current = 0;
  }, []);

  const startMonitoring = useCallback(async () => {
    if (!backendOnline) return;
    setError(null);
    failCountRef.current = 0;
    breachLoggedRef.current.clear();
    identityMapRef.current.clear();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "environment" },
      });
      streamRef.current = stream;
      setMonitoring(true);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch {
      setError("Camera access denied. Please allow camera permissions.");
    }
  }, [backendOnline]);

  const handleVideoReady = useCallback(() => setVideoReady(true), []);

  /* ── Sync overlay canvas size to video display size ───────────── */

  useEffect(() => {
    const video = videoRef.current;
    const canvas = overlayCanvasRef.current;
    if (!video || !canvas) return;

    const syncSize = () => {
      const rect = video.getBoundingClientRect();
      if (rect.width === 0) return;
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
    };

    const observer = new ResizeObserver(syncSize);
    observer.observe(video);
    video.addEventListener("loadedmetadata", syncSize);
    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", syncSize);
    };
  }, [monitoring]);

  /* ── Frame capture & send ─────────────────────────────────────── */

  useEffect(() => {
    if (!monitoring || !backendOnline || !videoReady) return;

    const captureAndSend = async () => {
      const video = videoRef.current;
      const captureCanvas = captureCanvasRef.current;
      if (!video || !captureCanvas || !video.videoWidth || !video.videoHeight) return;

      const ctx = captureCanvas.getContext("2d");
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

      const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.7);
      const base64 = dataUrl.split(",")[1];

      try {
        const res = await trackingApi.processFrame(base64);
        if (res.data) {
          const newPersons = res.data.persons || [];
          setPersons(newPersons);
          failCountRef.current = 0;
          setError(null);

          // Draw immediately on every frame capture and sync canvas to video size
          if (video && overlayCanvasRef.current) {
            const rect = video.getBoundingClientRect();
            if (rect.width > 0 && (overlayCanvasRef.current.width !== rect.width || overlayCanvasRef.current.height !== rect.height)) {
              overlayCanvasRef.current.width = rect.width;
              overlayCanvasRef.current.height = rect.height;
              overlayCanvasRef.current.style.width = rect.width + "px";
              overlayCanvasRef.current.style.height = rect.height + "px";
            }
            if (overlayCanvasRef.current.width > 0) {
              const ctx = overlayCanvasRef.current.getContext("2d");
              ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
              const scaleX = overlayCanvasRef.current.width / (video.videoWidth || 640);
              const scaleY = overlayCanvasRef.current.height / (video.videoHeight || 480);
              
              drawZones(ctx, zonesRef.current, scaleX, scaleY);
              drawPersons(ctx, newPersons, scaleX, scaleY, breachedIdsRef.current, identityMapRef.current);
              
              if (drawingModeRef.current && drawingPointsRef.current.length > 0) {
                drawPendingPolygon(ctx, drawingPointsRef.current, scaleX, scaleY, zoneTypeRef.current);
              }
            }
          }

          // Handle exit alerts from response
          const exitAlerts = res.data.exit_alerts || [];
          if (exitAlerts.length > 0) {
            setLatestExitAlert(exitAlerts[0]);
            setExitAlertActive(true);
            playAlertSound();
            if (exitAlertTimerRef.current) clearTimeout(exitAlertTimerRef.current);
            exitAlertTimerRef.current = setTimeout(() => setExitAlertActive(false), 3000);
          }
        } else {
          failCountRef.current++;
        }
      } catch {
        failCountRef.current++;
      }

      // Identity check every 10 frames
      frameCountRef.current++;
      if (frameCountRef.current % 10 === 0) {
        try {
          const idRes = await trackingApi.identifyPerson(base64);
          if (idRes.data && idRes.data.matched) {
            const now = Date.now();
            // Cache identity for all visible persons (face match applies to current frame)
            const persons_ = persons;
            if (persons_.length > 0) {
              const firstPerson = persons_[0];
              identityMapRef.current.set(firstPerson.person_id, {
                name: idRes.data.identity,
                role: idRes.data.role,
                confidence: idRes.data.confidence,
                cachedAt: now,
              });
            }
          }
        } catch { /* face-verification may be down */ }
      }

      // Expire cached identities older than 30 seconds
      const now = Date.now();
      for (const [pid, info] of identityMapRef.current.entries()) {
        if (now - info.cachedAt > 30000) {
          identityMapRef.current.delete(pid);
        }
      }

      if (failCountRef.current >= 3) {
        setError("Backend offline — monitoring paused.");
      }
    };

    intervalRef.current = setInterval(captureAndSend, 500);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [monitoring, backendOnline, videoReady, stopMonitoring]);

  /* ── Breach detection (client-side) ───────────────────────────── */

  useEffect(() => {
    if (!persons.length || !zones.length) {
      setBreachActive(false);
      return;
    }

    const restrictedZones = zones.filter((z) => z.is_active && z.zone_type === "restricted" && z.polygon?.length >= 3);
    const newBreachedIds = new Set();

    persons.forEach((person) => {
      const cx = person.bbox.x + person.bbox.w / 2;
      const cy = person.bbox.y + person.bbox.h / 2;

      restrictedZones.forEach((zone) => {
        if (pointInPolygon([cx, cy], zone.polygon)) {
          newBreachedIds.add(person.person_id);
          const breachKey = `${person.person_id}:${zone.zone_id}`;
          if (!breachLoggedRef.current.has(breachKey)) {
            breachLoggedRef.current.add(breachKey);
            geofenceApi.checkBreach({ person_id: person.person_id, x: cx, y: cy }).catch(() => {});
          }
        }
      });
    });

    setBreachActive(newBreachedIds.size > 0);
    breachedIdsRef.current = newBreachedIds;
  }, [persons, zones]);

  /* ── Draw everything on overlay canvas ────────────────────────── */

  useEffect(() => {
    const video = videoRef.current;
    const canvas = overlayCanvasRef.current;
    if (!canvas || !video) return;
    if (canvas.width === 0) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const videoW = video.videoWidth || 640;
    const videoH = video.videoHeight || 480;
    const scaleX = canvas.width / videoW;
    const scaleY = canvas.height / videoH;

    drawZones(ctx, zones, scaleX, scaleY);
    drawPersons(ctx, persons, scaleX, scaleY, breachedIdsRef.current, identityMapRef.current);

    if (drawingMode && drawingPoints.length > 0) {
      drawPendingPolygon(ctx, drawingPoints, scaleX, scaleY, zoneType);
    }
  }, [persons, zones, drawingMode, drawingPoints, zoneType]);

  /* ── Canvas click handler (drawing mode) ──────────────────────── */

  const handleCanvasClick = useCallback((e) => {
    if (!drawingMode) return;
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const rect = canvas.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;
    const videoW = video.videoWidth || 640;
    const videoH = video.videoHeight || 480;
    const videoX = Math.round((displayX / canvas.width) * videoW);
    const videoY = Math.round((displayY / canvas.height) * videoH);

    setDrawingPoints((prev) => [...prev, [videoX, videoY]]);
  }, [drawingMode]);

  const handleCanvasDoubleClick = useCallback((e) => {
    e.preventDefault();
    if (!drawingMode || drawingPoints.length < 3) return;
    setShowZoneForm(true);
  }, [drawingMode, drawingPoints]);

  /* ── Zone save ────────────────────────────────────────────────── */

  const handleSaveZone = async () => {
    if (drawingPoints.length < 3) return;
    setSavingZone(true);
    const name = zoneName.trim() || `Zone-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    try {
      await geofenceApi.createZone({
        name,
        zone_type: zoneType,
        polygon: drawingPoints,
        color: ZONE_COLORS[zoneType],
      });
      setDrawingPoints([]);
      setShowZoneForm(false);
      setZoneName("");
      setDrawingMode(false);
      if (onZoneSaved) onZoneSaved();
    } catch (err) {
      console.error("Failed to save zone:", err);
    } finally {
      setSavingZone(false);
    }
  };

  const handleCancelDrawing = () => {
    setDrawingPoints([]);
    setShowZoneForm(false);
    setZoneName("");
    setDrawingMode(false);
  };

  /* ── Cleanup ──────────────────────────────────────────────────── */

  useEffect(() => { return () => stopMonitoring(); }, [stopMonitoring]);

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div className="panel feed-container">
      <div className="panel-header">
        <h2><span className="icon">📹</span> Live Tracking Feed</h2>
        <div className="feed-toolbar">
          {monitoring && !drawingMode && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setDrawingMode(true); setDrawingPoints([]); }}>
              📐 Draw Zone
            </button>
          )}
          {drawingMode && (
            <button className="btn btn-ghost btn-sm" onClick={handleCancelDrawing}>
              ✕ Cancel Draw
            </button>
          )}
          {monitoring ? (
            <button className="btn btn-danger btn-sm" onClick={stopMonitoring}>⏹ Stop</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={startMonitoring} disabled={!backendOnline}>
              ▶ Start Monitoring
            </button>
          )}
        </div>
      </div>
      <div className="panel-body">
        {error && (
          <div style={{ padding: "8px 12px", background: "rgba(255,59,92,0.1)", borderRadius: "6px", color: "#FF3B5C", fontSize: "0.8rem", marginBottom: "10px" }}>
            ⚠️ {error}
          </div>
        )}

        {/* Video + overlay wrapper */}
        <div
          className={`feed-video-wrapper ${drawingMode ? "drawing-mode-active" : ""} ${breachActive ? "breach-active" : ""}`}
          style={{ display: monitoring ? "block" : "none", position: "relative" }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={handleVideoReady}
            onPlaying={handleVideoReady}
            style={{ width: "100%", display: "block" }}
          />
          <canvas
            ref={overlayCanvasRef}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            style={{
              position: "absolute",
              top: 0, left: 0,
              pointerEvents: drawingMode ? "auto" : "none",
            }}
          />
          <canvas ref={captureCanvasRef} style={{ display: "none" }} />
          {!drawingMode && <div className="scan-line" />}

          {/* Exit alert flash overlay */}
          {exitAlertActive && (
            <div className="exit-flash-overlay">
              <div className="exit-flash-content">
                ⚠ ZONE EXIT DETECTED<br />
                <span style={{ fontSize: "14px" }}>{latestExitAlert?.message}</span>
              </div>
            </div>
          )}

          {/* Zone save form overlay */}
          {showZoneForm && (
            <div className="zone-form-overlay">
              <div className="form-row" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                  Name this zone
                </span>
              </div>
              <div className="form-row">
                <input
                  type="text"
                  placeholder="Zone name"
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  autoFocus
                />
                <select value={zoneType} onChange={(e) => setZoneType(e.target.value)}>
                  <option value="restricted">🔴 Restricted</option>
                  <option value="safe">🟢 Safe</option>
                  <option value="alert">🟠 Alert</option>
                </select>
              </div>
              <div className="form-row" style={{ marginTop: 4 }}>
                <div className="zone-type-radio-group">
                  {["safe", "restricted", "alert"].map((t) => (
                    <label key={t} className={`zone-type-radio ${zoneType === t ? "active" : ""} ${t}`}>
                      <input type="radio" name="ztype" value={t} checked={zoneType === t} onChange={() => setZoneType(t)} />
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-row" style={{ marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={handleSaveZone} disabled={savingZone}>
                  {savingZone ? "Saving..." : "💾 Save Zone"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={handleCancelDrawing}>Cancel</button>
                <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {drawingPoints.length} points
                </span>
              </div>
            </div>
          )}

          {/* Drawing instructions */}
          {drawingMode && !showZoneForm && (
            <div className="canvas-instructions">
              Click to add points · Double-click to finish · {drawingPoints.length} point{drawingPoints.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {!monitoring && (
          <div className="feed-placeholder">
            <span className="cam-icon">📷</span>
            <span>Click "Start Monitoring" to begin</span>
            {!backendOnline && <span style={{ color: "#FF3B5C", fontSize: "0.75rem" }}>Backend offline</span>}
          </div>
        )}

        <div className="feed-info">
          <span className="detection-count">
            👤 {persons.length} person{persons.length !== 1 ? "s" : ""} tracked
            {breachActive && <span style={{ color: "#FF3B5C", marginLeft: 8 }}>⚠ BREACH</span>}
          </span>
          <span>{monitoring ? "🔴 LIVE" : "⏸ IDLE"}</span>
        </div>
      </div>
    </div>
  );
}
