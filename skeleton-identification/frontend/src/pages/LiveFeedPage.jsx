import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useWebSocket } from '../hooks/useWebSocket';

export default function LiveFeedPage({ onFpsChange }) {
  const { setSystemOnline, setWsConnected, setActiveTab } = useApp();
  const toast = useToast();

  // Stream state
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraSource, setCameraSource] = useState('webcam'); // 'webcam' | 'ipcam'
  const [showIpcamBar, setShowIpcamBar] = useState(false);
  const [rtspUrl, setRtspUrl] = useState('rtsp://admin:admin@169.254.110.15:554/stream1');
  const [ipcamStatus, setIpcamStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'

  // Identification result state
  const [idResult, setIdResult] = useState(null);
  const [pipelineStats, setPipelineStats] = useState({ latency: '--', features: '--', gait: '--', method: '--' });

  // Security Alert State
  const [alerts, setAlerts] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);

  // Alert tracking refs
  const isUnknownSessionRef = useRef(false);
  const lastSnapshotTimeRef = useRef(0);
  const streamStartTimeRef = useRef(0);

  // Camera stream ref
  const cameraStreamRef = useRef(null);

  // DOM refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const ipcamImgRef = useRef(null);

  // WebSocket stream state (mutable, for the hook)
  const streamStateRef = useRef({
    isStreaming: false,
    isEnrolling: false,
    enrollUserId: null,
    cameraSource: 'webcam',
    usePhoneCamera: false,
    phoneImage: null,
    phoneCameraUrl: '',
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

  const handleResult = useCallback((data) => {
    if (!data.detected) {
      setIdResult(null);
      return;
    }

    setPipelineStats({
      latency: `${data.latency_ms ?? '--'} ms`,
      features: data.num_features ?? '--',
      gait: `${data.gait_buffer ?? 0} / 30`,
      method: data.identification?.method ?? '--',
    });

    if (!data.features_ok) return;

    const id = data.identification || {};
    const name = id.user || 'unknown';
    const isKnown = id.is_known || false;
    const conf = id.confidence || 0;
    const confPctVal = Math.round(conf * 100);

    setIdResult({
      name,
      isKnown,
      conf,
      method: id.method || 'none',
      faceConf: id.face_confidence,
      skelConf: id.skeleton_confidence,
    });

    // Check status logic
    const frameStatus = isKnown && confPctVal >= 90
      ? 'verified'
      : (isKnown && confPctVal >= 70
          ? 'low'
          : 'unknown');

    if (frameStatus === 'unknown') {
      const now = Date.now();
      // Only trigger alert if camera has been running for at least 5 seconds
      if (now - streamStartTimeRef.current > 5000) {
        if (!isUnknownSessionRef.current || (now - lastSnapshotTimeRef.current > 15000)) {
          isUnknownSessionRef.current = true;
          lastSnapshotTimeRef.current = now;
          
          setTimeout(() => {
            const snapshotUrl = captureSnapshot();
            const newAlert = {
              id: now.toString(),
              snapshot: snapshotUrl,
              time: new Date().toLocaleString(),
              source: streamStateRef.current.cameraSource === 'webcam' ? 'Webcam' : 'IP Camera',
              confidence: confPctVal,
              status: 'Unknown Person',
            };
            
            setActiveAlert(newAlert);
            setAlerts(prev => [newAlert, ...prev]);
          }, 100);
        }
      }
    } else {
      isUnknownSessionRef.current = false;
    }
  }, [captureSnapshot]);

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
    if (cameraSource === 'ipcam') startIpCam();
    else startWebcam();
  };

  const stopCamera = () => {
    streamStateRef.current.isStreaming = false;
    setIsStreaming(false);

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (ipcamImgRef.current) {
      ipcamImgRef.current.src = '';
    }

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    disconnect();
    setWsConnected(false);
    setIpcamStatus('disconnected');
    setIdResult(null);
    onFpsChange?.(0);
    toast('Camera stopped', 'info');
  };

  const switchSource = (src) => {
    if (isStreaming) return;
    setCameraSource(src);
    setShowIpcamBar(src === 'ipcam');
  };

  const confPct = idResult ? Math.round(idResult.conf * 100) : 0;
  const faceMatch = idResult ? (idResult.faceConf ? Math.round(idResult.faceConf * 100) : 0) : 91;
  const skeletonMatch = idResult ? (idResult.skelConf ? Math.round(idResult.skelConf * 100) : Math.round(idResult.conf * 100)) : 87;
  const hybridScore = idResult ? Math.round(idResult.conf * 100) : 95;

  const status = idResult
    ? (idResult.isKnown && confPct >= 90
        ? 'verified'
        : (idResult.isKnown && confPct >= 70
            ? 'low'
            : 'unknown'))
    : 'idle';

  let cardBorder = 'border-white/5';
  if (status === 'verified') {
    cardBorder = 'border-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.03)]';
  } else if (status === 'low') {
    cardBorder = 'border-amber-500/25 shadow-[0_0_12px_rgba(245,158,11,0.03)]';
  } else if (status === 'unknown') {
    cardBorder = 'border-rose-500/30 shadow-[0_0_12px_rgba(239,68,68,0.05)]';
  }

  const isVerified = status === 'verified';
  const statusLabel = status === 'verified'
    ? 'Verified Identity'
    : status === 'low'
      ? 'Low Confidence'
      : status === 'unknown'
        ? 'Unregistered Person'
        : 'Verified Identity';
  const statusColor = status === 'verified'
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : status === 'low'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : status === 'unknown'
        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  const dotColor = status === 'verified'
    ? 'bg-emerald-400'
    : status === 'low'
      ? 'bg-amber-400'
      : status === 'unknown'
        ? 'bg-rose-400'
        : 'bg-emerald-400';

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
          
          {activeAlert.snapshot && (
            <div className="flex items-center justify-between flex-wrap gap-4 p-3 bg-dark-900/60 rounded-lg border border-white/5">
              <div className="flex items-center gap-4">
                <img 
                  src={activeAlert.snapshot} 
                  alt="Snapshot Preview" 
                  className="w-24 h-16 object-cover rounded bg-dark-900 border border-rose-500/20"
                />
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
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Video Feed */}
        <div className="xl:col-span-2 space-y-6">
          <div className="glass-card relative overflow-hidden" style={{ paddingBottom: '56.25%' }}>
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
              {/* Skeleton overlay canvas */}
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

              {/* ID Badge */}
              {idResult?.isKnown && isStreaming && (
                <div className="absolute bottom-4 left-4 animate-fade-in">
                  <div className="px-3 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 backdrop-blur-sm">
                    <div className="text-sm font-bold text-emerald-300">{idResult.name}</div>
                    <div className="text-xs text-emerald-400/70">{confPct}% confidence</div>
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
                  onClick={() => setAlerts([])}
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
                    {alert.snapshot ? (
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
                            onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
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
                      </div>
                      
                      <div className="flex gap-1.5 mt-2">
                        <button
                          onClick={() => setActiveTab('enroll')}
                          className="px-2 py-1 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/25 transition-all flex-1 text-center"
                        >
                          Enroll
                        </button>
                        <button
                          onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
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
        <div className="space-y-4">
          {/* Identification Card */}
          <div className={`glass-card p-4 transition-all duration-300 border ${cardBorder}`}>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Identification</h3>

            <div className="flex items-center gap-3 mb-4">
              <div className={`
                w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0 transition-all duration-300
                ${status === 'verified'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : status === 'low'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : status === 'unknown'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-dark-600 text-slate-500 border border-white/5'
                }
              `}>
                {status === 'verified' || status === 'low' ? idResult.name.charAt(0).toUpperCase() : '?'}
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
                  {status === 'verified' && (
                    <>
                      <span>{idResult.name}</span>
                      <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0110.5 21a3.745 3.745 0 01-3.068-1.593 3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0113.5 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                      </svg>
                    </>
                  )}
                  {status === 'low' && (
                    <>
                      <span>{idResult.name}</span>
                      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.008v.008H12v-.008z" />
                      </svg>
                    </>
                  )}
                  {status === 'unknown' && (
                    <>
                      <span>Unknown Person</span>
                      <svg className="w-4 h-4 text-rose-400 animate-pulse" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.008v.008H12v-.008z" />
                      </svg>
                    </>
                  )}
                  {status === 'idle' && (
                    <span>No person detected</span>
                  )}
                </div>

                {/* Status Badges */}
                <div className="flex flex-wrap gap-2 items-center">
                  {status === 'verified' && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                      Verified
                    </span>
                  )}
                  {status === 'low' && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                      Low Confidence
                    </span>
                  )}
                  {status === 'unknown' && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      <span className="w-1 h-1 rounded-full bg-rose-400 animate-pulse" />
                      Unregistered Person
                    </span>
                  )}
                  {status !== 'idle' && (
                    <span className="text-[10px] text-slate-500">
                      Method: {idResult.method}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Confidence bar */}
            <div className="space-y-1.5">
              <div className="confidence-bar-track">
                <div
                  className={`confidence-bar-fill transition-all duration-500
                    ${status === 'verified'
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                      : status === 'low'
                        ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                        : 'bg-gradient-to-r from-rose-500 to-rose-400'
                    }`}
                  style={{ width: `${confPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Confidence</span>
                <span className="font-mono text-slate-300">{confPct}%</span>
              </div>
            </div>

            {/* Status Message */}
            {status !== 'idle' && (
              <div className="mt-3 pt-2.5 border-t border-white/5 text-[11px] font-medium leading-none">
                {status === 'verified' && (
                  <span className="text-emerald-400 flex items-center gap-1">
                    ✓ Identity Successfully Verified.
                  </span>
                )}
                {status === 'low' && (
                  <span className="text-amber-400 flex items-center gap-1">
                    ⚠ Verification Recommended.
                  </span>
                )}
                {status === 'unknown' && (
                  <span className="text-rose-400 flex items-center gap-1">
                    ⚠ Unknown Person Detected.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Current Person Card */}
          <div className="glass-card p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Current Person</h3>
            {idResult ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-dark-600/60">
                <span className="text-sm text-slate-200">
                  {idResult.isKnown ? idResult.name : 'Unknown'}
                </span>
                <span className="font-mono text-sm text-cyan-400">{confPct}%</span>
              </div>
            ) : (
              <p className="text-xs text-slate-500 text-center py-3">Waiting for data…</p>
            )}
          </div>

          {/* Hybrid Identification Confidence Panel */}
          <div className="glass-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
              </svg>
              <h3 className="text-xs font-semibold text-slate-100 uppercase tracking-wider">
                Hybrid Identification
              </h3>
            </div>

            <div className="space-y-3">
              {/* Face Match */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Face Match</span>
                  <span className="font-mono text-slate-200">{faceMatch}%</span>
                </div>
                <div className="h-1.5 w-full bg-dark-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-500"
                    style={{ width: `${faceMatch}%` }}
                  />
                </div>
              </div>

              {/* Skeleton Match */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Skeleton Match</span>
                  <span className="font-mono text-slate-200">{skeletonMatch}%</span>
                </div>
                <div className="h-1.5 w-full bg-dark-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-600 to-teal-400 rounded-full transition-all duration-500"
                    style={{ width: `${skeletonMatch}%` }}
                  />
                </div>
              </div>

              {/* Final Hybrid Score */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-200 font-medium">Final Hybrid Score</span>
                  <span className="font-mono text-emerald-400 font-semibold">{hybridScore}%</span>
                </div>
                <div className="h-2 w-full bg-dark-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                    style={{ width: `${hybridScore}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="pt-2.5 border-t border-white/5 space-y-1.5">
              <div className="flex">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${statusColor}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-pulse`} />
                  {statusLabel}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Final score is generated by combining facial recognition and skeletal bone structure matching.
              </p>
            </div>
          </div>

          {/* Pipeline Stats */}
          <div className="glass-card p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Pipeline</h3>
            <div className="space-y-2">
              {[
                { label: 'Latency', value: pipelineStats.latency },
                { label: 'Features', value: pipelineStats.features },
                { label: 'Gait Buffer', value: pipelineStats.gait },
                { label: 'Method', value: pipelineStats.method },
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
