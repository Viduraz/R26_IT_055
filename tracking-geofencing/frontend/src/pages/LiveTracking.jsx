import { useState, useEffect, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import axios from "axios";

export default function LiveTracking() {
  const webcamRef = useRef(null);
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState("idle");
  const [absenceSecs, setAbsenceSecs] = useState(0);
  const [tracking, setTracking] = useState(false);

  const captureAndTrack = useCallback(async () => {
    if (!webcamRef.current || !sessionId || !tracking) return;
    const imageSrc = webcamRef.current.getScreenshot();
    
    try {
      const { data } = await axios.post("http://localhost:8002/api/tracking/update-caregiver-visibility", {
        session_id: sessionId,
        live_frame: imageSrc
      });
      setStatus(data.status);
      setAbsenceSecs(data.absence_seconds || 0);
    } catch (err) {
      console.error("Frame tracking failure:", err);
    }
  }, [webcamRef, sessionId, tracking]);

  useEffect(() => {
    if (!tracking) return;
    const interval = setInterval(() => {
      captureAndTrack();
    }, 5000); // 5-second polling interval
    return () => clearInterval(interval);
  }, [tracking, captureAndTrack]);

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center bg-gray-900 border border-gray-700 p-6 rounded-2xl shadow-lg">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Live Camera Node</h1>
          <p className="text-gray-400">Continuous presence monitoring simulation for verified caregivers.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <input 
            type="text" 
            placeholder="Enter Hand-off Session ID..." 
            className="px-4 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-indigo-500 font-mono text-sm w-80"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            disabled={tracking}
          />
          <button 
            onClick={() => setTracking(!tracking)}
            disabled={!sessionId}
            className={`px-8 py-2 font-bold rounded-lg transition-all ${tracking ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-green-600 hover:bg-green-500 text-white disabled:opacity-50'}`}
          >
            {tracking ? "Stop Camera Analysis" : "Start Tracking Handoff"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 relative rounded-2xl overflow-hidden shadow-2xl border-4 border-gray-800 bg-black">
          {tracking ? (
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              className="w-full h-auto object-cover opacity-80"
            />
          ) : (
            <div className="flex items-center justify-center h-80 text-gray-600 font-mono">
              [ CAMERA OFFLINE ]
            </div>
          )}
          
          {tracking && (
            <div className="absolute top-4 left-4 bg-red-600/90 text-white text-xs px-3 py-1 font-bold rounded-full animate-pulse flex items-center gap-2 shadow-lg tracking-widest">
              <span className="w-2 h-2 bg-white rounded-full"></span>
              REC
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className={`p-6 rounded-2xl border-2 transition-all shadow-lg ${
            status === 'verified_present' ? 'bg-green-900/40 border-green-500' :
            status === 'warning' ? 'bg-yellow-900/40 border-yellow-500' :
            status === 'missing' ? 'bg-orange-900/40 border-orange-500' :
            status === 'missing_critical' ? 'bg-red-900/40 border-red-500 animate-pulse' :
            'bg-gray-800 border-gray-700'
          }`}>
            <h3 className="text-gray-400 font-medium text-sm mb-1 uppercase tracking-wider">Continuity Status</h3>
            <p className="text-2xl font-black text-white capitalize break-words">
              {status.replace("_", " ")}
            </p>
          </div>

          <div className="bg-gray-800 border-gray-700 border p-6 rounded-2xl shadow-lg">
            <h3 className="text-gray-400 font-medium text-sm mb-1 uppercase tracking-wider">Absence Timer</h3>
            <p className="text-4xl font-mono text-white">
              {absenceSecs.toFixed(1)} <span className="text-xl text-gray-500">sec</span>
            </p>
            <div className="w-full bg-gray-700 h-2 rounded-full mt-4 overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${absenceSecs > 30 ? 'bg-red-500' : absenceSecs > 10 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min((absenceSecs / 120) * 100, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
