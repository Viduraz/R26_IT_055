/**
 * gateway-dashboard/frontend/src/pages/LiveStream.jsx
 *
 * Caregiver Recognition + Live Tracking Flow:
 *   1. Camera opens via react-webcam
 *   2. Every 5s → frame posted to face-verification :8001/api/face/verify-caregiver
 *   3. On first successful recognition → tracking session created at :8002
 *   4. Every 5s (with active session) → frame+session_id posted to :8002/update-caregiver-visibility
 *   5. Status overlay + alert panel updated based on responses
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

// ─── Service base URLs ────────────────────────────────────────────────────────
const FACE_API   = 'http://localhost:8001/api/face';
const TRACK_API  = 'http://localhost:8002/api/tracking';

// ─── Polling interval ─────────────────────────────────────────────────────────
const POLL_MS = 5000;

// ─── Map backend status → UI config ──────────────────────────────────────────
function mapStatusToUI(status) {
  switch (status) {
    case 'verified_present':
      return { label: 'Caregiver Present', color: 'emerald', pulse: false };
    case 'warning':
      return { label: 'Caregiver Warning', color: 'yellow', pulse: true };
    case 'missing':
      return { label: 'Caregiver Missing', color: 'orange', pulse: true };
    case 'missing_critical':
      return { label: 'CRITICAL — Caregiver Absent!', color: 'red', pulse: true };
    default:
      return { label: 'Awaiting Data…', color: 'gray', pulse: false };
  }
}

// ─── Color token maps (Tailwind class strings) ────────────────────────────────
const colorMap = {
  emerald: {
    border: 'border-emerald-500',
    bg: 'bg-emerald-900/30',
    text: 'text-emerald-400',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
  yellow: {
    border: 'border-yellow-500',
    bg: 'bg-yellow-900/30',
    text: 'text-yellow-400',
    badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  },
  orange: {
    border: 'border-orange-500',
    bg: 'bg-orange-900/30',
    text: 'text-orange-400',
    badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  },
  red: {
    border: 'border-red-500',
    bg: 'bg-red-900/30',
    text: 'text-red-400',
    badge: 'bg-red-500/20 text-red-300 border-red-500/40',
  },
  gray: {
    border: 'border-gray-700',
    bg: 'bg-gray-800/50',
    text: 'text-gray-400',
    badge: 'bg-gray-700/50 text-gray-400 border-gray-600/40',
  },
};

export default function LiveStream() {
  // ── Core camera state ──────────────────────────────────────────────────────
  const [isCameraOn, setIsCameraOn]               = useState(false);
  const [cameraError, setCameraError]             = useState('');

  // ── Caregiver recognition state ───────────────────────────────────────────
  const [caregiver, setCaregiver]                 = useState(null);   // { name, ... }
  const [confidence, setConfidence]               = useState(null);
  const [lastRecognizedAt, setLastRecognizedAt]   = useState(null);

  // ── Tracking session state ────────────────────────────────────────────────
  const [trackingSessionId, setTrackingSessionId] = useState(null);
  const [caregiverStatus, setCaregiverStatus]     = useState('idle');
  const [absenceSecs, setAbsenceSecs]             = useState(0);

  // ── Request in-flight guards (state for UI driven display) ────────────────
  const [isRecognizing, setIsRecognizing]         = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);

  // ── Error feedback ────────────────────────────────────────────────────────
  const [error, setError]                         = useState('');

  // ── Refs ──────────────────────────────────────────────────────────────────
  const webcamRef             = useRef(null);
  const pollIntervalRef       = useRef(null);
  const isRecognizingRef      = useRef(false);   // guards concurrent recognize calls
  const isUpdatingRef         = useRef(false);   // guards concurrent visibility calls
  const sessionCreatingRef    = useRef(false);   // prevents duplicate session creation
  const sessionIdRef          = useRef(null);    // always in sync with state for closures
  const isCameraOnRef         = useRef(false);   // for closure-safe cleanup

  // keep refs in sync
  useEffect(() => { sessionIdRef.current = trackingSessionId; }, [trackingSessionId]);
  useEffect(() => { isCameraOnRef.current = isCameraOn; }, [isCameraOn]);

  // ── Helper: capture a base64 JPEG frame from the webcam ──────────────────
  const captureFrame = useCallback(() => {
    if (!webcamRef.current) return null;
    return webcamRef.current.getScreenshot();   // → "data:image/jpeg;base64,..."
  }, []);

  // ── Step 2: identify caregiver from frame ─────────────────────────────────
  const verifyCaregiver = useCallback(async () => {
    if (isRecognizingRef.current) return;   // skip if previous call still pending
    const frame = captureFrame();
    if (!frame) return;

    isRecognizingRef.current = true;
    setIsRecognizing(true);
    try {
      const { data } = await axios.post(`${FACE_API}/verify-caregiver`, {
        live_sample: frame,  // payload matches ScanCaregiverModal.jsx
      });

      if (data.verified) {
        setCaregiver(data.caregiver_details);
        setConfidence(data.confidence);
        setLastRecognizedAt(new Date());
        setError('');
        return data;  // bubble up for session creation logic
      } else {
        // Caregiver not matched this poll cycle — keep existing caregiver in state
      }
    } catch (err) {
      // Silent degradation — don't crash UX on network hiccup
      const msg = err.response?.data?.detail || err.message || 'Face API unreachable.';
      setError(`Recognition: ${msg}`);
    } finally {
      isRecognizingRef.current = false;
      setIsRecognizing(false);
    }
    return null;
  }, [captureFrame]);

  // ── Step 3: create a tracking session (called once per camera session) ────
  const startTrackingSession = useCallback(async (caregiverDetails) => {
    if (sessionCreatingRef.current || sessionIdRef.current) return; // already exists
    sessionCreatingRef.current = true;

    try {
      const { data } = await axios.post(`${TRACK_API}/start-caregiver-session`, {
        caregiver_name: caregiverDetails?.name || 'Unknown',
        caregiver_id:   caregiverDetails?.id   || null,
      });
      const sid = data.session_id;
      setTrackingSessionId(sid);
      setCaregiverStatus('verified_present');
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Tracking API unreachable.';
      setError(`Session: ${msg}`);
    } finally {
      sessionCreatingRef.current = false;
    }
  }, []);

  // ── Step 4: update caregiver visibility with session ─────────────────────
  const updateCaregiverVisibility = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isUpdatingRef.current) return;

    const frame = captureFrame();
    if (!frame) return;

    isUpdatingRef.current = true;
    setIsUpdatingVisibility(true);
    try {
      const { data } = await axios.post(`${TRACK_API}/update-caregiver-visibility`, {
        session_id: sid,
        live_frame: frame,
      });
      setCaregiverStatus(data.status || 'idle');
      setAbsenceSecs(data.absence_seconds || 0);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Tracking update failed.';
      setError(`Visibility: ${msg}`);
    } finally {
      isUpdatingRef.current = false;
      setIsUpdatingVisibility(false);
    }
  }, [captureFrame]);

  // ── Master poll tick — runs every POLL_MS while camera is on ─────────────
  const pollTick = useCallback(async () => {
    if (!isCameraOnRef.current) return;

    // Step 2 → verify caregiver
    const result = await verifyCaregiver();

    // Step 3 → create session on first recognition
    if (result?.verified && result?.caregiver_details && !sessionIdRef.current) {
      await startTrackingSession(result.caregiver_details);
    }

    // Step 4 → update visibility if session exists
    if (sessionIdRef.current) {
      await updateCaregiverVisibility();
    }
  }, [verifyCaregiver, startTrackingSession, updateCaregiverVisibility]);

  // ── Start camera ──────────────────────────────────────────────────────────
  const startCamera = () => {
    setCameraError('');
    setError('');
    setCaregiver(null);
    setConfidence(null);
    setTrackingSessionId(null);
    setCaregiverStatus('idle');
    setAbsenceSecs(0);
    sessionCreatingRef.current = false;
    setIsCameraOn(true);
  };

  // ── Stop camera ───────────────────────────────────────────────────────────
  const stopCamera = () => {
    setIsCameraOn(false);
    clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = null;
    setTrackingSessionId(null);
    sessionIdRef.current = null;
    setCaregiverStatus('idle');
  };

  // ── Start/stop polling when camera toggles ────────────────────────────────
  useEffect(() => {
    if (isCameraOn) {
      // First poll immediately, then on interval
      pollTick();
      pollIntervalRef.current = setInterval(pollTick, POLL_MS);
    } else {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    return () => clearInterval(pollIntervalRef.current);
  }, [isCameraOn, pollTick]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(pollIntervalRef.current);
    };
  }, []);

  // ── Derived UI state ──────────────────────────────────────────────────────
  const statusUI   = mapStatusToUI(caregiverStatus);
  const colors     = colorMap[statusUI.color];
  const isCritical = caregiverStatus === 'missing_critical';

  const webcamConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'user',
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 lg:p-8">

      {/* ── Critical Alert Banner ───────────────────────────────────────── */}
      {isCritical && (
        <div className="mb-6 animate-pulse flex items-center gap-4 bg-red-600/20 border border-red-500 text-red-300 px-6 py-4 rounded-2xl shadow-lg shadow-red-900/30">
          <span className="text-2xl">🚨</span>
          <div>
            <p className="font-black text-red-300 text-lg tracking-wide">CRITICAL ALERT</p>
            <p className="text-sm text-red-400">Caregiver has been absent for {absenceSecs.toFixed(0)}s. Immediate attention required.</p>
          </div>
        </div>
      )}

      {/* ── Page Header ────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">Live Stream</h1>
          <p className="text-gray-400 text-sm mt-1">AI-powered caregiver recognition &amp; presence monitoring</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Camera status indicator */}
          <span className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-full border ${
            isCameraOn
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
              : 'bg-gray-800 border-gray-700 text-gray-500'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isCameraOn ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`} />
            {isCameraOn ? 'LIVE' : 'OFFLINE'}
          </span>

          {/* Start / Stop button */}
          {isCameraOn ? (
            <button
              id="btn-stop-camera"
              onClick={stopCamera}
              className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-900/30"
            >
              Stop Camera
            </button>
          ) : (
            <button
              id="btn-start-camera"
              onClick={startCamera}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-900/30"
            >
              Start Camera
            </button>
          )}
        </div>
      </div>

      {/* ── Main Grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── Left: Video Feed ────────────────────────────────────────── */}
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">

          {/* Video header */}
          <div className="bg-gray-800/80 px-5 py-3 flex items-center justify-between border-b border-gray-700">
            <div className="flex items-center gap-2 text-sm text-gray-300 font-medium">
              <span className={`w-2.5 h-2.5 rounded-full ${isCameraOn ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`} />
              {isCameraOn ? 'Camera Active' : 'Camera Offline'}
            </div>
            <div className="flex items-center gap-2">
              {isRecognizing && (
                <span className="flex items-center gap-1.5 text-xs text-indigo-400 font-mono">
                  <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  Recognizing…
                </span>
              )}
              {isUpdatingVisibility && (
                <span className="flex items-center gap-1.5 text-xs text-cyan-400 font-mono">
                  <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  Tracking…
                </span>
              )}
              <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/30 font-mono">
                STREAM_NODE_01
              </span>
            </div>
          </div>

          {/* Video area */}
          <div className="relative flex-1 bg-gray-950 min-h-[360px] flex items-center justify-center">

            {/* Webcam */}
            {isCameraOn ? (
              <>
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  screenshotFormat="image/jpeg"
                  videoConstraints={webcamConstraints}
                  onUserMediaError={(err) => {
                    setCameraError(err.message || 'Camera permission denied.');
                    setIsCameraOn(false);
                  }}
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />

                {/* REC badge */}
                <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-red-600/90 text-white text-xs font-black px-3 py-1 rounded-full animate-pulse tracking-widest shadow-lg">
                  <span className="w-2 h-2 bg-white rounded-full" />
                  REC
                </div>

                {/* Caregiver identity overlay */}
                {caregiver && (
                  <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
                    <span className="flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm border border-emerald-500/50 text-emerald-300 px-4 py-2 rounded-xl text-sm font-bold shadow-lg">
                      <span className="text-base">👤</span>
                      {caregiver.name}
                    </span>
                    {confidence !== null && (
                      <span className="flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm border border-indigo-500/40 text-indigo-300 px-3 py-2 rounded-xl text-sm font-medium shadow-lg">
                        {confidence}% match
                      </span>
                    )}
                    {trackingSessionId && (
                      <span className="flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm border border-cyan-500/40 text-cyan-300 px-3 py-2 rounded-xl text-xs font-mono shadow-lg">
                        SESSION: {trackingSessionId.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* Offline placeholder */
              <div className="flex flex-col items-center justify-center gap-4 text-gray-600 py-16 px-8 text-center">
                <svg className="w-20 h-20 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <p className="font-mono text-sm tracking-widest">[ CAMERA OFFLINE ]</p>
                <p className="text-gray-700 text-xs">Click "Start Camera" to begin caregiver monitoring</p>
              </div>
            )}

            {/* Camera error overlay */}
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-950/90 rounded-b-3xl">
                <div className="text-center p-6">
                  <p className="text-red-400 font-bold text-lg mb-1">Camera Access Denied</p>
                  <p className="text-red-500/70 text-sm">{cameraError}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Status Panel ─────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* ── Caregiver Status Card ──────────────────────────── */}
          <div className={`border-2 rounded-2xl p-5 transition-all duration-500 shadow-lg ${colors.border} ${colors.bg}`}>
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">Continuity Status</p>
            <p className={`text-2xl font-black ${colors.text} ${statusUI.pulse ? 'animate-pulse' : ''}`}>
              {statusUI.label}
            </p>
          </div>

          {/* ── Absence Timer ─────────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-lg">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">Absence Timer</p>
            <p className="text-4xl font-mono text-white">
              {absenceSecs.toFixed(0)}
              <span className="text-lg text-gray-500 ml-1">sec</span>
            </p>
            <div className="w-full bg-gray-800 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  absenceSecs > 30 ? 'bg-red-500' : absenceSecs > 10 ? 'bg-yellow-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min((absenceSecs / 60) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* ── Caregiver Info Card ───────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-lg">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Identified Caregiver</p>

            {caregiver ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-lg">
                    👤
                  </div>
                  <div>
                    <p className="text-white font-bold">{caregiver.name}</p>
                    <p className="text-gray-400 text-xs">Registered Caregiver</p>
                  </div>
                </div>
                {confidence !== null && (
                  <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border ${colors.badge}`}>
                    {confidence}% biometric confidence
                  </div>
                )}
                {lastRecognizedAt && (
                  <p className="text-gray-600 text-xs">
                    Last seen: {lastRecognizedAt.toLocaleTimeString()}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 text-gray-600">
                <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-lg opacity-40">👤</div>
                <p className="text-sm">{isCameraOn ? 'Scanning for caregivers…' : 'No caregiver identified'}</p>
              </div>
            )}
          </div>

          {/* ── Session Info Card ─────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-lg">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">Tracking Session</p>
            {trackingSessionId ? (
              <>
                <p className="text-emerald-400 font-bold text-sm mb-1">✔ Session Active</p>
                <p className="text-gray-500 font-mono text-xs break-all">{trackingSessionId}</p>
              </>
            ) : (
              <p className="text-gray-600 text-sm">
                {isCameraOn ? 'Awaiting caregiver recognition…' : 'No active session'}
              </p>
            )}
          </div>

          {/* ── Error Box ─────────────────────────────────────── */}
          {error && (
            <div className="bg-red-900/30 border border-red-500/50 text-red-300 text-xs p-4 rounded-2xl shadow-lg">
              <p className="font-bold mb-1 text-red-400">API Notice</p>
              <p className="break-words">{error}</p>
            </div>
          )}

          {/* ── Polling Info ──────────────────────────────────── */}
          {isCameraOn && (
            <div className="text-center text-gray-700 text-xs font-mono">
              Polling every {POLL_MS / 1000}s · AI biometric active
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
