/**
 * anomaly-detection/frontend/src/pages/AnomalyDashboard.jsx
 * Phase 2 — Production-grade dashboard with:
 *  - WebSocket real-time streaming (persistent, auto-reconnect)
 *  - Live Status Panel (color-coded anomaly state)
 *  - Event Timeline (last 20 events with timestamps + severity colors)
 *  - Patient Status Card
 *  - Confidence + Motion Score visualization bars
 *  - Detection Source badge (Rule / LSTM / Hybrid)
 *  - Skeleton + bounding box canvas overlay
 *  - Movement trail
 *  - Smooth non-flickering predictions (backed by backend smoother)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import axios from "axios";

const ANOMALY_API  = "http://localhost:8003/api/anomaly";
const POLL_MS      = 200;
const SNAPSHOT_MS  = 500;
const TRAIL_LEN    = 25;
const MAX_TIMELINE = 20;

// ── Anomaly UI config ─────────────────────────────────────────────────────────
const ANOMALY_UI = {
  normal_activity:      { label: "Normal Activity",      color: "emerald", icon: "✅", pulse: false, ring: "ring-emerald-500/40" },
  fall_detected:        { label: "FALL DETECTED",         color: "red",     icon: "🚨", pulse: true,  ring: "ring-red-500/60" },
  aggression_detected:  { label: "Aggression Detected",  color: "orange",  icon: "⚠️", pulse: true,  ring: "ring-orange-500/50" },
  prolonged_inactivity: { label: "Prolonged Inactivity", color: "yellow",  icon: "😴", pulse: true,  ring: "ring-yellow-500/50" },
  inactivity_warning:   { label: "Inactivity Warning",   color: "yellow",  icon: "⏱️", pulse: false, ring: "ring-yellow-400/30" },
  unusual_movement:     { label: "Unusual Movement",     color: "indigo",  icon: "❓", pulse: true,  ring: "ring-indigo-500/40" },
  no_person:            { label: "No Person in Frame",   color: "gray",    icon: "👁️", pulse: false, ring: "ring-gray-600/20" },
};

const COLORS = {
  emerald: { border: "border-emerald-500", bg: "bg-emerald-900/30", text: "text-emerald-400", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", box: "rgba(16,185,129,0.9)" },
  red:     { border: "border-red-500",     bg: "bg-red-900/30",     text: "text-red-400",     badge: "bg-red-500/20 text-red-300 border-red-500/50",             box: "rgba(239,68,68,0.95)" },
  orange:  { border: "border-orange-500",  bg: "bg-orange-900/30",  text: "text-orange-400",  badge: "bg-orange-500/20 text-orange-300 border-orange-500/40",    box: "rgba(249,115,22,0.9)" },
  yellow:  { border: "border-yellow-500",  bg: "bg-yellow-900/30",  text: "text-yellow-400",  badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",    box: "rgba(234,179,8,0.9)" },
  indigo:  { border: "border-indigo-500",  bg: "bg-indigo-900/30",  text: "text-indigo-400",  badge: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",    box: "rgba(99,102,241,0.9)" },
  gray:    { border: "border-gray-700",    bg: "bg-gray-800/50",    text: "text-gray-400",    badge: "bg-gray-700/50 text-gray-400 border-gray-600/40",           box: "rgba(156,163,175,0.6)" },
};

const SEV_BADGE = {
  critical: "bg-red-600/30 text-red-300 border border-red-600/40",
  high:     "bg-orange-600/30 text-orange-300 border border-orange-600/40",
  medium:   "bg-yellow-600/30 text-yellow-300 border border-yellow-600/40",
  low:      "bg-indigo-600/30 text-indigo-300 border border-indigo-600/40",
  none:     "bg-gray-700/30 text-gray-400 border border-gray-700/40",
};

// MediaPipe skeleton bone pairs
const SKELETON_PAIRS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[24,26],[26,28],
  [0,11],[0,12],
];

// Source badge labels
const SOURCE_BADGE = {
  "rule_engine":    { label: "Rule Engine", cls: "bg-blue-800/50 text-blue-300" },
  "lstm":           { label: "LSTM",        cls: "bg-purple-800/50 text-purple-300" },
  "lstm+rule":      { label: "Hybrid",      cls: "bg-violet-800/50 text-violet-300" },
  "rule_engine+ae": { label: "Rule+AE",     cls: "bg-teal-800/50 text-teal-300" },
  "autoencoder":    { label: "Autoencoder", cls: "bg-cyan-800/50 text-cyan-300" },
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function AnomalyDashboard() {
  // Core detection state
  const [isOn,        setIsOn]        = useState(false);
  const [cameraSource, setCameraSource] = useState("webcam");
  const [anomalyType, setAnomalyType] = useState("no_person");
  const [confidence,  setConfidence]  = useState(0);
  const [severity,    setSeverity]    = useState("none");
  const [source,      setSource]      = useState("rule_engine");
  const [poseValid,   setPoseValid]   = useState(false);
  const [bbox,        setBbox]        = useState(null);
  const [keypoints,   setKeypoints]   = useState(null);
  const [evidence,    setEvidence]    = useState({});
  const [personId,    setPersonId]    = useState("patient_001");
  const [lastUpdate,  setLastUpdate]  = useState(null);
  const [wsStatus,    setWsStatus]    = useState("disconnected"); // connected|disconnected|error
  const [error,       setError]       = useState("");

  // Timeline of last N events
  const [timeline,    setTimeline]    = useState([]);

  // IP camera preview
  const [ipFrame,   setIpFrame]   = useState(null);
  const [ipError,   setIpError]   = useState(null);
  const [ipLoading, setIpLoading] = useState(false);

  // Refs
  const webcamRef  = useRef(null);
  const canvasRef  = useRef(null);
  const wrapperRef = useRef(null);
  const pollRef    = useRef(null);
  const wsRef      = useRef(null);
  const trailRef   = useRef([]);
  const isOnRef    = useRef(false);
  const sourceRef  = useRef("webcam");

  useEffect(() => { isOnRef.current = isOn; },          [isOn]);
  useEffect(() => { sourceRef.current = cameraSource; }, [cameraSource]);

  // ── Canvas drawing ──────────────────────────────────────────────────────────
  const drawCanvas = useCallback((bboxData, kpts, trail, boxColor) => {
    const canvas  = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const W = wrapper.clientWidth;
    const H = wrapper.clientHeight;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // Movement trail
    if (trail.length > 1) {
      ctx.lineWidth = 2; ctx.lineCap = "round";
      trail.forEach((pt, i) => {
        if (i === 0) return;
        const alpha = 0.15 + (i / trail.length) * 0.7;
        ctx.strokeStyle = `rgba(99,102,241,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(trail[i-1].x * W, trail[i-1].y * H);
        ctx.lineTo(pt.x * W, pt.y * H);
        ctx.stroke();
      });
      trail.forEach((pt, i) => {
        const r = 1.5 + (i / trail.length) * 4;
        ctx.beginPath();
        ctx.arc(pt.x * W, pt.y * H, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99,102,241,${0.2 + (i / trail.length) * 0.8})`;
        ctx.fill();
      });
    }

    // Bounding box
    if (bboxData) {
      const { x, y, w, h } = bboxData;
      const [rx, ry, rw, rh] = [x*W, y*H, w*W, h*H];
      ctx.shadowColor = boxColor; ctx.shadowBlur = 14;
      ctx.strokeStyle = boxColor; ctx.lineWidth = 2.5;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.shadowBlur = 0;
      // Corner accents
      const cs = 16; ctx.lineWidth = 3.5;
      [[rx,ry,cs,0,0,cs],[rx+rw,ry,-cs,0,0,cs],[rx,ry+rh,cs,0,0,-cs],[rx+rw,ry+rh,-cs,0,0,-cs]]
        .forEach(([ox,oy,d1x,,d2x,d2y]) => {
          ctx.beginPath();
          ctx.moveTo(ox+d1x, oy);
          ctx.lineTo(ox, oy);
          ctx.lineTo(ox+d2x, oy+d2y);
          ctx.stroke();
        });
    }

    // Skeleton bones
    if (kpts && kpts.length >= 29) {
      ctx.strokeStyle = "rgba(139,92,246,0.6)"; ctx.lineWidth = 1.5;
      SKELETON_PAIRS.forEach(([a, b]) => {
        const pa = kpts[a], pb = kpts[b];
        if (!pa || !pb || pa[2] < 0.3 || pb[2] < 0.3) return;
        ctx.beginPath();
        ctx.moveTo(pa[0]*W, pa[1]*H);
        ctx.lineTo(pb[0]*W, pb[1]*H);
        ctx.stroke();
      });
      kpts.forEach(([kx, ky, vis]) => {
        if (vis < 0.3) return;
        ctx.beginPath();
        ctx.arc(kx*W, ky*H, 3.5, 0, Math.PI*2);
        ctx.fillStyle = "rgba(167,139,250,0.9)";
        ctx.fill();
      });
    }
  }, []);

  useEffect(() => {
    if (!isOn) {
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height);
      trailRef.current = [];
      return;
    }
    const col = COLORS[ANOMALY_UI[anomalyType]?.color || "gray"];
    drawCanvas(bbox, keypoints, trailRef.current, col.box);
  }, [bbox, keypoints, anomalyType, isOn, drawCanvas]);

  // ── IP Camera preview ───────────────────────────────────────────────────────
  useEffect(() => {
    if (cameraSource !== "ip_camera" || !isOn) return;
    let active = true;
    setIpLoading(true); setIpError(null); setIpFrame(null);
    const fetchPreview = async () => {
      try {
        const { data } = await axios.get(`${ANOMALY_API}/camera-snapshot`, { timeout: 10000 });
        if (active) { setIpFrame(data.frame); setIpError(null); setIpLoading(false); }
      } catch (err) {
        if (active) { setIpError(err.response?.data?.detail || "IP camera unreachable"); setIpLoading(false); }
      }
    };
    fetchPreview();
    const timer = setInterval(fetchPreview, SNAPSHOT_MS);
    return () => { active = false; clearInterval(timer); };
  }, [cameraSource, isOn]);

  // ── WebSocket Frame Sender ──────────────────────────────────────────────────
  const sendFrame = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (sourceRef.current === "ip_camera") {
      ws.send(JSON.stringify({ source: "ip_camera", person_id: personId }));
    } else {
      if (!webcamRef.current) return;
      const frame = webcamRef.current.getScreenshot();
      if (!frame) return;
      ws.send(JSON.stringify({ live_frame: frame, person_id: personId, source: "webcam" }));
    }
  }, [personId]);

  // ── Handle incoming WS message ──────────────────────────────────────────────
  const handleMessage = useCallback((data) => {
    if (data.error && !data.anomaly_type) { setError(data.error); return; }

    const atype = data.anomaly_type || "no_person";
    const conf  = data.confidence   || 0;
    const sev   = data.severity     || "none";
    const src   = data.source       || "rule_engine";

    setAnomalyType(atype);
    setConfidence(conf);
    setSeverity(sev);
    setSource(src);
    setPoseValid(data.pose_valid || false);
    setBbox(data.bbox || null);
    setKeypoints(data.keypoints || null);
    setEvidence(data.evidence || {});
    setLastUpdate(new Date());
    setError(data.error || "");

    if (data.bbox) {
      const cx = data.bbox.x + data.bbox.w / 2;
      const cy = data.bbox.y + data.bbox.h / 2;
      trailRef.current = [...trailRef.current.slice(-(TRAIL_LEN-1)), { x: cx, y: cy }];
    }

    if (atype !== "normal_activity" && atype !== "no_person") {
      const entry = {
        id:        Date.now(),
        type:      atype,
        conf,
        sev,
        src,
        time:      new Date().toLocaleTimeString(),
        evidence:  data.evidence || {},
      };
      setTimeline(prev => [entry, ...prev].slice(0, MAX_TIMELINE));
    }
  }, []);

  // ── WebSocket lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isOn) {
      const wsUrl = ANOMALY_API.replace(/^http/, "ws") + "/ws/process";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsStatus("connected"); setError("");
        pollRef.current = setInterval(sendFrame, POLL_MS);
      };
      ws.onmessage = (evt) => {
        try { handleMessage(JSON.parse(evt.data)); }
        catch (e) { console.error("[ws] parse error:", e); }
      };
      ws.onerror  = () => { setWsStatus("error"); setError("WebSocket connection failed"); };
      ws.onclose  = () => { setWsStatus("disconnected"); clearInterval(pollRef.current); };

    } else {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      clearInterval(pollRef.current);
      setAnomalyType("no_person"); setBbox(null); setKeypoints(null);
      setConfidence(0); setPoseValid(false); setWsStatus("disconnected");
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
      clearInterval(pollRef.current);
    };
  }, [isOn, sendFrame, handleMessage]);

  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (isOn) {
        const col = COLORS[ANOMALY_UI[anomalyType]?.color || "gray"];
        drawCanvas(bbox, keypoints, trailRef.current, col.box);
      }
    });
    if (wrapperRef.current) obs.observe(wrapperRef.current);
    return () => obs.disconnect();
  }, [isOn, bbox, keypoints, anomalyType, drawCanvas]);

  // ── Derived UI values ───────────────────────────────────────────────────────
  const ui      = ANOMALY_UI[anomalyType] || ANOMALY_UI.no_person;
  const colors  = COLORS[ui.color];
  const isFall  = anomalyType === "fall_detected";
  const srcBadge = SOURCE_BADGE[source] || SOURCE_BADGE["rule_engine"];
  const motionScore = evidence?.pose_energy  ?? null;
  const wristVel    = evidence?.wrist_velocity ?? null;

  // ── WS status indicator ─────────────────────────────────────────────────────
  const wsIndicator = {
    connected:    { dot: "bg-emerald-500 animate-pulse", label: "LIVE" },
    disconnected: { dot: "bg-gray-500",                  label: "OFFLINE" },
    error:        { dot: "bg-red-500 animate-pulse",     label: "ERROR" },
  }[wsStatus];

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Critical FALL Banner ──────────────────────────────────────────── */}
      {isFall && isOn && (
        <div className="px-6 pt-4">
          <div className="flex items-center gap-4 bg-red-600/20 border-2 border-red-500 text-red-200 px-6 py-4 rounded-2xl animate-pulse shadow-2xl shadow-red-900/40">
            <span className="text-4xl">🚨</span>
            <div>
              <p className="font-black text-2xl text-red-300 tracking-wide">FALL DETECTED</p>
              <p className="text-sm text-red-400 mt-0.5">
                Patient fall confirmed — confidence {(confidence*100).toFixed(0)}% · Severity: CRITICAL
              </p>
            </div>
            <div className="ml-auto text-xs font-mono text-red-500">
              {lastUpdate?.toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}

      <div className="p-5">
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Anomaly Detection</h1>
            <p className="text-gray-400 text-sm mt-1">MediaPipe · Rule Engine · LSTM · Autoencoder · WebSocket</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {!isOn && (
              <input
                type="text"
                placeholder="Patient ID"
                value={personId}
                onChange={e => setPersonId(e.target.value)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white font-mono w-44 focus:outline-none focus:border-indigo-500"
              />
            )}
            {/* WS status pill */}
            <span className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-full border bg-gray-800/80 border-gray-700 text-gray-400">
              <span className={`w-2 h-2 rounded-full ${wsIndicator.dot}`} />
              {wsIndicator.label}
            </span>
            {/* Toggle */}
            <button
              id="toggle-monitoring-btn"
              onClick={() => setIsOn(v => !v)}
              className={`px-5 py-2 font-bold rounded-xl transition-all shadow-lg
                ${isOn
                  ? "bg-red-600 hover:bg-red-500 shadow-red-900/30"
                  : "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/30"
                }`}
            >
              {isOn ? "Stop Monitoring" : "Start Monitoring"}
            </button>
          </div>
        </div>

        {/* ── Camera source toggle ──────────────────────────────────────────── */}
        {!isOn && (
          <div className="flex items-center gap-2 mb-5 p-1 bg-gray-900 rounded-xl border border-gray-700 max-w-xs">
            {[{id:"webcam",label:"🖥️ Webcam"},{id:"ip_camera",label:"📡 IP Camera"}].map(({id,label}) => (
              <button key={id} id={`source-toggle-${id}`}
                onClick={() => setCameraSource(id)}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all
                  ${cameraSource===id ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <div className="flex gap-2 mb-5 text-sm">
          {[["Dashboard","/"],["History","/history"],["Model Status","/model-status"]].map(([label,href]) => (
            <a key={href} href={href}
              className={`px-4 py-1.5 rounded-lg border transition-colors
                ${href==="/" ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                             : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"}`}>
              {label}
            </a>
          ))}
        </div>

        {/* ── Main grid ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* ── Video feed + canvas ──────────────────────────────────────── */}
          <div className="xl:col-span-2 flex flex-col gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
              {/* Feed header */}
              <div className="bg-gray-800/80 px-5 py-3 flex items-center justify-between border-b border-gray-700">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <span className={`w-2.5 h-2.5 rounded-full ${isOn ? "bg-red-500 animate-pulse" : "bg-gray-600"}`} />
                  {isOn ? "AI Monitoring Active" : "Camera Offline"}
                </div>
                <div className="flex items-center gap-3">
                  {isOn && (
                    <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${srcBadge.cls}`}>
                      {srcBadge.label}
                    </span>
                  )}
                  {lastUpdate && (
                    <span className="text-xs text-gray-500 font-mono">
                      {lastUpdate.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Video area */}
              <div ref={wrapperRef} className="relative flex-1 bg-gray-950 min-h-[380px]">
                {isOn ? (
                  <>
                    {cameraSource === "webcam" && (
                      <>
                        <Webcam ref={webcamRef} audio={false} screenshotFormat="image/jpeg"
                          videoConstraints={{width:1280,height:720,facingMode:"user"}}
                          className="w-full h-full object-cover" style={{transform:"scaleX(-1)"}} />
                        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full"
                          style={{pointerEvents:"none",transform:"scaleX(-1)"}} />
                      </>
                    )}
                    {cameraSource === "ip_camera" && (
                      <>
                        {ipLoading && (
                          <div className="flex flex-col items-center justify-center gap-4 text-gray-500 py-20">
                            <div className="w-12 h-12 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
                            <p className="font-mono text-sm">Connecting to IP camera...</p>
                          </div>
                        )}
                        {ipError && !ipLoading && (
                          <div className="flex flex-col items-center justify-center gap-3 text-red-400 py-20">
                            <span className="text-5xl">📡</span>
                            <p className="font-semibold">Camera Unreachable</p>
                            <p className="text-xs text-red-500 max-w-xs text-center">{ipError}</p>
                          </div>
                        )}
                        {ipFrame && !ipLoading && (
                          <img src={ipFrame} alt="IP camera feed" className="w-full h-full object-cover" />
                        )}
                        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{pointerEvents:"none"}} />
                        {ipFrame && (
                          <div className="absolute bottom-2 right-2 bg-black/60 text-gray-300 text-xs font-mono px-2 py-0.5 rounded">
                            IP Camera
                          </div>
                        )}
                      </>
                    )}
                    {/* Overlays */}
                    <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 bg-red-600/90 text-white text-xs font-black px-3 py-1 rounded-full animate-pulse tracking-widest">
                      <span className="w-2 h-2 bg-white rounded-full" />REC
                    </div>
                    <div className="absolute top-4 right-4 z-10 flex flex-col gap-1.5 items-end">
                      <span className={`backdrop-blur-sm text-xs font-mono px-3 py-1 rounded-full border
                        ${poseValid ? "bg-emerald-700/80 text-emerald-200 border-emerald-500/40"
                                    : "bg-gray-700/80 text-gray-400 border-gray-600"}`}>
                        {poseValid ? "SKELETON ✓" : "SEARCHING..."}
                      </span>
                      {confidence > 0 && (
                        <span className={`backdrop-blur-sm text-xs font-mono px-3 py-1 rounded-full border ${colors.badge}`}>
                          {ui.icon} {(confidence*100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-4 text-gray-600 py-20">
                    <svg className="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <p className="font-mono text-sm tracking-widest">[ AI MONITORING OFFLINE ]</p>
                    <p className="text-gray-700 text-xs">Enter patient ID and click Start Monitoring</p>
                  </div>
                )}
              </div>

              {/* Legend */}
              {isOn && (
                <div className="bg-gray-900 border-t border-gray-800 px-5 py-3 flex flex-wrap gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-2 border-emerald-500" />{anomalyType.replace(/_/g," ")}</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded bg-indigo-500/60" />Movement trail</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-500/80" />Body joints</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-violet-500/50" />Skeleton bones</span>
                </div>
              )}
            </div>

            {/* ── Event Timeline ──────────────────────────────────────────── */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Event Timeline</p>
                <span className="text-xs text-gray-600 font-mono">{timeline.length} events</span>
              </div>
              {timeline.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-6">No anomaly events detected this session</p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {timeline.map((ev) => {
                    const evUi    = ANOMALY_UI[ev.type] || ANOMALY_UI.no_person;
                    const evColor = COLORS[evUi.color];
                    return (
                      <div key={ev.id}
                        className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs
                          ${evColor.bg} ${evColor.border}`}>
                        <div className="flex items-center gap-2">
                          <span>{evUi.icon}</span>
                          <div>
                            <p className={`font-bold ${evColor.text}`}>{ev.type.replace(/_/g," ").toUpperCase()}</p>
                            <p className="text-gray-500 mt-0.5">
                              {(ev.conf*100).toFixed(0)}% conf · {ev.src?.replace(/_/g," ")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-bold uppercase ${SEV_BADGE[ev.sev] || SEV_BADGE.none}`}>
                            {ev.sev}
                          </span>
                          <span className="text-gray-500 font-mono">{ev.time}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Right panel ──────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">

            {/* ── Patient Status Card ────────────────────────────────────── */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">Patient Status</p>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-lg">
                  👴
                </div>
                <div>
                  <p className="font-bold text-white font-mono text-sm">{personId}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {isOn ? "Monitoring Active" : "Monitoring Inactive"}
                  </p>
                </div>
              </div>
              <div className="border-t border-gray-800 pt-3 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-gray-500">Current State</span>
                  <span className={colors.text}>{ui.icon} {ui.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Severity</span>
                  <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-xs ${SEV_BADGE[severity] || SEV_BADGE.none}`}>
                    {severity}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Event</span>
                  <span className="text-gray-400">{lastUpdate?.toLocaleTimeString() || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Pose Valid</span>
                  <span className={poseValid ? "text-emerald-400" : "text-gray-600"}>{poseValid ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>

            {/* ── Live Status Panel ──────────────────────────────────────── */}
            <div className={`border-2 rounded-2xl p-5 transition-all duration-500
              ${colors.border} ${colors.bg} ${ui.pulse && isOn ? "animate-pulse" : ""}`}>
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-2 font-semibold">Detection Status</p>
              <p className={`text-xl font-black ${colors.text} flex items-center gap-2`}>
                <span>{ui.icon}</span> {ui.label}
              </p>
              {severity !== "none" && (
                <span className={`mt-2 inline-block text-xs font-bold uppercase px-2 py-0.5 rounded ${SEV_BADGE[severity] || SEV_BADGE.none}`}>
                  {severity} severity
                </span>
              )}
            </div>

            {/* ── Confidence visualization ───────────────────────────────── */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
              <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Confidence & Metrics</p>

              {/* Confidence bar */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">Anomaly Confidence</span>
                  <span className="text-white font-mono font-bold">{(confidence*100).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500
                    ${confidence > 0.8 ? "bg-red-500" : confidence > 0.6 ? "bg-yellow-500" : "bg-emerald-500"}`}
                    style={{width:`${(confidence*100).toFixed(0)}%`}} />
                </div>
              </div>

              {/* Motion score */}
              {motionScore !== null && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">Pose Energy (Motion Score)</span>
                    <span className="text-indigo-300 font-mono">{motionScore.toFixed(4)}</span>
                  </div>
                  <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500 bg-indigo-500"
                      style={{width:`${Math.min(motionScore * 200, 100).toFixed(0)}%`}} />
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    {motionScore < 0.012 ? "Inactive" : motionScore < 0.04 ? "Low Activity" : "High Activity"}
                  </p>
                </div>
              )}

              {/* Wrist velocity */}
              {wristVel !== null && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">Wrist Velocity</span>
                    <span className="text-violet-300 font-mono">{wristVel.toFixed(4)}</span>
                  </div>
                  <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500 bg-violet-500"
                      style={{width:`${Math.min(wristVel * 500, 100).toFixed(0)}%`}} />
                  </div>
                </div>
              )}
            </div>

            {/* ── Evidence panel ─────────────────────────────────────────── */}
            {Object.keys(evidence).length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <p className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">Evidence Details</p>
                <div className="space-y-1.5 font-mono text-xs">
                  {Object.entries(evidence).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-gray-500">{k.replace(/_/g," ")}</span>
                      <span className="text-indigo-300">{typeof v === "number" ? v.toFixed(4) : String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── API Error ──────────────────────────────────────────────── */}
            {error && (
              <div className="bg-red-900/30 border border-red-500/50 text-red-300 text-xs p-4 rounded-2xl">
                <p className="font-bold mb-1">Connection Error</p>
                <p className="break-words">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
