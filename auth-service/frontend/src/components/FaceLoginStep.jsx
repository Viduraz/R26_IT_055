/**
 * auth-service/frontend/src/components/FaceLoginStep.jsx
 *
 * Biometric login step for Caregivers.
 * Supports two capture sources:
 *   - 🖥️  Webcam  — react-webcam (live MediaStream, instant)
 *   - 📡  IP Camera — polls auth backend /camera-snapshot every 500 ms
 *
 * In both cases the captured JPEG base64 is passed to onVerify().
 */
import React, { useRef, useState, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import { Camera, MonitorSmartphone, Video } from "lucide-react";
import { getCameraSnapshot } from "../services/authApi";

const VIDEO_CONSTRAINTS = { width: 400, height: 400, facingMode: "user" };
const IP_POLL_MS = 500; // fast polling — backend serves from buffer

const FaceLoginStep = ({ onVerify, onCancel, loading }) => {
  const webcamRef = useRef(null);

  // "webcam" | "ip_camera"
  const [source, setSource] = useState("webcam");

  // IP camera state
  const [ipFrame, setIpFrame]       = useState(null);
  const [ipError, setIpError]       = useState(null);
  const [ipLoading, setIpLoading]   = useState(false);
  const ipActiveRef                 = useRef(false);

  // ── IP camera polling ───────────────────────────────────────────────────────
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
      if (ipActiveRef.current) {
        setTimeout(poll, IP_POLL_MS);
      }
    };

    poll();
    return () => { ipActiveRef.current = false; };
  }, [source]);

  // ── Capture handlers ────────────────────────────────────────────────────────
  const handleWebcamCapture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) onVerify(imageSrc);
  }, [onVerify]);

  const handleIpCapture = useCallback(() => {
    if (ipFrame) onVerify(ipFrame);
  }, [ipFrame, onVerify]);

  const canCapture = source === "webcam" || (source === "ip_camera" && !!ipFrame && !ipLoading);

  return (
    <div className="flex flex-col items-center justify-center space-y-5 animate-fade-in">

      {/* ── Header ── */}
      <div className="text-center space-y-1">
        <h3 className="text-xl font-bold text-white">Live Face Verification</h3>
        <p className="text-sm text-gray-400 max-w-sm">
          Caregiver accounts require biometric verification. Position your face in the frame and scan.
        </p>
      </div>

      {/* ── Source toggle ── */}
      <div className="flex gap-1 p-1 bg-gray-800 rounded-xl border border-gray-700 w-full max-w-xs">
        {[
          { id: "webcam",    label: "Webcam",    Icon: MonitorSmartphone },
          { id: "ip_camera", label: "IP Camera", Icon: Video },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSource(id)}
            disabled={loading}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
              source === id
                ? "bg-indigo-600 text-white shadow"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Camera viewport ── */}
      <div className="relative overflow-hidden rounded-full w-64 h-64 border-4 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.3)] bg-gray-900">

        {/* Webcam */}
        {source === "webcam" && (
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            videoConstraints={VIDEO_CONSTRAINTS}
            className="w-full h-full object-cover"
          />
        )}

        {/* IP Camera */}
        {source === "ip_camera" && (
          <>
            {ipLoading && !ipFrame && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500 text-xs">
                <div className="w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
                <span>Connecting…</span>
              </div>
            )}
            {ipError && !ipFrame && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-red-400 text-xs text-center px-4">
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
            {/* Live badge */}
            {ipFrame && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 text-indigo-300 text-[10px] font-mono px-2 py-0.5 rounded-full">
                LIVE · 169.254.110.15
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Action buttons ── */}
      <div className="flex w-full gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg transition-colors border border-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={source === "webcam" ? handleWebcamCapture : handleIpCapture}
          disabled={loading || !canCapture}
          className="flex-2 flex-grow flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          <Camera className="w-5 h-5" />
          {loading ? "Verifying…" : "Scan & Login"}
        </button>
      </div>
    </div>
  );
};

export default FaceLoginStep;
