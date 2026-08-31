import { useState, useRef, useEffect, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { fetchUsers, createUser as apiCreateUser } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import './FaceScanStyles.css';

// ── Web Audio Chime Sound Synthesizer ─────────────────────────────────────────
function playChime(type = 'step') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    if (type === 'step') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } else if (type === 'complete') {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.1);
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.22);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.38);
    }
  } catch {
    // Ignore audio policy blocks
  }
}

// ── Scan Steps Configuration ─────────────────────────────────────────────────
const SCAN_STEPS = [
  { id: 'center', label: 'Look Straight Ahead', subtitle: 'Position your face in the center of the oval', targetPose: 'center', direction: null, framesNeeded: 8 },
  { id: 'right', label: 'Slowly Turn Right', subtitle: 'Turn your head slowly to your right', targetPose: 'right', direction: 'right', framesNeeded: 8 },
  { id: 'left', label: 'Slowly Turn Left', subtitle: 'Turn your head slowly to your left', targetPose: 'left', direction: 'left', framesNeeded: 8 },
  { id: 'up', label: 'Tilt Your Head Up', subtitle: 'Raise your chin upward slightly', targetPose: 'up', direction: 'up', framesNeeded: 6 },
];
const TOTAL_FRAMES_NEEDED = SCAN_STEPS.reduce((s, step) => s + step.framesNeeded, 0);

// ── SVG Icons ────────────────────────────────────────────────────────────────
const Icons = {
  user: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
    </svg>
  ),
  scan: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  arrowRight: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6"/>
    </svg>
  ),
  arrowLeft: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6"/>
    </svg>
  ),
  arrowUp: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 15l-6-6-6 6"/>
    </svg>
  ),
  arrowDown: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  ),
  face: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>
    </svg>
  ),
  steps: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  ),
};

function DirectionArrow({ direction }) {
  if (!direction) return null;
  const arrowMap = { right: Icons.arrowRight, left: Icons.arrowLeft, up: Icons.arrowUp, down: Icons.arrowDown };
  return <div className={`direction-indicator ${direction}`}>{arrowMap[direction]}</div>;
}

