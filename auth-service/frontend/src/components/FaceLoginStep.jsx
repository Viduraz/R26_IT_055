/**
 * auth-service/frontend/src/components/FaceLoginStep.jsx
 *
 * Biometric login step for Caregivers — two-phase live verification:
 *   1. Face   — auto-captured once the live pose detector confirms you're
 *               looking squarely at the camera and holding still.
 *   2. Skeleton/Gait — auto-captured once your full body is visible and
 *               holding still.
 *
 * Both samples are sent together to the backend (loginWithFace), which
 * already verifies face AND skeleton server-side when both are present —
 * this component just needed to actually capture and send the skeleton
 * sample, which it previously never did.
 *
 * Live detection reuses the same skeleton-identification gateway pipeline
 * (usePoseStream) built for signup enrollment: no client-side identity
 * matching happens here, it only grabs a clean, well-framed sample — the
 * server performs the actual match against the stored profile.
 *
 * Supports two capture sources:
 *   - 🖥️  Webcam  — react-webcam (live MediaStream, instant)
 *   - 📡  IP Camera — polls auth backend /camera-snapshot every 500 ms
 */
import React, { useRef, useState, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import {
  Camera,
  MonitorSmartphone,
  Video,
  User,
  Activity,
  CheckCircle2,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCcw,
} from "lucide-react";
import { getAuthBaseUrl } from "../services/authApi";
import { usePoseStream } from "../hooks/usePoseStream";
import { estimateHeadPose, isFullBodyVisible, keypointMovement, drawSkeleton } from "../utils/pose";

const VIDEO_CONSTRAINTS = { width: 1280, height: 720, facingMode: "user" };

const FRONT_YAW_THRESHOLD = 0.35;
const HEAD_SMOOTHING_ALPHA = 0.4;
const FACE_HOLD_MS = 250;
const SKELETON_STABLE_STREAK = 1; // 1 stable frame (which requires 2 consecutive frames to match)
const SKELETON_MOVEMENT_THRESHOLD = 0.045;
const MANUAL_FALLBACK_MS = 8000;

function ConnectionBanner({ connected, error, onRetry }) {
  if (connected) return null;
  return (
    <div className="w-full flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl px-4 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        {error ? <WifiOff className="w-4 h-4 shrink-0" /> : <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
        <span>
          {error
            ? "Live verification service is unreachable — start the skeleton-identification backend (port 8007)."
            : "Connecting to live verification…"}
        </span>
      </div>
      {error && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1 shrink-0 text-amber-200 hover:text-white font-semibold"
        >
          <RefreshCcw className="w-3.5 h-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

const FaceLoginStep = ({ onVerify, onCancel, loading }) => {
  const webcamRef = useRef(null);
  const ipImgRef = useRef(null);
  const skeletonCanvasRef = useRef(null);

  // "webcam" | "ip_camera"
  const [source, setSource] = useState("webcam");

  // "face" | "skeleton" | "done"
  const [phase, setPhase] = useState("face");
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const [holdProgress, setHoldProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("Position your face in the frame");
  const [justCaptured, setJustCaptured] = useState(false);
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [wsRetryToken, setWsRetryToken] = useState(0);

  const faceSampleRef = useRef(null);
  const holdStartRef = useRef(null);
  const smoothedYawRef = useRef(null);
  const stableStreakRef = useRef(0);
  const prevKpsRef = useRef(null);

  // ── IP camera streaming ───────────────────────────────────────────────────
  const [ipError, setIpError] = useState(null);
  const [ipLoading, setIpLoading] = useState(false);

  const streamUrl = `${getAuthBaseUrl()}/camera-stream`;

  useEffect(() => {
    if (source !== "ip_camera") {
      setIpError(null);
      return;
    }
    setIpLoading(true);
    setIpError(null);
  }, [source]);

  // Full-resolution frame for the actual verification sample
  const getFrame = useCallback(() => {
    if (source === "webcam") return webcamRef.current?.getScreenshot() ?? null;
    if (source === "ip_camera" && ipImgRef.current) {
      const img = ipImgRef.current;
      if (!img.naturalWidth) return null; // not loaded yet

      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth || 1280;
      cv.height = img.naturalHeight || 720;
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      return cv.toDataURL("image/jpeg", 0.85);
    }
    return null;
  }, [source]);
  const getFrameRef = useRef(getFrame);
  useEffect(() => { getFrameRef.current = getFrame; }, [getFrame]);

  // Element the live pose detector samples frames from
  const getSourceElement = useCallback(() => {
    if (source === "webcam") return webcamRef.current?.video || null;
    return ipImgRef.current || null;
  }, [source]);

  const finishAndSubmit = useCallback((skeletonSample) => {
    setPhase("done");
    onVerify(faceSampleRef.current, skeletonSample);
  }, [onVerify]);

  // ── Auto-capture: face, then skeleton, driven by live pose detection ───────
  const handlePoseResult = useCallback((data) => {
    const currentPhase = phaseRef.current;
    if (currentPhase === "done") return;

    if (currentPhase === "face") {
      if (!data.detected || !data.keypoints) {
        holdStartRef.current = null;
        setHoldProgress(0);
        setStatusMsg(data.detected === false ? "No face detected — position yourself in frame" : "Bring your face into view");
        return;
      }

      const rawHead = estimateHeadPose(data.keypoints);
      if (!rawHead.faceVisible) {
        holdStartRef.current = null;
        setHoldProgress(0);
        smoothedYawRef.current = null;
        setStatusMsg("Can't see your face clearly — move closer or improve lighting");
        return;
      }

      smoothedYawRef.current =
        smoothedYawRef.current == null
          ? rawHead.yaw
          : smoothedYawRef.current + HEAD_SMOOTHING_ALPHA * (rawHead.yaw - smoothedYawRef.current);

      const matched = Math.abs(smoothedYawRef.current) < FRONT_YAW_THRESHOLD;
      setStatusMsg(matched ? "Centered — hold still…" : "Face the camera directly");

      if (!matched) {
        holdStartRef.current = null;
        setHoldProgress(0);
        return;
      }

      if (holdStartRef.current == null) holdStartRef.current = performance.now();
      const progress = Math.min((performance.now() - holdStartRef.current) / FACE_HOLD_MS, 1);
      setHoldProgress(progress);

      if (progress >= 1) {
        const frame = getFrameRef.current();
        if (frame) {
          faceSampleRef.current = frame;
          holdStartRef.current = null;
          setHoldProgress(0);
          setJustCaptured(true);
          setTimeout(() => setJustCaptured(false), 700);
          stableStreakRef.current = 0;
          prevKpsRef.current = null;
          setPhase("skeleton");
          setStatusMsg("Now step back so your full body is visible");
        }
      }
      return;
    }

    if (currentPhase === "skeleton") {
      const canvas = skeletonCanvasRef.current;
      if (canvas) {
        const w = (canvas.width = canvas.clientWidth || 800);
        const h = (canvas.height = canvas.clientHeight || 500);
        drawSkeleton(canvas.getContext("2d"), data.keypoints, w, h);
      }

      if (!data.detected) {
        setStatusMsg("No person detected — step into frame");
        stableStreakRef.current = 0;
        setHoldProgress(0);
        return;
      }

      const bodyVisible = data.body_visible ?? isFullBodyVisible(data.keypoints);
      if (!bodyVisible) {
        setStatusMsg(data.status_msg || "Step back until your full body is visible");
        stableStreakRef.current = 0;
        setHoldProgress(0);
        return;
      }

      const movement = keypointMovement(prevKpsRef.current, data.keypoints);
      prevKpsRef.current = data.keypoints;

      if (movement < SKELETON_MOVEMENT_THRESHOLD) stableStreakRef.current += 1;
      else stableStreakRef.current = 0;

      setHoldProgress(Math.min(stableStreakRef.current / SKELETON_STABLE_STREAK, 1));

      if (stableStreakRef.current >= SKELETON_STABLE_STREAK) {
        const frame = getFrameRef.current();
        if (frame) {
          setJustCaptured(true);
          setStatusMsg("Captured — verifying…");
          finishAndSubmit(frame);
        }
      } else {
        setStatusMsg("Hold steady…");
      }
    }
  }, [finishAndSubmit]);

  const { connected: poseConnected, connectionError: poseError } = usePoseStream({
    enabled: phase !== "done" && !loading,
    getSourceElement,
    onResult: handlePoseResult,
    retryToken: wsRetryToken,
  });

  // Escape hatch: if auto-detection stalls, offer a manual capture
  useEffect(() => {
    if (phase === "done") { setShowManualFallback(false); return undefined; }
    setShowManualFallback(false);
    const t = setTimeout(() => setShowManualFallback(true), MANUAL_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const manualCapture = () => {
    const frame = getFrame();
    if (!frame) return;
    if (phase === "face") {
      faceSampleRef.current = frame;
      stableStreakRef.current = 0;
      prevKpsRef.current = null;
      setPhase("skeleton");
      setStatusMsg("Now step back so your full body is visible");
    } else if (phase === "skeleton") {
      finishAndSubmit(frame);
    }
    setShowManualFallback(false);
  };

  // If a verify attempt fails, `loading` flips true -> false while we're still mounted
  // (success navigates away instead) — reset so the user can immediately try again.
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      setPhase("face");
      faceSampleRef.current = null;
      holdStartRef.current = null;
      stableStreakRef.current = 0;
      prevKpsRef.current = null;
      smoothedYawRef.current = null;
      setHoldProgress(0);
      setJustCaptured(false);
      setStatusMsg("Position your face in the frame");
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  const isVerifying = loading || phase === "done";

  return (
    <div className="flex flex-col items-center justify-center space-y-4 w-full animate-fade-in">

      {/* ── Header ── */}
      <div className="text-center space-y-1">
        <h3 className="text-xl font-bold text-white">Live Biometric Verification</h3>
        <p className="text-sm text-gray-400 max-w-md">
          Caregiver accounts require face + skeleton verification. Both are captured automatically — no button to press.
        </p>
      </div>

      {/* ── Phase indicator ── */}
      <div className="flex items-center gap-2 bg-gray-800/80 px-3 py-1.5 rounded-xl border border-gray-700">
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${phase === "face" ? "text-indigo-300" : "text-emerald-400"}`}>
          {phase === "face" ? <User className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Face
        </span>
        <span className="text-gray-600">→</span>
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${phase === "skeleton" ? "text-indigo-300" : phase === "done" ? "text-emerald-400" : "text-gray-500"
          }`}>
          {phase === "done" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Activity className="w-3.5 h-3.5" />}
          Skeleton
        </span>
      </div>

      <ConnectionBanner connected={poseConnected} error={poseError} onRetry={() => setWsRetryToken((t) => t + 1)} />

      {/* ── Source toggle ── */}
      <div className="flex gap-1 p-1 bg-gray-800 rounded-xl border border-gray-700 w-full max-w-xs">
        {[
          { id: "webcam", label: "Webcam", Icon: MonitorSmartphone },
          { id: "ip_camera", label: "IP Camera", Icon: Video },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSource(id)}
            disabled={isVerifying}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${source === id
              ? "bg-indigo-600 text-white shadow"
              : "text-gray-400 hover:text-white"
              } disabled:opacity-50`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Camera viewport — large rectangle ── */}
      <div className="relative overflow-hidden rounded-2xl w-full h-[440px] border-2 border-indigo-500/50 shadow-[0_0_30px_rgba(99,102,241,0.15)] bg-black flex items-center justify-center">

        {source === "webcam" && (
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            videoConstraints={VIDEO_CONSTRAINTS}
            className="w-full h-full object-cover"
          />
        )}

        {source === "ip_camera" && (
          <>
            {ipLoading && !ipError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black z-10">
                <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                <span className="text-gray-400 font-semibold text-sm animate-pulse">Connecting to Live Stream…</span>
              </div>
            )}
            {ipError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black z-10 text-red-400 text-xs text-center px-4">
                <span className="text-3xl">📡</span>
                <span className="font-semibold text-base mb-1">Camera Unreachable</span>
                <span className="text-gray-500 max-w-sm">{ipError}</span>
              </div>
            )}
            <img
              ref={ipImgRef}
              src={streamUrl}
              alt="IP camera live feed"
              className="w-full h-full object-cover"
              crossOrigin="anonymous"
              onLoad={() => { setIpLoading(false); setIpError(null); }}
              onError={(e) => {
                // It might fail immediately if endpoint is down or return 503
                setIpError("The stream disconnected or the IP camera is not available.");
                setIpLoading(false);
              }}
            />
            {(!ipLoading && !ipError) && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/60 text-indigo-300 text-[10px] font-mono px-2 py-0.5 rounded-full z-10">
                LIVE MJPEG
              </div>
            )}
          </>
        )}

        {/* Face phase: rectangular guide frame, no oval/circle */}
        {phase === "face" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className={`w-64 h-72 sm:w-72 sm:h-80 rounded-xl border-4 border-dashed transition-colors ${justCaptured ? "border-emerald-400" : "border-indigo-400/60"
                }`}
            />
          </div>
        )}

        {/* Skeleton phase: live dynamic green skeleton overlay */}
        {phase === "skeleton" && (
          <canvas ref={skeletonCanvasRef} className="absolute inset-0 pointer-events-none w-full h-full" />
        )}

        {justCaptured && phase !== "done" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-fade-in">
            <CheckCircle2 className="w-16 h-16 text-emerald-400 drop-shadow-lg" />
          </div>
        )}

        {/* Live connection indicator */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-mono">
          {poseConnected ? (
            <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">LIVE</span></>
          ) : (
            <><WifiOff className="w-3 h-3 text-amber-400" /><span className="text-amber-400">CONNECTING</span></>
          )}
        </div>

        {/* Verifying overlay */}
        {isVerifying && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 backdrop-blur-sm">
            <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
            <p className="text-indigo-200 font-semibold text-sm">Verifying your identity…</p>
          </div>
        )}

        {/* Big status banner */}
        {!isVerifying && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md px-5 py-2.5 rounded-full border border-indigo-500/30 max-w-[92%]">
            <p className="text-sm sm:text-base font-semibold text-indigo-200 text-center">{statusMsg}</p>
          </div>
        )}
      </div>

      {/* Hold-progress bar */}
      {!isVerifying && (
        <div className="w-full max-w-lg">
          <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${phase === "face" ? "bg-gradient-to-r from-indigo-500 to-cyan-400" : "bg-gradient-to-r from-emerald-500 to-teal-400"}`}
              style={{ width: `${holdProgress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="flex flex-col items-center gap-2 w-full pt-1">
        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isVerifying}
            className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg transition-colors border border-gray-700"
          >
            Cancel
          </button>
        </div>
        {!isVerifying && showManualFallback && (
          <button
            onClick={manualCapture}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-300 underline underline-offset-2"
          >
            <Camera className="w-3.5 h-3.5" /> Trouble detecting? Tap to capture manually
          </button>
        )}
      </div>
    </div>
  );
};

export default FaceLoginStep;
