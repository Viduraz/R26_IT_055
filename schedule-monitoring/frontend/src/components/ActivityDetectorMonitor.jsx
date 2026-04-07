// schedule-monitoring/frontend/src/components/ActivityDetectorMonitor.jsx
/**
 * Activity Detector Monitor Component
 * Runs webcam-based activity detection and logs detected activities to the backend
 */
import { useEffect, useRef, useState } from "react";
import { initializePoseDetection, stopPoseDetection, isPoseDetectionRunning } from "../services/activityDetection";
import { getSchedule, logDetectedActivity } from "../services/scheduleApi";

const DETECTION_DEBOUNCE = 2000; // Only log same activity every 2 seconds
const CONFIDENCE_THRESHOLD = 0.55; // Minimum confidence to log

export default function ActivityDetectorMonitor() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [currentActivity, setCurrentActivity] = useState(null);
  const [lastDetectedActivity, setLastDetectedActivity] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [debugInfo, setDebugInfo] = useState("");
  const [stats, setStats] = useState({ detected: 0, logged: 0 });
  const lastLogTimeRef = useRef({});

  useEffect(() => {
    fetchSchedule();
  }, []);

  const fetchSchedule = async () => {
    try {
      const res = await getSchedule();
      setSchedule(res.data || []);
    } catch (error) {
      console.error("Error fetching schedule:", error);
    }
  };

  const handleActivityDetected = async (detectionData) => {
    setCurrentActivity(detectionData);
    setStats((prev) => ({ ...prev, detected: prev.detected + 1 }));

    // Debounce: don't log same activity repeatedly
    const key = detectionData.activity_name;
    const now = Date.now();
    const lastTime = lastLogTimeRef.current[key] || 0;

    if (now - lastTime < DETECTION_DEBOUNCE) {
      return; // Skip logging
    }

    if (detectionData.confidence < CONFIDENCE_THRESHOLD) {
      return; // Confidence too low
    }

    // Check if this activity is in the schedule
    const scheduleActivities = schedule[0]?.activities || [];
    const inSchedule = scheduleActivities.some(
      (a) => a.activity_name.toLowerCase() === detectionData.activity_name.toLowerCase()
    );

    if (!inSchedule) {
      setDebugInfo(`Detected activity not in schedule: ${detectionData.activity_name}`);
      return;
    }

    // Log the activity to backend
    try {
      const scheduleId = schedule[0]?.schedule_id;
      if (!scheduleId) {
        setDebugInfo("No schedule ID available");
        return;
      }

      await logDetectedActivity(scheduleId, {
        activity_name: detectionData.activity_name,
        confidence: detectionData.confidence,
        detected_at: detectionData.detected_at.toISOString(),
        signals: detectionData.signals
      });

      lastLogTimeRef.current[key] = now;
      setLastDetectedActivity(detectionData);
      setStats((prev) => ({ ...prev, logged: prev.logged + 1 }));
      setDebugInfo(`✓ Logged: ${detectionData.activity_name} (${(detectionData.confidence * 100).toFixed(0)}%)`);
    } catch (error) {
      console.error("Error logging activity:", error);
      setDebugInfo(`✗ Failed to log: ${error.message}`);
    }
  };

  const startDetection = async () => {
    if (!videoRef.current) return;

    try {
      setDebugInfo("Initializing webcam...");
      await initializePoseDetection(videoRef.current, handleActivityDetected);
      setIsDetecting(true);
      setDebugInfo("✓ Webcam detection active");
    } catch (error) {
      console.error("Error starting detection:", error);
      setDebugInfo(`✗ Error: ${error.message}`);
    }
  };

  const stopDetection = async () => {
    try {
      await stopPoseDetection();
      setIsDetecting(false);
      setCurrentActivity(null);
      setDebugInfo("Detection stopped");
    } catch (error) {
      console.error("Error stopping detection:", error);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Webcam Activity Monitor</h2>
        <span
          className={`inline-block w-3 h-3 rounded-full ${
            isDetecting ? "bg-green-500 animate-pulse" : "bg-gray-600"
          }`}
        />
      </div>

      {/* Webcam Feed */}
      <div className="relative bg-black rounded-lg overflow-hidden mb-4" style={{ background: "#000", aspectRatio: "16/9" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "none"
          }}
        />

        {/* Status Overlay */}
        <div className="absolute top-4 left-4 bg-black/70 px-3 py-2 rounded font-mono text-xs text-green-400">
          {isDetecting ? "🟢 ACTIVE" : "⚫ INACTIVE"}
        </div>

        {/* Current Activity Display */}
        {currentActivity && (
          <div className="absolute bottom-4 right-4 bg-black/70 px-4 py-3 rounded text-sm">
            <p className="text-green-300 font-semibold">{currentActivity.activity_name}</p>
            <p className="text-gray-400 text-xs">
              Confidence: {(currentActivity.confidence * 100).toFixed(0)}%
            </p>
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex gap-3 mb-4">
        {!isDetecting ? (
          <button
            onClick={startDetection}
            className="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded font-semibold"
          >
            ▶ Start Detection
          </button>
        ) : (
          <button
            onClick={stopDetection}
            className="flex-1 bg-red-600 hover:bg-red-700 px-4 py-2 rounded font-semibold"
          >
            ⏹ Stop Detection
          </button>
        )}
        <button
          onClick={fetchSchedule}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded font-semibold"
        >
          ↻ Schedule
        </button>
      </div>

      {/* Debug Info & Stats */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Stats */}
        <div className="bg-gray-800 rounded p-3 border border-gray-700">
          <p className="text-xs text-gray-400 mb-1">Detections</p>
          <p className="text-2xl font-bold">{stats.detected}</p>
          <p className="text-xs text-gray-500">activities detected</p>
        </div>

        <div className="bg-gray-800 rounded p-3 border border-gray-700">
          <p className="text-xs text-gray-400 mb-1">Logged</p>
          <p className="text-2xl font-bold text-green-400">{stats.logged}</p>
          <p className="text-xs text-gray-500">activities logged</p>
        </div>
      </div>

      {/* Debug Log */}
      <div className="bg-gray-800 rounded p-3 border border-gray-700 font-mono text-xs text-gray-300 h-20 overflow-y-auto">
        <p className={debugInfo.includes("✓") ? "text-green-400" : debugInfo.includes("✗") ? "text-red-400" : ""}>
          {debugInfo || "Waiting for input..."}
        </p>
      </div>

      {/* Last Detected Activity */}
      {lastDetectedActivity && (
        <div className="mt-4 bg-blue-900/20 border border-blue-700 rounded p-3">
          <p className="text-sm text-blue-300">
            <strong>Last Logged:</strong> {lastDetectedActivity.activity_name} (
            {new Date(lastDetectedActivity.detected_at).toLocaleTimeString()})
          </p>
        </div>
      )}

      {/* Schedule Validation */}
      {schedule.length > 0 && (
        <div className="mt-4 bg-gray-800 rounded p-3 border border-gray-700 text-xs">
          <p className="text-gray-400 mb-2">
            <strong>Schedule registered:</strong> {schedule[0]?.description || "Default"}
          </p>
          <div className="flex gap-1 flex-wrap">
            {schedule[0]?.activities?.map((act, idx) => (
              <span key={idx} className="px-2 py-1 bg-gray-700 rounded text-gray-300">
                {act.activity_name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
