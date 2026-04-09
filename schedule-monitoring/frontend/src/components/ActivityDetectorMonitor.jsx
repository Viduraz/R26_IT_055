// schedule-monitoring/frontend/src/components/ActivityDetectorMonitor.jsx
/**
 * Activity Detector Monitor Component - Enhanced with Real-time Schedule Validation
 * Runs webcam-based ML activity detection and validates against schedule with 20-minute rule
 */
import { useEffect, useRef, useState } from "react";
import { initializePoseDetection, stopPoseDetection } from "../services/activityDetection";
import { getSchedule, logDetectedActivity } from "../services/scheduleApi";

const DETECTION_DEBOUNCE = 2000;
const CONFIDENCE_THRESHOLD = 0.55;

export default function ActivityDetectorMonitor() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [currentActivity, setCurrentActivity] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [detectionLogs, setDetectionLogs] = useState([]);
  const [debugInfo, setDebugInfo] = useState("");
  const [stats, setStats] = useState({ detected: 0, logged: 0, matched: 0 });
  const lastLogTimeRef = useRef({});

  useEffect(() => {
    fetchSchedule();
  }, []);

  const fetchSchedule = async () => {
    try {
      const res = await getSchedule();
      const schedules = res.data || [];
      if (schedules.length > 0) {
        setSchedule(schedules[0]);
        setDebugInfo(`✓ Loaded schedule with ${schedules[0].activities.length} activities`);
      } else {
        setSchedule(null);
        setDebugInfo("⚠️ No schedule found. Create one first!");
      }
    } catch (error) {
      console.error("Error fetching schedule:", error);
      setDebugInfo("✗ Failed to load schedule");
    }
  };

  const checkActivityInSchedule = (activityName, currentTime) => {
    if (!schedule) return null;

    const timeInMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    
    for (const scheduledActivity of schedule.activities) {
      if (scheduledActivity.activity_name.toLowerCase() === activityName.toLowerCase()) {
        const [startH, startM] = scheduledActivity.start_time.split(":").map(Number);
        const [endH, endM] = scheduledActivity.end_time.split(":").map(Number);
        const startTime = startH * 60 + startM;
        const endTime = endH * 60 + endM;

        // Handle overnight times (e.g., sleep 20:00 - 07:00)
        let isInWindow = false;
        if (startTime > endTime) {
          isInWindow = timeInMinutes >= startTime || timeInMinutes < endTime;
        } else {
          isInWindow = timeInMinutes >= startTime && timeInMinutes < endTime;
        }

        if (isInWindow) {
          return { status: "Done", start: scheduledActivity.start_time, end: scheduledActivity.end_time };
        } else if (timeInMinutes < startTime) {
          return { status: "Early", start: scheduledActivity.start_time, end: scheduledActivity.end_time };
        } else {
          return { status: "Late", start: scheduledActivity.start_time, end: scheduledActivity.end_time };
        }
      }
    }
    return { status: "Unexpected", start: "-", end: "-" };
  };

  const handleActivityDetected = async (detectionData) => {
    setCurrentActivity(detectionData);
    setStats((prev) => ({ ...prev, detected: prev.detected + 1 }));

    const key = detectionData.activity_name;
    const now = Date.now();
    const lastTime = lastLogTimeRef.current[key] || 0;

    if (now - lastTime < DETECTION_DEBOUNCE) return;
    if (detectionData.confidence < CONFIDENCE_THRESHOLD) return;
    if (!schedule) {
      setDebugInfo("⚠️ No schedule available");
      return;
    }

    const validation = checkActivityInSchedule(detectionData.activity_name, new Date());
    const isMatched = validation && validation.status !== "Unexpected";

    const logEntry = {
      activity: detectionData.activity_name,
      confidence: (detectionData.confidence * 100).toFixed(0),
      status: validation.status,
      time: new Date().toLocaleTimeString(),
      matched: isMatched
    };

    setDetectionLogs((prev) => [logEntry, ...prev.slice(0, 9)]);
    setStats((prev) => ({
      ...prev,
      logged: prev.logged + 1,
      matched: isMatched ? prev.matched + 1 : prev.matched
    }));

    try {
      await logDetectedActivity(schedule.schedule_id, {
        activity_name: detectionData.activity_name,
        confidence: detectionData.confidence,
        detected_at: detectionData.detected_at.toISOString(),
        signals: detectionData.signals
      });

      lastLogTimeRef.current[key] = now;
      setDebugInfo(
        `✓ ${logEntry.activity} [${logEntry.status}] ${isMatched ? "✓ Matched" : "✗ Not in schedule"}`
      );
    } catch (error) {
      console.error("Error logging activity:", error);
    }
  };

  const startDetection = async () => {
    if (!videoRef.current) return;
    if (!schedule) {
      setDebugInfo("⚠️ Please create a schedule first!");
      return;
    }

    try {
      setDebugInfo("🔄 Initializing MoveNet ML pose detection...");
      await initializePoseDetection(videoRef.current, handleActivityDetected);
      setIsDetecting(true);
      setDebugInfo("✓ ML Activity detection active - MoveNet pose detection running");
    } catch (error) {
      console.error("Error:", error);
      setDebugInfo(`✗ Error: ${error.message}`);
    }
  };

  const stopDetection = async () => {
    try {
      await stopPoseDetection();
      setIsDetecting(false);
      setCurrentActivity(null);
      setDebugInfo("⏹ Detection stopped");
    } catch (error) {
      console.error("Error:", error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Webcam Feed */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">📷 ML Activity Detection</h2>
          <span
            className={`inline-block w-3 h-3 rounded-full ${
              isDetecting ? "bg-green-500 animate-pulse" : "bg-gray-600"
            }`}
          />
        </div>

        {/* Webcam */}
        <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: "16/9" }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{ width: "100%", height: "100%", display: "block" }}
          />
          {/* Status */}
          <div className="absolute top-4 left-4 bg-black/70 px-3 py-2 rounded font-mono text-xs text-green-400">
            {isDetecting ? "🟢 DETECTING" : "⚫ INACTIVE"}
          </div>
          {/* Current Activity */}
          {currentActivity && (
            <div className="absolute bottom-4 right-4 bg-black/70 px-4 py-3 rounded">
              <p className="text-green-300 font-semibold">{currentActivity.activity_name}</p>
              <p className="text-xs text-gray-400">Confidence: {(currentActivity.confidence * 100).toFixed(0)}%</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-3 mt-4">
          {!isDetecting ? (
            <button
              onClick={startDetection}
              className="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded font-semibold"
            >
              ▶ Start Activity Detection
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
            ↻ Refresh Schedule
          </button>
        </div>

        {/* Debug Info */}
        <div className="mt-4 p-3 bg-gray-800 rounded text-sm text-gray-300 font-mono">
          {debugInfo || "Status: Ready"}
        </div>
      </div>

      {/* Schedule and Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Schedule */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h3 className="text-lg font-semibold mb-4 text-blue-300">📅 Today's Schedule</h3>
          {schedule ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {schedule.activities.map((activity, idx) => (
                <div key={idx} className="bg-gray-800 rounded p-3 border border-gray-700 text-sm">
                  <p className="font-semibold text-white">{activity.activity_name}</p>
                  <p className="text-gray-400">{activity.start_time} - {activity.end_time}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 py-8">No schedule loaded</p>
          )}
        </div>

        {/* Detection Results */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h3 className="text-lg font-semibold mb-4 text-green-300">✓ Detection Log</h3>
          
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-blue-900/30 rounded p-2 text-center">
              <p className="text-xs text-gray-400">Detected</p>
              <p className="text-lg font-bold text-blue-300">{stats.detected}</p>
            </div>
            <div className="bg-green-900/30 rounded p-2 text-center">
              <p className="text-xs text-gray-400">Matched</p>
              <p className="text-lg font-bold text-green-300">{stats.matched}</p>
            </div>
            <div className="bg-purple-900/30 rounded p-2 text-center">
              <p className="text-xs text-gray-400">Logged</p>
              <p className="text-lg font-bold text-purple-300">{stats.logged}</p>
            </div>
          </div>

          {/* Logs */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {detectionLogs.length === 0 ? (
              <p className="text-gray-400 text-center py-4">Waiting for activity detection...</p>
            ) : (
              detectionLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={`p-2 rounded text-xs border ${
                    log.matched
                      ? "bg-green-900/20 border-green-700 text-green-300"
                      : "bg-red-900/20 border-red-700 text-red-300"
                  }`}
                >
                  <div className="flex justify-between">
                    <span className="font-semibold">{log.activity}</span>
                    <span className="text-gray-400">{log.time}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span>{log.confidence}% confidence</span>
                    <span className={log.matched ? "text-green-400" : "text-red-400"}>
                      [{log.status}]
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-4 text-sm">
        <p className="text-blue-200">
          💡 <strong>How it works:</strong> Perform activities in front of the camera. The ML model detects your pose and 
          automatically checks against your schedule. Use activities: <strong>Wake up, Eating, Walking, Sitting / rest, Sleep</strong>
        </p>
      </div>
    </div>
  );
}
