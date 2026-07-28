/**
 * anomaly-detection/frontend/src/pages/AnomalyDashboard.jsx
 * Phase 3 — Research-grade production dashboard
 *
 * NEW in Phase 3:
 *  ✅ Decision Reasoning panel (WHY + contributing factors)
 *  ✅ Research Metrics panel (accuracy proxy, FPS, latency, event distribution)
 *  ✅ Analytics bar chart (event distribution)
 *  ✅ System Health panel (WS status, FPS, latency meter)
 *  ✅ Scenario Mode panel (Demo simulation buttons)
 *  ✅ Export session logs (download JSON)
 *  ✅ Reset Session button
 *  ✅ Loading skeleton states
 *  ✅ Risk Level indicator in Patient card
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import axios from "axios";

const ANOMALY_API  = import.meta.env.VITE_ANOMALY_BACKEND_URL || "http://localhost:8003/api/anomaly";
const POLL_MS      = 200;
const SNAPSHOT_MS  = 500;
const TRAIL_LEN    = 25;
const MAX_TIMELINE = 20;
const METRICS_MS   = 3000; // refresh metrics every 3s

// ── Anomaly UI config ─────────────────────────────────────────────────────────
const ANOMALY_UI = {
  normal_activity:      { label: "Normal Activity",      color: "emerald", icon: "✅", pulse: false },
  fall_detected:        { label: "FALL DETECTED",         color: "red",     icon: "🚨", pulse: true  },
  aggression_detected:  { label: "Aggression Detected",  color: "orange",  icon: "⚠️", pulse: true  },
  prolonged_inactivity: { label: "Prolonged Inactivity", color: "yellow",  icon: "😴", pulse: true  },
  inactivity_warning:   { label: "Inactivity Warning",   color: "yellow",  icon: "⏱️", pulse: false },
  unusual_movement:     { label: "Unusual Movement",     color: "indigo",  icon: "❓", pulse: true  },
  no_person:            { label: "No Person in Frame",   color: "gray",    icon: "👁️", pulse: false },
};

const COLORS = {
  emerald: { border: "border-emerald-500", bg: "bg-emerald-900/30", text: "text-emerald-400", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", box: "rgba(16,185,129,0.9)",  bar: "#10b981" },
  red:     { border: "border-red-500",     bg: "bg-red-900/30",     text: "text-red-400",     badge: "bg-red-500/20 text-red-300 border-red-500/50",             box: "rgba(239,68,68,0.95)", bar: "#ef4444" },
  orange:  { border: "border-orange-500",  bg: "bg-orange-900/30",  text: "text-orange-400",  badge: "bg-orange-500/20 text-orange-300 border-orange-500/40",    box: "rgba(249,115,22,0.9)", bar: "#f97316" },
  yellow:  { border: "border-yellow-500",  bg: "bg-yellow-900/30",  text: "text-yellow-400",  badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",    box: "rgba(234,179,8,0.9)",  bar: "#eab308" },
  indigo:  { border: "border-indigo-500",  bg: "bg-indigo-900/30",  text: "text-indigo-400",  badge: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",    box: "rgba(99,102,241,0.9)", bar: "#6366f1" },
  gray:    { border: "border-gray-700",    bg: "bg-gray-800/50",    text: "text-gray-400",    badge: "bg-gray-700/50 text-gray-400 border-gray-600/40",           box: "rgba(156,163,175,0.6)",bar: "#6b7280" },
};

const SEV_BADGE = {
  critical: "bg-red-600/30 text-red-300 border border-red-600/40",
  high:     "bg-orange-600/30 text-orange-300 border border-orange-600/40",
  medium:   "bg-yellow-600/30 text-yellow-300 border border-yellow-600/40",
  low:      "bg-indigo-600/30 text-indigo-300 border border-indigo-600/40",
  none:     "bg-gray-700/30 text-gray-400 border border-gray-700/40",
};

const RISK_LEVEL = {
  fall_detected:        { label: "CRITICAL", cls: "text-red-300 bg-red-900/40 border-red-600/50" },
  aggression_detected:  { label: "HIGH",     cls: "text-orange-300 bg-orange-900/40 border-orange-600/50" },
  prolonged_inactivity: { label: "HIGH",     cls: "text-orange-300 bg-orange-900/40 border-orange-600/50" },
  inactivity_warning:   { label: "MEDIUM",   cls: "text-yellow-300 bg-yellow-900/40 border-yellow-600/50" },
  unusual_movement:     { label: "LOW",      cls: "text-indigo-300 bg-indigo-900/40 border-indigo-600/50" },
  normal_activity:      { label: "SAFE",     cls: "text-emerald-300 bg-emerald-900/40 border-emerald-600/50" },
  no_person:            { label: "UNKNOWN",  cls: "text-gray-400 bg-gray-800 border-gray-700" },
};

const SOURCE_BADGE = {
  "rule_engine":    { label: "Rule Engine", cls: "bg-blue-800/50 text-blue-300" },
  "lstm":           { label: "LSTM",        cls: "bg-purple-800/50 text-purple-300" },
  "lstm+rule":      { label: "Hybrid",      cls: "bg-violet-800/50 text-violet-300" },
  "rule_engine+ae": { label: "Rule+AE",     cls: "bg-teal-800/50 text-teal-300" },
  "autoencoder":    { label: "Autoencoder", cls: "bg-cyan-800/50 text-cyan-300" },
  "simulation":     { label: "SIM",         cls: "bg-pink-800/50 text-pink-300" },
};

const SKELETON_PAIRS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[24,26],[26,28],
  [0,11],[0,12],
];

const DIST_LABELS = {
  fall_detected:        "Fall",
  aggression_detected:  "Aggression",
  prolonged_inactivity: "Inactivity",
  inactivity_warning:   "Warning",
  unusual_movement:     "Unusual",
  normal_activity:      "Normal",
  no_person:            "No Person",
};

// ── Mini bar chart ────────────────────────────────────────────────────────────
function DistributionBar({ label, count, percent, color }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-gray-400 truncate shrink-0">{label}</span>
      <div className="flex-1 bg-gray-800 h-2 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-gray-500 w-10 text-right font-mono">{count}</span>
      <span className="text-gray-600 w-10 text-right font-mono">{percent}%</span>
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({ label, value, unit = "", cls = "text-white" }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-black font-mono ${cls}`}>{value}<span className="text-sm text-gray-500 ml-1">{unit}</span></p>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function Skeleton({ h = "h-4", w = "w-full" }) {
  return <div className={`${h} ${w} bg-gray-800 rounded animate-pulse`} />;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AnomalyDashboard() {
  const [isOn,          setIsOn]          = useState(false);
  const [cameraSource,  setCameraSource]  = useState("webcam");
  const [anomalyType,   setAnomalyType]   = useState("no_person");
  const [confidence,    setConfidence]    = useState(0);
  const [severity,      setSeverity]      = useState("none");
  const [source,        setSource]        = useState("rule_engine");
  const [poseValid,     setPoseValid]     = useState(false);
  const [bbox,          setBbox]          = useState(null);
  const [keypoints,     setKeypoints]     = useState(null);
  const [evidence,      setEvidence]      = useState({});
  const [explanation,   setExplanation]   = useState(null);
  const [personId,      setPersonId]      = useState("patient_001");
  const [lastUpdate,    setLastUpdate]    = useState(null);
  const [latencyMs,     setLatencyMs]     = useState(null);
  const [wsStatus,      setWsStatus]      = useState("disconnected");
  const [error,         setError]         = useState("");
  const [isSimulating,  setIsSimulating]  = useState(false);
  const [simLoading,    setSimLoading]    = useState(null);
  const [timeline,      setTimeline]      = useState([]);
  const [metrics,       setMetrics]       = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [activeTab,     setActiveTab]     = useState("monitor"); // monitor | analytics | research

  // IP camera
  const [ipFrame,   setIpFrame]   = useState(null);
  const [ipError,   setIpError]   = useState(null);
  const [ipLoading, setIpLoading] = useState(false);

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

  // ── Fetch metrics periodically ─────────────────────────────────────────────
  useEffect(() => {
    const fetchMetrics = async () => {
      setMetricsLoading(true);
      try {
        const { data } = await axios.get(`${ANOMALY_API}/metrics`, { timeout: 3000 });
        setMetrics(data);
      } catch { /* silent */ } finally {
        setMetricsLoading(false);
      }
    };
    fetchMetrics();
    const t = setInterval(fetchMetrics, METRICS_MS);
    return () => clearInterval(t);
  }, []);

  // ── Canvas drawing ─────────────────────────────────────────────────────────
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
    }
    if (bboxData) {
      const { x, y, w, h } = bboxData;
      const [rx,ry,rw,rh] = [x*W, y*H, w*W, h*H];
      ctx.shadowColor = boxColor; ctx.shadowBlur = 14;
      ctx.strokeStyle = boxColor; ctx.lineWidth = 2.5;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.shadowBlur = 0;
    }
    if (kpts && kpts.length >= 29) {
      ctx.strokeStyle = "rgba(139,92,246,0.6)"; ctx.lineWidth = 1.5;
      SKELETON_PAIRS.forEach(([a,b]) => {
        const pa = kpts[a], pb = kpts[b];
        if (!pa || !pb || pa[2] < 0.3 || pb[2] < 0.3) return;
        ctx.beginPath();
        ctx.moveTo(pa[0]*W, pa[1]*H);
        ctx.lineTo(pb[0]*W, pb[1]*H);
        ctx.stroke();
      });
      kpts.forEach(([kx,ky,vis]) => {
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
      const c = canvasRef.current;
      if (c) c.getContext("2d").clearRect(0,0,c.width,c.height);
      trailRef.current = [];
      return;
    }
    const col = COLORS[ANOMALY_UI[anomalyType]?.color || "gray"];
    drawCanvas(bbox, keypoints, trailRef.current, col.box);
  }, [bbox, keypoints, anomalyType, isOn, drawCanvas]);

  // ── IP Camera preview ──────────────────────────────────────────────────────
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

  // ── Handle WS message ─────────────────────────────────────────────────────
  const handleMessage = useCallback((data) => {
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
    setExplanation(data.explanation || null);
    setLastUpdate(new Date());
    setLatencyMs(data.latency_ms || null);
    setError(data.error || "");

    if (data.bbox) {
      const cx = data.bbox.x + data.bbox.w / 2;
      const cy = data.bbox.y + data.bbox.h / 2;
      trailRef.current = [...trailRef.current.slice(-(TRAIL_LEN-1)), { x: cx, y: cy }];
    }

    if (atype !== "normal_activity" && atype !== "no_person") {
      setTimeline(prev => [{
        id: Date.now(), type: atype, conf, sev, src,
        time: new Date().toLocaleTimeString(),
        evidence: data.evidence || {},
        explanation: data.explanation || null,
        simulated: !!data.simulated,
      }, ...prev].slice(0, MAX_TIMELINE));
    }
  }, []);

  // ── Send frame via WS ─────────────────────────────────────────────────────
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

  // ── WebSocket lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    if (isOn) {
      const token  = localStorage.getItem("access_token") || "";
      const wsUrl  = ANOMALY_API.replace(/^http/, "ws") + "/ws/process" + (token ? `?token=${token}` : "");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen    = () => { setWsStatus("connected"); setError(""); pollRef.current = setInterval(sendFrame, POLL_MS); };
      ws.onmessage = (evt) => { try { handleMessage(JSON.parse(evt.data)); } catch(e) { console.error(e); } };
      ws.onerror   = () => { setWsStatus("error"); setError("WebSocket connection failed"); };
      ws.onclose   = () => { setWsStatus("disconnected"); clearInterval(pollRef.current); };
    } else {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      clearInterval(pollRef.current);
      setAnomalyType("no_person"); setBbox(null); setKeypoints(null);
      setConfidence(0); setPoseValid(false); setWsStatus("disconnected");
    }
    return () => { if (wsRef.current) wsRef.current.close(); clearInterval(pollRef.current); };
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

  // ── Scenario Mode ─────────────────────────────────────────────────────────
  const runScenario = useCallback(async (scenario) => {
    setSimLoading(scenario);
    const token = localStorage.getItem("access_token");
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const { data } = await axios.post(`${ANOMALY_API}/simulate/${scenario}`, null,
        { params: { person_id: personId }, headers: authHeaders, timeout: 5000 });
      handleMessage(data);
      setIsSimulating(true);
      setTimeout(() => setIsSimulating(false), 4000);
    } catch (e) {
      setError(`Simulation failed: ${e.message}`);
    } finally {
      setSimLoading(null);
    }
  }, [personId, handleMessage]);

  // ── Reset Session ─────────────────────────────────────────────────────────
  const resetSession = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      await axios.post(`${ANOMALY_API}/reset-session`, null, { headers: authHeaders });
      setTimeline([]);
      setAnomalyType("no_person");
      setConfidence(0);
      setEvidence({});
      setExplanation(null);
      setSeverity("none");
    } catch (e) {
      setError(`Reset failed: ${e.message}`);
    }
  }, []);

  // ── Export logs ───────────────────────────────────────────────────────────
  const exportLogs = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const { data } = await axios.get(`${ANOMALY_API}/session-logs`, { headers: authHeaders });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `anomaly_logs_${Date.now()}.json`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Export failed: ${e.message}`);
    }
  }, []);

  // ── Derived UI ────────────────────────────────────────────────────────────
  const ui        = ANOMALY_UI[anomalyType] || ANOMALY_UI.no_person;
  const colors    = COLORS[ui.color];
  const isFall    = anomalyType === "fall_detected";
  const srcBadge  = SOURCE_BADGE[source] || SOURCE_BADGE["rule_engine"];
  const riskInfo  = RISK_LEVEL[anomalyType] || RISK_LEVEL.no_person;
  const motionScore = evidence?.pose_energy ?? null;
  const wristVel    = evidence?.wrist_velocity ?? null;

  const wsIndicator = {
    connected:    { dot: "bg-emerald-500 animate-pulse", label: "LIVE" },
    disconnected: { dot: "bg-gray-500",                  label: "OFFLINE" },
    error:        { dot: "bg-red-500 animate-pulse",     label: "ERROR" },
  }[wsStatus];

  const tabs = [
    { id: "monitor",  label: "🖥️ Monitor"  },
    { id: "analytics",label: "📊 Analytics" },
    { id: "research", label: "🔬 Research"  },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── FALL BANNER ───────────────────────────────────────────────────── */}
      {isFall && (
        <div className="px-6 pt-4">
          <div className="flex items-center gap-4 bg-red-600/20 border-2 border-red-500 text-red-200 px-6 py-4 rounded-2xl animate-pulse shadow-2xl shadow-red-900/40">
            <span className="text-4xl">🚨</span>
            <div>
              <p className="font-black text-2xl text-red-300 tracking-wide">FALL DETECTED</p>
              {explanation?.reason && (
                <p className="text-sm text-red-400 mt-0.5 max-w-2xl">{explanation.reason}</p>
              )}
            </div>
            <div className="ml-auto text-xs font-mono text-red-500">{lastUpdate?.toLocaleTimeString()}</div>
          </div>
        </div>
      )}

      <div className="p-5">
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight">
              Anomaly Detection
              {isSimulating && <span className="ml-3 text-sm font-mono text-pink-400 animate-pulse">[SIM MODE]</span>}
            </h1>
            <p className="text-gray-400 text-sm mt-1">MediaPipe · Rule Engine · LSTM · Autoencoder · Phase 3</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isOn && (
              <input type="text" placeholder="Patient ID" value={personId}
                onChange={e => setPersonId(e.target.value)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white font-mono w-36 focus:outline-none focus:border-indigo-500" />
            )}
            <span className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-full border bg-gray-800/80 border-gray-700 text-gray-400">
              <span className={`w-2 h-2 rounded-full ${wsIndicator.dot}`} />{wsIndicator.label}
            </span>
            <button onClick={exportLogs}
              className="px-3 py-2 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl transition-all">
              ⬇️ Export
            </button>
            <button onClick={resetSession}
              className="px-3 py-2 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-yellow-400 rounded-xl transition-all">
              🔄 Reset
            </button>
            <button id="toggle-monitoring-btn" onClick={() => setIsOn(v => !v)}
              className={`px-5 py-2 font-bold rounded-xl transition-all shadow-lg
                ${isOn ? "bg-red-600 hover:bg-red-500 shadow-red-900/30" : "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/30"}`}>
              {isOn ? "Stop" : "Start Monitoring"}
            </button>
          </div>
        </div>

        {/* ── Tab nav ───────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-5 p-1 bg-gray-900/80 rounded-xl border border-gray-800 max-w-sm">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all
                ${activeTab === t.id ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* MONITOR TAB                                                        */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "monitor" && (
          <>
            {/* Camera source toggle */}
            {!isOn && (
              <div className="flex items-center gap-2 mb-5 p-1 bg-gray-900 rounded-xl border border-gray-700 max-w-xs">
                {[{id:"webcam",label:"🖥️ Webcam"},{id:"ip_camera",label:"📡 IP Camera"}].map(({id,label}) => (
                  <button key={id} id={`source-toggle-${id}`} onClick={() => setCameraSource(id)}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all
                      ${cameraSource===id ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
              {/* ── Video + Timeline (left) ────────────────────────────────── */}
              <div className="xl:col-span-2 flex flex-col gap-4">
                {/* Video feed */}
                <div className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
                  <div className="bg-gray-800/80 px-5 py-3 flex items-center justify-between border-b border-gray-700">
                    <div className="flex items-center gap-2 text-sm text-gray-300">
                      <span className={`w-2.5 h-2.5 rounded-full ${isOn ? "bg-red-500 animate-pulse" : "bg-gray-600"}`} />
                      {isOn ? "AI Monitoring Active" : "Camera Offline"}
                    </div>
                    <div className="flex items-center gap-3">
                      {source && isOn && (
                        <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${srcBadge.cls}`}>{srcBadge.label}</span>
                      )}
                      {latencyMs && (
                        <span className="text-xs text-gray-500 font-mono">{latencyMs}ms</span>
                      )}
                      {lastUpdate && (
                        <span className="text-xs text-gray-600 font-mono">{lastUpdate.toLocaleTimeString()}</span>
                      )}
                    </div>
                  </div>
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
                            {ipLoading && <div className="flex items-center justify-center py-20"><div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}
                            {ipError && !ipLoading && <div className="flex flex-col items-center justify-center gap-2 text-red-400 py-20"><span className="text-5xl">📡</span><p>{ipError}</p></div>}
                            {ipFrame && !ipLoading && <img src={ipFrame} alt="IP camera" className="w-full h-full object-cover" />}
                            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{pointerEvents:"none"}} />
                          </>
                        )}
                        <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 bg-red-600/90 text-white text-xs font-black px-3 py-1 rounded-full animate-pulse tracking-widest">
                          <span className="w-2 h-2 bg-white rounded-full" />REC
                        </div>
                        <div className="absolute top-4 right-4 z-10 flex flex-col gap-1.5 items-end">
                          <span className={`backdrop-blur-sm text-xs font-mono px-3 py-1 rounded-full border
                            ${poseValid ? "bg-emerald-700/80 text-emerald-200 border-emerald-500/40" : "bg-gray-700/80 text-gray-400 border-gray-600"}`}>
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
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Event Timeline ──────────────────────────────────────── */}
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
                        const evUi = ANOMALY_UI[ev.type] || ANOMALY_UI.no_person;
                        const evColor = COLORS[evUi.color];
                        return (
                          <div key={ev.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs ${evColor.bg} ${evColor.border}`}>
                            <div className="flex items-center gap-2">
                              <span>{evUi.icon}</span>
                              <div>
                                <p className={`font-bold ${evColor.text}`}>
                                  {ev.type.replace(/_/g," ").toUpperCase()}
                                  {ev.simulated && <span className="ml-1 text-pink-500">[SIM]</span>}
                                </p>
                                <p className="text-gray-500 mt-0.5">{(ev.conf*100).toFixed(0)}% · {ev.src?.replace(/_/g," ")}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-bold uppercase ${SEV_BADGE[ev.sev] || SEV_BADGE.none}`}>{ev.sev}</span>
                              <span className="text-gray-500 font-mono">{ev.time}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right panel ───────────────────────────────────────────── */}
              <div className="flex flex-col gap-4">
                {/* Patient status */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <p className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">Patient Status</p>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-lg">👴</div>
                    <div>
                      <p className="font-bold text-white font-mono text-sm">{personId}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{isOn ? "Monitoring Active" : "Monitoring Inactive"}</p>
                    </div>
                  </div>
                  <div className="border-t border-gray-800 pt-3 space-y-2 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Risk Level</span>
                      <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-xs border ${riskInfo.cls}`}>{riskInfo.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Current State</span>
                      <span className={colors.text}>{ui.icon} {ui.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Severity</span>
                      <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-xs ${SEV_BADGE[severity] || SEV_BADGE.none}`}>{severity}</span>
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

                {/* Live Detection Status */}
                <div className={`border-2 rounded-2xl p-5 transition-all duration-500 ${colors.border} ${colors.bg} ${ui.pulse && isOn ? "animate-pulse" : ""}`}>
                  <p className="text-xs uppercase tracking-widest text-gray-500 mb-2 font-semibold">Detection Status</p>
                  <p className={`text-xl font-black ${colors.text} flex items-center gap-2`}>
                    <span>{ui.icon}</span> {ui.label}
                  </p>
                  {severity !== "none" && (
                    <span className={`mt-2 inline-block text-xs font-bold uppercase px-2 py-0.5 rounded ${SEV_BADGE[severity] || SEV_BADGE.none}`}>{severity} severity</span>
                  )}
                </div>

                {/* ── Decision Explanation ─────────────────────────────────── */}
                {explanation && (
                  <div className="bg-gray-900 border border-indigo-500/30 rounded-2xl p-5">
                    <p className="text-xs uppercase tracking-widest text-indigo-400 mb-2 font-semibold flex items-center gap-2">
                      <span>🧠</span> Decision Reasoning
                    </p>
                    <p className="text-xs text-gray-300 leading-relaxed mb-3">{explanation.reason}</p>
                    {explanation.contributing_factors && Object.keys(explanation.contributing_factors).length > 0 && (
                      <div className="border-t border-gray-800 pt-3 space-y-1.5">
                        <p className="text-xs text-gray-500 font-semibold mb-2">Contributing Factors</p>
                        {Object.entries(explanation.contributing_factors).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-2 text-xs">
                            <span className="text-gray-500 w-36 truncate shrink-0">{k.replace(/_/g," ")}</span>
                            {typeof v === "number" && v <= 1.0 && v >= 0.0 ? (
                              <>
                                <div className="flex-1 bg-gray-800 h-1.5 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                                    style={{width:`${(v*100).toFixed(0)}%`}} />
                                </div>
                                <span className="text-indigo-300 w-10 text-right font-mono">{(v*100).toFixed(0)}%</span>
                              </>
                            ) : (
                              <span className="text-indigo-300 font-mono ml-auto">{typeof v === "number" ? v.toFixed(typeof v === "number" && v > 10 ? 0 : 4) : String(v)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {explanation.temporal_confirmation > 0 && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400">
                        <span>⏱️</span>
                        <span>Confirmed across <strong>{explanation.temporal_confirmation}</strong> frames</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Confidence + metrics */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
                  <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Signal Metrics</p>
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
                  {motionScore !== null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-500">Motion Energy</span>
                        <span className="text-indigo-300 font-mono">{motionScore.toFixed(4)}</span>
                      </div>
                      <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500 bg-indigo-500"
                          style={{width:`${Math.min(motionScore*200,100).toFixed(0)}%`}} />
                      </div>
                    </div>
                  )}
                  {wristVel !== null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-500">Wrist Velocity</span>
                        <span className="text-violet-300 font-mono">{wristVel.toFixed(4)}</span>
                      </div>
                      <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500 bg-violet-500"
                          style={{width:`${Math.min(wristVel*500,100).toFixed(0)}%`}} />
                      </div>
                    </div>
                  )}
                </div>

                {/* System Health */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <p className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">⚡ System Health</p>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-gray-500">WebSocket</span>
                      <span className={wsStatus==="connected" ? "text-emerald-400" : wsStatus==="error" ? "text-red-400" : "text-gray-500"}>
                        {wsStatus.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">FPS</span>
                      <span className="text-white">{metrics?.fps ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Avg Latency</span>
                      <span className={`${latencyMs && latencyMs < 100 ? "text-emerald-400" : "text-yellow-400"}`}>
                        {latencyMs ? `${latencyMs}ms` : (metrics?.latency_ms?.avg ? `${metrics.latency_ms.avg}ms` : "—")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Frames Processed</span>
                      <span className="text-white">{metrics?.session?.total_frames ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Total Anomalies</span>
                      <span className="text-orange-400">{metrics?.session?.total_anomalies ?? "—"}</span>
                    </div>
                  </div>
                </div>

                {/* ── Scenario Mode ─────────────────────────────────────────── */}
                <div className="bg-gray-900 border border-pink-500/30 rounded-2xl p-5">
                  <p className="text-xs uppercase tracking-widest text-pink-400 mb-3 font-semibold flex items-center gap-2">
                    <span>🎭</span> Scenario Mode
                    <span className="text-gray-600 font-normal">(Demo)</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id:"fall",       label:"🚨 Fall",       cls:"bg-red-800/40 border-red-700 hover:bg-red-700/50 text-red-300" },
                      { id:"aggression", label:"⚠️ Aggression",  cls:"bg-orange-800/40 border-orange-700 hover:bg-orange-700/50 text-orange-300" },
                      { id:"inactivity", label:"😴 Inactivity",  cls:"bg-yellow-800/40 border-yellow-700 hover:bg-yellow-700/50 text-yellow-300" },
                      { id:"normal",     label:"✅ Normal",      cls:"bg-emerald-800/40 border-emerald-700 hover:bg-emerald-700/50 text-emerald-300" },
                    ].map(s => (
                      <button key={s.id} id={`sim-${s.id}-btn`}
                        onClick={() => runScenario(s.id)}
                        disabled={simLoading !== null}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all
                          ${s.cls} ${simLoading === s.id ? "opacity-50 animate-pulse" : ""}`}>
                        {simLoading === s.id ? "⏳ ..." : s.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-600 mt-2">Inject demo events without real camera input</p>
                </div>

                {error && (
                  <div className="bg-red-900/30 border border-red-500/50 text-red-300 text-xs p-4 rounded-2xl">
                    <p className="font-bold mb-1">Error</p><p>{error}</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ANALYTICS TAB                                                      */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "analytics" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Event Distribution */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
              <p className="text-sm font-bold text-gray-300 mb-1">📊 Event Distribution</p>
              <p className="text-xs text-gray-500 mb-5">Breakdown of all processed frames by detection type</p>
              {metricsLoading && !metrics ? (
                <div className="space-y-3">{Array(6).fill(0).map((_,i)=><Skeleton key={i} h="h-4" />)}</div>
              ) : metrics?.event_distribution ? (
                <div className="space-y-3">
                  {Object.entries(metrics.event_distribution).map(([key, val]) => {
                    const evUi = ANOMALY_UI[key];
                    const evColor = COLORS[evUi?.color || "gray"];
                    return (
                      <DistributionBar key={key}
                        label={DIST_LABELS[key] || key}
                        count={val.count}
                        percent={val.percent}
                        color={evColor.bar}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="text-gray-600 text-sm text-center py-8">No data yet — start monitoring to see distribution</p>
              )}
            </div>

            {/* Session Timeline */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
              <p className="text-sm font-bold text-gray-300 mb-1">📈 Anomaly Timeline</p>
              <p className="text-xs text-gray-500 mb-5">Most recent {timeline.length} anomaly events</p>
              {timeline.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No anomaly events yet this session</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {timeline.map((ev, idx) => {
                    const evUi = ANOMALY_UI[ev.type] || ANOMALY_UI.no_person;
                    const evColor = COLORS[evUi.color];
                    return (
                      <div key={ev.id} className="flex items-start gap-3 text-xs">
                        <span className="text-gray-600 font-mono w-6 shrink-0">{String(idx+1).padStart(2,"0")}</span>
                        <div className={`w-2 h-2 rounded-full mt-1 shrink-0`} style={{backgroundColor: evColor.bar}} />
                        <div className="flex-1">
                          <p className={`font-bold ${evColor.text}`}>{ev.type.replace(/_/g," ").toUpperCase()}</p>
                          <p className="text-gray-500">{(ev.conf*100).toFixed(0)}% conf · {ev.sev} · {ev.time}</p>
                          {ev.explanation?.reason && (
                            <p className="text-gray-600 mt-0.5 leading-relaxed">{ev.explanation.reason.slice(0,120)}…</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Severity breakdown */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
              <p className="text-sm font-bold text-gray-300 mb-4">⚡ Severity Breakdown</p>
              {timeline.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No events recorded</p>
              ) : (() => {
                const sevCount = { critical:0, high:0, medium:0, low:0, none:0 };
                timeline.forEach(ev => { sevCount[ev.sev] = (sevCount[ev.sev] || 0) + 1; });
                const total = timeline.length;
                return (
                  <div className="space-y-3">
                    {[["critical","bg-red-500"],["high","bg-orange-500"],["medium","bg-yellow-500"],["low","bg-indigo-500"]].map(([sev,bar]) => (
                      <div key={sev} className="flex items-center gap-2 text-xs">
                        <span className="w-16 text-gray-400 capitalize">{sev}</span>
                        <div className="flex-1 bg-gray-800 h-2 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${bar}`}
                            style={{width:`${((sevCount[sev]||0)/total*100).toFixed(0)}%`}} />
                        </div>
                        <span className="text-gray-500 w-6 text-right">{sevCount[sev]||0}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Detection source breakdown */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
              <p className="text-sm font-bold text-gray-300 mb-4">🔍 Detection Sources</p>
              {timeline.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No events recorded</p>
              ) : (() => {
                const srcCount = {};
                timeline.forEach(ev => { srcCount[ev.src] = (srcCount[ev.src] || 0) + 1; });
                const total = timeline.length;
                return (
                  <div className="space-y-3">
                    {Object.entries(srcCount).map(([src, cnt]) => {
                      const sb = SOURCE_BADGE[src] || SOURCE_BADGE["rule_engine"];
                      return (
                        <div key={src} className="flex items-center gap-2 text-xs">
                          <span className={`px-2 py-0.5 rounded text-xs font-mono ${sb.cls}`}>{sb.label}</span>
                          <div className="flex-1 bg-gray-800 h-2 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-indigo-500"
                              style={{width:`${(cnt/total*100).toFixed(0)}%`}} />
                          </div>
                          <span className="text-gray-500 w-6 text-right">{cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* RESEARCH TAB                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "research" && (
          <div className="space-y-5">
            {/* Metric cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {metricsLoading && !metrics ? (
                Array(4).fill(0).map((_,i) => <Skeleton key={i} h="h-20" />)
              ) : metrics ? (
                <>
                  <MetricCard label="System Accuracy (Proxy)" value={(metrics.fall_accuracy_proxy*100).toFixed(1)} unit="%" cls="text-emerald-400" />
                  <MetricCard label="False Positive Rate" value={(metrics.false_positive_rate*100).toFixed(1)} unit="%" cls={metrics.false_positive_rate < 0.1 ? "text-emerald-400" : "text-yellow-400"} />
                  <MetricCard label="Avg Response Time" value={metrics.latency_ms.avg} unit="ms" cls={metrics.latency_ms.avg < 100 ? "text-emerald-400" : "text-yellow-400"} />
                  <MetricCard label="Processing FPS" value={metrics.fps} unit="fps" cls="text-indigo-400" />
                </>
              ) : (
                <p className="col-span-4 text-gray-600 text-center py-8">Metrics will appear once monitoring starts</p>
              )}
            </div>

            {/* Latency breakdown */}
            {metrics && (
              <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
                <p className="text-sm font-bold text-gray-300 mb-4">📉 Latency Analysis</p>
                <div className="grid grid-cols-3 gap-4">
                  {[["Average", metrics.latency_ms.avg, "ms"], ["P95", metrics.latency_ms.p95, "ms"], ["P99", metrics.latency_ms.p99, "ms"]].map(([label, val, unit]) => (
                    <div key={label} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-500 mb-1">{label}</p>
                      <p className="text-2xl font-black text-white font-mono">{val}<span className="text-sm text-gray-500 ml-1">{unit}</span></p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* System info */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
              <p className="text-sm font-bold text-gray-300 mb-4">🏗️ System Architecture</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-xs font-mono">
                {[
                  ["Pipeline",          metrics?.model_pipeline || "MediaPipe → Rule Engine → LSTM → Autoencoder"],
                  ["Feature Vector",    `${metrics?.feature_dimensions || 40} dimensions`],
                  ["Sequence Window",   "30 frames (6 seconds @ 5 FPS)"],
                  ["Detection Classes", "5 (Fall, Aggression, Inactivity, Warning, Unusual)"],
                  ["Smoothing Window",  "8 frames majority vote"],
                  ["Alert Cooldown",    "8 seconds per event-patient pair"],
                  ["Pose Landmarks",    "33 × [x, y, z, visibility]"],
                  ["Backbone",          "MediaPipe BlazePose (Google)"],
                  ["LSTM Hidden Dim",   "128 → 64 → 5-class output"],
                  ["Autoencoder Dims",  "40→32→16→8→16→32→40"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-gray-800/50 py-1.5">
                    <span className="text-gray-500">{k}</span>
                    <span className="text-gray-300 max-w-xs text-right">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Session stats */}
            {metrics && (
              <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
                <p className="text-sm font-bold text-gray-300 mb-4">📊 Session Statistics</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <MetricCard label="Total Frames" value={metrics.session.total_frames} />
                  <MetricCard label="Total Anomalies" value={metrics.session.total_anomalies} cls="text-orange-400" />
                  <MetricCard label="Session Uptime" value={metrics.session.uptime_seconds} unit="s" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
