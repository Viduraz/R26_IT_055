/**
 * auth-service/frontend/src/components/FaceEnrollmentStep.jsx
 *
 * Face enrollment during Caregiver sign-up.
 * Captures 5 JPEG samples (auto-timed) for embedding extraction.
 *
 * Supports two capture sources:
 *   - 🖥️  Webcam  — react-webcam (native MediaStream)
 *   - 📡  IP Camera — polls auth backend /camera-snapshot every 500 ms
 *
 * In both cases an array of 5 base64 JPEG strings is passed to onComplete().
 */
import React, { useRef, useState, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import { Camera, CheckCircle, RefreshCcw, MonitorSmartphone, Video } from "lucide-react";
import { getCameraSnapshot } from "../services/authApi";

const VIDEO_CONSTRAINTS = { width: 400, height: 400, facingMode: "user" };
const REQUIRED_SAMPLES  = 5;
const CAPTURE_INTERVAL  = 800; // ms between auto-captures
const IP_POLL_MS        = 500; // live preview refresh rate

const FaceEnrollmentStep = ({ onComplete }) => {
  const webcamRef = useRef(null);

  // "webcam" | "ip_camera"
  const [source, setSource] = useState("webcam");

  const [samples,     setSamples]     = useState([]);
  const [isCapturing, setIsCapturing] = useState(false);

  // IP camera preview state
  const [ipFrame,   setIpFrame]   = useState(null);
  const [ipError,   setIpError]   = useState(null);
  const [ipLoading, setIpLoading] = useState(false);
  const ipActiveRef               = useRef(false);
  // Ref so capture interval can always access latest frame without stale closure
  const ipFrameRef                = useRef(null);

  // Keep ref in sync with state
  useEffect(() => { ipFrameRef.current = ipFrame; }, [ipFrame]);

  // ── IP camera live preview polling ──────────────────────────────────────────
  useEffect(() => {
    if (source !== "ip_camera") {
      ipActiveRef.current = false;
      setIpFrame(null);
      setIpError(null);
      return;
    }

    ipActiveRef.current = true;
    setIpLoading(true);
    setIpError(null);

    const poll = async () => {
      if (!ipActiveRef.current) return;
      try {
        const data = await getCameraSnapshot();
        if (ipActiveRef.current) {
          setIpFrame(data.frame);
          setIpError(null);
          setIpLoading(false);
        }
      } catch (err) {
        if (ipActiveRef.current) {
          setIpError(err.response?.data?.detail || "IP camera unreachable");
          setIpLoading(false);
        }
      }
      if (ipActiveRef.current) setTimeout(poll, IP_POLL_MS);
    };

    poll();
    return () => { ipActiveRef.current = false; };
  }, [source]);

  // ── Capture helpers ─────────────────────────────────────────────────────────
  const getFrame = useCallback(() => {
    if (source === "webcam") {
      return webcamRef.current?.getScreenshot() ?? null;
    }
    return ipFrameRef.current;
  }, [source]);

  const handleStartCapture = useCallback(() => {
    if (isCapturing) return;
    // Validate we have a source
    if (source === "ip_camera" && !ipFrameRef.current) return;

    setSamples([]);
    setIsCapturing(true);

    let count = 0;
    const interval = setInterval(() => {
      const frame = getFrame();
      if (!frame) return;

      count += 1;
      setSamples(prev => {
        const next = [...prev, frame];
        if (next.length >= REQUIRED_SAMPLES) {
          clearInterval(interval);
          setIsCapturing(false);
        }
        return next;
      });

      if (count >= REQUIRED_SAMPLES) {
        clearInterval(interval);
        setIsCapturing(false);
      }
    }, CAPTURE_INTERVAL);
  }, [isCapturing, source, getFrame]);

  const reset = () => {
    setSamples([]);
    setIsCapturing(false);
  };

  const done = samples.length >= REQUIRED_SAMPLES;
  const ipReady = source === "ip_camera" && !!ipFrame && !ipLoading;

  return (
    <div className="flex flex-col items-center justify-center space-y-4">

      {/* ── Header ── */}
      <h3 className="text-xl font-semibold text-white">Face Enrollment</h3>
      <p className="text-sm text-gray-400 text-center max-w-sm">
        Caregivers must enroll their face for secure login. Look into the camera and move your head slightly while scanning.
      </p>

      {/* ── Source toggle (only shown before capture completes) ── */}
      {!done && (
        <div className="flex gap-1 p-1 bg-gray-800 rounded-xl border border-gray-700 w-full max-w-xs">
          {[
            { id: "webcam",    label: "Webcam",    Icon: MonitorSmartphone },
            { id: "ip_camera", label: "IP Camera", Icon: Video },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { if (!isCapturing) setSource(id); }}
              disabled={isCapturing}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                source === id
                  ? "bg-indigo-600 text-white shadow"
                  : "text-gray-400 hover:text-white disabled:opacity-40"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Camera viewport ── */}
      {!done ? (
        <div className="relative overflow-hidden rounded-xl border-2 border-indigo-500 shadow-lg shadow-indigo-500/20 bg-gray-900">

          {/* Webcam */}
          {source === "webcam" && (
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={VIDEO_CONSTRAINTS}
              className="w-full max-w-[300px] h-auto object-cover"
            />
          )}

          {/* IP Camera */}
          {source === "ip_camera" && (
            <div className="w-[300px] h-[300px] flex items-center justify-center">
              {ipLoading && !ipFrame && (
                <div className="flex flex-col items-center gap-2 text-gray-500 text-xs">
                  <div className="w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
                  <span>Connecting…</span>
                </div>
              )}
              {ipError && !ipFrame && (
                <div className="flex flex-col items-center gap-2 text-red-400 text-xs text-center px-4">
                  <span className="text-3xl">📡</span>
                  <span className="font-semibold">Camera Unreachable</span>
                  <span className="text-red-500">{ipError}</span>
                </div>
              )}
              {ipFrame && (
                <img
                  src={ipFrame}
                  alt="IP camera live feed"
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          )}

          {/* Capture progress badge */}
          {isCapturing && (
            <div className="absolute top-2 right-2 bg-black/70 px-3 py-1 rounded-full text-indigo-400 font-bold text-sm animate-pulse">
              {samples.length} / {REQUIRED_SAMPLES}
            </div>
          )}

          {/* IP live badge */}
          {source === "ip_camera" && ipFrame && !isCapturing && (
            <div className="absolute bottom-2 left-2 bg-black/60 text-indigo-300 text-[10px] font-mono px-2 py-0.5 rounded">
              LIVE · 169.254.110.15
            </div>
          )}
        </div>
      ) : (
        /* ── Success state ── */
        <div className="flex flex-col items-center p-6 bg-green-500/10 border border-green-500/50 rounded-xl space-y-2">
          <CheckCircle className="w-12 h-12 text-green-400" />
          <h4 className="text-green-400 font-medium">Enrollment Successful</h4>
          <p className="text-sm text-gray-300">Captured {samples.length} reference images.</p>
        </div>
      )}

      {/* ── Action buttons ── */}
      {!done ? (
        <button
          type="button"
          onClick={handleStartCapture}
          disabled={isCapturing || (source === "ip_camera" && !ipReady)}
          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          <Camera className="w-5 h-5" />
          {isCapturing
            ? `Scanning… (${samples.length}/${REQUIRED_SAMPLES})`
            : source === "ip_camera" && !ipReady
            ? "Waiting for camera…"
            : "Start Head Scan"}
        </button>
      ) : (
        <div className="flex gap-4">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            <RefreshCcw className="w-4 h-4" />
            Retake
          </button>
          <button
            type="button"
            onClick={() => onComplete(samples)}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
          >
            Confirm & Complete Signup
          </button>
        </div>
      )}
    </div>
  );
};

export default FaceEnrollmentStep;
