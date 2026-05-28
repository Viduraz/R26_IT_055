import { useState, useRef, useEffect, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { fetchUsers, createUser as apiCreateUser } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

export default function FaceRecognitionPage() {
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('caregiver');
  const [creatingUser, setCreatingUser] = useState(false);

  const [usePhoneCamera, setUsePhoneCamera] = useState(false);
  const [phoneCameraUrl, setPhoneCameraUrl] = useState('');

  const [isEnrolling, setIsEnrolling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [framesCollected, setFramesCollected] = useState(0);
  const [statusMsg, setStatusMsg] = useState('Configure and start face scan');

  const cameraStreamRef = useRef(null);
  const enrollVideoRef  = useRef(null);
  const enrollCanvasRef = useRef(null);

  const streamStateRef = useRef({
    isStreaming: false,
    isEnrolling: false,
    enrollUserId: null,
    cameraSource: 'webcam',
    usePhoneCamera: false,
    phoneImage: null,
    phoneCameraUrl: '',
  });

  // Load users on mount
  useEffect(() => {
    fetchUsers()
      .then(setUsers)
      .catch(() => toast('Failed to load users', 'error'));
  }, []);

  const handleResult = useCallback((data) => {
    if (data.status_msg) setStatusMsg(data.status_msg);
    if (!data.detected) {
      setStatusMsg(data.status_msg || 'No face detected');
      return;
    }
    if (data.features_ok) setStatusMsg('Face aligned - collecting data...');
    
    if (data.mode === 'enroll' && data.features_ok && data.frames_collected != null) {
      setFramesCollected(data.frames_collected);
      
      // Using same target frames as EnrollPage for consistency
      const TARGET_FRAMES = 10; 
      const pct = Math.min((data.frames_collected / TARGET_FRAMES) * 100, 100);
      setProgress(pct);

      if (data.frames_collected >= TARGET_FRAMES) {
        toast('Biometric enrollment complete! ✅', 'success');
        stopEnrollment();
      }
    }
  }, []);

  const { connect, disconnect } = useWebSocket(
    { enrollVideoRef, enrollCanvasRef },
    streamStateRef.current,
    { onResult: handleResult }
  );

  useEffect(() => {
    streamStateRef.current.isEnrolling = isEnrolling;
    streamStateRef.current.enrollUserId = selectedUserId;
    streamStateRef.current.usePhoneCamera = usePhoneCamera;
    streamStateRef.current.phoneCameraUrl = phoneCameraUrl;
  }, [isEnrolling, selectedUserId, usePhoneCamera, phoneCameraUrl]);

  const handleCreateUser = async () => {
    if (!name.trim()) { toast('Please enter a name', 'error'); return; }
    setCreatingUser(true);
    try {
      const user = await apiCreateUser(name.trim(), email.trim() || null, role, 'face_recognition');
      toast(`User "${user.name}" created!`, 'success');
      setName('');
      setEmail('');
      setRole('caregiver');
      const updated = await fetchUsers();
      setUsers(updated);
      setSelectedUserId(user.user_id);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCreatingUser(false);
    }
  };

  const startEnrollment = async () => {
    if (!selectedUserId) return;

    streamStateRef.current.isEnrolling = true;
    streamStateRef.current.isStreaming = true;
    streamStateRef.current.enrollUserId = selectedUserId;
    streamStateRef.current.usePhoneCamera = usePhoneCamera;
    streamStateRef.current.phoneCameraUrl = phoneCameraUrl;

    setIsEnrolling(true);
    setProgress(0);
    setFramesCollected(0);
    setStatusMsg('Initializing biometric scanner...');

    const enrollCanvas = enrollCanvasRef.current;
    enrollCanvas.width = 640;
    enrollCanvas.height = 480;

    try {
      if (usePhoneCamera) {
        if (!phoneCameraUrl) {
          toast('Please enter your Phone Camera URL', 'error');
          setIsEnrolling(false);
          return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = phoneCameraUrl;
        streamStateRef.current.phoneImage = img;
      } else {
        if (cameraStreamRef.current) {
          cameraStreamRef.current.getTracks().forEach(t => t.stop());
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        cameraStreamRef.current = stream;
        enrollVideoRef.current.srcObject = stream;
        await enrollVideoRef.current.play();
      }

      connect(false);
      toast(`Face scan started via ${usePhoneCamera ? 'Phone' : 'Webcam'}`, 'info');
    } catch (err) {
      toast(`Camera error: ${err.message}`, 'error');
      setIsEnrolling(false);
    }
  };

  const stopEnrollment = useCallback(() => {
    streamStateRef.current.isEnrolling = false;
    streamStateRef.current.isStreaming = false;

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    if (enrollVideoRef.current) enrollVideoRef.current.srcObject = null;
    if (enrollCanvasRef.current) {
      const ctx = enrollCanvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, enrollCanvasRef.current.width, enrollCanvasRef.current.height);
    }

    disconnect();
    setIsEnrolling(false);
    setStatusMsg('Configure and start face scan');
  }, [disconnect]);

  const progressPct = Math.min(progress, 100);

  return (
    <div className="flex-1 p-6 overflow-y-auto space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gradient-cyan">Face Recognition & Enrollment</h1>
        <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider">Biometric Identity Management</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Enrollment Form */}
        <div className="space-y-6">
          <div className="glass-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <line x1="20" y1="8" x2="20" y2="14"/>
                <line x1="23" y1="11" x2="17" y2="11"/>
              </svg>
              Quick User Creation
            </h3>
            
            <div className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Full Name"
                className="form-input"
              />
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="form-select"
              >
                <option value="caregiver">Caregiver</option>
                <option value="patient">Patient</option>
                <option value="guardian">Guardian</option>
              </select>
              <button
                onClick={handleCreateUser}
                disabled={creatingUser || !name.trim()}
                className="btn btn-primary btn-block btn-sm"
              >
                {creatingUser ? <LoadingSpinner size="sm" /> : 'Register User'}
              </button>
            </div>
          </div>

          <div className="glass-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300">Enrollment Setup</h3>
            
            <div className="space-y-4">
              <div>
                <label className="form-label">Select User</label>
                <select
                  value={selectedUserId}
                  onChange={e => setSelectedUserId(e.target.value)}
                  className="form-select"
                  disabled={isEnrolling}
                >
                  <option value="">-- Select User --</option>
                  {users.map(u => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.name} ({u.enrollment_status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Capture Method</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setUsePhoneCamera(false)}
                    disabled={isEnrolling}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all border
                      ${!usePhoneCamera ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' : 'bg-dark-600 text-slate-500 border-white/5'}
                    `}
                  >
                    Webcam
                  </button>
                  <button
                    onClick={() => setUsePhoneCamera(true)}
                    disabled={isEnrolling}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all border
                      ${usePhoneCamera ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' : 'bg-dark-600 text-slate-500 border-white/5'}
                    `}
                  >
                    Phone Cam
                  </button>
                </div>
              </div>

              {usePhoneCamera && (
                <input
                  type="text"
                  value={phoneCameraUrl}
                  onChange={e => setPhoneCameraUrl(e.target.value)}
                  placeholder="http://192.168.x.x:8080/video"
                  className="form-input text-xs"
                  disabled={isEnrolling}
                />
              )}

              {!isEnrolling ? (
                <button
                  onClick={startEnrollment}
                  disabled={!selectedUserId}
                  className="btn btn-accent btn-block shadow-glow-cyan"
                >
                  Start Biometric Scan
                </button>
              ) : (
                <button onClick={stopEnrollment} className="btn btn-danger btn-block">
                  Stop Capture
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Scan Preview */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card relative aspect-video overflow-hidden group">
            <video
              ref={enrollVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            <canvas ref={enrollCanvasRef} className="absolute inset-0 w-full h-full" />

            {/* Scanning HUD Overlay */}
            {isEnrolling && (
              <>
                <div className="absolute inset-0 bg-cyan-500/5 pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-scan" />
                
                <div className="absolute inset-12 border border-cyan-500/30 rounded-[40px] pointer-events-none">
                  <div className="absolute -top-1 -left-1 w-10 h-10 border-t-4 border-l-4 border-cyan-400 rounded-tl-3xl" />
                  <div className="absolute -top-1 -right-1 w-10 h-10 border-t-4 border-r-4 border-cyan-400 rounded-tr-3xl" />
                  <div className="absolute -bottom-1 -left-1 w-10 h-10 border-b-4 border-l-4 border-cyan-400 rounded-bl-3xl" />
                  <div className="absolute -bottom-1 -right-1 w-10 h-10 border-b-4 border-r-4 border-cyan-400 rounded-br-3xl" />
                </div>
              </>
            )}

            {/* Status Overlay */}
            {(!isEnrolling || statusMsg) && (
              <div className={`absolute inset-0 flex items-center justify-center bg-dark-900/60 backdrop-blur-sm transition-opacity ${isEnrolling && !statusMsg ? 'opacity-0' : 'opacity-100'}`}>
                <div className="text-center p-6 glass-card border-cyan-500/20 max-w-xs mx-auto">
                  {isEnrolling ? <LoadingSpinner size="md" /> : (
                    <div className="w-12 h-12 mx-auto rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 mb-4">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
                        <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
                        <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
                        <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                      </svg>
                    </div>
                  )}
                  <p className="text-slate-200 text-sm font-medium">{statusMsg}</p>
                </div>
              </div>
            )}

            <div className="absolute bottom-6 left-6 flex items-center gap-2 px-3 py-1.5 bg-dark-900/60 backdrop-blur-md rounded-lg border border-white/5">
              <div className={`status-dot ${isEnrolling ? 'status-dot-online' : 'status-dot-offline'} w-2 h-2`} />
              <span className="text-[10px] font-mono text-slate-300 uppercase tracking-widest font-bold">
                {isEnrolling ? 'Scanner Active' : 'Scanner Idle'}
              </span>
            </div>
          </div>

          {/* Progress Section */}
          {isEnrolling && (
            <div className="glass-card p-6 space-y-4 animate-in slide-in-from-top-4">
              <div className="flex justify-between items-end">
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Biometric Pattern Capture</h4>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Collecting facial geometry data</p>
                </div>
                <span className="font-mono text-2xl font-bold text-gradient-cyan">{Math.round(progressPct)}%</span>
              </div>
              <div className="confidence-bar-track h-3">
                <div
                  className="confidence-bar-fill bg-gradient-to-r from-violet-600 via-cyan-500 to-cyan-400 shadow-glow-cyan"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                <span>{framesCollected} valid samples stored</span>
                <span>Target: 10 optimal samples</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scan {
          animation: scan 3s linear infinite;
        }
      `}} />
    </div>
  );
}
