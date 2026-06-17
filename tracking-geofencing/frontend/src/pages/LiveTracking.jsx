/**
 * tracking-geofencing/frontend/src/pages/LiveTracking.jsx
 *
 * Caregiver Live Tracking with:
 *  - YOLOv8 bounding box rendered on <canvas> overlay
 *  - MediaPipe keypoint movement trail (last N centroid positions)
 *  - Status badges, absence timer, session management
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import axios from "axios";

const TRACK_API  = import.meta.env.VITE_TRACKING_BACKEND_URL || "http://localhost:8002/api/tracking";
const POLL_MS    = 2000;   // 2s — faster for snappy bbox updates
const TRAIL_LEN  = 30;     // how many centroid positions to keep in movement trail

// ── Status → UI config ────────────────────────────────────────────────────────
const STATUS_UI = {
  verified_present: { label: "Caregiver Present",          color: "emerald", pulse: false },
  warning:          { label: "Caregiver Warning",           color: "yellow",  pulse: true  },
  missing:          { label: "Caregiver Missing",           color: "orange",  pulse: true  },
  missing_critical: { label: "CRITICAL — Caregiver Absent!",color: "red",     pulse: true  },
  idle:             { label: "Awaiting Session…",           color: "gray",    pulse: false },
  error:            { label: "Session Error",               color: "red",     pulse: false },
};

const STATUS_COLORS = {
  emerald: { box: "rgba(16,185,129,0.9)",  bg: "bg-emerald-900/30 border-emerald-500", text: "text-emerald-400" },
  yellow:  { box: "rgba(234,179,8,0.9)",   bg: "bg-yellow-900/30 border-yellow-500",  text: "text-yellow-400"  },
  orange:  { box: "rgba(249,115,22,0.9)",  bg: "bg-orange-900/30 border-orange-500",  text: "text-orange-400"  },
  red:     { box: "rgba(239,68,68,0.95)",  bg: "bg-red-900/30 border-red-500",        text: "text-red-400"     },
  gray:    { box: "rgba(156,163,175,0.7)", bg: "bg-gray-800 border-gray-700",         text: "text-gray-400"    },
};


export default function LiveTracking() {
  // ── Session & control state ───────────────────────────────────────────────
  const [sessionId, setSessionId]       = useState("");
  const [tracking, setTracking]         = useState(false);

  // ── Detection response state ──────────────────────────────────────────────
  const [status, setStatus]             = useState("idle");
  const [absenceSecs, setAbsenceSecs]   = useState(0);
  const [bbox, setBbox]                 = useState(null);      // {x,y,w,h} normalised 0-1
  const [confidence, setConfidence]     = useState(null);
  const [keypoints, setKeypoints]       = useState(null);      // [[x,y,vis], ...]
  const [lastUpdated, setLastUpdated]   = useState(null);

  // ── Movement trail (centroid history) ────────────────────────────────────
  const trailRef = useRef([]);   // array of {x, y} in normalised coords

  // ── Refs ──────────────────────────────────────────────────────────────────
  const webcamRef     = useRef(null);
  const canvasRef     = useRef(null);
  const videoBoxRef   = useRef(null);   // wrapper div to measure rendered size
  const pollRef       = useRef(null);
  const inFlightRef   = useRef(false);
  const trackingRef   = useRef(false);

  useEffect(() => { trackingRef.current = tracking; }, [tracking]);

  // ── Draw bounding box + trail + keypoints on canvas ──────────────────────
  const drawOverlay = useCallback((bboxData, kpts, trail, statusColor) => {
    const canvas = canvasRef.current;
    const wrapper = videoBoxRef.current;
    if (!canvas || !wrapper) return;

    const W = wrapper.clientWidth;
    const H = wrapper.clientHeight;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const boxColor = statusColor?.box || "rgba(16,185,129,0.9)";

    // ── Movement trail ────────────────────────────────────────────────────
    if (trail.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(99,102,241,0.6)";  // indigo trail
      ctx.lineWidth   = 2;
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
      trail.forEach((pt, i) => {
        const px = pt.x * W;
        const py = pt.y * H;
        const alpha = (i / trail.length) * 0.8;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      });
      ctx.stroke();

      // Trail dots
      trail.forEach((pt, i) => {
        const r     = 2 + (i / trail.length) * 4;
        const alpha = 0.2 + (i / trail.length) * 0.8;
        ctx.beginPath();
        ctx.arc(pt.x * W, pt.y * H, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99,102,241,${alpha})`;
        ctx.fill();
      });
    }

    // ── Bounding box ──────────────────────────────────────────────────────
    if (bboxData) {
      const { x, y, w, h } = bboxData;
      const rx = x * W;
      const ry = y * H;
      const rw = w * W;
      const rh = h * H;

      // Outer glow
      ctx.shadowColor   = boxColor;
      ctx.shadowBlur    = 12;
      ctx.strokeStyle   = boxColor;
      ctx.lineWidth     = 2.5;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.shadowBlur    = 0;

      // Corner accents
      const cs = 14;  // corner accent size
      ctx.lineWidth = 3.5;
      [
        [rx, ry, cs, 0, 0, cs],
        [rx + rw, ry, -cs, 0, 0, cs],
        [rx, ry + rh, cs, 0, 0, -cs],
        [rx + rw, ry + rh, -cs, 0, 0, -cs],
      ].forEach(([ox, oy, dx1, dy1, dx2, dy2]) => {
        ctx.beginPath();
        ctx.moveTo(ox + dx1, oy + dy1);
        ctx.lineTo(ox, oy);
        ctx.lineTo(ox + dx2, oy + dy2);
        ctx.stroke();
      });

      // Label above box
      const label = `CAREGIVER${confidence ? `  ${(confidence * 100).toFixed(0)}%` : ""}`;
      ctx.font      = "bold 11px monospace";
      const tw      = ctx.measureText(label).width;
      const lx      = rx;
      const ly      = Math.max(ry - 8, 20);

      ctx.fillStyle = boxColor;
      ctx.fillRect(lx - 2, ly - 16, tw + 10, 20);

      ctx.fillStyle = "#000";
      ctx.fillText(label, lx + 3, ly - 2);
    }

    // ── Keypoints (body joints) ───────────────────────────────────────────
    if (kpts && kpts.length > 0) {
      // Key landmark indices for a skeleton silhouette
      const SKELETON_PAIRS = [
        [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],  // arms
        [11, 23], [12, 24], [23, 24],                       // torso
        [23, 25], [25, 27], [24, 26], [26, 28],             // legs
      ];

      // Draw bone lines
      ctx.strokeStyle = "rgba(99,102,241,0.5)";
      ctx.lineWidth   = 1.5;
      SKELETON_PAIRS.forEach(([a, b]) => {
        const pa = kpts[a];
        const pb = kpts[b];
        if (!pa || !pb || pa[2] < 0.3 || pb[2] < 0.3) return;
        ctx.beginPath();
        ctx.moveTo(pa[0] * W, pa[1] * H);
        ctx.lineTo(pb[0] * W, pb[1] * H);
        ctx.stroke();
      });

      // Draw joint dots
      kpts.forEach(([kx, ky, vis]) => {
        if (vis < 0.3) return;
        ctx.beginPath();
        ctx.arc(kx * W, ky * H, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(167,139,250,0.85)";  // violet
        ctx.fill();
      });
    }
  }, [confidence]);

  // ── Re-draw whenever detection data changes ───────────────────────────────
  useEffect(() => {
    if (!tracking) return;
    const uiColor = STATUS_COLORS[STATUS_UI[status]?.color || "gray"];
    drawOverlay(bbox, keypoints, trailRef.current, uiColor);
  }, [bbox, keypoints, status, tracking, drawOverlay]);

  // ── Clear canvas when tracking stops ─────────────────────────────────────
  useEffect(() => {
    if (!tracking) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      trailRef.current = [];
    }
  }, [tracking]);

  // ── Poll tick ─────────────────────────────────────────────────────────────
  const pollTick = useCallback(async () => {
    if (inFlightRef.current || !trackingRef.current) return;
    if (!webcamRef.current || !sessionId) return;

    const frame = webcamRef.current.getScreenshot();
    if (!frame) return;

    inFlightRef.current = true;
    try {
      const { data } = await axios.post(`${TRACK_API}/update-caregiver-visibility`, {
        session_id: sessionId,
        live_frame: frame,
      });

      setStatus(data.status || "idle");
      setAbsenceSecs(data.absence_seconds || 0);
      setBbox(data.bbox || null);
      setConfidence(data.confidence || null);
      setKeypoints(data.keypoints || null);
      setLastUpdated(new Date());

      // Update movement trail using bbox centre
      if (data.bbox) {
        const cx = data.bbox.x + data.bbox.w / 2;
        const cy = data.bbox.y + data.bbox.h / 2;
        trailRef.current = [...trailRef.current.slice(-(TRAIL_LEN - 1)), { x: cx, y: cy }];
      }
    } catch (err) {
      console.error("[LiveTracking] poll error:", err.message);
    } finally {
      inFlightRef.current = false;
    }
  }, [sessionId]);

  // ── Start / stop polling ──────────────────────────────────────────────────
  useEffect(() => {
    if (tracking) {
      pollTick();  // immediate first tick
      pollRef.current = setInterval(pollTick, POLL_MS);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [tracking, pollTick]);

  // ── Canvas resize listener ────────────────────────────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (tracking) drawOverlay(bbox, keypoints, trailRef.current,
          STATUS_COLORS[STATUS_UI[status]?.color || "gray"]);
    });
    if (videoBoxRef.current) obs.observe(videoBoxRef.current);
    return () => obs.disconnect();
  }, [tracking, bbox, keypoints, status, drawOverlay]);

  const handleToggle = () => {
    if (!tracking) {
      setStatus("idle");
      setAbsenceSecs(0);
      setBbox(null);
      setKeypoints(null);
      setConfidence(null);
      trailRef.current = [];
    }
    setTracking(t => !t);
  };

  const statusKey = STATUS_UI[status] ? status : "idle";
  const uiConf   = STATUS_UI[statusKey];
  const colors   = STATUS_COLORS[uiConf.color];
  const isCritical = status === "missing_critical";

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">

      {/* ── Critical Banner ─────────────────────────────────────────────── */}
      {isCritical && (
        <div className="mb-5 flex items-center gap-4 bg-red-600/20 border border-red-500 text-red-300 px-5 py-4 rounded-2xl animate-pulse shadow-lg shadow-red-900/30">
          <span className="text-2xl">🚨</span>
          <div>
            <p className="font-black text-lg">CRITICAL ALERT</p>
            <p className="text-sm text-red-400">Caregiver absent for {absenceSecs.toFixed(0)}s. Escalate immediately.</p>
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Live Tracking</h1>
          <p className="text-gray-400 text-sm mt-1">YOLOv8 + MediaPipe skeleton detection with movement trail</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-full border ${
            tracking
              ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
              : "bg-gray-800 border-gray-700 text-gray-500"
          }`}>
            <span className={`w-2 h-2 rounded-full ${tracking ? "bg-emerald-500 animate-pulse" : "bg-gray-600"}`} />
            {tracking ? "TRACKING LIVE" : "OFFLINE"}
          </span>

          <button
            id="btn-toggle-tracking"
            onClick={handleToggle}
            disabled={!sessionId && !tracking}
            className={`px-5 py-2 font-bold rounded-xl transition-all ${
              tracking
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
            }`}
          >
            {tracking ? "Stop Tracking" : "Start Tracking"}
          </button>
        </div>
      </div>

      {/* ── Session Input ────────────────────────────────────────────────── */}
      {!tracking && (
        <div className="mb-5 bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-gray-500 text-sm font-mono">SESSION ID</span>
          <input
            id="input-session-id"
            type="text"
            placeholder="Enter caregiver session ID…"
            className="flex-1 px-4 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-indigo-500 font-mono text-sm"
            value={sessionId}
            onChange={e => setSessionId(e.target.value)}
          />
        </div>
      )}

      {/* ── Main Grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* ── Video + Canvas Overlay ──────────────────────────────────── */}
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">

          {/* Header bar */}
          <div className="bg-gray-800/80 px-5 py-3 flex items-center justify-between border-b border-gray-700">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <span className={`w-2.5 h-2.5 rounded-full ${tracking ? "bg-emerald-500 animate-pulse" : "bg-gray-600"}`} />
              {tracking ? "YOLOv8 + Skeleton Active" : "Camera Offline"}
            </div>
            {lastUpdated && (
              <span className="text-xs text-gray-500 font-mono">
                Last: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Video area */}
          <div
            ref={videoBoxRef}
            className="relative flex-1 bg-gray-950 min-h-[360px]"
          >
            {tracking ? (
              <>
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  screenshotFormat="image/jpeg"
                  videoConstraints={{ width: 1280, height: 720, facingMode: "user" }}
                  className="w-full h-full object-cover"
                  style={{ transform: "scaleX(-1)" }}
                />

                {/* Canvas overlay — sits on top of video, pointer-events:none so webcam still works */}
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full"
                  style={{ pointerEvents: "none", transform: "scaleX(-1)" }}
                />

                {/* REC badge */}
                <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-red-600/90 text-white text-xs font-black px-3 py-1 rounded-full animate-pulse tracking-widest shadow-lg z-10">
                  <span className="w-2 h-2 bg-white rounded-full" />
                  REC
                </div>

                {/* Detection info badge */}
                {bbox && (
                  <div className="absolute top-4 right-4 z-10 flex flex-col gap-1.5 items-end">
                    <span className="bg-emerald-700/80 backdrop-blur-sm text-emerald-200 text-xs font-mono px-3 py-1 rounded-full border border-emerald-500/40">
                      PERSON DETECTED
                    </span>
                    {confidence && (
                      <span className="bg-indigo-700/80 backdrop-blur-sm text-indigo-200 text-xs font-mono px-3 py-1 rounded-full border border-indigo-500/40">
                        {(confidence * 100).toFixed(1)}% conf
                      </span>
                    )}
                    {keypoints && (
                      <span className="bg-violet-700/80 backdrop-blur-sm text-violet-200 text-xs font-mono px-3 py-1 rounded-full border border-violet-500/40">
                        SKELETON ✓
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 text-gray-600 py-20">
                <svg className="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <p className="font-mono text-sm tracking-widest">[ CAMERA OFFLINE ]</p>
                <p className="text-gray-700 text-xs">Enter session ID and click Start Tracking</p>
              </div>
            )}
          </div>

          {/* Legend */}
          {tracking && (
            <div className="bg-gray-900 border-t border-gray-800 px-5 py-3 flex flex-wrap gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm border-2 border-emerald-500" /> Bounding Box
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-1 rounded-full bg-indigo-500/60" /> Movement Trail
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-500/70" /> Body Joints
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-indigo-400/50" /> Skeleton Bones
              </span>
            </div>
          )}
        </div>

        {/* ── Right Panel ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Status card */}
          <div className={`border-2 rounded-2xl p-5 transition-all duration-500 ${colors.bg} ${uiConf.pulse ? "animate-pulse" : ""}`}>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-2 font-semibold">Continuity Status</p>
            <p className={`text-xl font-black ${colors.text}`}>{uiConf.label}</p>
          </div>

          {/* Absence timer */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-2 font-semibold">Absence Timer</p>
            <p className="text-4xl font-mono text-white">
              {absenceSecs.toFixed(0)}<span className="text-lg text-gray-500 ml-1">sec</span>
            </p>
            <div className="w-full bg-gray-800 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  absenceSecs > 30 ? "bg-red-500" : absenceSecs > 10 ? "bg-yellow-500" : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min((absenceSecs / 120) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Bounding Box coords */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">Detection Data</p>
            {bbox ? (
              <div className="space-y-2 font-mono text-xs">
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(bbox).map(([k, v]) => (
                    <div key={k} className="bg-gray-800 rounded-lg px-3 py-2">
                      <span className="text-gray-500 uppercase">{k}</span>
                      <p className="text-emerald-400 font-bold">{(v * 100).toFixed(1)}%</p>
                    </div>
                  ))}
                </div>
                {confidence && (
                  <p className="text-indigo-400 mt-2">YOLO conf: {(confidence * 100).toFixed(1)}%</p>
                )}
                {keypoints && (
                  <p className="text-violet-400">Landmarks: {keypoints.length} joints</p>
                )}
              </div>
            ) : (
              <p className="text-gray-600 text-sm">
                {tracking ? "No person detected in frame" : "No data yet"}
              </p>
            )}
          </div>

          {/* Session info */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-2 font-semibold">Session</p>
            {sessionId ? (
              <>
                <p className="text-emerald-400 text-sm font-bold mb-1">✔ Session Linked</p>
                <p className="text-gray-500 font-mono text-xs break-all">{sessionId}</p>
              </>
            ) : (
              <p className="text-gray-600 text-sm">No session provided</p>
            )}
          </div>

          {/* Trail info */}
          {tracking && trailRef.current.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-2 font-semibold">Movement Trail</p>
              <p className="text-indigo-400 text-sm font-mono">{trailRef.current.length} waypoints recorded</p>
              {trailRef.current.length > 0 && (
                <p className="text-gray-600 text-xs mt-1">
                  Last: ({(trailRef.current.at(-1).x * 100).toFixed(1)}%, {(trailRef.current.at(-1).y * 100).toFixed(1)}%)
                </p>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
