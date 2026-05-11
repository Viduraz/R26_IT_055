import { useState, useRef, useEffect, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { fetchUsers, createUser as apiCreateUser } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

const TOTAL_FRAMES = 150;

export default function EnrollPage() {
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  const [usePhoneCamera, setUsePhoneCamera] = useState(false);
  const [phoneCameraUrl, setPhoneCameraUrl] = useState('');

  const [isEnrolling, setIsEnrolling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [framesCollected, setFramesCollected] = useState(0);
  const [statusMsg, setStatusMsg] = useState('Select a user and start enrollment');

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
      setStatusMsg(data.status_msg || 'No person detected');
      return;
    }
    if (data.features_ok) setStatusMsg('');
    if (data.mode === 'enroll' && data.features_ok && data.frames_collected != null) {
      setFramesCollected(data.frames_collected);
      
      // Speed up enrollment for presentation
      const TARGET_FRAMES = 10;
      const pct = Math.min((data.frames_collected / TARGET_FRAMES) * 100, 100);
      setProgress(pct);

      if (data.frames_collected >= TARGET_FRAMES) {
        toast('Enrollment complete! ✅', 'success');
        stopEnrollment();
      }

      /* Original logic kept for after presentation:
      const pct = Math.min((data.progress || 0), 100);
      setProgress(pct);
      if (data.enrollment_status === 'completed') {
        toast('Enrollment complete! ✅', 'success');
        stopEnrollment();
      }
      */
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
      const user = await apiCreateUser(name.trim(), email.trim() || null);
      toast(`User "${user.name}" created!`, 'success');
      setName('');
      setEmail('');
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
    setStatusMsg('Starting enrollment…');

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
      toast(`Enrollment started via ${usePhoneCamera ? 'Phone' : 'Webcam'}`, 'info');
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
    setStatusMsg('Select a user and start enrollment');
  }, [disconnect]);

  const progressPct = Math.min(progress, 100);

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">

        {/* Form Panel */}
        <div className="glass-card p-6 space-y-5">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">New User</h2>

          {/* Create User */}
          <div className="space-y-3">
            <div>
              <label className="form-label">Fullllll Nameeee</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., John Doe"
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label">Email (optional)</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="john@example.com"
                className="form-input"
              />
            </div>
            <button
              onClick={handleCreateUser}
              disabled={creatingUser || !name.trim()}
              className="btn btn-primary btn-block"
            >
              {creatingUser ? <LoadingSpinner size="sm" /> : 'Create User'}
            </button>
          </div>

          <div className="border-t border-white/5" />

          {/* Select User */}
          <div>
            <label className="form-label">Select User to Enroll</label>
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

          {/* Camera Source */}
          <div>
            <label className="form-label">Camera Source</label>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setUsePhoneCamera(false)}
                disabled={isEnrolling}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all
                  ${!usePhoneCamera
                    ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                    : 'bg-dark-600 text-slate-400 border-white/10'
                  } disabled:opacity-50`}
              >
                💻 Webcam
              </button>
              <button
                onClick={() => setUsePhoneCamera(true)}
                disabled={isEnrolling}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all
                  ${usePhoneCamera
                    ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                    : 'bg-dark-600 text-slate-400 border-white/10'
                  } disabled:opacity-50`}
              >
                📱 Phone
              </button>
            </div>
            {usePhoneCamera && (
              <div className="space-y-2 animate-fade-in">
                <input
                  type="text"
                  value={phoneCameraUrl}
                  onChange={e => setPhoneCameraUrl(e.target.value)}
                  placeholder="http://192.168.1.5:8080/video"
                  className="form-input"
                  disabled={isEnrolling}
                />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Install <strong className="text-slate-400">IP Webcam</strong> on Android → Start Server → Enter URL above. Phone & PC must be on same WiFi.
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {!isEnrolling ? (
            <button
              onClick={startEnrollment}
              disabled={!selectedUserId}
              className="btn btn-accent btn-block"
            >
              🎬 Start Enrollment Recording
            </button>
          ) : (
            <button onClick={stopEnrollment} className="btn btn-danger btn-block">
              ⏹ Stop Recording
            </button>
          )}
        </div>

        {/* Preview Panel */}
        <div className="glass-card overflow-hidden">
          {/* Video + Canvas area */}
          <div className="relative" style={{ paddingBottom: '75%' }}>
            <div className="absolute inset-0">
              <video
                ref={enrollVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
              <canvas ref={enrollCanvasRef} className="absolute inset-0 w-full h-full" />

              {/* Status overlay */}
              {(!isEnrolling || statusMsg) && (
                <div className={`absolute inset-0 flex items-center justify-center bg-dark-900/70 transition-opacity ${isEnrolling && !statusMsg ? 'opacity-0 pointer-events-none' : ''}`}>
                  <div className="text-center px-6">
                    {isEnrolling && <LoadingSpinner size="md" />}
                    <p className="text-slate-300 text-sm mt-3">{statusMsg}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Progress */}
          {isEnrolling && (
            <div className="p-4 border-t border-white/5 space-y-2 animate-fade-in">
              <div className="confidence-bar-track">
                <div
                  className="confidence-bar-fill bg-gradient-to-r from-violet-500 to-cyan-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">{framesCollected} frames collected</span>
                <span className="font-mono text-violet-400">{Math.round(progressPct)}%</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
