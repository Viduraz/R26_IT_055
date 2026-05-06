// schedule-monitoring/frontend/src/components/ActivityDetectorMonitor.jsx
/**
 * Activity Detector Monitor Component - Enhanced with Adaptive Threshold Validation
 * Runs webcam-based ML activity detection and validates against schedules with ML-learned grace periods
 */
import { useEffect, useRef, useState } from "react";
import { initializePoseDetection, stopPoseDetection } from "../services/activityDetection";
import { getSchedule, logDetectedActivity } from "../services/scheduleApi";

const DETECTION_DEBOUNCE = 2000;
const CONFIDENCE_THRESHOLD = 0.50;

// Status colors and icons based on adaptive threshold logic
const STATUS_DISPLAY = {
  "Done": { color: "bg-green-900/20 border-green-700 text-green-300", icon: "✓", label: "Done" },
  "Early": { color: "bg-cyan-900/20 border-cyan-700 text-cyan-300", icon: "🕒", label: "Early" },
  "Slightly Late": { color: "bg-yellow-900/20 border-yellow-700 text-yellow-300", icon: "⚠", label: "Slightly Late" },
  "Late": { color: "bg-red-900/20 border-red-700 text-red-300", icon: "✕", label: "Late" },
  "Unexpected": { color: "bg-gray-900/20 border-gray-700 text-gray-300", icon: "?", label: "Not Scheduled" }
};

const GhostOutline = ({ expectedActivity, isAligned }) => {
  const color = "#4ade80"; // Ghost outline is always green, live skeleton changes color
  const dropShadow = isAligned ? "drop-shadow-[0_0_15px_rgba(74,222,128,0.8)]" : "drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]";

  if (expectedActivity?.toLowerCase() === "sleep") {
    // Horizontal skeleton
    return (
      <svg width="450" height="250" viewBox="0 0 200 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`animate-pulse-slow ${dropShadow}`}>
        {/* Head */}
        <circle cx="170" cy="50" r="12" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Torso */}
        <rect x="90" y="40" width="65" height="20" rx="8" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Arms */}
        <path d="M150 40 C140 25, 120 25, 110 40" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Legs */}
        <path d="M90 50 C60 50, 40 50, 20 50" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        <path d="M90 60 C60 60, 40 60, 20 60" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
      </svg>
    );
  } else if (expectedActivity?.toLowerCase().includes("sit") || expectedActivity?.toLowerCase().includes("eat")) {
    // Seated skeleton
    return (
      <svg width="250" height="350" viewBox="0 0 100 150" fill="none" xmlns="http://www.w3.org/2000/svg" className={`animate-pulse-slow ${dropShadow}`}>
        {/* Head */}
        <circle cx="50" cy="30" r="12" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Torso */}
        <rect x="40" y="45" width="20" height="50" rx="8" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Arm */}
        <path d="M45 55 C30 60, 20 75, 40 80" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Leg bent */}
        <path d="M50 95 C65 95, 80 95, 85 130" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
      </svg>
    );
  } else if (expectedActivity?.toLowerCase().includes("drink")) {
    // Seated skeleton — arm raised high (cup-to-lips gesture)
    return (
      <svg width="250" height="350" viewBox="0 0 100 150" fill="none" xmlns="http://www.w3.org/2000/svg" className={`animate-pulse-slow ${dropShadow}`}>
        {/* Head */}
        <circle cx="50" cy="30" r="12" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Torso */}
        <rect x="40" y="45" width="20" height="50" rx="8" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Right arm raised high — elbow above shoulder, wrist near mouth */}
        <path d="M58 50 C72 38, 72 28, 56 24" stroke={color} strokeWidth="2.5" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Left arm resting */}
        <path d="M42 55 C32 65, 28 78, 32 90" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Legs bent — seated */}
        <path d="M47 95 C42 110, 35 115, 28 115" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        <path d="M53 95 C58 110, 65 115, 72 115" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Cup icon hint */}
        <rect x="52" y="18" width="8" height="10" rx="2" stroke={color} strokeWidth="1.5" strokeDasharray="2 2" opacity="0.6" />
      </svg>
    );
  } else if (expectedActivity?.toLowerCase().includes("talk")) {
    // Standing/seated skeleton — hand gesturing near chin/face
    return (
      <svg width="250" height="420" viewBox="0 0 100 180" fill="none" xmlns="http://www.w3.org/2000/svg" className={`animate-pulse-slow ${dropShadow}`}>
        {/* Head */}
        <circle cx="50" cy="22" r="13" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Torso */}
        <rect x="36" y="38" width="28" height="55" rx="10" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Right arm — bent at elbow, hand near chin (talking gesture) */}
        <path d="M62 45 C74 48, 76 56, 60 60" stroke={color} strokeWidth="2.5" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Left arm relaxed */}
        <path d="M38 45 C26 52, 20 70, 24 85" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Legs */}
        <path d="M42 93 C38 120, 35 148, 38 165" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        <path d="M58 93 C62 120, 65 148, 62 165" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Speech indicator */}
        <path d="M62 30 Q72 25 72 32 Q72 39 62 36" stroke={color} strokeWidth="1.5" strokeDasharray="2 2" fill="none" opacity="0.6" />
        <circle cx="66" cy="36" r="1.5" fill={color} opacity="0.5" />
      </svg>
    );
  } else {
    // Standing skeleton (Walking, Standing up)
    return (
      <svg width="250" height="450" viewBox="0 0 100 200" fill="none" xmlns="http://www.w3.org/2000/svg" className={`animate-pulse-slow ${dropShadow}`}>
        {/* Head */}
        <circle cx="50" cy="25" r="15" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Torso */}
        <rect x="35" y="45" width="30" height="65" rx="10" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {/* Left Arm */}
        <path d="M30 55 C20 60, 10 90, 15 110" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Right Arm */}
        <path d="M70 55 C80 60, 90 90, 85 110" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Left Leg */}
        <path d="M40 110 C35 140, 30 170, 35 190" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        {/* Right Leg */}
        <path d="M60 110 C65 140, 70 170, 65 190" stroke={color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
      </svg>
    );
  }
};

