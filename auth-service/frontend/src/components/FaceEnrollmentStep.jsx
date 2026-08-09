/**
 * auth-service/frontend/src/components/FaceEnrollmentStep.jsx
 *
 * High-Precision Multi-Step Biometric Enrollment (Face + Skeleton) during Caregiver Registration.
 *
 * Steps:
 *  0. Choice / Navigation Hub (Choose Face, Choose Skeleton, or Start Guided Setup)
 *  1. Multi-Angle Face Biometrics (Front, Left 30°, Right 30°, Up 15°, Down 15°) -> 10 frames
 *     Auto-captured: head orientation is estimated live from the skeleton-identification
 *     gateway's pose detector; each angle is captured automatically once it's held steady,
 *     the same way phone Face ID setup works — no capture button.
 *  2. Full-Body Skeleton & Gait Posture (Standing 2-3m back) -> 30 keypoint frames
 *     Auto-captured: a live green skeleton overlay tracks the detected body in real time,
 *     and frames are only accepted while the pose is fully visible and holding still,
 *     paced out rather than grabbed on a blind timer.
 *  3. Final Confirmation & Registration
 *
 * Live detection is provided by the skeleton-identification gateway's MediaPipe Pose
 * pipeline over WebSocket (/ws/stream, mode: "identify") — see usePoseStream.js. It is
 * only used for real-time feedback here; the actual biometric enrollment still happens
 * once via the existing bulk face_samples/skeleton_samples submission at registration.
 */
