// schedule-monitoring/frontend/src/components/ActivityDetectorMonitor.jsx
/**
 * Activity Detector Monitor Component
 * v3: wristIsElevated guard, simplified eating detection, 3s confirmation
 * v4: 1-SECOND confirmation (was 3s) — applies to ALL activities
 * v4: added green "confirmed" indicators for Sitting/Resting, Standing,
 *     Sleeping, Walking, Drinking, and Taking Medications, plus fixed
 *     inactive-badge tint (solid gray instead of translucent black, which
 *     picked up color from the video behind it)
 */
import { useEffect, useRef, useState } from "react";
import { initializePoseDetection, stopPoseDetection } from "../services/activityDetection";
import { getSchedule, logDetectedActivity } from "../services/scheduleApi";

const DETECTION_DEBOUNCE = 2000;
const CONFIDENCE_THRESHOLD = 0.50;

const STATUS_DISPLAY = {
  "Completed":    { color: "bg-green-900/20 border-green-700 text-green-300",   icon: "✓", label: "Completed" },
  "Early":        { color: "bg-cyan-900/20 border-cyan-700 text-cyan-300",      icon: "🕒", label: "Early" },
  "Late":         { color: "bg-red-900/20 border-red-700 text-red-300",         icon: "✕", label: "Late" },
  "Missed":       { color: "bg-rose-900/20 border-rose-700 text-rose-300",      icon: "⚠", label: "Missed" },
  "Not Done":     { color: "bg-orange-900/20 border-orange-700 text-orange-300",icon: "⚠", label: "Not Done" },
  "Unexpected":   { color: "bg-gray-900/20 border-gray-700 text-gray-300",      icon: "?", label: "Not Scheduled" },
};