export default function FaceRecognitionPage() {
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('caregiver');
  const [creatingUser, setCreatingUser] = useState(false);
  const [usePhoneCamera, setUsePhoneCamera] = useState(false);
  const [phoneCameraUrl, setPhoneCameraUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [stepFrames, setStepFrames] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [scanComplete, setScanComplete] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Position your face in the oval to begin');
  const [ovalState, setOvalState] = useState('idle');
  const [livePose, setLivePose] = useState('center');
  const [liveHeadData, setLiveHeadData] = useState({ yaw: 0, pitch: 0 });

  const cameraStreamRef = useRef(null);
  const enrollVideoRef = useRef(null);
  const enrollCanvasRef = useRef(null);
  const stepFramesRef = useRef(0);
  const currentStepIdxRef = useRef(0);
  const totalFramesRef = useRef(0);
  const isScanningRef = useRef(false);

  const streamStateRef = useRef({
    isStreaming: false, isEnrolling: false, enrollUserId: null,
    cameraSource: 'webcam', usePhoneCamera: false, phoneImage: null, phoneCameraUrl: '',
    enrollType: 'face',
  });

  useEffect(() => {
    let cancelled = false;
    fetchUsers()
      .then(data => { if (!cancelled) setUsers(data); })
      .catch(() => {
        if (!cancelled)
          toast('Could not reach skeleton backend (port 8007). Is it running?', 'error');
      });
    return () => { cancelled = true; };
  }, [toast]);

  const currentStep = SCAN_STEPS[currentStepIdx] || SCAN_STEPS[0];
  const overallProgress = Math.min((totalFrames / TOTAL_FRAMES_NEEDED) * 100, 100);
  const stepProgress = currentStep ? Math.min((stepFrames / currentStep.framesNeeded) * 100, 100) : 0;

  const advanceStep = useCallback(() => {
    const nextIdx = currentStepIdxRef.current + 1;
    if (nextIdx >= SCAN_STEPS.length) {
      setScanComplete(true);
      setOvalState('success');
      playChime('complete');
      toast('iPhone-Style Face Biometric Scan Complete! ✅', 'success');
      setTimeout(() => stopScan(), 3500);
      return;
    }
    currentStepIdxRef.current = nextIdx;
    stepFramesRef.current = 0;
    setCurrentStepIdx(nextIdx);
    setStepFrames(0);
    setOvalState('scanning');
    toast(`Step ${nextIdx + 1}/${SCAN_STEPS.length}: ${SCAN_STEPS[nextIdx].label}`, 'info');
  }, [toast]);

  const handleResult = useCallback((data) => {
    if (!isScanningRef.current) return;
    if (!data.detected) {
      setStatusMsg('No face detected — position your face in the oval');
      setOvalState('warning');
      return;
    }

    const currentStepConfig = SCAN_STEPS[currentStepIdxRef.current];
    if (!currentStepConfig) return;

    const detectedPose = data.head_pose?.pose || 'center';
    setLivePose(detectedPose);
    if (data.head_pose) setLiveHeadData(data.head_pose);

    const requiredPose = currentStepConfig.targetPose;
    const isPoseMatch = (detectedPose === requiredPose);

    if (!isPoseMatch) {
      setOvalState('warning');
      const promptMap = {
        right: '👉 Turn head RIGHT',
        left: '👈 Turn head LEFT',
        up: '👆 Tilt chin UP',
        center: '🎯 Face STRAIGHT ahead',
      };
      setStatusMsg(`${promptMap[requiredPose]} to continue scan`);
      return;
    }

    // Pose matched! Collect biometric sample frame
    setOvalState('scanning');
    setStatusMsg(`✅ Pose Matched! Capturing ${currentStepConfig.label}...`);

    if (data.mode === 'enroll' && data.frames_collected != null) {
      totalFramesRef.current += 1;
      setTotalFrames(totalFramesRef.current);
      stepFramesRef.current += 1;
      setStepFrames(stepFramesRef.current);

      if (stepFramesRef.current >= currentStepConfig.framesNeeded) {
        playChime('step');
        advanceStep();
      }
    }
  }, [advanceStep]);

  const { connect, disconnect } = useWebSocket(
    { enrollVideoRef, enrollCanvasRef }, streamStateRef.current, { onResult: handleResult }
  );

  useEffect(() => {
    streamStateRef.current.isEnrolling = isScanning;
    streamStateRef.current.enrollUserId = selectedUserId;
    streamStateRef.current.usePhoneCamera = usePhoneCamera;
    streamStateRef.current.phoneCameraUrl = phoneCameraUrl;
  }, [isScanning, selectedUserId, usePhoneCamera, phoneCameraUrl]);

  const handleCreateUser = async () => {
    if (!name.trim()) { toast('Please enter a name', 'error'); return; }
    setCreatingUser(true);
    try {
      const user = await apiCreateUser(name.trim(), null, role, 'face_recognition');
      toast(`User "${user.name}" created!`, 'success');
      setName(''); setRole('caregiver');
      const updated = await fetchUsers();
      setUsers(updated);
      setSelectedUserId(user.user_id);
    } catch (err) { toast(err.message, 'error'); }
    finally { setCreatingUser(false); }
  };

  const startScan = async () => {
    if (!selectedUserId) return;
    setCurrentStepIdx(0); currentStepIdxRef.current = 0;
    setStepFrames(0); stepFramesRef.current = 0;
    setTotalFrames(0); totalFramesRef.current = 0;
    setScanComplete(false); setOvalState('scanning');
    setStatusMsg(SCAN_STEPS[0].label); isScanningRef.current = true;
    Object.assign(streamStateRef.current, {
      isEnrolling: true, isStreaming: true, enrollUserId: selectedUserId,
      usePhoneCamera, phoneCameraUrl,
    });
    setIsScanning(true);
    if (enrollCanvasRef.current) { enrollCanvasRef.current.width = 640; enrollCanvasRef.current.height = 480; }
    try {
      if (usePhoneCamera) {
        if (!phoneCameraUrl) { toast('Please enter your Phone Camera URL', 'error'); setIsScanning(false); isScanningRef.current = false; return; }
        const img = new Image(); img.crossOrigin = 'anonymous'; img.src = phoneCameraUrl;
        streamStateRef.current.phoneImage = img;
      } else {
        if (cameraStreamRef.current) cameraStreamRef.current.getTracks().forEach(t => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
        cameraStreamRef.current = stream;
        enrollVideoRef.current.srcObject = stream;
        await enrollVideoRef.current.play();
      }
      connect(false);
      toast('Face ID scan initiated — turn your head as prompted', 'info');
    } catch (err) { toast(`Camera error: ${err.message}`, 'error'); setIsScanning(false); isScanningRef.current = false; }
  };

  const stopScan = useCallback(() => {
    isScanningRef.current = false;
    streamStateRef.current.isEnrolling = false;
    streamStateRef.current.isStreaming = false;
    if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach(t => t.stop()); cameraStreamRef.current = null; }
    if (enrollVideoRef.current) enrollVideoRef.current.srcObject = null;
    if (enrollCanvasRef.current) { const ctx = enrollCanvasRef.current.getContext('2d'); ctx.clearRect(0, 0, enrollCanvasRef.current.width, enrollCanvasRef.current.height); }
    disconnect(); setIsScanning(false); setOvalState('idle'); setStatusMsg('Position your face in the oval to begin');
  }, [disconnect]);

  return (
    <div className="face-page">
      {/* Header */}
      <div className="face-page-header">
        <div>
          <h1 className="text-gradient-cyan">Face ID Biometric Scanner</h1>
          <div className="subtitle">iPhone-Style Multi-Angle Guided Face Enrollment</div>
        </div>
        {isScanning && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: 'rgba(6,182,212,0.08)', borderRadius: 12, border: '1px solid rgba(6,182,212,0.15)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#06b6d4', boxShadow: '0 0 10px rgba(6,182,212,0.5)', animation: 'dotPulse 1.5s ease-in-out infinite' }} />
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#06b6d4', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Face ID Active
            </span>
          </div>
        )}
      </div>

      {/* Main Grid */}
      <div className="face-page-grid">
        {/* Left Column */}
        <div className="face-left-panel">
          {/* Register Card */}
          <div className="face-card">
            <div className="face-card-title">
              <div className="icon-wrap cyan">{Icons.user}</div>
              Register New User
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full Name" className="form-input" disabled={isScanning} />
              <select value={role} onChange={e => setRole(e.target.value)} className="form-select" disabled={isScanning}>
                <option value="caregiver">Caregiver</option>
                <option value="patient">Patient</option>
                <option value="guardian">Guardian</option>
              </select>
              <button onClick={handleCreateUser} disabled={creatingUser || !name.trim() || isScanning} className="face-btn face-btn-primary face-btn-sm">
                {creatingUser ? <LoadingSpinner size="sm" /> : 'Register User'}
              </button>
            </div>
          </div>

          {/* Scan Config Card */}
          <div className="face-card">
            <div className="face-card-title">
              <div className="icon-wrap violet">{Icons.scan}</div>
              Scan Configuration
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label">Select User</label>
                <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className="form-select" disabled={isScanning}>
                  <option value="">— Select User —</option>
                  {users.map(u => <option key={u.user_id} value={u.user_id}>{u.name} ({u.enrollment_status})</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Capture Method</label>
                <div className="cam-toggle-group">
                  <button onClick={() => setUsePhoneCamera(false)} disabled={isScanning} className={`cam-toggle ${!usePhoneCamera ? 'active' : ''}`}>💻 Webcam</button>
                  <button onClick={() => setUsePhoneCamera(true)} disabled={isScanning} className={`cam-toggle ${usePhoneCamera ? 'active' : ''}`}>📱 Phone</button>
                </div>
              </div>
              {usePhoneCamera && (
                <input type="text" value={phoneCameraUrl} onChange={e => setPhoneCameraUrl(e.target.value)} placeholder="http://192.168.x.x:8080/video" className="form-input" style={{ fontSize: '0.72rem' }} disabled={isScanning} />
              )}
              {!isScanning ? (
                <button onClick={startScan} disabled={!selectedUserId} className="face-btn face-btn-scan">
                  {Icons.face}
                  Begin Face ID Scan
                </button>
              ) : (
                <button onClick={stopScan} className="face-btn face-btn-danger">✕ Cancel Scan</button>
              )}
            </div>
          </div>

          {/* Scan Steps Progress */}
          {isScanning && (
            <div className="face-card" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
              <div className="face-card-title">
                <div className="icon-wrap emerald">{Icons.steps}</div>
                Guided Angle Steps
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SCAN_STEPS.map((step, idx) => {
                  const isActive = idx === currentStepIdx;
                  const isDone = idx < currentStepIdx || scanComplete;
                  return (
                    <div key={step.id} className={`step-row ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
                      <div className={`step-number ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
                        {isDone ? '✓' : idx + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: isActive ? '#06b6d4' : isDone ? '#10b981' : '#475569' }}>{step.label}</div>
                        {isActive && (
                          <div style={{ fontSize: '0.6rem', color: '#64748b', marginTop: 2 }}>
                            {stepFrames}/{step.framesNeeded} frames • Target: <span className="font-mono text-cyan-400 font-bold uppercase">{step.targetPose}</span>
                          </div>
                        )}
                      </div>
                      {isActive && (
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: '0.75rem', color: '#06b6d4' }}>
                          {Math.round(stepProgress)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Live HUD Pose Info */}
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(15,23,42,0.6)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Detected Head Orientation</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 800, color: livePose === currentStep.targetPose ? '#10b981' : '#f59e0b' }}>
                    {livePose.toUpperCase()} {livePose === currentStep.targetPose ? '✓ MATCH' : '• WAITING'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.6rem', fontFamily: 'monospace', color: '#94a3b8' }}>
                  <div>Yaw: {liveHeadData.yaw}</div>
                  <div>Pitch: {liveHeadData.pitch}</div>
                </div>
              </div>

              {/* Overall progress */}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  <span>Overall Face ID Progress</span>
                  <span style={{ color: '#06b6d4' }}>{Math.round(overallProgress)}%</span>
                </div>
                <div className="face-progress-track">
                  <div className="face-progress-fill" style={{ width: `${overallProgress}%` }} />
                </div>
                <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: 6 }}>
                  {totalFrames} / {TOTAL_FRAMES_NEEDED} biometric samples collected
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Scanner */}
        <div className="face-scanner-panel">
          <div className="face-scan-container">
            <video ref={enrollVideoRef} autoPlay playsInline muted className="face-scan-video" />
            <canvas ref={enrollCanvasRef} style={{ display: 'none' }} />

            {/* Overlay */}
            <div className="face-scan-overlay">
              {/* Oval mask */}
              <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, zIndex: 4 }} preserveAspectRatio="none">
                <defs>
                  <mask id="ovalMask">
                    <rect width="100%" height="100%" fill="white"/>
                    <rect x="22%" y="12%" width="56%" height="72%" rx="20" ry="20" fill="black"/>
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#ovalMask)"/>
              </svg>

              {/* iPhone Face ID Radial Tick Indicators around oval */}
              <div className="face-id-ticks-ring">
                {SCAN_STEPS.map((step, idx) => {
                  const isDone = idx < currentStepIdx || scanComplete;
                  const isActive = idx === currentStepIdx && isScanning;
                  return (
                    <div
                      key={step.id}
                      className={`face-id-tick-segment tick-${step.id} ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}
                    />
                  );
                })}
              </div>

              {/* Oval ring */}
              <div className={`face-oval-guide ${ovalState}`} />

              {/* Scan line */}
              {isScanning && !scanComplete && <div className="face-scan-line" />}

              {/* Direction arrows */}
              {isScanning && !scanComplete && currentStep.direction && <DirectionArrow direction={currentStep.direction} />}

              {/* Status badge (top-left) */}
              <div className="scan-status-badge" style={{ color: isScanning ? (ovalState === 'warning' ? '#f59e0b' : '#06b6d4') : '#64748b' }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: isScanning ? (ovalState === 'warning' ? '#f59e0b' : '#06b6d4') : '#475569',
                  boxShadow: isScanning && ovalState !== 'warning' ? '0 0 8px rgba(6,182,212,0.5)' : 'none',
                  animation: isScanning && ovalState !== 'warning' ? 'dotPulse 1.5s ease-in-out infinite' : 'none',
                }} />
                {isScanning ? (scanComplete ? 'Complete' : `Step ${currentStepIdx + 1}/${SCAN_STEPS.length} • Target: ${currentStep.targetPose.toUpperCase()}`) : 'Idle'}
              </div>

              {/* Frames badge (top-right) */}
              {isScanning && (
                <div className="frames-badge">
                  <span className="count">{totalFrames}</span>
                  <span>/ {TOTAL_FRAMES_NEEDED}</span>
                </div>
              )}

              {/* Instruction banner */}
              <div className="face-instruction">
                {isScanning && !scanComplete && (
                  <>
                    <h3>{currentStep.label}</h3>
                    <p>{statusMsg}</p>
                    <div className="step-dots">
                      {SCAN_STEPS.map((_, i) => (
                        <div key={i} className={`step-dot ${i === currentStepIdx ? 'active' : ''} ${i < currentStepIdx ? 'completed' : ''}`} />
                      ))}
                    </div>
                  </>
                )}
                {!isScanning && !scanComplete && (
                  <>
                    <div className="scanner-idle-icon" style={{ margin: '0 auto 12px' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="10" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                      </svg>
                    </div>
                    <h3>{statusMsg}</h3>
                    <p>Select a user and click "Begin Face ID Scan"</p>
                  </>
                )}
              </div>

              {/* Completion overlay */}
              {scanComplete && (
                <div className="scan-complete-overlay">
                  <div className="scan-complete-icon">{Icons.check}</div>
                  <h2 style={{ color: '#f1f5f9', fontSize: '1.25rem', fontWeight: 800, marginBottom: 8, letterSpacing: '-0.01em' }}>
                    Face ID Biometrics Saved!
                  </h2>
                  <p style={{ color: '#94a3b8', fontSize: '0.78rem', maxWidth: 280, textAlign: 'center', lineHeight: 1.6 }}>
                    {totalFrames} multi-angle biometric samples aggregated across {SCAN_STEPS.length} head positions. Profile active!
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Status bar below scanner */}
          {isScanning && !scanComplete && (
            <div className="face-status-bar">
              <div style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: ovalState === 'warning' ? '#f59e0b' : '#10b981',
                boxShadow: ovalState === 'warning' ? 'none' : '0 0 10px rgba(16,185,129,0.4)',
                animation: ovalState === 'warning' ? 'none' : 'dotPulse 2s ease-in-out infinite',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{statusMsg}</div>
                <div style={{ fontSize: '0.62rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
                  Step {currentStepIdx + 1} of {SCAN_STEPS.length} • Required Pose: {currentStep.targetPose.toUpperCase()}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="text-gradient-cyan" style={{ fontSize: '1.25rem', fontFamily: 'ui-monospace, monospace', fontWeight: 800 }}>
                  {Math.round(overallProgress)}%
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
