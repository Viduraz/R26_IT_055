/**
 * gateway-dashboard/frontend/src/pages/LiveStream.jsx
 *
 * Caregiver Recognition + Live Tracking Flow:
 *   1. Camera opens via react-webcam
 *   2. Immediately + every RECOG_MS → frame posted to face-verification
 *   3. Face recognition and visibility update run IN PARALLEL each tick
 *   4. On first successful recognition → tracking session created at tracking-service
 *   5. Status overlay + alert panel updated based on responses
 *   6. Caregiver name shown instantly on video overlay and info card
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

// ─── Service base URLs ────────────────────────────────────────────────────────
const FACE_API  = import.meta.env.VITE_FACE_BACKEND_URL  || 'http://localhost:8001/api/face';
const TRACK_API = import.meta.env.VITE_TRACKING_BACKEND_URL || 'http://localhost:8002/api/tracking';

// ─── Polling interval: how often to run a recognition cycle ──────────────────
const RECOG_MS = 800;   // fast enough to feel "instant" after camera warms up

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
  const [isCameraOn, setIsCameraOn]           = useState(false);
  const [cameraError, setCameraError]         = useState('');
  const [webcamReady, setWebcamReady]         = useState(false);

  // ── Caregiver recognition state ───────────────────────────────────────────
  const [caregiver, setCaregiver]             = useState(null);   // { name, ... }
  const [confidence, setConfidence]           = useState(null);
  const [lastRecognizedAt, setLastRecognizedAt] = useState(null);

  // ── Tracking session state ────────────────────────────────────────────────
  const [trackingSessionId, setTrackingSessionId] = useState(null);
  const [caregiverStatus, setCaregiverStatus]     = useState('idle');
  const [absenceSecs, setAbsenceSecs]             = useState(0);

  // ── In-flight guards ──────────────────────────────────────────────────────
  const [isRecognizing, setIsRecognizing]           = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);

  // ── Feedback ──────────────────────────────────────────────────────────────
  const [error, setError] = useState('');

  // ── Refs ──────────────────────────────────────────────────────────────────
  const webcamRef          = useRef(null);
  const timerRef           = useRef(null);         // setTimeout handle for polling loop
  const isRecognizingRef   = useRef(false);
  const isUpdatingRef      = useRef(false);
  const sessionCreatingRef = useRef(false);
  const sessionIdRef       = useRef(null);
  const isCameraOnRef      = useRef(false);
  const caregiverRef       = useRef(null);         // latest caregiver for closures
  const isActiveRef        = useRef(false);        // set false on stop to cancel in-flight

  // keep refs in sync
  useEffect(() => { sessionIdRef.current = trackingSessionId; }, [trackingSessionId]);
  useEffect(() => { isCameraOnRef.current = isCameraOn; }, [isCameraOn]);
  useEffect(() => { caregiverRef.current = caregiver; }, [caregiver]);

  // ── Helper: capture frame (strip data URI prefix for backend) ────────────
  const captureFrame = useCallback(() => {
    if (!webcamRef.current) return null;
    const dataUrl = webcamRef.current.getScreenshot();
    if (!dataUrl) return null;
    // Return the raw base64 without "data:image/jpeg;base64," prefix
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  }, []);

  // ── Create tracking session (once per camera session) ────────────────────
  const startTrackingSession = useCallback(async (caregiverDetails) => {
    if (sessionCreatingRef.current || sessionIdRef.current) return;
    sessionCreatingRef.current = true;
    try {
      const { data } = await axios.post(`${TRACK_API}/start-caregiver-session`, {
        caregiver_name: caregiverDetails?.name || 'Unknown',
        caregiver_id:   caregiverDetails?.id   || null,
      });
      if (data?.session_id) {
        setTrackingSessionId(data.session_id);
        sessionIdRef.current = data.session_id;
        setCaregiverStatus('verified_present');
      }
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Tracking API unreachable.';
      console.warn('[LiveStream] session start:', msg);
    } finally {
      sessionCreatingRef.current = false;
    }
  }, []);

  // ── Update caregiver visibility (parallel with recognition) ──────────────
  const updateVisibility = useCallback(async (frameBase64) => {
    const sid = sessionIdRef.current;
    if (!sid || isUpdatingRef.current || !frameBase64) return;
    isUpdatingRef.current = true;
    setIsUpdatingVisibility(true);
    try {
      const { data } = await axios.post(`${TRACK_API}/update-caregiver-visibility`, {
        session_id: sid,
        live_frame:  frameBase64,
      });
      if (isActiveRef.current) {
        setCaregiverStatus(data.status || 'idle');
        setAbsenceSecs(data.absence_seconds || 0);
      }
    } catch { /* silent */ }
    finally {
      isUpdatingRef.current = false;
      setIsUpdatingVisibility(false);
    }
  }, []);

  // ── Main poll tick ────────────────────────────────────────────────────────
  const pollTick = useCallback(async () => {
    if (!isActiveRef.current) return;

    const frame = captureFrame();
    if (!frame) {
      // Webcam not ready yet — retry quickly
      timerRef.current = setTimeout(pollTick, 200);
      return;
    }

    // ── Fire recognition + visibility update IN PARALLEL ──────────────────
    const recognizePromise = (async () => {
      if (isRecognizingRef.current) return null;
      isRecognizingRef.current = true;
      setIsRecognizing(true);
      try {
        const { data } = await axios.post(
          `${FACE_API}/verify-caregiver`,
          { live_sample: frame },
          { timeout: 5000 }
        );
        if (!isActiveRef.current) return null;
        if (data?.verified && data?.caregiver_details) {
          setCaregiver(data.caregiver_details);
          setConfidence(data.confidence ?? null);
          setLastRecognizedAt(new Date());
          setError('');
          setCaregiverStatus('verified_present');
          return data;
        }
        return null;
      } catch (err) {
        const msg = err.response?.data?.detail || err.message || 'Face API unreachable.';
        if (isActiveRef.current) setError(`Recognition: ${msg}`);
        return null;
      } finally {
        isRecognizingRef.current = false;
        setIsRecognizing(false);
      }
    })();

    const visibilityPromise = updateVisibility(frame);

    const [recognizeResult] = await Promise.allSettled([recognizePromise, visibilityPromise]);
    if (!isActiveRef.current) return;

    // Create tracking session on first successful recognition
    const recogData = recognizeResult.status === 'fulfilled' ? recognizeResult.value : null;
    if (recogData?.verified && recogData?.caregiver_details && !sessionIdRef.current) {
      startTrackingSession(recogData.caregiver_details);
    }

    // Schedule next tick
    if (isActiveRef.current) {
      timerRef.current = setTimeout(pollTick, RECOG_MS);
    }
  }, [captureFrame, updateVisibility, startTrackingSession]);

  // ── Start camera ──────────────────────────────────────────────────────────
  const startCamera = useCallback(() => {
    setCameraError('');
    setError('');
    setCaregiver(null);
    setConfidence(null);
    setLastRecognizedAt(null);
    setTrackingSessionId(null);
    setCaregiverStatus('idle');
    setAbsenceSecs(0);
    setWebcamReady(false);
    sessionCreatingRef.current = false;
    sessionIdRef.current = null;
    isActiveRef.current = true;
    setIsCameraOn(true);
  }, []);

  // ── Stop camera ───────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    isActiveRef.current = false;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    setIsCameraOn(false);
    setWebcamReady(false);
    setTrackingSessionId(null);
    sessionIdRef.current = null;
    setCaregiverStatus('idle');
  }, []);

  // ── When webcam becomes ready, kick off first poll immediately ────────────
  const handleWebcamReady = useCallback(() => {
    setWebcamReady(true);
    if (isActiveRef.current) {
      // Small delay to let the first video frame render
      timerRef.current = setTimeout(pollTick, 300);
    }
  }, [pollTick]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  // ── Derived UI state ──────────────────────────────────────────────────────
  const statusUI   = mapStatusToUI(caregiverStatus);
  const colors     = colorMap[statusUI.color];
  const isCritical = caregiverStatus === 'missing_critical';

  const webcamConstraints = {
    width:      { ideal: 1280 },
    height:     { ideal: 720 },
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
            <p className="text-sm text-red-400">
              {caregiver?.name || 'Caregiver'} has been absent for {absenceSecs.toFixed(0)}s. Immediate attention required.
            </p>
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
              {isCameraOn ? (webcamReady ? 'Camera Active' : 'Camera Initialising…') : 'Camera Offline'}
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
                  onUserMedia={handleWebcamReady}
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

                {/* Caregiver identity overlay — shown as soon as name is known */}
                {caregiver && (
                  <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
                    <span className="flex items-center gap-2 bg-gray-900/90 backdrop-blur-sm border border-emerald-500/60 text-emerald-300 px-4 py-2 rounded-xl text-sm font-bold shadow-lg">
                      <span className="text-base">👤</span>
                      {caregiver.name}
                    </span>
                    {confidence !== null && (
                      <span className="flex items-center gap-1 bg-gray-900/90 backdrop-blur-sm border border-indigo-500/40 text-indigo-300 px-3 py-2 rounded-xl text-sm font-medium shadow-lg">
                        {confidence}% match
                      </span>
                    )}
                    {trackingSessionId && (
                      <span className="flex items-center gap-1 bg-gray-900/90 backdrop-blur-sm border border-cyan-500/40 text-cyan-300 px-3 py-2 rounded-xl text-xs font-mono shadow-lg">
                        SESSION: {trackingSessionId.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                )}

                {/* "Scanning" badge while webcam ready but no caregiver yet */}
                {!caregiver && webcamReady && (
                  <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm border border-indigo-500/30 text-indigo-400 px-4 py-2 rounded-xl text-xs font-mono">
                    <span className="w-2 h-2 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    Scanning for registered caregiver…
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
                    <p className="text-white font-bold text-base">{caregiver.name}</p>
                    <p className="text-gray-400 text-xs">
                      Registered Caregiver{caregiver.id_number ? ` · ID: ${caregiver.id_number}` : ''}
                    </p>
                  </div>
                </div>
                {confidence !== null && (
                  <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border ${colors.badge}`}>
                    ✔ {confidence}% biometric confidence
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
                <p className="text-sm">
                  {isCameraOn
                    ? webcamReady
                      ? 'AI scanning for registered caregiver…'
                      : 'Camera initialising…'
                    : 'No caregiver identified'}
                </p>
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
              Polling every {RECOG_MS}ms · AI biometric active
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