export default function ActivityDetectorMonitor({ onActivityConfirmed }) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const expectedActivityRef = useRef(null);

  const [isDetecting,     setIsDetecting]     = useState(false);
  const [isLoading,       setIsLoading]       = useState(false);
  const [currentExpected, setCurrentExpected] = useState("Walking");
  const [isAligned,       setIsAligned]       = useState(false);
  const [currentActivity, setCurrentActivity] = useState(null);
  const [schedule,        setSchedule]        = useState(null);
  const [detectionLogs,   setDetectionLogs]   = useState([]);
  const [debugInfo,       setDebugInfo]       = useState("");
  const [liveFeatures,    setLiveFeatures]    = useState(null);
  const [stats, setStats] = useState({ detected: 0, logged: 0, completed: 0, late: 0, missed: 0 });
  const [confirmedActivity, setConfirmedActivity] = useState(null);

  const lastLogTimeRef = useRef({});

  // ── 1-second activity confirmation (was 3s) — applies to ALL activities ────
  const activityConfirmationRef = useRef({
    activityName:        null,
    startTime:           null,
    timeoutId:           null,
    confirmedActivities: {},
  });

  // ── Sync expected activity ref ─────────────────────────────────────────────
  useEffect(() => {
    expectedActivityRef.current = currentExpected;
  }, [currentExpected]);

  // ── Fetch schedule on mount ────────────────────────────────────────────────
  useEffect(() => {
    fetchSchedule();
  }, []);

  // ── Update expected activity from schedule every minute ───────────────────
  useEffect(() => {
    if (!schedule) return;
    const updateExpected = () => {
      const now         = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      let active        = schedule.activities[0]?.activity_name || "Walking";
      for (const act of schedule.activities) {
        const [startH, startM] = act.start_time.split(":").map(Number);
        const [endH,   endM  ] = act.end_time.split(":").map(Number);
        const start = startH * 60 + startM;
        const end   = endH   * 60 + endM;
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

  // ── Cleanup confirmation timer on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      if (activityConfirmationRef.current.timeoutId) {
        clearTimeout(activityConfirmationRef.current.timeoutId);
      }
    };
  }, []);

  // ── Fetch schedule ─────────────────────────────────────────────────────────
  const fetchSchedule = async () => {
    try {
      const res       = await getSchedule();
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

  const findScheduledActivity = (activityName) => {
    if (!schedule) return null;
    return schedule.activities.find(
      (act) => act.activity_name.toLowerCase() === activityName.toLowerCase()
    );
  };

  // ── 1-second confirmation logic (was 3000ms) ───────────────────────────────
  const confirmActivityForLogging = (detectionData) => {
    const confirmation     = activityConfirmationRef.current;
    const now              = Date.now();
    const CONFIRMATION_TIME = 1000; // was 3000 — every activity confirms after ~1s of stability

    if (confirmation.activityName !== detectionData.activity_name) {
      if (confirmation.timeoutId) clearTimeout(confirmation.timeoutId);
      confirmation.activityName = detectionData.activity_name;
      confirmation.startTime    = now;
      confirmation.timeoutId    = setTimeout(() => {
        confirmation.confirmedActivities[detectionData.activity_name] = true;
        confirmation.timeoutId = null;
      }, CONFIRMATION_TIME);
      return false;
    }

    const elapsedTime  = now - confirmation.startTime;
    const isConfirmed  = confirmation.confirmedActivities[detectionData.activity_name] === true;

    if (elapsedTime >= CONFIRMATION_TIME && !isConfirmed) {
      confirmation.confirmedActivities[detectionData.activity_name] = true;
      return true;
    }
    return isConfirmed;
  };

  // ── Handle detection callback ──────────────────────────────────────────────
  const handleActivityDetected = async (detectionData) => {
    if (detectionData.activity_name === "Movement") {
      setCurrentActivity(null);
    } else {
      setCurrentActivity(detectionData);
    }
    setStats((prev) => ({ ...prev, detected: prev.detected + 1 }));

    if (detectionData.features) {
      setLiveFeatures({
        handToMouth:  detectionData.features[7]?.toFixed(3),
        velocity:     detectionData.features[8]?.toFixed(5),
        wristHeight:  detectionData.features[11]?.toFixed(3),
        hipHeight:    detectionData.features[10]?.toFixed(3),
        torsoAlign:   detectionData.features[14]?.toFixed(2),
        activity:     detectionData.activity_name,
        confidence:   (detectionData.confidence * 100).toFixed(0),
      });
    }

    const isActivityConfirmed = confirmActivityForLogging(detectionData);
    if (!isActivityConfirmed) return;

    const key      = detectionData.activity_name;
    const now      = Date.now();
    const lastTime = lastLogTimeRef.current[key] || 0;
    if (now - lastTime < DETECTION_DEBOUNCE) return;

    if (detectionData.confidence < CONFIDENCE_THRESHOLD) return;

    if (detectionData.activity_name === "Movement") return;

    let activityStatus = "Unexpected";
    if (schedule) {
      const scheduledActivity = findScheduledActivity(detectionData.activity_name);
      activityStatus = scheduledActivity ? "Scheduled" : "Unexpected";
    }

    const logEntry = {
      activity:               detectionData.activity_name,
      confidence:             (detectionData.confidence * 100).toFixed(0),
      status:                 activityStatus,
      time:                   new Date().toLocaleTimeString(),
      adaptive_grace_minutes: "...",
      delay_minutes:          "...",
      deadline:               "...",
    };

    try {
      if (schedule) {
        const response = await logDetectedActivity(schedule.schedule_id, {
          activity_name: detectionData.activity_name,
          confidence:    detectionData.confidence,
          detected_at:   detectionData.detected_at.toISOString(),
          signals:       detectionData.signals,
        });

        const adaptiveData = response.data;
        logEntry.status                 = adaptiveData.status                 || activityStatus;
        logEntry.adaptive_grace_minutes = adaptiveData.adaptive_grace_minutes || "?";
        logEntry.delay_minutes          = adaptiveData.delay_minutes          || "?";
        logEntry.deadline               = adaptiveData.deadline
          ? new Date(adaptiveData.deadline).toLocaleTimeString()
          : "?";

        setStats((prev) => {
          const updated = { ...prev, logged: prev.logged + 1 };
          if (adaptiveData.status === "Completed" || adaptiveData.status === "Early" || adaptiveData.status === "Late") {
            updated.completed++;
          }
          if (adaptiveData.status === "Late") updated.late++;
          if (adaptiveData.status === "Missed") updated.missed++;
          return updated;
        });
      } else {
        logEntry.status                 = "Unexpected (No Schedule)";
        logEntry.adaptive_grace_minutes = "N/A";
        logEntry.delay_minutes          = "N/A";
        logEntry.deadline               = "N/A";
        setStats((prev) => ({ ...prev, logged: prev.logged + 1 }));
      }

      setDetectionLogs((prev) => [logEntry, ...prev.slice(0, 9)]);
      lastLogTimeRef.current[key] = now;
      setDebugInfo(
        `✓ ${logEntry.activity} [${logEntry.status}] | Grace: ${logEntry.adaptive_grace_minutes}min | Delay: ${logEntry.delay_minutes}min`
      );

      // Set confirmed activity for visual indicator
      setConfirmedActivity({
        name: detectionData.activity_name,
        status: logEntry.status,
        confidence: detectionData.confidence,
        time: new Date().toLocaleTimeString(),
      });

      // Notify parent (ScheduleDashboard) to immediately re-fetch data
      if (onActivityConfirmed) {
        onActivityConfirmed();
      }
    } catch (error) {
      console.error("Error logging activity:", error);
      setDetectionLogs((prev) => [{ ...logEntry, status: "Error" }, ...prev.slice(0, 9)]);
    }
  };

  // ── Start detection ────────────────────────────────────────────────────────
  const startDetection = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    if (isLoading) return;
    if (!schedule) setDebugInfo("⚠️ No schedule — detection will run in test mode!");

    try {
      setIsLoading(true);
      setDebugInfo("🔄 Initializing MoveNet ML pose detection...");
      await initializePoseDetection(
        videoRef.current,
        canvasRef.current,
        expectedActivityRef,
        handleActivityDetected,
        (aligned) => setIsAligned(aligned)
      );
      setIsDetecting(true);
      setDebugInfo("✓ Activity detection active\n📷 Position yourself in front of the camera");
    } catch (error) {
      console.error("Error:", error);
      setDebugInfo(`✗ Error initializing: ${error.message}\n\nAllow camera permission!`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Stop detection ─────────────────────────────────────────────────────────
  const stopDetection = async () => {
    try {
      if (activityConfirmationRef.current.timeoutId) {
        clearTimeout(activityConfirmationRef.current.timeoutId);
        activityConfirmationRef.current.timeoutId = null;
      }
      activityConfirmationRef.current.activityName        = null;
      activityConfirmationRef.current.startTime           = null;
      activityConfirmationRef.current.confirmedActivities = {};

      await stopPoseDetection();
      setIsDetecting(false);
      setCurrentActivity(null);
      setIsAligned(false);
      setLiveFeatures(null);
      setDebugInfo("⏹ Detection stopped");
    } catch (error) {
      console.error("Error:", error);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Webcam Feed ── */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">📷 ML Activity Detection (Adaptive Thresholds)</h2>
          <span className={`inline-block w-3 h-3 rounded-full ${isDetecting ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
        </div>

        {/* Webcam */}
        <div
          className="relative bg-black rounded-lg overflow-hidden border border-gray-800 shadow-2xl"
          style={{ aspectRatio: "16/9" }}
        >
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

          {/* Status badge */}
          <div className="absolute top-4 left-4 bg-black/70 px-3 py-2 rounded font-mono text-xs text-green-400 backdrop-blur-sm border border-green-500/20">
            {isDetecting ? "🟢 DETECTING" : "⚫ INACTIVE"}
          </div>

          {/* Live signal indicators — left side */}
          {isDetecting && liveFeatures && (
            <div className="absolute top-20 left-4 flex flex-col gap-2 pointer-events-none">
              {/* HAND NEAR FACE */}
              <div className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2
                ${parseFloat(liveFeatures.handToMouth) < 0.35
                  ? "bg-green-500/20 border-green-500 text-green-400"
                  : "bg-gray-900 border-gray-700 text-gray-500"}`}>
                <span className="text-xs">🍽️</span> HAND NEAR FACE
              </div>

              {/* BODY STILL */}
              <div className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2
                ${parseFloat(liveFeatures.velocity) < 0.03
                  ? "bg-green-500/20 border-green-500 text-green-400"
                  : "bg-gray-900 border-gray-700 text-gray-500"}`}>
                <span className="text-xs">🛑</span> BODY STILL
              </div>

              {/* LYING DOWN */}
              <div className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2
                ${parseFloat(liveFeatures.torsoAlign) > 1.1
                  ? "bg-green-500/20 border-green-500 text-green-400"
                  : "bg-gray-900 border-gray-700 text-gray-500"}`}>
                <span className="text-xs">🛏️</span> LYING DOWN
              </div>

              {/* SITTING / RESTING — confirmed-activity indicator (green light) */}
              <div className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2
                ${currentActivity?.activity_name === "Sitting / rest"
                  ? "bg-green-500/20 border-green-500 text-green-400"
                  : "bg-gray-900 border-gray-700 text-gray-500"}`}>
                <span className="text-xs">🪑</span> SITTING / RESTING
              </div>

              {/* STANDING — confirmed-activity indicator */}
              <div className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2
                ${currentActivity?.activity_name === "Standing"
                  ? "bg-green-500/20 border-green-500 text-green-400"
                  : "bg-gray-900 border-gray-700 text-gray-500"}`}>
                <span className="text-xs">🧍</span> STANDING
              </div>

              {/* SLEEPING — confirmed-activity indicator */}
              <div className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2
                ${currentActivity?.activity_name === "Sleeping"
                  ? "bg-green-500/20 border-green-500 text-green-400"
                  : "bg-gray-900 border-gray-700 text-gray-500"}`}>
                <span className="text-xs">😴</span> SLEEPING
              </div>

              {/* WALKING — confirmed-activity indicator */}
              <div className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2
                ${currentActivity?.activity_name === "Walking"
                  ? "bg-green-500/20 border-green-500 text-green-400"
                  : "bg-gray-900 border-gray-700 text-gray-500"}`}>
                <span className="text-xs">🚶</span> WALKING
              </div>

              {/* DRINKING — confirmed-activity indicator */}
              <div className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2
                ${currentActivity?.activity_name === "Drinking"
                  ? "bg-green-500/20 border-green-500 text-green-400"
                  : "bg-gray-900 border-gray-700 text-gray-500"}`}>
                <span className="text-xs">🥤</span> DRINKING
              </div>

              {/* TAKING MEDICATIONS — confirmed-activity indicator */}
              <div className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2
                ${currentActivity?.activity_name === "Taking Medications"
                  ? "bg-green-500/20 border-green-500 text-green-400"
                  : "bg-gray-900 border-gray-700 text-gray-500"}`}>
                <span className="text-xs">💊</span> TAKING MEDICATIONS
              </div>
            </div>
          )}

          {/* Detected activity — right side */}
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
                />
              </div>
              <p className="text-[10px] text-gray-500 mt-1 text-right font-mono">
                {(currentActivity.confidence * 100).toFixed(0)}% CONFIDENCE
              </p>
            </div>
          )}
        </div>

        {/* Confirmed Activity Indicator */}
        {confirmedActivity && (
          <div className="mt-4 p-4 rounded-xl border border-green-500/30 bg-green-900/10 backdrop-blur-sm animate-slide-up">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center animate-pulse">
                  <span className="text-green-400 text-lg font-bold">✓</span>
                </div>
                <div>
                  <p className="text-green-400 font-bold text-sm">Activity Confirmed (1s stable)</p>
                  <p className="text-white text-base font-semibold">{confirmedActivity.name}</p>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-xs font-bold px-3 py-1 rounded-full border ${
                  confirmedActivity.status === 'Completed' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                  confirmedActivity.status === 'Early' ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' :
                  confirmedActivity.status === 'Late' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                  confirmedActivity.status === 'Missed' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' :
                  'text-blue-400 bg-blue-500/10 border-blue-500/20'
                }`}>
                  {confirmedActivity.status}
                </div>
                <p className="text-gray-500 text-[10px] mt-1 font-mono">{confirmedActivity.time}</p>
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-3 mt-4">
          {!isDetecting ? (
            <button
              onClick={startDetection}
              disabled={isLoading}
              className={`flex-1 ${isLoading ? "bg-gray-600 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"} px-4 py-2 rounded font-semibold transition`}
            >
              {isLoading ? "⏳ Loading Models..." : "▶ Start Activity Detection"}
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

        {/* Debug info */}
        <div className="mt-4 p-3 bg-gray-800 rounded text-sm text-gray-300 font-mono whitespace-pre-line">
          {debugInfo || "Status: Ready"}
        </div>
      </div>

      {/* ── Detection Log ── */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold mb-4 text-green-300">✓ Detection Log (Adaptive)</h3>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className="bg-blue-900/30 rounded p-2 text-center">
            <p className="text-xs text-gray-400">Detected</p>
            <p className="text-lg font-bold text-blue-300">{stats.detected}</p>
          </div>
          <div className="bg-green-900/30 rounded p-2 text-center">
            <p className="text-xs text-gray-400">Completed</p>
            <p className="text-lg font-bold text-green-300">{stats.completed}</p>
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

        {/* Log entries */}
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
                    <div className="text-xs opacity-75">Deadline: {log.deadline}</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Info box ── */}
      <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-4 text-sm">
        <p className="text-blue-200">
          💡 <strong>v4:</strong> Activities confirm after ~1 second of stable detection (was 3s),
          feeding straight into schedule status marking (Completed / Early / Late / Missed).
          Sitting/Resting, Standing, Sleeping, Walking, Drinking, and Taking Medications each
          light up green the moment they're the confirmed activity.
        </p>
      </div>

    </div>
  );
}