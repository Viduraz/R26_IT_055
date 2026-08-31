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

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return {
      distance: Math.sqrt((px - x1) ** 2 + (py - y1) ** 2),
      closestPoint: [x1, y1]
    };
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return {
    distance: Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2),
    closestPoint: [closestX, closestY]
  };
}

function pointToPolygonDistance(point, polygon) {
  const [px, py] = point;
  if (pointInPolygon(point, polygon)) {
    return { distance: 0, closestPoint: [px, py] };
  }
  let minDistance = Infinity;
  let closestPoint = null;
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const res = pointToSegmentDistance(px, py, p1[0], p1[1], p2[0], p2[1]);
    if (res.distance < minDistance) {
      minDistance = res.distance;
      closestPoint = res.closestPoint;
    }
  }
  return { distance: minDistance, closestPoint };
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

const speakAlert = (message) => {
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Cancel any ongoing speech
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  } catch (e) { /* ignore speech errors */ }
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

function drawPersons(ctx, persons, scaleX, scaleY, breachedIds, identityMap, warningIds = new Set(), warningRemaining = new Map(), zones = []) {
  persons.forEach((person) => {
    const x = person.bbox.x * scaleX;
    const y = person.bbox.y * scaleY;
    const w = person.bbox.w * scaleX;
    const h = person.bbox.h * scaleY;
    const dur = person.duration_seconds || 0;
    const isBreach = breachedIds.has(person.person_id);
    const isWarning = warningIds.has(person.person_id);

    // Tracker-specific default colors: Neon Green vs Electric Purple
    const isByteTrack = person.tracker_name === "ByteTrack" || (person.person_id && person.person_id.includes("(ByteTrack)"));
    const trackerName = isByteTrack ? "ByteTrack" : "DeepSORT";
    const defaultColor = isByteTrack ? "#00FF9D" : "#8A4FFF";

    // Identity-aware coloring
    const idInfo = identityMap.get(person.person_id);
    const isIdentified = idInfo && idInfo.name;
    const isCaregiver = idInfo && idInfo.role === "caregiver";

    let boxColor;
    if (isBreach) boxColor = "#FF3B5C";
    else if (isWarning) boxColor = "#FF8C00";
    else if (isCaregiver) boxColor = "#00D4FF";
    else boxColor = defaultColor;

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
      label = `${idInfo.name} (${trackerName})`;
      roleBadge = `[${idInfo.role}]`;
      sublabel = `${dur.toFixed(1)}s`;
    } else {
      label = person.person_id; // e.g. "P-001 (ByteTrack)"
      roleBadge = null;
      sublabel = `${dur.toFixed(1)}s`;
    }

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    const labelTextW = ctx.measureText(label).width;
    const badgeW = roleBadge ? ctx.measureText(` ${roleBadge}`).width : 0;
    const totalLabelW = labelTextW + badgeW + 16;
    const labelH = (isBreach || isWarning) ? 50 : 36;
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

    // Breach/Warning badge
    if (isBreach) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText("⚠ RESTRICTED", x + 5, y - labelH + 44);
    } else if (isWarning) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      const remainingSec = warningRemaining.get(person.person_id) || 5;
      ctx.fillText(`⚠ PENDING (${remainingSec}s)`, x + 5, y - labelH + 44);
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

    // Calculate and draw distance line to the closest restricted zone (door)
    const feetX = person.bbox.x + person.bbox.w / 2;
    const feetY = person.bbox.y + person.bbox.h;
    const restrictedZones = zones.filter(
      (z) => z.is_active && z.zone_type === "restricted" && z.polygon?.length >= 3
    );

    if (restrictedZones.length > 0) {
      let closestZone = null;
      let minDistancePx = Infinity;
      let closestPointOnZone = null;

      restrictedZones.forEach((zone) => {
        const res = pointToPolygonDistance([feetX, feetY], zone.polygon);
        if (res.distance < minDistancePx) {
          minDistancePx = res.distance;
          closestPointOnZone = res.closestPoint;
          closestZone = zone;
        }
      });

      if (closestZone && closestPointOnZone) {
        const bboxW = person.bbox.w || 0;
        const bboxH = person.bbox.h || 0;
        const aspectRatio = bboxH > 0 ? (bboxW / bboxH) : 0;
        const isSitting = person.is_sitting !== undefined ? person.is_sitting : (aspectRatio >= 0.55);

        const effectiveHeightPx = isSitting ? Math.max(bboxH, bboxW / 0.45) : bboxH;
        const pixelsPerMeter = effectiveHeightPx > 0 ? (effectiveHeightPx / 1.7) : 1;
        const dist2DPixels = minDistancePx;
        const dist2DMeters = dist2DPixels / pixelsPerMeter;

        const personDistFromCam = effectiveHeightPx > 0 ? (850 / effectiveHeightPx) : 0;
        const zoneDistFromCam = closestZone.camera_distance || 4.0;
        const feetInPolygon = pointInPolygon([feetX, feetY], closestZone.polygon);

        let effectiveDistanceMeters = 0.0;
        let isBreaching = false;

        if (isSitting) {
          // Person sitting in a chair: suppress restricted area entry/breach alert
          isBreaching = false;
          effectiveDistanceMeters = feetInPolygon ? 0.0 : dist2DMeters;
        } else if (feetInPolygon) {
          if (personDistFromCam < zoneDistFromCam - 0.5) {
            effectiveDistanceMeters = zoneDistFromCam - personDistFromCam;
            isBreaching = false;
          } else {
            effectiveDistanceMeters = 0.0;
            isBreaching = true;
          }
        } else {
          if (personDistFromCam < zoneDistFromCam - 0.5) {
            effectiveDistanceMeters = dist2DMeters + (zoneDistFromCam - personDistFromCam);
            isBreaching = false;
          } else {
            effectiveDistanceMeters = dist2DMeters;
            isBreaching = false;
          }
        }

        const startX = feetX * scaleX;
        const startY = feetY * scaleY;
        const endX = closestPointOnZone[0] * scaleX;
        const endY = closestPointOnZone[1] * scaleY;

        // Draw line connecting feet to closest boundary point
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = isBreaching ? "#FF3B5C" : "#FFD700"; // Red if inside, gold if outside
        ctx.lineWidth = 2;
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw foot target dot
        ctx.beginPath();
        ctx.arc(startX, startY, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#FFD700";
        ctx.fill();

        // Draw zone target dot
        ctx.beginPath();
        ctx.arc(endX, endY, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#FF3B5C";
        ctx.fill();

        // Display floating distance text label
        const statusLabel = isSitting ? " (Sitting)" : ((feetInPolygon && personDistFromCam < zoneDistFromCam - 0.5) ? " (In Front)" : "");
        const distText = isBreaching ? "Inside" : `${effectiveDistanceMeters.toFixed(1)}m${statusLabel}`;
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2 - 6;

        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = "center";

        // Draw label background
        const textWidth = ctx.measureText(distText).width;
        ctx.fillStyle = "rgba(10, 15, 30, 0.85)";
        ctx.fillRect(midX - textWidth / 2 - 4, midY - 9, textWidth + 8, 14);

        // Draw label text
        ctx.fillStyle = isBreaching ? "#FF3B5C" : "#FFD700";
        ctx.fillText(distText, midX, midY + 2);
        ctx.textAlign = "left";
      }
    }
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

export default function TrackingFeed({ backendOnline, zones = [], alerts = [], onZoneSaved, persons = [], setPersons, monitoring, setMonitoring, onNewAlert }) {
  const [videoReady, setVideoReady] = useState(false);
  const [breachActive, setBreachActive] = useState(false);
  const [error, setError] = useState(null);

  // Tracker selection state
  const [trackerType, setTrackerType] = useState("bytetrack");
  const trackerTypeRef = useRef(trackerType);
  useEffect(() => { trackerTypeRef.current = trackerType; }, [trackerType]);

  // Delayed breach state
  const breachStartTimes = useRef(new Map()); // "personId:zoneId" -> timestamp
  const [warningIds, setWarningIds] = useState(new Set());
  const warningIdsRef = useRef(new Set());
  const [warningRemaining, setWarningRemaining] = useState(new Map());
  const warningRemainingRef = useRef(new Map());

  // Drawing mode state
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [zoneType, setZoneType] = useState("restricted");
  const [savingZone, setSavingZone] = useState(false);
  const [cameraDistance, setCameraDistance] = useState("4.0");

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

  const personsRef = useRef(persons);
  useEffect(() => { personsRef.current = persons; }, [persons]);

  useEffect(() => { drawingModeRef.current = drawingMode; }, [drawingMode]);
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);
  useEffect(() => { zoneTypeRef.current = zoneType; }, [zoneType]);

  /* ── Start / Stop ─────────────────────────────────────────────── */

  const stopMonitoring = useCallback(() => {
    setMonitoring(false);
    setVideoReady(false);
    if (intervalRef.current) { clearTimeout(intervalRef.current); intervalRef.current = null; }
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
    if (breachStartTimes.current) breachStartTimes.current.clear();
    if (breachedIdsRef.current) breachedIdsRef.current = new Set();
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

    let isActive = true;

    const captureAndSend = async () => {
      if (!isActive || !monitoring) return;

      const video = videoRef.current;
      const captureCanvas = captureCanvasRef.current;
      if (!video || !captureCanvas || !video.videoWidth || !video.videoHeight) {
        if (isActive && monitoring) {
          intervalRef.current = setTimeout(captureAndSend, 100);
        }
        return;
      }

      const ctx = captureCanvas.getContext("2d");
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

      const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.7);
      const base64 = dataUrl.split(",")[1];

      try {
        const res = await trackingApi.processFrame(base64, trackerTypeRef.current);
        if (!isActive) return;

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
              drawPersons(ctx, newPersons, scaleX, scaleY, breachedIdsRef.current, identityMapRef.current, warningIdsRef.current, warningRemainingRef.current, zonesRef.current);

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
        if (!isActive) return;
        failCountRef.current++;
      }

      // Identity check every 10 frames
      frameCountRef.current++;
      if (frameCountRef.current % 10 === 0) {
        try {
          const idRes = await trackingApi.identifyPerson(base64);
          if (idRes.data && idRes.data.matched && isActive) {
            const now = Date.now();
            // Cache identity for all visible persons (face match applies to current frame)
            const currentPersons = personsRef.current || [];
            if (currentPersons.length > 0) {
              currentPersons.forEach((p) => {
                identityMapRef.current.set(p.person_id, {
                  name: idRes.data.identity,
                  role: idRes.data.role,
                  confidence: idRes.data.confidence,
                  cachedAt: now,
                });
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
        stopMonitoring();
      } else if (isActive && monitoring) {
        intervalRef.current = setTimeout(captureAndSend, 500);
      }
    };

    intervalRef.current = setTimeout(captureAndSend, 500);

    return () => {
      isActive = false;
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [monitoring, backendOnline, videoReady, stopMonitoring]);

  /* ── Breach detection (client-side) ───────────────────────────── */

  useEffect(() => {
    if (!persons.length || !zones.length) {
      setBreachActive(false);
      setWarningIds(new Set());
      warningIdsRef.current = new Set();
      setWarningRemaining(new Map());
      warningRemainingRef.current = new Map();
      breachedIdsRef.current = new Set();
      breachStartTimes.current.clear();
      return;
    }

    const restrictedZones = zones.filter((z) => z.is_active && z.zone_type === "restricted" && z.polygon?.length >= 3);
    const newBreachedIds = new Set();
    const newWarningIds = new Set();
    const newWarningRemaining = new Map();
    const activeBreachKeys = new Set();

    const now = Date.now();

    persons.forEach((person) => {
      const feetX = person.bbox.x + person.bbox.w / 2;
      const feetY = person.bbox.y + person.bbox.h;

      const bboxW = person.bbox.w || 0;
      const bboxH = person.bbox.h || 0;
      const aspectRatio = bboxH > 0 ? (bboxW / bboxH) : 0;
      const isSitting = person.is_sitting !== undefined ? person.is_sitting : (aspectRatio >= 0.55);

      restrictedZones.forEach((zone) => {
        const res = pointToPolygonDistance([feetX, feetY], zone.polygon);
        const effectiveHeightPx = isSitting ? Math.max(bboxH, bboxW / 0.45) : bboxH;
        const pixelsPerMeter = effectiveHeightPx > 0 ? (effectiveHeightPx / 1.7) : 1;
        const distanceMeters = res.distance / pixelsPerMeter;

        const personDistFromCam = effectiveHeightPx > 0 ? (850 / effectiveHeightPx) : 0;
        const zoneDistFromCam = zone.camera_distance || 4.0;
        const feetInPolygon = pointInPolygon([feetX, feetY], zone.polygon);

        let isBreaching = false;

        // If person is sitting in a chair, ignore restricted area entry alert!
        if (!isSitting) {
          if (feetInPolygon) {
            if (personDistFromCam >= zoneDistFromCam - 0.5) {
              isBreaching = true;
            }
          } else {
            if (distanceMeters < 0.15 && personDistFromCam >= zoneDistFromCam - 0.5) {
              isBreaching = true;
            }
          }
        }

        // Trigger breach if breaching
        if (isBreaching) {
          const breachKey = `${person.person_id}:${zone.zone_id}`;
          activeBreachKeys.add(breachKey);

          // If this is the first time we see them in the zone, record the time
          if (!breachStartTimes.current.has(breachKey)) {
            breachStartTimes.current.set(breachKey, now);
          }

          const entryTime = breachStartTimes.current.get(breachKey);
          const elapsed = (now - entryTime) / 1000;

          if (elapsed >= 0.0) {
            // Official breach!
            newBreachedIds.add(person.person_id);
            if (!breachLoggedRef.current.has(breachKey)) {
              breachLoggedRef.current.add(breachKey);
              geofenceApi.checkBreach({ person_id: person.person_id, x: feetX, y: feetY })
                .then((res) => {
                  playAlertSound();
                  
                  const idInfo = identityMapRef.current.get(person.person_id);
                  const displayName = idInfo && idInfo.name
                    ? idInfo.name
                    : `Person ${person.person_id.split(" ")[0]}`;
                  speakAlert(`Warning. ${displayName} has entered the restricted area.`);

                  if (res && res.data && Array.isArray(res.data.breaches) && res.data.breaches.length > 0) {
                    if (typeof onNewAlert === "function") {
                      res.data.breaches.forEach((b) => onNewAlert(b));
                    }
                  }
                })
                .catch(() => { });
            }
          }
        }
      });
    });

    // Clean up breachStartTimes for keys no longer active
    for (const key of breachStartTimes.current.keys()) {
      if (!activeBreachKeys.has(key)) {
        breachStartTimes.current.delete(key);
      }
    }

    // Clean up breachLoggedRef if they are completely out of the zone
    for (const key of Array.from(breachLoggedRef.current)) {
      if (!activeBreachKeys.has(key)) {
        breachLoggedRef.current.delete(key);
      }
    }

    setBreachActive(newBreachedIds.size > 0);
    breachedIdsRef.current = newBreachedIds;
    setWarningIds(newWarningIds);
    warningIdsRef.current = newWarningIds;
    setWarningRemaining(newWarningRemaining);
    warningRemainingRef.current = newWarningRemaining;
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
    drawPersons(ctx, persons, scaleX, scaleY, breachedIdsRef.current, identityMapRef.current, warningIds, warningRemaining, zones);

    if (drawingMode && drawingPoints.length > 0) {
      drawPendingPolygon(ctx, drawingPoints, scaleX, scaleY, zoneType);
    }
  }, [persons, zones, drawingMode, drawingPoints, zoneType, warningIds, warningRemaining]);

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
        camera_distance: parseFloat(cameraDistance) || 4.0,
      });
      setDrawingPoints([]);
      setShowZoneForm(false);
      setZoneName("");
      setCameraDistance("4.0");
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
    setCameraDistance("4.0");
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
          <select
            value={trackerType}
            onChange={(e) => setTrackerType(e.target.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(0, 212, 255, 0.1)",
              border: "1px solid rgba(0, 212, 255, 0.25)",
              padding: "4px 10px",
              borderRadius: "4px",
              fontSize: "0.75rem",
              fontWeight: "bold",
              color: "#00D4FF",
              fontFamily: "var(--font-mono)",
              marginRight: "10px",
              cursor: "pointer",
              outline: "none"
            }}
          >
            <option value="bytetrack" style={{ background: "#0A0F1E", color: "#00D4FF" }}>⚡ Tracker: ByteTrack</option>
            <option value="deepsort" style={{ background: "#0A0F1E", color: "#00D4FF" }}>⚡ Tracker: DeepSORT</option>
          </select>
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
              {zoneType === "restricted" && (
                <div className="form-row" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: "0.75rem", color: "rgba(255, 59, 92, 0.8)", fontFamily: "var(--font-mono)" }}>
                    Door Distance from Camera (meters):
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="20"
                    placeholder="e.g. 4.0"
                    value={cameraDistance}
                    onChange={(e) => setCameraDistance(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      background: "rgba(10, 15, 30, 0.75)",
                      border: "1px solid rgba(255, 59, 92, 0.35)",
                      borderRadius: 4,
                      color: "#FF3B5C",
                      fontSize: "0.8rem",
                      fontFamily: "var(--font-mono)",
                      outline: "none"
                    }}
                  />
                </div>
              )}
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
