/**
 * anomaly-detection/frontend/src/pages/AnomalyDashboard.jsx
 *
 * Live anomaly detection dashboard:
 *  - Source toggle: Webcam  OR  IP Camera (via backend proxy)
 *  - Webcam mode: react-webcam → POST /api/anomaly/process every 0.2 s
 *  - IP Camera mode: backend fetches frame → POST /api/anomaly/camera-process every 0.2 s
 *  - IP Camera preview: GET /api/anomaly/camera-snapshot polled every 0.5 s
 *  - MediaPipe skeleton canvas overlay, fall banner, alert log
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import axios from "axios";

const ANOMALY_API = "http://localhost:8003/api/anomaly";
const POLL_MS = 200;
const SNAPSHOT_MS = 500;  // IP camera preview — backend now returns buffered frame (~1–5 ms), so we can poll fast
const TRAIL_LEN = 25;

// ── Status config ─────────────────────────────────────────────────────────────
const ANOMALY_UI = {
  normal_activity: { label: "Normal Activity", color: "emerald", icon: "✅", pulse: false },
  fall_detected: { label: "FALL DETECTED", color: "red", icon: "🚨", pulse: true },
  aggression_detected: { label: "Aggression Detected", color: "orange", icon: "⚠️", pulse: true },
  prolonged_inactivity: { label: "Prolonged Inactivity", color: "yellow", icon: "😴", pulse: true },
  inactivity_warning: { label: "Inactivity Warning", color: "yellow", icon: "⏱️", pulse: false },
  unusual_movement: { label: "Unusual Movement", color: "indigo", icon: "❓", pulse: true },
  no_person: { label: "No Person in Frame", color: "gray", icon: "👁️", pulse: false },
};

const COLORS = {
  emerald: { border: "border-emerald-500", bg: "bg-emerald-900/30", text: "text-emerald-400", box: "rgba(16,185,129,0.9)" },
  red: { border: "border-red-500", bg: "bg-red-900/30", text: "text-red-400", box: "rgba(239,68,68,0.95)" },
  orange: { border: "border-orange-500", bg: "bg-orange-900/30", text: "text-orange-400", box: "rgba(249,115,22,0.9)" },
  yellow: { border: "border-yellow-500", bg: "bg-yellow-900/30", text: "text-yellow-400", box: "rgba(234,179,8,0.9)" },
  indigo: { border: "border-indigo-500", bg: "bg-indigo-900/30", text: "text-indigo-400", box: "rgba(99,102,241,0.9)" },
  gray: { border: "border-gray-700", bg: "bg-gray-800/50", text: "text-gray-400", box: "rgba(156,163,175,0.6)" },
};

// MediaPipe skeleton bone pairs (landmark index pairs)
const SKELETON_PAIRS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],  // arms
  [11, 23], [12, 24], [23, 24],                  // torso
  [23, 25], [25, 27], [24, 26], [26, 28],          // legs
  [0, 11], [0, 12],                            // head-shoulders
];

export default function AnomalyDashboard() {
  const [isOn, setIsOn] = useState(false);
  const [cameraSource, setCameraSource] = useState("webcam"); // "webcam" | "ip_camera"
  const [anomalyType, setAnomalyType] = useState("no_person");
  const [confidence, setConfidence] = useState(0);
  const [severity, setSeverity] = useState("none");
  const [poseValid, setPoseValid] = useState(false);
  const [bbox, setBbox] = useState(null);
  const [keypoints, setKeypoints] = useState(null);
  const [lastPoll, setLastPoll] = useState(null);
  const [error, setError] = useState("");
  const [personId, setPersonId] = useState("patient_001");
  const [evidence, setEvidence] = useState({});
  const [alertLog, setAlertLog] = useState([]);

  // IP camera preview
  const [ipFrame, setIpFrame] = useState(null);
  const [ipError, setIpError] = useState(null);
  const [ipLoading, setIpLoading] = useState(false);

  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const pollRef = useRef(null);
  const inFlight = useRef(false);
  const trailRef = useRef([]);
  const isOnRef = useRef(false);
  const sourceRef = useRef("webcam");

  useEffect(() => { isOnRef.current = isOn; }, [isOn]);
  useEffect(() => { sourceRef.current = cameraSource; }, [cameraSource]);

  // ── Canvas drawing ─────────────────────────────────────────────────────────
  const drawCanvas = useCallback((bboxData, kpts, trail, boxColor) => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const W = wrapper.clientWidth;
    const H = wrapper.clientHeight;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // Movement trail
    if (trail.length > 1) {
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      trail.forEach((pt, i) => {
        if (i === 0) return;
        const alpha = 0.15 + (i / trail.length) * 0.7;
        ctx.strokeStyle = `rgba(99,102,241,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x * W, trail[i - 1].y * H);
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
      const rx = x * W, ry = y * H, rw = w * W, rh = h * H;

      ctx.shadowColor = boxColor;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.shadowBlur = 0;

      // Corner accents
      const cs = 16;
      ctx.lineWidth = 3.5;
      [[rx, ry, cs, 0, 0, cs], [rx + rw, ry, -cs, 0, 0, cs], [rx, ry + rh, cs, 0, 0, -cs], [rx + rw, ry + rh, -cs, 0, 0, -cs]]
        .forEach(([ox, oy, d1x, d1y, d2x, d2y]) => {
          ctx.beginPath();
          ctx.moveTo(ox + d1x, oy + d1y);
          ctx.lineTo(ox, oy);
          ctx.lineTo(ox + d2x, oy + d2y);
          ctx.stroke();
        });

      // Label above box
      const label = anomalyType.replace(/_/g, " ").toUpperCase();
      ctx.font = "bold 11px monospace";
      const tw = ctx.measureText(label).width;
      const ly = Math.max(ry - 8, 20);
      ctx.fillStyle = boxColor;
      ctx.fillRect(rx - 2, ly - 16, tw + 12, 20);
      ctx.fillStyle = "#000";
      ctx.fillText(label, rx + 4, ly - 2);
    }

    // Skeleton — bones
    if (kpts && kpts.length >= 29) {
      ctx.strokeStyle = "rgba(139,92,246,0.55)";
      ctx.lineWidth = 1.5;
      SKELETON_PAIRS.forEach(([a, b]) => {
        const pa = kpts[a], pb = kpts[b];
        if (!pa || !pb || pa[2] < 0.3 || pb[2] < 0.3) return;
        ctx.beginPath();
        ctx.moveTo(pa[0] * W, pa[1] * H);
        ctx.lineTo(pb[0] * W, pb[1] * H);
        ctx.stroke();
      });
      // Joints
      kpts.forEach(([kx, ky, vis]) => {
        if (vis < 0.3) return;
        ctx.beginPath();
        ctx.arc(kx * W, ky * H, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(167,139,250,0.9)";
        ctx.fill();
      });
    }
  }, [anomalyType]);

  useEffect(() => {
    if (!isOn) {
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      trailRef.current = [];
      return;
    }
    const col = COLORS[ANOMALY_UI[anomalyType]?.color || "gray"];
    drawCanvas(bbox, keypoints, trailRef.current, col.box);
  }, [bbox, keypoints, anomalyType, isOn, drawCanvas]);

  // ── IP Camera preview polling (runs when ip_camera selected + monitoring ON) ──
  useEffect(() => {
    if (cameraSource !== "ip_camera" || !isOn) return;

    let active = true;
    setIpLoading(true);
    setIpError(null);
    setIpFrame(null);

    const fetchPreview = async () => {
      try {
        const { data } = await axios.get(`${ANOMALY_API}/camera-snapshot`, { timeout: 10000 });
        if (active) { setIpFrame(data.frame); setIpError(null); setIpLoading(false); }
      } catch (err) {
        if (active) {
          setIpError(err.response?.data?.detail || "IP camera unreachable");
          setIpLoading(false);
        }
      }
    };

    fetchPreview();
    const timer = setInterval(fetchPreview, SNAPSHOT_MS);
    return () => { active = false; clearInterval(timer); };
  }, [cameraSource, isOn]);

  // ── Polling ───────────────────────────────────────────────────────────────
  const pollTick = useCallback(async () => {
    if (inFlight.current || !isOnRef.current) return;

    inFlight.current = true;
    try {
      let data;
      if (sourceRef.current === "ip_camera") {
        // Backend fetches frame from camera — no webcamRef needed
        const resp = await axios.post(`${ANOMALY_API}/camera-process`, {
          person_id: personId,
          caregiver_id: null,
          session_id: null,
        });
        data = resp.data;
      } else {
        if (!webcamRef.current) { inFlight.current = false; return; }
        const frame = webcamRef.current.getScreenshot();
        if (!frame) { inFlight.current = false; return; }
        const resp = await axios.post(`${ANOMALY_API}/process`, {
          live_frame: frame,
          person_id: personId,
          caregiver_id: null,
          session_id: null,
        });
        data = resp.data;
      }

      setAnomalyType(data.anomaly_type || "no_person");
      setConfidence(data.confidence || 0);
      setSeverity(data.severity || "none");
      setPoseValid(data.pose_valid || false);
      setBbox(data.bbox || null);
      setKeypoints(data.keypoints || null);
      setEvidence(data.evidence || {});
      setLastPoll(new Date());
      setError("");

      if (data.bbox) {
        const cx = data.bbox.x + data.bbox.w / 2;
        const cy = data.bbox.y + data.bbox.h / 2;
        trailRef.current = [...trailRef.current.slice(-(TRAIL_LEN - 1)), { x: cx, y: cy }];
      }

      if (data.anomaly_type && data.anomaly_type !== "normal_activity" && data.anomaly_type !== "no_person") {
        setAlertLog(prev => [{
          type: data.anomaly_type,
          conf: data.confidence,
          sev: data.severity,
          time: new Date().toLocaleTimeString(),
        }, ...prev].slice(0, 5));
      }

    } catch (err) {
      setError(err.response?.data?.detail || err.message || "API unreachable");
    } finally {
      inFlight.current = false;
    }
  }, [personId]);

  useEffect(() => {
    if (isOn) {
      pollTick();
      pollRef.current = setInterval(pollTick, POLL_MS);
    } else {
      clearInterval(pollRef.current);
      setAnomalyType("no_person");
      setBbox(null);
      setKeypoints(null);
      setConfidence(0);
      setPoseValid(false);
    }
    return () => clearInterval(pollRef.current);
  }, [isOn, pollTick]);

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

  const ui = ANOMALY_UI[anomalyType] || ANOMALY_UI.no_person;
  const colors = COLORS[ui.color];
  const isCrit = anomalyType === "fall_detected";
  const isFall = anomalyType === "fall_detected";

  return (
    <div className="min-h-screen bg-gray-950 text-white p-5">

      {/* ── Critical FALL Banner ──────────────────────────────────────────── */}
      {isFall && (
        <div className="mb-4 flex items-center gap-4 bg-red-600/25 border-2 border-red-500 text-red-200 px-6 py-4 rounded-2xl animate-pulse shadow-2xl shadow-red-900/40">
          <span className="text-4xl">🚨</span>
          <div>
            <p className="font-black text-2xl text-red-300 tracking-wide">FALL DETECTED</p>
            <p className="text-sm text-red-400 mt-0.5">
              Patient fall event confirmed — confidence {(confidence * 100).toFixed(0)}% · Severity: {severity?.toUpperCase()}
            </p>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Anomaly Detection</h1>
          <p className="text-gray-400 text-sm mt-1">MediaPipe Pose · Rule Engine · LSTM · Autoencoder</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {!isOn && (
            <input
              type="text"
              placeholder="Person ID (e.g. patient_001)"
              value={personId}
              onChange={e => setPersonId(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white font-mono w-52 focus:outline-none focus:border-indigo-500"
            />
          )}
          <span className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-full border ${isOn ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400" : "bg-gray-800 border-gray-700 text-gray-500"
            }`}>
            <span className={`w-2 h-2 rounded-full ${isOn ? "bg-emerald-500 animate-pulse" : "bg-gray-600"}`} />
            {isOn ? "MONITORING" : "OFFLINE"}
          </span>
          <button
            id="toggle-monitoring-btn"
            onClick={() => setIsOn(v => !v)}
            className={`px-5 py-2 font-bold rounded-xl transition-all ${isOn ? "bg-red-600 hover:bg-red-500 text-white" : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
          >
            {isOn ? "Stop Monitoring" : "Start Monitoring"}
          </button>
        </div>
      </div>

      {/* ── Camera Source Toggle ─────────────────────────────────────────── */}
      {!isOn && (
        <div className="flex items-center gap-2 mb-5 p-1 bg-gray-900 rounded-xl border border-gray-700 max-w-xs">
          {[
            { id: "webcam", label: "🖥️ Webcam" },
            { id: "ip_camera", label: "📡 IP Camera" },
          ].map(({ id, label }) => (
            <button
              key={id}
              id={`source-toggle-${id}`}
              onClick={() => setCameraSource(id)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all ${cameraSource === id
                ? "bg-indigo-600 text-white shadow"
                : "text-gray-400 hover:text-white"
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {isOn && (
        <div className="mb-4 flex items-center gap-2 text-xs text-gray-500 font-mono">
          <span className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1">
            Source: {cameraSource === "ip_camera" ? "📡 IP Camera (169.254.110.15)" : "🖥️ Webcam"}
          </span>
        </div>
      )}

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-5 text-sm">
        {[["/ (Dashboard)", "/"], ["History", "/history"], ["Model Status", "/model-status"]].map(([label, href]) => (
          <a key={href} href={href}
            className="px-4 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 transition-colors">
            {label}
          </a>
        ))}
      </div>

      {/* ── Main Grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* ── Video + Canvas ────────────────────────────────────────────── */}
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
          <div className="bg-gray-800/80 px-5 py-3 flex items-center justify-between border-b border-gray-700">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <span className={`w-2.5 h-2.5 rounded-full ${isOn ? "bg-red-500 animate-pulse" : "bg-gray-600"}`} />
              {isOn ? "AI Monitoring Active" : "Camera Offline"}
            </div>
            {lastPoll && (
              <span className="text-xs text-gray-500 font-mono">Last: {lastPoll.toLocaleTimeString()}</span>
            )}
          </div>

          <div ref={wrapperRef} className="relative flex-1 bg-gray-950 min-h-[380px]">
            {isOn ? (
              <>
                {/* ── Webcam source ── */}
                {cameraSource === "webcam" && (
                  <>
                    <Webcam
                      ref={webcamRef}
                      audio={false}
                      screenshotFormat="image/jpeg"
                      videoConstraints={{ width: 1280, height: 720, facingMode: "user" }}
                      className="w-full h-full object-cover"
                      style={{ transform: "scaleX(-1)" }}
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full"
                      style={{ pointerEvents: "none", transform: "scaleX(-1)" }}
                    />
                  </>
                )}

                {/* ── IP Camera source ── */}
                {cameraSource === "ip_camera" && (
                  <>
                    {ipLoading && (
                      <div className="flex flex-col items-center justify-center gap-4 text-gray-500 py-20">
                        <div className="w-12 h-12 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
                        <p className="font-mono text-sm">Connecting to 169.254.110.15…</p>
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
                      <img
                        src={ipFrame}
                        alt="IP camera feed"
                        className="w-full h-full object-cover"
                      />
                    )}
                    {/* Canvas overlay for skeleton/bbox — always rendered on top */}
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full"
                      style={{ pointerEvents: "none" }}
                    />
                    {/* Camera IP badge */}
                    {ipFrame && (
                      <div className="absolute bottom-2 right-2 bg-black/60 text-gray-300 text-xs font-mono px-2 py-0.5 rounded">
                        169.254.110.15
                      </div>
                    )}
                  </>
                )}

                {/* ── Shared overlays (REC badge + pose badge) ── */}
                <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 bg-red-600/90 text-white text-xs font-black px-3 py-1 rounded-full animate-pulse tracking-widest">
                  <span className="w-2 h-2 bg-white rounded-full" />REC
                </div>
                <div className="absolute top-4 right-4 z-10 flex flex-col gap-1.5 items-end">
                  <span className={`backdrop-blur-sm text-xs font-mono px-3 py-1 rounded-full border ${poseValid ? "bg-emerald-700/80 text-emerald-200 border-emerald-500/40" : "bg-gray-700/80 text-gray-400 border-gray-600"
                    }`}>
                    {poseValid ? "SKELETON ✓" : "POSE SEARCHING…"}
                  </span>
                  {confidence > 0 && (
                    <span className={`backdrop-blur-sm text-xs font-mono px-3 py-1 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
                      {ui.icon} {(confidence * 100).toFixed(0)}%
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
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-2 border-emerald-500" />{anomalyType.replace(/_/g, " ")}</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded bg-indigo-500/60" />Movement trail</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-500/80" />Body joints</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-violet-500/50" />Skeleton bones</span>
            </div>
          )}
        </div>

        {/* ── Right Panel ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Anomaly status */}
          <div className={`border-2 rounded-2xl p-5 transition-all duration-500 ${colors.border} ${colors.bg} ${ui.pulse && isOn ? "animate-pulse" : ""}`}>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-2 font-semibold">Detection Status</p>
            <p className={`text-xl font-black ${colors.text} flex items-center gap-2`}>
              <span>{ui.icon}</span> {ui.label}
            </p>
            {severity !== "none" && (
              <span className={`mt-2 inline-block text-xs font-bold uppercase px-2 py-0.5 rounded ${severity === "critical" ? "bg-red-600/30 text-red-300" :
                severity === "high" ? "bg-orange-600/30 text-orange-300" :
                  "bg-yellow-600/30 text-yellow-300"
                }`}>
                {severity} severity
              </span>
            )}
          </div>

          {/* Confidence bar */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-2 font-semibold">Confidence</p>
            <p className="text-3xl font-mono text-white mb-3">{(confidence * 100).toFixed(0)}<span className="text-lg text-gray-500">%</span></p>
            <div className="w-full bg-gray-800 h-3 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${confidence > 0.8 ? "bg-red-500" : confidence > 0.6 ? "bg-yellow-500" : "bg-emerald-500"
                  }`}
                style={{ width: `${(confidence * 100).toFixed(0)}%` }}
              />
            </div>
          </div>

          {/* Evidence */}
          {Object.keys(evidence).length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">Evidence</p>
              <div className="space-y-1.5 font-mono text-xs">
                {Object.entries(evidence).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-500">{k.replace(/_/g, " ")}</span>
                    <span className="text-indigo-300">{typeof v === "number" ? v.toFixed(3) : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent alerts */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">Recent Alerts</p>
            {alertLog.length === 0 ? (
              <p className="text-gray-600 text-sm">No alerts yet this session</p>
            ) : (
              <div className="space-y-2">
                {alertLog.map((a, i) => (
                  <div key={i} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border ${a.sev === "critical" ? "bg-red-900/30 border-red-600/40 text-red-300" :
                    a.sev === "high" ? "bg-orange-900/30 border-orange-600/40 text-orange-300" :
                      "bg-yellow-900/30 border-yellow-600/40 text-yellow-300"
                    }`}>
                    <span className="font-bold">{a.type.replace(/_/g, " ")}</span>
                    <span className="opacity-70">{a.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-900/30 border border-red-500/50 text-red-300 text-xs p-4 rounded-2xl">
              <p className="font-bold mb-1">API Error</p>
              <p className="break-words">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