export default function ActivityDetectorMonitor() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const expectedActivityRef = useRef(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [currentExpected, setCurrentExpected] = useState("Walking");
  const [demoOverride, setDemoOverride] = useState(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isAligned, setIsAligned] = useState(false);
  const [currentActivity, setCurrentActivity] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [detectionLogs, setDetectionLogs] = useState([]);
  const [debugInfo, setDebugInfo] = useState("");
  const [stats, setStats] = useState({ detected: 0, logged: 0, onTime: 0, late: 0 });
  const [liveFeatures, setLiveFeatures] = useState(null);
  const lastLogTimeRef = useRef({});

  const activeExpected = demoOverride || currentExpected;

  useEffect(() => {
    expectedActivityRef.current = activeExpected;
  }, [activeExpected]);

  useEffect(() => {
    fetchSchedule();
  }, []);

  useEffect(() => {
    if (!schedule) return;
    const updateExpected = () => {
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      let active = schedule.activities[0]?.activity_name || "Walking";
      for (const act of schedule.activities) {
        const [startH, startM] = act.start_time.split(':').map(Number);
        const [endH, endM] = act.end_time.split(':').map(Number);
        const start = startH * 60 + startM;
        const end = endH * 60 + endM;
        if (currentTime >= start && currentTime <= end) {
          active = act.activity_name;
          break;
        }
      }
      setCurrentExpected(active);
    };
    updateExpected();
    const interval = setInterval(updateExpected, 60000);
    return () => clearInterval(interval);
  }, [schedule]);

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
    if (detectionData.activity_name === "Movement") {
      setCurrentActivity(null); // Hide the purple popup entirely for generic movement
    } else {
      setCurrentActivity(detectionData);
    }
    setStats((prev) => ({ ...prev, detected: prev.detected + 1 }));

    // Display live features for debugging
    if (detectionData.features) {
      setLiveFeatures({
        hipHeight: detectionData.features[10]?.toFixed(3),
        bodyHeight: detectionData.features[5]?.toFixed(3),
        velocity: detectionData.features[8]?.toFixed(5),
        h2m: detectionData.features[7]?.toFixed(3),
        torsoAlignment: detectionData.features[14]?.toFixed(2),
        activity: detectionData.activity_name,
        confidence: (detectionData.confidence * 100).toFixed(0),
        source: detectionData.signals?.source || 'unknown'
      });
    }

    const key = detectionData.activity_name;
    const now = Date.now();
    const lastTime = lastLogTimeRef.current[key] || 0;

    // Debounce detection
    if (now - lastTime < DETECTION_DEBOUNCE) return;
    if (detectionData.confidence < CONFIDENCE_THRESHOLD) return;
    
    // Ignore generic "Movement" to prevent flooding the logs and backend
    if (detectionData.activity_name === "Movement") return;
    let activityStatus = "Unexpected";
    if (schedule) {
      const scheduledActivity = findScheduledActivity(detectionData.activity_name);
      activityStatus = scheduledActivity ? "Scheduled" : "Unexpected";
    }

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
      if (schedule) {
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
      } else {
        logEntry.status = "Unexpected (No Schedule)";
        logEntry.adaptive_grace_minutes = "N/A";
        logEntry.delay_minutes = "N/A";
        logEntry.deadline = "N/A";

        setStats((prev) => ({ ...prev, logged: prev.logged + 1 }));
      }

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
    if (!videoRef.current || !canvasRef.current || isInitializing) return;
    if (!schedule) {
      setDebugInfo("⚠️ No schedule available, but detection will run in test mode!");
    }

    try {
      setIsInitializing(true);
      setDebugInfo("🔄 Initializing MoveNet ML pose detection...");
      console.log("Starting pose detection with ML-based schedule validation:", schedule);
      await initializePoseDetection(
        videoRef.current,
        canvasRef.current,
        expectedActivityRef,
        handleActivityDetected,
        (aligned) => setIsAligned(aligned)
      );
      setIsDetecting(true);
      setDebugInfo("✓ ML Activity detection active | Using adaptive thresholds per elder\n📷 Position yourself in front of the camera");
    } catch (error) {
      console.error("Error:", error);
      setDebugInfo(`✗ Error initializing detection: ${error.message}\n\nMake sure to allow camera permission!`);
    } finally {
      setIsInitializing(false);
    }
  };

  const stopDetection = async () => {
    try {
      await stopPoseDetection();
      setIsDetecting(false);
      setCurrentActivity(null);
      setIsAligned(false);
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
            className={`inline-block w-3 h-3 rounded-full ${isDetecting ? "bg-green-500 animate-pulse" : "bg-gray-600"
              }`}
          />
        </div>

        {/* Webcam */}
        <div className="relative bg-black rounded-lg overflow-hidden border border-gray-800 shadow-2xl" style={{ aspectRatio: "16/9" }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none w-full h-full object-cover"
          />
          <div className="absolute top-4 left-4 bg-black/70 px-3 py-2 rounded font-mono text-xs text-green-400 backdrop-blur-sm border border-green-500/20">
            {isDetecting ? "🟢 DETECTING" : "⚫ INACTIVE"}
          </div>



          {/* Visual Signals Overlay (Left Side) removed as requested */}



          {/* Detected Activity (Right Side) */}
          {currentActivity && (
            <div className="absolute top-20 right-4 bg-black/80 px-4 py-3 rounded-lg border border-purple-500/30 backdrop-blur-md w-48 shadow-xl">
              <p className="text-gray-400 text-[10px] uppercase tracking-widest mb-1">Detected Activity</p>
              <p className="text-purple-400 font-bold text-base leading-none tracking-tight">
                {currentActivity.activity_name}
              </p>
              <div className="w-full bg-gray-800 h-1 mt-3 rounded-full overflow-hidden">
                <div
                  className="bg-purple-500 h-full transition-all duration-300 shadow-[0_0_8px_rgba(168,85,247,0.5)]"
                  style={{ width: `${(currentActivity.confidence * 100).toFixed(0)}%` }}
                ></div>
              </div>
              <p className="text-[10px] text-gray-500 mt-1 text-right font-mono">
                {(currentActivity.confidence * 100).toFixed(0)}% CONFIDENCE
              </p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-3 mt-4">
          {!isDetecting ? (
            <button
              onClick={startDetection}
              disabled={isInitializing}
              className={`flex-1 px-4 py-2 rounded font-semibold transition ${
                isInitializing ? "bg-green-800 text-gray-300 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {isInitializing ? "⏳ Initializing ML Models..." : "▶ Start Activity Detection"}
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


      </div>

      {/* Schedule and Logs */}
      <div className="grid grid-cols-1 gap-6">


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

