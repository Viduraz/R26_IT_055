import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useWebSocket } from '../hooks/useWebSocket';

export default function LiveFeedPage({ onFpsChange }) {
  const { setSystemOnline, setWsConnected } = useApp();
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

  // Camera stream ref
  const cameraStreamRef = useRef(null);

  // DOM refs
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const ipcamImgRef  = useRef(null);

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

  const handleResult = useCallback((data) => {
    if (!data.detected) {
      setIdResult(null);
      return;
    }

    setPipelineStats({
      latency:  `${data.latency_ms ?? '--'} ms`,
      features: data.num_features ?? '--',
      gait:     `${data.gait_buffer ?? 0} / 30`,
      method:   data.identification?.method ?? '--',
    });

    if (!data.features_ok) return;

    const id = data.identification || {};
    setIdResult({
      name:     id.user || 'unknown',
      isKnown:  id.is_known || false,
      conf:     id.confidence || 0,
      method:   id.method || 'none',
    });
  }, []);

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
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Start Camera
            </button>
          ) : (
            <button onClick={stopCamera} className="btn-danger">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1"/>
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

      {/* Main Grid: Video + Info Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Video Feed */}
        <div className="xl:col-span-2">
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
                      <polygon points="23 7 16 12 23 17 23 7"/>
                      <rect x="1" y="5" width="15" height="14" rx="2"/>
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
        </div>

        {/* Info Panel */}
        <div className="space-y-4">
          {/* Identification Card */}
          <div className="glass-card p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Identification</h3>

            <div className="flex items-center gap-3 mb-4">
              <div className={`
                w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0
                ${idResult?.isKnown
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-dark-600 text-slate-500 border border-white/5'
                }
              `}>
                {idResult?.isKnown ? idResult.name.charAt(0).toUpperCase() : '?'}
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {idResult ? (idResult.isKnown ? idResult.name : 'Unknown Person') : 'No person detected'}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {idResult ? `Method: ${idResult.method}` : '—'}
                </div>
              </div>
            </div>

            {/* Confidence bar */}
            <div className="space-y-1.5">
              <div className="confidence-bar-track">
                <div
                  className={`confidence-bar-fill transition-all duration-500 ${
                    confPct >= 75 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' :
                    confPct >= 50 ? 'bg-gradient-to-r from-amber-500 to-amber-400' :
                    'bg-gradient-to-r from-rose-500 to-rose-400'
                  }`}
                  style={{ width: `${confPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Confidence</span>
                <span className="font-mono text-slate-300">{confPct}%</span>
              </div>
            </div>
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

          {/* Pipeline Stats */}
          <div className="glass-card p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Pipeline</h3>
            <div className="space-y-2">
              {[
                { label: 'Latency',    value: pipelineStats.latency },
                { label: 'Features',   value: pipelineStats.features },
                { label: 'Gait Buffer', value: pipelineStats.gait },
                { label: 'Method',     value: pipelineStats.method },
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
    connected:    'bg-emerald-500',
    connecting:   'bg-amber-400 animate-pulse',
    disconnected: 'bg-slate-600',
    error:        'bg-rose-500',
  };
  const labels = {
    connected:    'Connected',
    connecting:   'Connecting…',
    disconnected: 'Disconnected',
    error:        'Error',
  };
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400 flex-shrink-0">
      <span className={`w-2.5 h-2.5 rounded-full ${colors[status] || colors.disconnected}`} />
      {labels[status]}
    </div>
  );
}
