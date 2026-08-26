import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { notifyUnknownPerson } from '../services/api';

// Webcam-only: continuously record in short, self-contained segments so an
// unknown-person alert can attach a real few-seconds-around-the-moment clip
// instead of a single still. (IP camera frames only arrive at the slow
// multi-person detection cadence — a few per second at best — so there's no
// smooth video to record there; that path stays snapshot-only.)
const VIDEO_SEGMENT_MS = 6000;

// No recognition system is ever 100% accurate — lighting, angle, and a bad
// frame while someone's still walking in can all cause a one-off misread.
// Rather than alert on any single "unknown" reading, we wait for a track to
// have been continuously unknown for this long (unknown_ms, from the
// backend's per-track tracker) before treating it as worth a real alert —
// long enough for a one-off misread of an actually-known person to
// self-correct, short enough that a genuine stranger still gets flagged fast.
const ALERT_MIN_UNKNOWN_MS = 3000;

export default function LiveFeedPage({ onFpsChange }) {
  const { setSystemOnline, setWsConnected, setActiveTab } = useApp();
  const toast = useToast();

  // Stream state
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraSource, setCameraSource] = useState('webcam'); // 'webcam' | 'ipcam'
  const [showIpcamBar, setShowIpcamBar] = useState(false);
  const [rtspUrl, setRtspUrl] = useState('rtsp://admin:admin@169.254.110.15:554/stream1');
  const [ipcamStatus, setIpcamStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'
  const [isExpandedView, setIsExpandedView] = useState(false);

  // Everyone currently detected in frame — a lone person is just a list of
  // length 1, so this is the only identification state the page needs.
  const [people, setPeople] = useState([]);
  const [pipelineStats, setPipelineStats] = useState({ latency: '--', people: 0, known: 0 });

  // Security Alert State
  const [alerts, setAlerts] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);

  // Alert tracking refs
  const alertedTrackIdsRef = useRef(new Set()); // track_ids we've already fired an alert for
  const streamStartTimeRef = useRef(0);
  const whatsappWarnedRef = useRef(false); // only toast the "not configured" notice once per session

  // Camera stream ref
  const cameraStreamRef = useRef(null);

  // Rolling video-clip recording (webcam only — see VIDEO_SEGMENT_MS above)
  const mediaRecorderRef = useRef(null);
  const segmentChunksRef = useRef([]);
  const segmentMimeTypeRef = useRef('video/webm');
  const segmentTimerRef = useRef(null);
  const pendingClipResolversRef = useRef([]); // alerts waiting on the segment in progress to finish
  const recordingActiveRef = useRef(false); // false once the user hits Stop, so onstop doesn't restart

  // DOM refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const ipcamImgRef = useRef(null);

  // WebSocket stream state (mutable, for the hook) — always multi-person: a
  // single detected person is just the degenerate case of that same result.
  const streamStateRef = useRef({
    isStreaming: false,
    isEnrolling: false,
    enrollUserId: null,
    cameraSource: 'webcam',
    usePhoneCamera: false,
    phoneImage: null,
    phoneCameraUrl: '',
    detectMode: 'multi',
  });

  const captureSnapshot = useCallback(() => {
    const video = videoRef.current;
    const ipcamImg = ipcamImgRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const srcType = streamStateRef.current.cameraSource;

    if (srcType === 'webcam' && video) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg');
      } catch (e) {
        console.error("Failed to capture webcam snapshot", e);
      }
    } else if (srcType === 'ipcam' && ipcamImg) {
      canvas.width = ipcamImg.naturalWidth || 640;
      canvas.height = ipcamImg.naturalHeight || 480;
      try {
        ctx.drawImage(ipcamImg, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg');
      } catch (e) {
        console.error("Failed to capture ipcam snapshot", e);
      }
    }
    return null;
  }, []);

  // Start (or restart) one recording segment on the live webcam stream. Each
  // segment is a fully independent, self-contained WebM file — MediaRecorder
  // chunks from a single ongoing recording aren't independently playable, so
  // rather than trying to maintain one continuous recording and trim it, we
  // just keep restarting a fresh short recording. Whichever segment happens
  // to be in progress when an alert fires will span some time both before and
  // after that moment, which is exactly the "context around the alert" we want.
  const startSegmentRecording = useCallback((stream) => {
    if (typeof MediaRecorder === 'undefined') return; // unsupported browser — snapshot-only, no crash

    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported?.(t)) || 'video/webm';
    segmentMimeTypeRef.current = mimeType;

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 900000 });
    } catch (e) {
      console.warn('Video clip recording unavailable:', e);
      return;
    }

    segmentChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) segmentChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(segmentChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);

      const waiting = pendingClipResolversRef.current;
      pendingClipResolversRef.current = [];
      waiting.forEach((resolve) => resolve({ blob, url }));

      if (recordingActiveRef.current && cameraStreamRef.current) {
        startSegmentRecording(cameraStreamRef.current);
      } else {
        URL.revokeObjectURL(url); // nobody was waiting on this final segment — don't leak it
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    segmentTimerRef.current = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, VIDEO_SEGMENT_MS);
  }, []);

  const stopSegmentRecording = useCallback(() => {
    recordingActiveRef.current = false;
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    // Any alerts still waiting on a clip won't get one — resolve them with null
    // rather than leaving their promises hanging forever.
    const waiting = pendingClipResolversRef.current;
    pendingClipResolversRef.current = [];
    waiting.forEach((resolve) => resolve(null));
  }, []);

  /** Resolves with { blob, url } once the currently-recording segment finishes, or null if unavailable. */
  const captureVideoClip = useCallback(() => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
        resolve(null);
        return;
      }
      pendingClipResolversRef.current.push(resolve);
    });
  }, []);

  const handleResult = useCallback((data) => {
    const persons = data.persons || [];
    setPeople(persons);
    setPipelineStats({
      latency: `${data.latency_ms ?? '--'} ms`,
      people: persons.length,
      known: persons.filter(p => p.is_known).length,
    });

    const now = Date.now();
    // Grace period after starting the camera, so walking into frame while
    // still getting positioned doesn't immediately trigger an alert.
    if (now - streamStartTimeRef.current <= 5000) return;

    // Each track_id is assigned once by the backend's identity tracker and
    // never reused for a different physical person (see stream.py's
    // _stabilize_tracks) — so "have we alerted this track_id before" is a
    // precise, no-flicker way to fire exactly once per newly-seen unknown
    // person, using the same stability system the boxes/names already rely on.
    // On top of that, only alert once a track has been continuously unknown
    // for ALERT_MIN_UNKNOWN_MS — a single bad-angle misread of someone
    // actually known gets a few seconds to self-correct before it can page
    // anyone, while a real stranger is still flagged within a few seconds.
    const unknownPersons = persons.filter((p) => !p.is_known && (p.unknown_ms || 0) >= ALERT_MIN_UNKNOWN_MS);
    unknownPersons.forEach((p) => {
      const trackKey = p.track_id ?? `${p.bbox[0].toFixed(2)},${p.bbox[1].toFixed(2)}`;
      if (alertedTrackIdsRef.current.has(trackKey)) return;
      alertedTrackIdsRef.current.add(trackKey);

      // Prefer the raw frame the backend already decoded for IP camera mode —
      // drawing from the <img> element right after setting its src risks a
      // decode race (the image may not have finished loading yet); the raw
      // base64 the server sent has no such race.
      const snapshotUrl = data.camera_frame
        ? `data:image/jpeg;base64,${data.camera_frame}`
        : captureSnapshot();
      const source = streamStateRef.current.cameraSource === 'webcam' ? 'Webcam' : 'IP Camera';
      const timeLabel = new Date().toLocaleString();
      const confPct = Math.round((p.confidence || 0) * 100);

      const alertId = `${now}-${trackKey}`;
      const newAlert = {
        id: alertId,
        snapshot: snapshotUrl,
        video: null, // fills in a few seconds later, once the in-progress recording segment completes
        time: timeLabel,
        source,
        confidence: confPct,
        status: 'Unknown Person',
        peopleInFrame: persons.length,
      };

      setActiveAlert(newAlert);
      setAlerts((prev) => [newAlert, ...prev]);

      if (source === 'Webcam') {
        captureVideoClip().then((clip) => {
          if (!clip) return;
          setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, video: clip } : a)));
          setActiveAlert((prev) => (prev && prev.id === alertId ? { ...prev, video: clip } : prev));
        });
      }

      notifyUnknownPerson({
        snapshot: snapshotUrl,
        confidence: confPct,
        source,
        peopleInFrame: persons.length,
        detectedAt: timeLabel,
      }).then((result) => {
        if (!result.sent && !whatsappWarnedRef.current) {
          whatsappWarnedRef.current = true;
          toast(result.reason || 'WhatsApp alert not sent', 'error');
        }
      });
    });
  }, [captureSnapshot, captureVideoClip, toast]);

  const handleStatus = useCallback((online) => {
    setWsConnected(online);
    if (!online && isStreaming) {
      toast('Pipeline disconnected', 'error');
    }
  }, [isStreaming, setWsConnected, toast]);

  const handleFps = useCallback((fps) => {
    onFpsChange?.(fps);
  }, [onFpsChange]);

  const { connect, disconnect } = useWebSocket(
    { videoRef, canvasRef, ipcamImgRef },
    streamStateRef.current,
    { onResult: handleResult, onStatusChange: handleStatus, onFps: handleFps }
  );

  // Sync streamStateRef
  useEffect(() => {
    streamStateRef.current.isStreaming = isStreaming;
    streamStateRef.current.cameraSource = cameraSource;
  }, [isStreaming, cameraSource]);

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      cameraStreamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      recordingActiveRef.current = true;
      startSegmentRecording(stream);

      streamStateRef.current.isStreaming = true;
      setIsStreaming(true);
      connect(false);
      toast('Webcam started', 'success');
    } catch (err) {
      toast(`Camera error: ${err.message}`, 'error');
    }
  };

  const startIpCam = () => {
    streamStateRef.current.isStreaming = true;
    setIsStreaming(true);
    setIpcamStatus('connecting');

    const canvas = canvasRef.current;
    canvas.width = 640;
    canvas.height = 480;

    connect(true, rtspUrl);
    toast('Connecting to IP camera…', 'info');
  };

  const startCamera = () => {
    streamStartTimeRef.current = Date.now();
    alertedTrackIdsRef.current = new Set();
    whatsappWarnedRef.current = false;
    if (cameraSource === 'ipcam') startIpCam();
    else startWebcam();
  };

  // Imperative-only resource teardown (no state setters) — shared by the
  // user-facing Stop button and the unmount cleanup effect below, since React
  // warns/leaks if setState runs after the component's already gone.
  const releaseResources = useCallback(() => {
    stopSegmentRecording();

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (ipcamImgRef.current) ipcamImgRef.current.src = '';

    disconnect();
  }, [stopSegmentRecording, disconnect]);

  const stopCamera = () => {
    streamStateRef.current.isStreaming = false;
    setIsStreaming(false);

    releaseResources();

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    setWsConnected(false);
    setIpcamStatus('disconnected');
    setPeople([]);
    onFpsChange?.(0);
    toast('Camera stopped', 'info');
  };

  // Switching tabs unmounts this page (see App.jsx) without going through the
  // Stop button — most notably when clicking "Enroll Person" straight from an
  // alert. Without this, the webcam (and now the recorder) would keep running
  // invisibly in the background.
  useEffect(() => {
    return () => {
      if (streamStateRef.current.isStreaming) releaseResources();
    };
    // Intentionally mount/unmount only — streamStateRef.current is read fresh
    // at cleanup time regardless, so this doesn't need releaseResources as a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchSource = (src) => {
    if (isStreaming) return;
    setCameraSource(src);
    setShowIpcamBar(src === 'ipcam');
  };

  const removeAlert = (id) => {
    setAlerts((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.video?.url) URL.revokeObjectURL(target.video.url);
      return prev.filter((a) => a.id !== id);
    });
  };

  const clearAllAlerts = () => {
    alerts.forEach((a) => { if (a.video?.url) URL.revokeObjectURL(a.video.url); });
    setAlerts([]);
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto">
      {/* Camera Source Toggle + Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => switchSource('webcam')}
            disabled={isStreaming}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${cameraSource === 'webcam'
                ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                : 'bg-dark-600 text-slate-400 border-white/10 hover:border-white/20'
              } disabled:opacity-50`}
          >
            📷 Webcam
          </button>
          <button
            onClick={() => switchSource('ipcam')}
            disabled={isStreaming}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${cameraSource === 'ipcam'
                ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                : 'bg-dark-600 text-slate-400 border-white/10 hover:border-white/20'
              } disabled:opacity-50`}
          >
            📡 IP Camera
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpandedView(!isExpandedView)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border flex items-center gap-1.5
              ${isExpandedView
                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                : 'bg-dark-600 text-slate-400 border-white/10 hover:border-white/20'
              }`}
            title="Expand camera view for multi-person display"
          >
            {isExpandedView ? '🗗 Standard View' : '⛶ Expand Video Screen'}
          </button>
          {!isStreaming ? (
            <button onClick={startCamera} className="btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Start Camera
            </button>
          ) : (
            <button onClick={stopCamera} className="btn-danger">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop
            </button>
          )}
        </div>
      </div>

      {/* IP Cam Config Bar */}
      {showIpcamBar && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-dark-600/60 border border-white/5 animate-fade-in">
          <span className="text-xs text-slate-400 flex-shrink-0">📡 RTSP URL</span>
          <input
            type="text"
            value={rtspUrl}
            onChange={e => setRtspUrl(e.target.value)}
            placeholder="rtsp://admin:admin@169.254.110.15:554/stream1"
            className="form-input flex-1"
            disabled={isStreaming}
          />
          <IpcamDot status={ipcamStatus} />
        </div>
      )}

      {/* Alert Banner */}
      {activeAlert && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 animate-fade-in space-y-3 shadow-lg shadow-rose-950/20">
          <div className="flex items-start justify-between">
            <div className="flex gap-2.5">
              <span className="text-xl">⚠️</span>
              <div>
                <h4 className="text-sm font-bold text-rose-400">Unregistered Person Detected</h4>
                <p className="text-xs text-slate-400 mt-1">
                  This individual is not enrolled in the system. Please verify their identity.
                  {activeAlert.peopleInFrame > 1 && ` (${activeAlert.peopleInFrame} people were in frame at the time.)`}
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveAlert(null)}
              className="text-slate-400 hover:text-slate-200 transition-colors p-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {(activeAlert.snapshot || activeAlert.video) && (
            <div className="flex items-center justify-between flex-wrap gap-4 p-3 bg-dark-900/60 rounded-lg border border-white/5">
              <div className="flex items-center gap-4">
                {activeAlert.video ? (
                  <video
                    src={activeAlert.video.url}
                    controls
                    muted
                    playsInline
                    className="w-32 h-20 object-cover rounded bg-dark-900 border border-rose-500/20"
                  />
                ) : (
                  <div className="relative">
                    <img
                      src={activeAlert.snapshot}
                      alt="Snapshot Preview"
                      className="w-24 h-16 object-cover rounded bg-dark-900 border border-rose-500/20"
                    />
                    {activeAlert.source === 'Webcam' && (
                      <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/70 text-rose-300 px-1 rounded">
                        clip recording…
                      </span>
                    )}
                  </div>
                )}
                <div className="text-xs space-y-1 text-slate-300">
                  <div><span className="text-slate-500">Detection Time:</span> {activeAlert.time}</div>
                  <div><span className="text-slate-500">Camera Source:</span> {activeAlert.source}</div>
                  <div><span className="text-slate-500">Confidence Score:</span> {activeAlert.confidence}%</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('enroll')}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25 transition-all"
                >
                  👤 Enroll Person
                </button>
                <button
                  onClick={() => setActiveAlert(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-dark-600 text-slate-400 border border-white/5 hover:border-white/10 transition-all"
                >
                  Dismiss Alert
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Grid: Video + Info Panel */}
      <div className={`grid grid-cols-1 ${isExpandedView ? 'gap-6' : 'xl:grid-cols-3 gap-6'}`}>
        {/* Video Feed */}
        <div className={`${isExpandedView ? 'w-full' : 'xl:col-span-2'} space-y-6`}>
          <div className="glass-card relative overflow-hidden" style={{ paddingBottom: isExpandedView ? '48%' : '56.25%' }}>
            <div className="absolute inset-0">
              {/* Webcam video */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`absolute inset-0 w-full h-full object-cover ${cameraSource === 'ipcam' ? 'hidden' : ''}`}
              />
              {/* IP cam image */}
              <img
                ref={ipcamImgRef}
                alt="IP Camera Feed"
                className={`absolute inset-0 w-full h-full object-cover ${cameraSource !== 'ipcam' ? 'hidden' : ''}`}
              />
              {/* Bounding-box + name overlay canvas */}
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

              {/* Placeholder overlay */}
              {!isStreaming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900/80">
                  <div className="w-16 h-16 rounded-2xl bg-dark-600/80 flex items-center justify-center mb-4">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-500">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" />
                    </svg>
                  </div>
                  <p className="text-slate-400 text-sm">Click "Start Camera" to begin</p>
                </div>
              )}

              {/* People-count badge */}
              {isStreaming && (
                <div className="absolute bottom-4 left-4 animate-fade-in">
                  <div className="px-3 py-2 rounded-xl bg-violet-500/20 border border-violet-500/40 backdrop-blur-sm">
                    <div className="text-sm font-bold text-violet-200">
                      {people.length === 0
                        ? 'No one detected'
                        : `${people.length} ${people.length === 1 ? 'person' : 'people'} detected`}
                    </div>
                    {people.length > 0 && (
                      <div className="text-xs text-violet-300/70">
                        {people.filter(p => p.is_known).length} recognized
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Alert History Section */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 className="text-sm font-semibold text-slate-200">Alert History</h3>
              </div>
              {alerts.length > 0 && (
                <button
                  onClick={clearAllAlerts}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Clear All
                </button>
              )}
            </div>

            {alerts.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">No security alerts recorded.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[300px] overflow-y-auto pr-1">
                {alerts.map(alert => (
                  <div key={alert.id} className="flex gap-3 p-3 bg-dark-600/40 rounded-xl border border-rose-500/10 hover:border-rose-500/20 transition-all group animate-fade-in">
                    {alert.video ? (
                      <video
                        src={alert.video.url}
                        muted
                        playsInline
                        onMouseEnter={(e) => e.currentTarget.play()}
                        onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                        className="w-20 h-15 object-cover rounded bg-dark-900 border border-white/5 cursor-pointer"
                        title="Hover to preview, click to open"
                        onClick={(e) => e.currentTarget.requestFullscreen?.()}
                      />
                    ) : alert.snapshot ? (
                      <img
                        src={alert.snapshot}
                        alt="Thumbnail"
                        className="w-20 h-15 object-cover rounded bg-dark-900 border border-white/5"
                      />
                    ) : (
                      <div className="w-20 h-15 bg-dark-900 border border-white/5 rounded flex items-center justify-center text-[9px] text-slate-500">
                        No image
                      </div>
                    )}
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div className="text-[11px] space-y-0.5 text-slate-300">
                        <div className="flex justify-between items-start">
                          <span className="font-semibold text-rose-400 uppercase tracking-wider text-[9px] bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                            {alert.status}
                          </span>
                          <button
                            onClick={() => removeAlert(alert.id)}
                            className="text-slate-600 hover:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="mt-1"><span className="text-slate-500">Time:</span> {alert.time}</div>
                        <div><span className="text-slate-500">Camera:</span> {alert.source}</div>
                        <div><span className="text-slate-500">Confidence:</span> {alert.confidence}%</div>
                        {alert.peopleInFrame > 1 && (
                          <div><span className="text-slate-500">People in frame:</span> {alert.peopleInFrame}</div>
                        )}
                      </div>

                      <div className="flex gap-1.5 mt-2">
                        <button
                          onClick={() => setActiveTab('enroll')}
                          className="px-2 py-1 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/25 transition-all flex-1 text-center"
                        >
                          Enroll
                        </button>
                        <button
                          onClick={() => removeAlert(alert.id)}
                          className="px-2 py-1 rounded text-[10px] font-medium bg-dark-600 text-slate-400 border border-white/5 hover:border-white/10 transition-all flex-1 text-center"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Info Panel */}
        <div className={`space-y-4 ${isExpandedView ? 'w-full' : ''}`}>
          {/* Detected People Card */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <span>Detected People Accuracy</span>
                {people.length > 0 && (
                  <span className="text-[10px] bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/30 font-normal">
                    {people.length} active
                  </span>
                )}
              </h3>
              <span className="text-xs font-mono text-amber-300 font-bold">{people.length}</span>
            </div>

            {people.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">
                {isStreaming ? 'Scanning for people…' : 'Start the camera to begin.'}
              </p>
            ) : (
              <div className={`space-y-3 max-h-[420px] overflow-y-auto pr-1 ${isExpandedView ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 space-y-0' : ''}`}>
                {people.map((person, idx) => {
                  const pConf = Math.round((person.confidence || 0) * 100);
                  const barGradient = !person.is_known
                    ? 'from-rose-500 to-amber-500'
                    : pConf >= 85
                      ? 'from-amber-400 to-amber-500'
                      : 'from-amber-500 to-yellow-500';
                  const pTextColor = !person.is_known
                    ? 'text-amber-400'
                    : pConf >= 85
                      ? 'text-amber-300 font-bold'
                      : 'text-yellow-400';
                  return (
                    <div key={idx} className="p-3 bg-dark-900/70 rounded-xl border border-amber-500/20 space-y-2 shadow-sm">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <div className={`font-semibold text-xs truncate ${pTextColor}`}>
                            {person.is_known ? person.name : `Person ${idx + 1}`}
                          </div>
                          <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                            {person.is_known ? (
                              <>
                                {person.role ? person.role.charAt(0).toUpperCase() + person.role.slice(1) : 'Caregiver'}
                                {person.method ? ` · via ${person.method.replace(/\+/g, ' + ')}` : ''}
                              </>
                            ) : (
                              'Unregistered Person'
                            )}
                          </div>
                        </div>
                        <span className={`font-mono font-bold shrink-0 text-sm ${pTextColor}`}>
                          {pConf}%
                        </span>
                      </div>
                      <div className="confidence-bar-track">
                        <div
                          className={`confidence-bar-fill bg-gradient-to-r ${barGradient}`}
                          style={{ width: `${Math.max(pConf, 6)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed mt-3 pt-2.5 border-t border-white/5">
              Every detected person is identified independently each frame — skeletal proportions fused with
              face verification when a face is visible. Immediate, no warm-up buffer.
            </p>
          </div>

          {/* Pipeline Stats */}
          <div className="glass-card p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Pipeline</h3>
            <div className="space-y-2">
              {[
                { label: 'Latency', value: pipelineStats.latency },
                { label: 'People Detected', value: pipelineStats.people },
                { label: 'Recognized', value: pipelineStats.known },
                { label: 'Recognition', value: 'Skeleton + Face' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                  <span className="text-xs text-slate-400">{label}</span>
                  <span className="stat-value">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IpcamDot({ status }) {
  const colors = {
    connected: 'bg-emerald-500',
    connecting: 'bg-amber-400 animate-pulse',
    disconnected: 'bg-slate-600',
    error: 'bg-rose-500',
  };
  const labels = {
    connected: 'Connected',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    error: 'Error',
  };
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400 flex-shrink-0">
      <span className={`w-2.5 h-2.5 rounded-full ${colors[status] || colors.disconnected}`} />
      {labels[status]}
    </div>
  );
}
