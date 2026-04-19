// schedule-monitoring/frontend/src/components/ActivityDetectorMonitor.jsx
/**
 * Activity Detector Monitor Component - Enhanced with Adaptive Threshold Validation
 * Runs webcam-based ML activity detection and validates against schedules with ML-learned grace periods
 */
import { useEffect, useRef, useState } from "react";
import { initializePoseDetection, stopPoseDetection } from "../services/activityDetection";
import { getSchedule, logDetectedActivity } from "../services/scheduleApi";

const DETECTION_DEBOUNCE = 2000;
const CONFIDENCE_THRESHOLD = 0.55;

// Status colors and icons based on adaptive threshold logic
const STATUS_DISPLAY = {
  "On Time": { color: "bg-green-900/20 border-green-700 text-green-300", icon: "✓", label: "On Time" },
  "Slightly Late": { color: "bg-yellow-900/20 border-yellow-700 text-yellow-300", icon: "⚠", label: "Slightly Late" },
  "Late": { color: "bg-red-900/20 border-red-700 text-red-300", icon: "✕", label: "Late" },
  "Unexpected": { color: "bg-gray-900/20 border-gray-700 text-gray-300", icon: "?", label: "Not Scheduled" }
};

export default function ActivityDetectorMonitor() {
  const videoRef = useRef(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [currentActivity, setCurrentActivity] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [detectionLogs, setDetectionLogs] = useState([]);
  const [debugInfo, setDebugInfo] = useState("");
  const [stats, setStats] = useState({ detected: 0, logged: 0, onTime: 0, late: 0 });
  const [liveFeatures, setLiveFeatures] = useState(null);
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
        setDebugInfo(`✓ Loaded schedule with ${schedules[0].activities.length} activities (using ML-based adaptive thresholds)`);
      } else {
        setSchedule(null);
        setDebugInfo("⚠️ No schedule found. Create one first!");
      }
    } catch (error) {
      console.error("Error fetching schedule:", error);
      setDebugInfo("✗ Failed to load schedule");
    }
  };

  const findScheduledActivity = (activityName) => {
    if (!schedule) return null;
    
    return schedule.activities.find(
      (act) => act.activity_name.toLowerCase() === activityName.toLowerCase()
    );
  };

  const handleActivityDetected = async (detectionData) => {
    setCurrentActivity(detectionData);
    setStats((prev) => ({ ...prev, detected: prev.detected + 1 }));

    // Display live features for debugging
    if (detectionData.features) {
      setLiveFeatures({
        hipHeight: detectionData.features[8]?.toFixed(3),
        bodyHeight: detectionData.features[5]?.toFixed(3),
        velocity: detectionData.features[6]?.toFixed(5),
        activity: detectionData.activity_name,
        confidence: (detectionData.confidence * 100).toFixed(0)
      });
    }

    const key = detectionData.activity_name;
    const now = Date.now();
    const lastTime = lastLogTimeRef.current[key] || 0;

    // Debounce detection
    if (now - lastTime < DETECTION_DEBOUNCE) return;
    if (detectionData.confidence < CONFIDENCE_THRESHOLD) return;
    if (!schedule) {
      setDebugInfo("⚠️ No schedule available");
      return;
    }

    const scheduledActivity = findScheduledActivity(detectionData.activity_name);
    const activityStatus = scheduledActivity ? "Scheduled" : "Unexpected";

    // Prepare log entry (backend will add adaptive details)
    const logEntry = {
      activity: detectionData.activity_name,
      confidence: (detectionData.confidence * 100).toFixed(0),
      status: activityStatus,
      time: new Date().toLocaleTimeString(),
      // Will be updated with response
      adaptive_grace_minutes: "...",
      delay_minutes: "...",
      deadline: "..."
    };

    try {
      // Send to backend for ML-based validation
      const response = await logDetectedActivity(schedule.schedule_id, {
        activity_name: detectionData.activity_name,
        confidence: detectionData.confidence,
        detected_at: detectionData.detected_at.toISOString(),
        signals: detectionData.signals
      });

      // Update log entry with adaptive response data
      const adaptiveData = response.data;
      logEntry.status = adaptiveData.status || activityStatus;
      logEntry.adaptive_grace_minutes = adaptiveData.adaptive_grace_minutes || "?";
      logEntry.delay_minutes = adaptiveData.delay_minutes || "?";
      logEntry.deadline = adaptiveData.deadline ? new Date(adaptiveData.deadline).toLocaleTimeString() : "?";
      logEntry.statusConfidence = adaptiveData.confidence || "--";

      // Update stats based on adaptive status
      setStats((prev) => {
        const updated = { ...prev, logged: prev.logged + 1 };
        if (adaptiveData.status === "On Time") updated.onTime++;
        else if (["Late", "Slightly Late"].includes(adaptiveData.status)) updated.late++;
        return updated;
      });

      setDetectionLogs((prev) => [logEntry, ...prev.slice(0, 9)]);
      lastLogTimeRef.current[key] = now;

      // Update debug info with adaptive details
      setDebugInfo(
        `✓ ${logEntry.activity} [${logEntry.status}] | Grace: ${logEntry.adaptive_grace_minutes}min | Delay: ${logEntry.delay_minutes}min`
      );
    } catch (error) {
      console.error("Error logging activity:", error);
      setDetectionLogs((prev) => [{ ...logEntry, status: "Error" }, ...prev.slice(0, 9)]);
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
      console.log("Starting pose detection with ML-based schedule validation:", schedule);
      await initializePoseDetection(videoRef.current, handleActivityDetected);
      setIsDetecting(true);
      setDebugInfo("✓ ML Activity detection active | Using adaptive thresholds per elder\n📷 Position yourself in front of the camera");
    } catch (error) {
      console.error("Error:", error);
      setDebugInfo(`✗ Error initializing detection: ${error.message}\n\nMake sure to allow camera permission!`);
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
          <h2 className="text-xl font-semibold">📷 ML Activity Detection (Phase 1: Adaptive Thresholds)</h2>
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
          <div className="absolute top-4 left-4 bg-black/70 px-3 py-2 rounded font-mono text-xs text-green-400">
            {isDetecting ? "🟢 DETECTING" : "⚫ INACTIVE"}
          </div>
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
              className="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded font-semibold transition"
            >
              ▶ Start Activity Detection
            </button>
          ) : (
            <button
              onClick={stopDetection}
              className="flex-1 bg-red-600 hover:bg-red-700 px-4 py-2 rounded font-semibold transition"
            >
              ⏹ Stop Detection
            </button>
          )}
          <button
            onClick={fetchSchedule}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded font-semibold transition"
          >
            ↻ Refresh Schedule
          </button>
        </div>

        {/* Debug Info */}
        <div className="mt-4 p-3 bg-gray-800 rounded text-sm text-gray-300 font-mono">
          {debugInfo || "Status: Ready"}
        </div>

        {/* Live Feature Debug Panel */}
        {isDetecting && liveFeatures && (
          <div className="mt-3 p-3 bg-gray-950 border border-purple-700/50 rounded text-xs text-purple-300">
            <p className="font-bold mb-2">🔍 ML Feature Values (Sleep Detection Thresholds - TEST MODE):</p>
            <div className="space-y-1 font-mono text-purple-200">
              <p>📍 Activity: <span className="text-cyan-300">{liveFeatures.activity}</span> | Conf: <span className="text-cyan-300">{liveFeatures.confidence}%</span></p>
              <p>📏 Hip Height: <span className={liveFeatures.hipHeight > 0.50 ? "text-green-400 font-bold" : "text-gray-400"}>{liveFeatures.hipHeight}</span> <span className="text-gray-500">(need &gt;0.50 for sleep)</span></p>
              <p>📐 Body Height: <span className={liveFeatures.bodyHeight < 0.50 ? "text-green-400 font-bold" : "text-gray-400"}>{liveFeatures.bodyHeight}</span> <span className="text-gray-500">(need &lt;0.50 for sleep)</span></p>
              <p>🏃 Velocity: <span className={liveFeatures.velocity < 0.012 ? "text-green-400 font-bold" : "text-gray-400"}>{liveFeatures.velocity}</span> <span className="text-gray-500">(need &lt;0.012 for sleep)</span></p>
              <p className="text-yellow-300 mt-2">⚠️ TEST MODE: Thresholds are relaxed for debugging. Will be tightened after calibration.</p>
              <p className="text-purple-400">✓ = Green means threshold is MET | Gray means NOT met</p>
            </div>
          </div>
        )}
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
                  <p className="text-gray-400 text-xs">{activity.start_time} - {activity.end_time}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 py-8">No schedule loaded</p>
          )}
        </div>

        {/* Detection Results with Adaptive Info */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h3 className="text-lg font-semibold mb-4 text-green-300">✓ Detection Log (Adaptive)</h3>
          
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            <div className="bg-blue-900/30 rounded p-2 text-center">
              <p className="text-xs text-gray-400">Detected</p>
              <p className="text-lg font-bold text-blue-300">{stats.detected}</p>
            </div>
            <div className="bg-green-900/30 rounded p-2 text-center">
              <p className="text-xs text-gray-400">On Time</p>
              <p className="text-lg font-bold text-green-300">{stats.onTime}</p>
            </div>
            <div className="bg-red-900/30 rounded p-2 text-center">
              <p className="text-xs text-gray-400">Late</p>
              <p className="text-lg font-bold text-red-300">{stats.late}</p>
            </div>
            <div className="bg-purple-900/30 rounded p-2 text-center">
              <p className="text-xs text-gray-400">Logged</p>
              <p className="text-lg font-bold text-purple-300">{stats.logged}</p>
            </div>
          </div>

          {/* Logs with Adaptive Details */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {detectionLogs.length === 0 ? (
              <p className="text-gray-400 text-center py-4">Waiting for activity detection...</p>
            ) : (
              detectionLogs.map((log, idx) => {
                const statusDisplay = STATUS_DISPLAY[log.status] || STATUS_DISPLAY.Unexpected;
                return (
                  <div
                    key={idx}
                    className={`p-2 rounded text-xs border space-y-1 ${statusDisplay.color}`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-semibold flex items-center gap-1">
                        <span className="text-lg">{statusDisplay.icon}</span>
                        {log.activity}
                      </span>
                      <span className="text-gray-400">{log.time}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs opacity-80">
                      <span>{log.confidence}%</span>
                      <span>Grace: {log.adaptive_grace_minutes}min</span>
                      <span>Delay: {log.delay_minutes}min</span>
                    </div>
                    {log.deadline !== "?" && (
                      <div className="text-xs opacity-75">
                        Deadline: {log.deadline}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-4 text-sm">
        <p className="text-blue-200">
          💡 <strong>Phase 1 Adaptive Thresholds:</strong> Each activity now has a personalized grace period learned from your past behavior. 
          You might get a 12-minute grace for breakfast if you're usually early, or 35 minutes if you're typically slower. 
          The system learns and adapts automatically!
        </p>
      </div>
    </div>
  );
}