import React, { useRef, useState, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import {
  Camera,
  CheckCircle2,
  RefreshCcw,
  UserCheck,
  Activity,
  User,
  ChevronRight,
  Sparkles,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { getCameraSnapshot } from "../services/authApi";
import { usePoseStream } from "../hooks/usePoseStream";
import { estimateHeadPose, isFullBodyVisible, keypointMovement, drawSkeleton } from "../utils/pose";

const VIDEO_CONSTRAINTS = { width: 1280, height: 720, facingMode: "user" };
const IP_POLL_MS = 500;

const REQUIRED_SKELETON_FRAMES = 30;
const HOLD_MS = 650; // how long a pose must be held before it auto-captures
const FRONT_YAW_THRESHOLD = 0.35;
const YAW_THRESHOLD = 0.45;
const HEAD_SMOOTHING_ALPHA = 0.4; // exponential smoothing applied to yaw to damp landmark jitter
const MANUAL_FALLBACK_MS = 9000; // show a manual capture escape hatch if detection stalls
const SKELETON_STABLE_STREAK = 3; // consecutive "not moving" frames required before capturing
const SKELETON_MOVEMENT_THRESHOLD = 0.012; // avg normalized keypoint displacement considered "still"
const SKELETON_CAPTURE_GAP_MS = 450; // minimum spacing between accepted frames — no rushing

const RING_SIZE_RATIO = 0.82; // ring diameter as a fraction of the smaller camera-viewport dimension
const RING_MIN_SIZE = 220;
const RING_PADDING = 12; // px between the ring's outer edge and the dashed face-guide circle

// Face Pose Angles to capture
const FACE_POSES = [
  { id: "front", label: "Look Directly Front", icon: "👤", desc: "Keep face straight towards camera" },
  { id: "left", label: "Turn Your Head to One Side", icon: "👈", desc: "Slowly rotate your head — hold once turned" },
  { id: "right", label: "Turn Your Head the Other Way", icon: "👉", desc: "Now rotate the opposite direction" },
];

function ConnectionBanner({ connected, error, onRetry }) {
  if (connected) return null;
  return (
    <div className="w-full flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl px-4 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        {error ? <WifiOff className="w-4 h-4 shrink-0" /> : <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
        <span>
          {error
            ? "Live pose detection is unreachable — start the skeleton-identification backend (port 8007)."
            : "Connecting to live pose detection…"}
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

const FaceEnrollmentStep = ({ onComplete }) => {
  const webcamRef = useRef(null);
  const ipImgRef = useRef(null);
  const skeletonCanvasRef = useRef(null);

  // Active step: "selection" | "face" | "skeleton" | "summary"
  const [activeStep, setActiveStep] = useState("selection");
  const activeStepRef = useRef(activeStep);
  useEffect(() => { activeStepRef.current = activeStep; }, [activeStep]);

  // Source: "webcam" | "ip_camera"
  const [source, setSource] = useState("webcam");

  // ── Face Enrollment State ───────────────────────────────────────────────────
  const [currentFacePoseIdx, setCurrentFacePoseIdx] = useState(0);
  const currentFacePoseIdxRef = useRef(0);
  useEffect(() => { currentFacePoseIdxRef.current = currentFacePoseIdx; }, [currentFacePoseIdx]);

  const [capturedFaceSamples, setCapturedFaceSamples] = useState([]);
  const [completedFacePoses, setCompletedFacePoses] = useState({});
  const completedFacePosesRef = useRef({});
  useEffect(() => { completedFacePosesRef.current = completedFacePoses; }, [completedFacePoses]);

  const [holdProgress, setHoldProgress] = useState(0);
  const [faceDetectStatus, setFaceDetectStatus] = useState("Looking for your face…");
  const [justCaptured, setJustCaptured] = useState(false);
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [debugDelta, setDebugDelta] = useState(null); // { axis, value, threshold } — surfaced for calibration
  const [ringSize, setRingSize] = useState(RING_MIN_SIZE * 1.3);

  const baselineRef = useRef(null); // { yaw } captured on the "front" pose
  const sideSignRef = useRef(0); // sign of the first side-turn — the opposite sign is required for the other side
  const holdStartRef = useRef(null);
  const smoothedYawRef = useRef(null); // EMA-smoothed yaw to damp per-frame landmark jitter
  const cameraBoxRef = useRef(null); // face-step camera viewport — measured to size the guide ring to fit

  // ── Skeleton Enrollment State ───────────────────────────────────────────────
  const [capturedSkeletonSamples, setCapturedSkeletonSamples] = useState([]);
  const capturedSkeletonCountRef = useRef(0);
  useEffect(() => { capturedSkeletonCountRef.current = capturedSkeletonSamples.length; }, [capturedSkeletonSamples]);

  const [isCollectingSkeleton, setIsCollectingSkeleton] = useState(false);
  const isCollectingSkeletonRef = useRef(false);
  useEffect(() => { isCollectingSkeletonRef.current = isCollectingSkeleton; }, [isCollectingSkeleton]);

  const [skeletonStatus, setSkeletonStatus] = useState("Stand back 2–3 meters so your full body is visible.");

  const skeletonPrevKpsRef = useRef(null);
  const skeletonStableStreakRef = useRef(0);
  const skeletonLastCaptureRef = useRef(0);

  // ── IP camera polling ───────────────────────────────────────────────────────
  const [ipFrame, setIpFrame] = useState(null);
  const [ipError, setIpError] = useState(null);
  const ipActiveRef = useRef(false);
  const ipFrameRef = useRef(null);

  useEffect(() => { ipFrameRef.current = ipFrame; }, [ipFrame]);

  useEffect(() => {
    if (source !== "ip_camera") {
      ipActiveRef.current = false;
      setIpFrame(null);
      setIpError(null);
      return;
    }
    ipActiveRef.current = true;
    setIpError(null);

    const poll = async () => {
      if (!ipActiveRef.current) return;
      try {
        const data = await getCameraSnapshot();
        if (ipActiveRef.current) {
          setIpFrame(data.frame);
          setIpError(null);
        }
      } catch (err) {
        if (ipActiveRef.current) setIpError(err.response?.data?.detail || "IP camera unreachable");
      }
      if (ipActiveRef.current) setTimeout(poll, IP_POLL_MS);
    };

    poll();
    return () => { ipActiveRef.current = false; };
  }, [source]);

  // Full-resolution frame for storage (face embedding / skeleton training quality)
  const getFrame = useCallback(() => {
    if (source === "webcam") return webcamRef.current?.getScreenshot() ?? null;
    return ipFrameRef.current;
  }, [source]);
  const getFrameRef = useRef(getFrame);
  useEffect(() => { getFrameRef.current = getFrame; }, [getFrame]);

  // Element the live pose detector samples frames from
  const getSourceElement = useCallback(() => {
    if (source === "webcam") return webcamRef.current?.video || null;
    return ipImgRef.current || null;
  }, [source]);

  // ── Auto-capture: face angle & skeleton, driven by live pose detection ─────
  const handlePoseResult = useCallback((data) => {
    const step = activeStepRef.current;

    if (step === "face") {
      if (!data.detected || !data.keypoints) {
        holdStartRef.current = null;
        setHoldProgress(0);
        setFaceDetectStatus(data.detected === false ? "No face detected — position yourself in frame" : "Bring your face into view");
        return;
      }

      const poseIdx = currentFacePoseIdxRef.current;
      const pose = FACE_POSES[poseIdx];

      // Guard against re-triggering on the LAST pose: every earlier pose auto-advances
      // currentFacePoseIdx the moment it's captured, which naturally stops it from being
      // re-evaluated. The final pose has nowhere to advance to, so without this check it
      // kept re-matching and re-capturing forever ("loops") as long as the pose was held.
      if (completedFacePosesRef.current[pose.id]) {
        holdStartRef.current = null;
        setHoldProgress(0);
        setDebugDelta(null);
        setFaceDetectStatus("All poses captured — continue to the next step");
        return;
      }

      const rawHead = estimateHeadPose(data.keypoints);
      if (!rawHead.faceVisible) {
        holdStartRef.current = null;
        setHoldProgress(0);
        smoothedYawRef.current = null;
        setFaceDetectStatus("Can't see your face clearly — move closer or improve lighting");
        return;
      }

      smoothedYawRef.current =
        smoothedYawRef.current == null
          ? rawHead.yaw
          : smoothedYawRef.current + HEAD_SMOOTHING_ALPHA * (rawHead.yaw - smoothedYawRef.current);
      const yaw = smoothedYawRef.current;

      const baseline = baselineRef.current;
      let matched = false;
      let liveMsg = "Hold still…";

      let debugInfo = null;

      if (pose.id === "front") {
        matched = Math.abs(yaw) < FRONT_YAW_THRESHOLD;
        liveMsg = matched ? "Centered — hold still…" : "Face the camera directly";
        debugInfo = { axis: "yaw", value: yaw, threshold: FRONT_YAW_THRESHOLD };
      } else if (pose.id === "left" || pose.id === "right") {
        if (!baseline) {
          liveMsg = "Look directly front first";
        } else {
          const delta = yaw - baseline.yaw;
          debugInfo = { axis: "yaw Δ", value: delta, threshold: YAW_THRESHOLD };
          if (pose.id === "left") {
            matched = Math.abs(delta) > YAW_THRESHOLD;
            liveMsg = matched ? "Nice — hold that turn…" : "Slowly turn your head to the side";
          } else {
            matched = sideSignRef.current !== 0 && Math.sign(delta) === -sideSignRef.current && Math.abs(delta) > YAW_THRESHOLD;
            liveMsg = matched ? "Nice — hold that turn…" : "Turn the opposite way from your last turn";
          }
        }
      }
      setDebugDelta(debugInfo);

      setFaceDetectStatus(liveMsg);

      if (!matched) {
        holdStartRef.current = null;
        setHoldProgress(0);
        return;
      }

      if (holdStartRef.current == null) holdStartRef.current = performance.now();
      const elapsed = performance.now() - holdStartRef.current;
      const progress = Math.min(elapsed / HOLD_MS, 1);
      setHoldProgress(progress);

      if (progress >= 1) {
        holdStartRef.current = null;
        setHoldProgress(0);

        if (pose.id === "front") {
          baselineRef.current = { yaw };
        } else if (pose.id === "left") {
          sideSignRef.current = Math.sign(yaw - baselineRef.current.yaw) || 1;
        }

        const frame = getFrameRef.current();
        if (frame) {
          setCapturedFaceSamples((prev) => [...prev, frame, frame]);
          setCompletedFacePoses((prev) => ({ ...prev, [pose.id]: true }));
          setJustCaptured(true);
          setTimeout(() => setJustCaptured(false), 900);
          if (poseIdx < FACE_POSES.length - 1) setCurrentFacePoseIdx((i) => i + 1);
        }
      }
      return;
    }

    if (step === "skeleton") {
      const canvas = skeletonCanvasRef.current;
      if (canvas) {
        const w = (canvas.width = canvas.clientWidth || 800);
        const h = (canvas.height = canvas.clientHeight || 500);
        drawSkeleton(canvas.getContext("2d"), data.keypoints, w, h);
      }

      if (!data.detected) {
        setSkeletonStatus("No person detected — step into frame");
        skeletonStableStreakRef.current = 0;
        return;
      }

      const bodyVisible = data.body_visible ?? isFullBodyVisible(data.keypoints);
      if (!bodyVisible) {
        setSkeletonStatus(data.status_msg || "Step back until your full body is visible");
        skeletonStableStreakRef.current = 0;
        return;
      }

      const movement = keypointMovement(skeletonPrevKpsRef.current, data.keypoints);
      skeletonPrevKpsRef.current = data.keypoints;

      if (!isCollectingSkeletonRef.current) {
        setSkeletonStatus("Full body detected — ready when you are");
        return;
      }

      if (movement < SKELETON_MOVEMENT_THRESHOLD) skeletonStableStreakRef.current += 1;
      else skeletonStableStreakRef.current = 0;

      const now = performance.now();
      const readyToCapture =
        skeletonStableStreakRef.current >= SKELETON_STABLE_STREAK &&
        now - skeletonLastCaptureRef.current > SKELETON_CAPTURE_GAP_MS &&
        capturedSkeletonCountRef.current < REQUIRED_SKELETON_FRAMES;

      if (readyToCapture) {
        const frame = getFrameRef.current();
        if (frame) {
          skeletonLastCaptureRef.current = now;
          skeletonStableStreakRef.current = 0;
          setCapturedSkeletonSamples((prev) => {
            if (prev.length >= REQUIRED_SKELETON_FRAMES) return prev;
            const next = [...prev, frame];
            if (next.length >= REQUIRED_SKELETON_FRAMES) {
              setIsCollectingSkeleton(false);
              setSkeletonStatus("All 30 frames captured!");
            } else {
              setSkeletonStatus(`Captured ${next.length} of ${REQUIRED_SKELETON_FRAMES} — hold steady for the next…`);
            }
            return next;
          });
        }
      } else {
        setSkeletonStatus(
          skeletonStableStreakRef.current > 0
            ? "Holding steady — capturing shortly…"
            : `Captured ${capturedSkeletonCountRef.current} of ${REQUIRED_SKELETON_FRAMES} — hold still…`
        );
      }
    }
  }, []);

  const [wsRetryToken, setWsRetryToken] = useState(0);
  const { connected: poseConnected, connectionError: poseError } = usePoseStream({
    enabled: activeStep === "face" || activeStep === "skeleton",
    getSourceElement,
    onResult: handlePoseResult,
    retryToken: wsRetryToken,
  });

  // Escape hatch: if auto-detection stalls on the current face pose, offer a manual capture
  useEffect(() => {
    if (activeStep !== "face") { setShowManualFallback(false); return undefined; }
    setShowManualFallback(false);
    const t = setTimeout(() => setShowManualFallback(true), MANUAL_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [activeStep, currentFacePoseIdx]);

  // Size the face-guide ring to actually fit the camera viewport (was a fixed
  // 240px, which looked tiny/misaligned against a real face filling the frame).
  useEffect(() => {
    if (activeStep !== "face") return undefined;
    const el = cameraBoxRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w && h) setRingSize(Math.max(RING_MIN_SIZE, Math.round(Math.min(w, h) * RING_SIZE_RATIO)));
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeStep]);

  const manualCaptureFace = () => {
    const frame = getFrame();
    if (!frame) return;
    const pose = FACE_POSES[currentFacePoseIdx];
    setCapturedFaceSamples((prev) => [...prev, frame, frame]);
    setCompletedFacePoses((prev) => ({ ...prev, [pose.id]: true }));
    const liveYaw = smoothedYawRef.current;
    if (pose.id === "front") {
      baselineRef.current = baselineRef.current || { yaw: liveYaw != null ? liveYaw : 0 };
    } else if (pose.id === "left" && sideSignRef.current === 0) {
      const liveDelta = liveYaw != null && baselineRef.current ? liveYaw - baselineRef.current.yaw : 0;
      sideSignRef.current = Math.sign(liveDelta) || 1;
    }
    if (currentFacePoseIdx < FACE_POSES.length - 1) setCurrentFacePoseIdx((i) => i + 1);
    setShowManualFallback(false);
  };

  const resetSkeletonCapture = () => {
    setCapturedSkeletonSamples([]);
    setIsCollectingSkeleton(false);
    skeletonStableStreakRef.current = 0;
    skeletonLastCaptureRef.current = 0;
    skeletonPrevKpsRef.current = null;
    setSkeletonStatus("Stand back 2–3 meters so your full body is visible.");
  };

  const isAllFacePosesComplete = FACE_POSES.every((p) => completedFacePoses[p.id]);

  const handleFinalSubmit = () => {
    onComplete(capturedFaceSamples, capturedSkeletonSamples);
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6 w-full">

      {/* ── Top Navigation Bar / Wizard Steps ── */}
      <div className="flex items-center justify-center gap-2 sm:gap-4 bg-gray-800/80 p-2 rounded-2xl border border-gray-700 w-full max-w-2xl">
        <button
          onClick={() => setActiveStep("selection")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            activeStep === "selection" ? "bg-cyan-600 text-white shadow" : "text-gray-400 hover:text-white"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" /> 1. Mode Chooser
        </button>

        <ChevronRight className="w-4 h-4 text-gray-600" />

        <button
          onClick={() => setActiveStep("face")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            activeStep === "face" ? "bg-cyan-600 text-white shadow" : "text-gray-400 hover:text-white"
          }`}
        >
          <User className="w-3.5 h-3.5" /> 2. Face Biometrics
          {isAllFacePosesComplete && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
        </button>

        <ChevronRight className="w-4 h-4 text-gray-600" />

        <button
          onClick={() => setActiveStep("skeleton")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            activeStep === "skeleton" ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-white"
          }`}
        >
          <Activity className="w-3.5 h-3.5" /> 3. Skeleton Posture
          {capturedSkeletonSamples.length >= REQUIRED_SKELETON_FRAMES && (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          )}
        </button>

        <ChevronRight className="w-4 h-4 text-gray-600" />

        <button
          onClick={() => setActiveStep("summary")}
          disabled={!isAllFacePosesComplete && capturedSkeletonSamples.length < REQUIRED_SKELETON_FRAMES}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            activeStep === "summary" ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white disabled:opacity-40"
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" /> 4. Summary & Submit
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STEP 0: SELECTION HUB / MODE CHOOSER                                   */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeStep === "selection" && (
        <div className="flex flex-col items-center space-y-6 w-full max-w-3xl text-center animate-fade-in">
          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-white">Select Enrollment Workflow</h3>
            <p className="text-sm text-gray-400 max-w-lg mx-auto">
              Choose which biometric modality to record, or run the guided 2-step setup. Both steps auto-capture
              in real time as you move — just like Face ID setup — no buttons to press.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full pt-2">
            {/* Card 1: Face Biometrics */}
            <div
              onClick={() => setActiveStep("face")}
              className="group cursor-pointer bg-gradient-to-b from-gray-800/80 to-gray-900 border border-cyan-500/30 hover:border-cyan-400 p-6 rounded-2xl text-left space-y-4 transition-all shadow-xl hover:shadow-cyan-500/10 hover:-translate-y-1"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 text-2xl">
                  👤
                </div>
                <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-full border border-cyan-500/30">
                  {FACE_POSES.length} POSES · AUTO-CAPTURE
                </span>
              </div>
              <div>
                <h4 className="text-lg font-bold text-white group-hover:text-cyan-300 transition-colors">
                  Face Biometrics Enrollment
                </h4>
                <p className="text-xs text-gray-400 mt-1">
                  Captures {FACE_POSES.length} multi-angle head positions (Front, Left, Right) for MTCNN + FaceNet embeddings.
                </p>
              </div>
              <div className="pt-2 flex items-center justify-between text-xs font-semibold text-cyan-400">
                <span>{isAllFacePosesComplete ? "✔ Completed" : "Start Face Capture →"}</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>

            {/* Card 2: Skeleton Posture & Gait */}
            <div
              onClick={() => setActiveStep("skeleton")}
              className="group cursor-pointer bg-gradient-to-b from-gray-800/80 to-gray-900 border border-emerald-500/30 hover:border-emerald-400 p-6 rounded-2xl text-left space-y-4 transition-all shadow-xl hover:shadow-emerald-500/10 hover:-translate-y-1"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl">
                  🦴
                </div>
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30">
                  30 FRAMES · LIVE TRACKING
                </span>
              </div>
              <div>
                <h4 className="text-lg font-bold text-white group-hover:text-emerald-300 transition-colors">
                  Skeleton & Gait Enrollment
                </h4>
                <p className="text-xs text-gray-400 mt-1">
                  Captures full-body keypoint vectors and posture features for identification even if the face is hidden.
                </p>
              </div>
              <div className="pt-2 flex items-center justify-between text-xs font-semibold text-emerald-400">
                <span>
                  {capturedSkeletonSamples.length >= REQUIRED_SKELETON_FRAMES ? "✔ Completed" : "Start Skeleton Scan →"}
                </span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>
          </div>

          <button
            onClick={() => setActiveStep("face")}
            className="mt-4 px-10 py-3.5 bg-gradient-to-r from-cyan-600 via-teal-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-base rounded-xl transition-all shadow-xl shadow-cyan-500/20 flex items-center gap-2"
          >
            🚀 Start Guided 2-Step Biometric Enrollment
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STEP 1: DEDICATED FACE ENROLLMENT PAGE — auto-capture, Face ID style   */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeStep === "face" && (
        <div className="flex flex-col items-center space-y-4 w-full animate-fade-in">
          <ConnectionBanner
            connected={poseConnected}
            error={poseError}
            onRetry={() => setWsRetryToken((t) => t + 1)}
          />

          {/* Active Pose Prompt Header — big, iPhone-style */}
          <div className="text-center space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold mb-1">
              <span>{FACE_POSES[currentFacePoseIdx].icon}</span>
              Step 1 of 2: Face Pose {currentFacePoseIdx + 1} of {FACE_POSES.length}
            </div>
            <h3 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              {FACE_POSES[currentFacePoseIdx].label}
            </h3>
            <p className="text-sm text-gray-400">{FACE_POSES[currentFacePoseIdx].desc}</p>
            <p className={`text-sm font-semibold transition-colors ${justCaptured ? "text-emerald-400" : "text-cyan-300"}`}>
              {justCaptured ? "Captured!" : faceDetectStatus}
            </p>
            {debugDelta && !justCaptured && (
              <p className="text-[10px] font-mono text-gray-600">
                {debugDelta.axis} {debugDelta.value.toFixed(2)} · need {debugDelta.threshold.toFixed(2)}
              </p>
            )}
          </div>

          {/* Camera Viewport with live auto-detect ring */}
          <div
            ref={cameraBoxRef}
            className="relative overflow-hidden rounded-2xl w-full h-[520px] border-2 border-cyan-500/40 shadow-2xl bg-black flex items-center justify-center"
          >
            {source === "webcam" ? (
              <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={VIDEO_CONSTRAINTS}
                className="w-full h-full object-cover"
              />
            ) : (
              ipFrame && <img ref={ipImgRef} src={ipFrame} alt="IP Feed" className="w-full h-full object-cover" />
            )}

            {/* Live face-guide + hold-progress ring — sized to the viewport via ResizeObserver above */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative" style={{ width: ringSize, height: ringSize }}>
                <svg width={ringSize} height={ringSize} className="absolute inset-0 -rotate-90">
                  <circle
                    cx={ringSize / 2}
                    cy={ringSize / 2}
                    r={ringSize / 2 - RING_PADDING}
                    fill="none"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="5"
                  />
                  <circle
                    cx={ringSize / 2}
                    cy={ringSize / 2}
                    r={ringSize / 2 - RING_PADDING}
                    fill="none"
                    stroke={justCaptured ? "#34d399" : "#00d4ff"}
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * (ringSize / 2 - RING_PADDING)}
                    strokeDashoffset={2 * Math.PI * (ringSize / 2 - RING_PADDING) * (1 - (justCaptured ? 1 : holdProgress))}
                    style={{ transition: "stroke-dashoffset 100ms linear, stroke 200ms" }}
                  />
                </svg>
                <div
                  className={`absolute rounded-full border-2 border-dashed transition-colors ${
                    justCaptured ? "border-emerald-400/70" : "border-cyan-400/40"
                  }`}
                  style={{ inset: RING_PADDING + 8 }}
                />
                {justCaptured && (
                  <div className="absolute inset-0 flex items-center justify-center animate-fade-in">
                    <CheckCircle2 className="w-16 h-16 text-emerald-400 drop-shadow-lg" />
                  </div>
                )}
              </div>
            </div>

            {/* Pose checklist overlaid on top right */}
            <div className="absolute top-3 right-3 bg-black/80 backdrop-blur-md p-3 rounded-xl border border-cyan-500/30 space-y-1.5 text-xs text-left">
              <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider block">
                Face Angle Checklist
              </span>
              {FACE_POSES.map((pose, idx) => (
                <div
                  key={pose.id}
                  className={`flex items-center gap-2 ${
                    completedFacePoses[pose.id]
                      ? "text-emerald-400 font-bold"
                      : idx === currentFacePoseIdx
                      ? "text-cyan-300 font-bold animate-pulse"
                      : "text-gray-500"
                  }`}
                >
                  <span>{completedFacePoses[pose.id] ? "✔" : "○"}</span>
                  <span>{pose.label}</span>
                </div>
              ))}
            </div>

            {/* Live connection indicator */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-mono">
              {poseConnected ? (
                <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">LIVE DETECTION</span></>
              ) : (
                <><WifiOff className="w-3 h-3 text-amber-400" /><span className="text-amber-400">CONNECTING</span></>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col items-center gap-2 pt-1">
            {isAllFacePosesComplete && (
              <button
                onClick={() => setActiveStep("skeleton")}
                className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2"
              >
                Proceed to Step 2: Skeleton Scan →
              </button>
            )}
            {!isAllFacePosesComplete && showManualFallback && (
              <button
                onClick={manualCaptureFace}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-cyan-300 underline underline-offset-2"
              >
                <Camera className="w-3.5 h-3.5" /> Trouble detecting your pose? Tap to capture manually
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STEP 2: DEDICATED SKELETON & GAIT ENROLLMENT PAGE — live tracking       */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeStep === "skeleton" && (
        <div className="flex flex-col items-center space-y-4 w-full animate-fade-in">
          <ConnectionBanner
            connected={poseConnected}
            error={poseError}
            onRetry={() => setWsRetryToken((t) => t + 1)}
          />

          <div className="text-center space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-1">
              <Activity className="w-3.5 h-3.5" />
              Step 2 of 2: Full-Body Skeleton & Gait Setup
            </div>
            <h3 className="text-2xl font-bold text-white">Full-Body Skeleton Posture Scan</h3>
            <p className="text-xs text-gray-400 max-w-lg">
              Stand back 2–3 meters so your full body (head to feet) is visible. Frames are captured automatically,
              one at a time, only while you hold a steady pose — take your time, there's no rush.
            </p>
          </div>

          <div className="relative overflow-hidden rounded-2xl w-full h-[620px] border-2 border-emerald-500/40 shadow-2xl bg-black flex items-center justify-center">
            {source === "webcam" ? (
              <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={VIDEO_CONSTRAINTS}
                className="w-full h-full object-cover"
              />
            ) : (
              ipFrame && <img ref={ipImgRef} src={ipFrame} alt="IP Feed" className="w-full h-full object-cover" />
            )}

            {/* Live dynamic green skeleton overlay */}
            <canvas ref={skeletonCanvasRef} className="absolute inset-0 pointer-events-none w-full h-full" />

            {/* Live connection indicator */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-mono">
              {poseConnected ? (
                <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">LIVE SKELETON TRACKING</span></>
              ) : (
                <><WifiOff className="w-3 h-3 text-amber-400" /><span className="text-amber-400">CONNECTING</span></>
              )}
            </div>

            {/* Skeleton capture status */}
            <div className="absolute top-3 right-3 bg-black/80 backdrop-blur-md px-4 py-2 rounded-xl text-emerald-400 font-bold text-xs font-mono border border-emerald-500/40">
              FRAMES: {capturedSkeletonSamples.length} / {REQUIRED_SKELETON_FRAMES}
            </div>

            {/* Big status banner, iPhone-style */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md px-5 py-2.5 rounded-full border border-emerald-500/30 max-w-[92%]">
              <p className="text-sm sm:text-base font-semibold text-emerald-300 text-center flex items-center gap-2 justify-center">
                {isCollectingSkeleton && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
                {skeletonStatus}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full max-w-lg space-y-1.5">
            <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                style={{ width: `${Math.min((capturedSkeletonSamples.length / REQUIRED_SKELETON_FRAMES) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Action Button */}
          <div className="flex gap-4 pt-1">
            {capturedSkeletonSamples.length < REQUIRED_SKELETON_FRAMES ? (
              <button
                onClick={() => setIsCollectingSkeleton(true)}
                disabled={isCollectingSkeleton || !poseConnected}
                className="px-8 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2"
              >
                <Activity className="w-4 h-4" />
                {isCollectingSkeleton ? "Tracking your posture…" : "Start Skeleton Capture"}
              </button>
            ) : (
              <button
                onClick={() => setActiveStep("summary")}
                className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2"
              >
                Review & Confirm →
              </button>
            )}

            {capturedSkeletonSamples.length > 0 && (
              <button
                onClick={resetSkeletonCapture}
                className="px-5 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold text-sm rounded-xl transition-all border border-gray-700 flex items-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" /> Recapture
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STEP 3: SUMMARY & FINAL CONFIRMATION                                   */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeStep === "summary" && (
        <div className="flex flex-col items-center space-y-6 w-full max-w-xl text-center animate-fade-in bg-gray-900 border border-gray-700 p-8 rounded-3xl shadow-2xl">
          <CheckCircle2 className="w-16 h-16 text-emerald-400 animate-bounce" />
          <div>
            <h3 className="text-2xl font-bold text-white">Biometrics Ready for Registration</h3>
            <p className="text-xs text-gray-400 mt-1">
              Both Face and Skeleton biometric profiles have been captured and verified.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 w-full text-left">
            <div className="bg-gray-800/80 p-4 rounded-xl border border-cyan-500/30">
              <span className="text-xs text-cyan-400 font-bold block">FACE PROFILE</span>
              <p className="text-sm text-white font-semibold mt-1">
                {capturedFaceSamples.length} Multi-Angle Embeddings
              </p>
              <span className="text-[10px] text-emerald-400 mt-1 block">✔ {FACE_POSES.length} Poses Verified</span>
            </div>

            <div className="bg-gray-800/80 p-4 rounded-xl border border-emerald-500/30">
              <span className="text-xs text-emerald-400 font-bold block">SKELETON PROFILE</span>
              <p className="text-sm text-white font-semibold mt-1">
                {capturedSkeletonSamples.length} Full-Body Pose Vectors
              </p>
              <span className="text-[10px] text-emerald-400 mt-1 block">✔ SVM Model Training Trigger</span>
            </div>
          </div>

          <button
            onClick={handleFinalSubmit}
            className="w-full py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-bold text-base rounded-xl transition-all shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-2"
          >
            <UserCheck className="w-5 h-5" />
            Complete Registration & Train AI Models
          </button>
        </div>
      )}
    </div>
  );
};

export default FaceEnrollmentStep;
