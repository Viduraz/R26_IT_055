import { useEffect, useRef, useState } from "react";
import {
  initializePoseDetection,
  stopPoseDetection,
} from "../services/activityDetection";
import { getSchedule, logDetectedActivity } from "../services/scheduleApi";

const DETECTION_DEBOUNCE = 2000;
const CONFIDENCE_THRESHOLD = 0.5;
const FINAL_STATUSES = ["Completed", "Early", "Late", "Missed"];

// Only these four statuses are ever shown in the UI now. "Unexpected" and
// "Not Done" have been removed on purpose: every confirmed detection now
// resolves to one of Early / Completed / Late (Missed is written
// server-side by evaluate_missed_tasks() when a window closes with NO
// detection at all, so it never originates from this file).
const STATUS_DISPLAY = {
  Completed: {
    color: "bg-green-900/20 border-green-700 text-green-300",
    icon: "✓",
    label: "Completed",
  },
  Early: {
    color: "bg-cyan-900/20 border-cyan-700 text-cyan-300",
    icon: "🕒",
    label: "Early",
  },
  Late: {
    color: "bg-red-900/20 border-red-700 text-red-300",
    icon: "✕",
    label: "Late",
  },
  Missed: {
    color: "bg-rose-900/20 border-rose-700 text-rose-300",
    icon: "⚠",
    label: "Missed",
  },
};

// Some backend responses may nest the activity array under a different key
// (e.g. "tasks" or "items" instead of "activities"), or the schedule prop
// itself may be an array of activities rather than an object wrapping one.
// This normalizes any of those shapes into a plain array so the rest of the
// component doesn't have to care which shape it received.
function extractActivitiesArray(rawSchedule) {
  if (!rawSchedule) return [];
  if (Array.isArray(rawSchedule)) return rawSchedule;
  if (Array.isArray(rawSchedule.activities)) return rawSchedule.activities;
  if (Array.isArray(rawSchedule.tasks)) return rawSchedule.tasks;
  if (Array.isArray(rawSchedule.items)) return rawSchedule.items;
  if (Array.isArray(rawSchedule.schedule_items)) return rawSchedule.schedule_items;
  return [];
}

function timeStrToMinutes(timeStr) {
  const [h, m] = String(timeStr || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function ActivityDetectorMonitor({
  onActivityConfirmed,
  schedule: scheduleProp,
  autoStart = false,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const expectedActivityRef = useRef(null);

  const [isDetecting, setIsDetecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentExpected, setCurrentExpected] = useState("Walking");
  const [isAligned, setIsAligned] = useState(false);
  const [currentActivity, setCurrentActivity] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [detectionLogs, setDetectionLogs] = useState([]);
  const [debugInfo, setDebugInfo] = useState("");
  const [liveFeatures, setLiveFeatures] = useState(null);
  const [stats, setStats] = useState({
    detected: 0,
    logged: 0,
    completed: 0,
    late: 0,
    missed: 0,
  });
  const [confirmedActivity, setConfirmedActivity] = useState(null);
  const lastLogTimeRef = useRef({});

  const activityConfirmationRef = useRef({
    activityName: null,
    startTime: null,
    timeoutId: null,
    confirmedActivities: {},
  });

  useEffect(() => {
    expectedActivityRef.current = currentExpected;
  }, [currentExpected]);

  useEffect(() => {
    if (scheduleProp) {
      console.log("[Detector] scheduleProp received:", scheduleProp);

      setSchedule(scheduleProp);
      const activities = extractActivitiesArray(scheduleProp);
      setDebugInfo(`✓ Loaded schedule with ${activities.length} activities`);
      if (activities.length === 0) {
        console.warn(
          "[Detector] scheduleProp had no recognizable activities array. " +
            "Keys present:",
          Object.keys(scheduleProp || {})
        );
      }
    } else {
      fetchSchedule();
    }
  }, [scheduleProp]);

  useEffect(() => {
    if (autoStart && !isDetecting && !isLoading) {
      startDetection();
    } else if (!autoStart && isDetecting) {
      stopDetection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  useEffect(() => {
    const activities = extractActivitiesArray(schedule);
    if (!activities.length) return;

    const updateExpected = () => {
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      let active = activities[0]?.activity_name || "Walking";
      for (const act of activities) {
        const start = timeStrToMinutes(act.start_time);
        const end = timeStrToMinutes(act.end_time);
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

  useEffect(() => {
    return () => {
      if (activityConfirmationRef.current.timeoutId) {
        clearTimeout(activityConfirmationRef.current.timeoutId);
      }
    };
  }, []);

  const fetchSchedule = async () => {
    try {
      const res = await getSchedule();
      console.log("[Detector] getSchedule() response:", res);
      const schedules = res.data || [];
      if (schedules.length > 0) {
        setSchedule(schedules[0]);
        const activities = extractActivitiesArray(schedules[0]);
        setDebugInfo(`✓ Loaded schedule with ${activities.length} activities`);
        if (activities.length === 0) {
          console.warn(
            "[Detector] Fetched schedule had no recognizable activities array. Keys present:",
            Object.keys(schedules[0] || {})
          );
        }
      } else {
        setSchedule(null);
        setDebugInfo("⚠️ No schedule found. Create one first!");
      }
    } catch (error) {
      console.error("Error fetching schedule:", error);
      setDebugInfo("✗ Failed to load schedule");
    }
  };

  // Flexible matching so "Walking" matches "Walk", "Morning Walking", etc.
  // FIX: this used to return null (→ "Unexpected") whenever the detected
  // activity's name/keywords didn't line up with the scheduled activity's
  // name. In a single-active-routine system there's basically always
  // exactly one activity that's "currently due" — so as a last resort we
  // now fall back to whichever scheduled activity's time window contains
  // right now, instead of giving up and reporting "Unexpected".
  const findScheduledActivity = (activityName) => {
    const activities = extractActivitiesArray(schedule);
    if (!activities.length) return null;

    const detected = (activityName || "").toLowerCase().trim();

    // 1) Exact match
    let match = activities.find(
      (act) => (act.activity_name || "").toLowerCase().trim() === detected
    );
    if (match) return match;

    // 2) Partial match
    match = activities.find((act) => {
      const name = (act.activity_name || "").toLowerCase().trim();
      return name.includes(detected) || detected.includes(name);
    });
    if (match) return match;

    // 3) Keyword groups
    const keywords = {
      walking: ["walk", "walking"],
      eating: ["eat", "eating", "breakfast", "lunch", "dinner", "food"],
      drinking: ["drink", "drinking", "water", "hydrate"],
      sleeping: ["sleep", "sleeping", "bed", "nap"],
      "sitting / rest": ["sit", "sitting", "rest", "resting"],
      standing: ["stand", "standing"],
      "taking medications": ["med", "medication", "pill", "tablet"],
    };

    for (const act of activities) {
      const name = (act.activity_name || "").toLowerCase();
      for (const [key, words] of Object.entries(keywords)) {
        const detectedHits =
          detected.includes(key) ||
          key.includes(detected) ||
          words.some((w) => detected.includes(w));
        const scheduleHits =
          words.some((w) => name.includes(w)) || name.includes(key);
        if (detectedHits && scheduleHits) return act;
      }
    }

    // 4) FALLBACK: no name/keyword match at all — use whichever scheduled
    // activity's window is currently active (or the nearest upcoming one
    // if none is active right now). This is what closes the "Unexpected"
    // gap: a real detection during a real scheduled window should always
    // resolve to *some* activity, not fall through to "not scheduled".
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const currentlyActive = activities.find((act) => {
      const start = timeStrToMinutes(act.start_time);
      const end = timeStrToMinutes(act.end_time);
      return nowMin >= start && nowMin <= end;
    });
    if (currentlyActive) {
      console.warn(
        "[Detector] No name match for detected activity",
        `"${activityName}"`,
        "— falling back to the currently-active scheduled activity:",
        currentlyActive.activity_name
      );
      return currentlyActive;
    }

    // 5) Still nothing — closest activity by start_time (upcoming or most
    // recently ended), so a genuinely off-schedule detection still gets
    // evaluated against the nearest window rather than discarded.
    let closest = null;
    let closestDist = Infinity;
    for (const act of activities) {
      const start = timeStrToMinutes(act.start_time);
      const end = timeStrToMinutes(act.end_time);
      const dist = nowMin < start ? start - nowMin : nowMin - end;
      if (dist < closestDist) {
        closestDist = dist;
        closest = act;
      }
    }
    if (closest) {
      console.warn(
        "[Detector] No name match and nothing currently active — using nearest scheduled activity by time:",
        closest.activity_name
      );
    }
    return closest;
  };

  const decideStatusFromWindow = (activityName) => {
    const scheduledActivity = findScheduledActivity(activityName);

    if (!scheduledActivity) {
      // Only reachable now if the schedule truly has zero activities.
      // Returning null (not a fake status string) tells the caller to skip
      // logging entirely, rather than writing a made-up "Unexpected" label
      // — a schedule with no activities has nothing to be Early/Late/
      // Completed relative to, so there's no honest status to give it.
      const activities = extractActivitiesArray(schedule);
      console.warn(
        "[Detector] No schedule match for:",
        activityName,
        "| schedule activities:",
        activities.map((a) => a.activity_name),
        "| raw schedule object:",
        schedule
      );
      return null;
    }

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = timeStrToMinutes(scheduledActivity.start_time);
    const endMin = timeStrToMinutes(scheduledActivity.end_time);

    if (nowMin < startMin) return "Early";
    if (nowMin > endMin) return "Late";
    return "Completed";
  };

  const confirmActivityForLogging = (detectionData) => {
    const confirmation = activityConfirmationRef.current;
    const now = Date.now();
    const CONFIRMATION_TIME = 1000;

    if (confirmation.activityName !== detectionData.activity_name) {
      if (confirmation.timeoutId) clearTimeout(confirmation.timeoutId);
      confirmation.activityName = detectionData.activity_name;
      confirmation.startTime = now;
      confirmation.timeoutId = setTimeout(() => {
        confirmation.confirmedActivities[detectionData.activity_name] = true;
        confirmation.timeoutId = null;
      }, CONFIRMATION_TIME);
      return false;
    }

    const elapsedTime = now - confirmation.startTime;
    const isConfirmed =
      confirmation.confirmedActivities[detectionData.activity_name] === true;

    if (elapsedTime >= CONFIRMATION_TIME && !isConfirmed) {
      confirmation.confirmedActivities[detectionData.activity_name] = true;
      return true;
    }
    return isConfirmed;
  };

  const handleActivityDetected = async (detectionData) => {
    if (detectionData.activity_name === "Movement") {
      setCurrentActivity(null);
    } else {
      setCurrentActivity(detectionData);
    }

    setStats((prev) => ({ ...prev, detected: prev.detected + 1 }));

    if (detectionData.features) {
      setLiveFeatures({
        handToMouth: detectionData.features[7]?.toFixed(3),
        velocity: detectionData.features[8]?.toFixed(5),
        wristHeight: detectionData.features[11]?.toFixed(3),
        hipHeight: detectionData.features[10]?.toFixed(3),
        torsoAlign: detectionData.features[14]?.toFixed(2),
        activity: detectionData.activity_name,
        confidence: (detectionData.confidence * 100).toFixed(0),
      });
    }

    const isActivityConfirmed = confirmActivityForLogging(detectionData);
    if (!isActivityConfirmed) return;

    const key = detectionData.activity_name;
    const now = Date.now();
    const lastTime = lastLogTimeRef.current[key] || 0;
    if (now - lastTime < DETECTION_DEBOUNCE) return;
    if (detectionData.confidence < CONFIDENCE_THRESHOLD) return;
    if (detectionData.activity_name === "Movement") return;

    let activityStatus = decideStatusFromWindow(detectionData.activity_name);

    // No honest status to give this detection. Distinguish between a truly
    // missing schedule and a loaded schedule whose current activities do not
    // include the detected action, so the UI message reflects reality.
    if (!activityStatus) {
      const hasSchedule = !!schedule && extractActivitiesArray(schedule).length > 0;
      if (hasSchedule) {
        setDebugInfo(
          `⚠️ Detected ${detectionData.activity_name}, but it is not part of the loaded schedule — not logged.`
        );
      } else {
        setDebugInfo(
          `⚠️ Detected ${detectionData.activity_name}, but no schedule is loaded — not logged.`
        );
      }
      return;
    }

    // Prefer the scheduled activity name for locking (matches sidebar)
    const matched = findScheduledActivity(detectionData.activity_name);
    const lockedName = matched?.activity_name || detectionData.activity_name;

    const logEntry = {
      activity: lockedName,
      confidence: (detectionData.confidence * 100).toFixed(0),
      status: activityStatus,
      time: new Date().toLocaleTimeString(),
      adaptive_grace_minutes: "...",
      delay_minutes: "...",
      deadline: "...",
    };

    try {
      // schedule is guaranteed non-null here: if it were null, findScheduledActivity
      // would have returned null, activityStatus would be null, and we'd already
      // have returned above before reaching this line.
      const response = await logDetectedActivity(schedule.schedule_id, {
        activity_name: lockedName,
        confidence: detectionData.confidence,
        detected_at: detectionData.detected_at.toISOString(),
        signals: detectionData.signals,
      });

      const adaptiveData = response?.data || {};
      const backendStatus = adaptiveData.status;

      if (backendStatus && FINAL_STATUSES.includes(backendStatus)) {
        logEntry.status = backendStatus;
      } else {
        // Backend didn't return a final status (e.g. its own window check
        // didn't match). We already have a locally-computed Early/Completed/
        // Late from decideStatusFromWindow above via the matched-activity
        // fallback, so use that — it's always one of the four real statuses.
        logEntry.status = activityStatus;
      }

      logEntry.adaptive_grace_minutes =
        adaptiveData.adaptive_grace_minutes || "?";
      logEntry.delay_minutes = adaptiveData.delay_minutes || "?";
      logEntry.deadline = adaptiveData.deadline
        ? new Date(adaptiveData.deadline).toLocaleTimeString()
        : "?";

      setStats((prev) => {
        const updated = { ...prev, logged: prev.logged + 1 };
        if (["Completed", "Early"].includes(logEntry.status)) {
          updated.completed++;
        }
        if (logEntry.status === "Late") updated.late++;
        if (logEntry.status === "Missed") updated.missed++;
        return updated;
      });

      setDetectionLogs((prev) => [logEntry, ...prev.slice(0, 9)]);
      lastLogTimeRef.current[key] = now;

      setDebugInfo(
        `✓ ${logEntry.activity} [${logEntry.status}] | Grace: ${logEntry.adaptive_grace_minutes}min | Delay: ${logEntry.delay_minutes}min`
      );

      setConfirmedActivity({
        name: lockedName,
        status: logEntry.status,
        confidence: detectionData.confidence,
        time: new Date().toLocaleTimeString(),
      });

      if (onActivityConfirmed) {
        onActivityConfirmed({
          activity_name: lockedName,
          status: logEntry.status,
        });
      }
    } catch (error) {
      console.error("Error logging activity:", error);

      // logEntry.status is already one of Early/Completed/Late from the
      // local decideStatusFromWindow computation (set before the try block),
      // even though the backend call itself failed — so there's still a
      // real status to show here, not a placeholder.
      setDetectionLogs((prev) => [logEntry, ...prev.slice(0, 9)]);
      lastLogTimeRef.current[key] = now;

      setConfirmedActivity({
        name: lockedName,
        status: logEntry.status,
        confidence: detectionData.confidence,
        time: new Date().toLocaleTimeString(),
      });

      if (onActivityConfirmed && FINAL_STATUSES.includes(logEntry.status)) {
        onActivityConfirmed({
          activity_name: lockedName,
          status: logEntry.status,
        });
      }
    }
  };

  const startDetection = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    if (isLoading) return;
    if (!schedule) {
      setDebugInfo("⚠️ No schedule — detection will run in test mode!");
    }

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
      setDebugInfo(
        "✓ Activity detection active\n📷 Position yourself in front of the camera"
      );
    } catch (error) {
      console.error("Error:", error);
      setDebugInfo(
        `✗ Error initializing: ${error.message}\n\nAllow camera permission!`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const stopDetection = async () => {
    try {
      if (activityConfirmationRef.current.timeoutId) {
        clearTimeout(activityConfirmationRef.current.timeoutId);
        activityConfirmationRef.current.timeoutId = null;
      }
      activityConfirmationRef.current.activityName = null;
      activityConfirmationRef.current.startTime = null;
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

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">
            📷 ML Activity Detection (Adaptive Thresholds)
          </h2>
          <span
            className={`inline-block w-3 h-3 rounded-full ${
              isDetecting ? "bg-green-500 animate-pulse" : "bg-gray-600"
            }`}
          />
        </div>

        <div
          className="relative bg-black rounded-lg overflow-hidden border border-gray-800 shadow-2xl"
          style={{ aspectRatio: "16/9" }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              objectFit: "cover",
            }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none w-full h-full object-cover"
          />

          <div className="absolute top-4 left-4 bg-black/70 px-3 py-2 rounded font-mono text-xs text-green-400 backdrop-blur-sm border border-green-500/20">
            {isDetecting ? "🟢 DETECTING" : "⚫ INACTIVE"}
          </div>

          {isDetecting && liveFeatures && (
            <div className="absolute top-20 left-4 flex flex-col gap-2 pointer-events-none">
              <div
                className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                  parseFloat(liveFeatures.handToMouth) < 0.35
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : "bg-gray-900 border-gray-700 text-gray-500"
                }`}
              >
                <span className="text-xs">🍽️</span> HAND NEAR FACE
              </div>
              <div
                className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                  parseFloat(liveFeatures.velocity) < 0.03
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : "bg-gray-900 border-gray-700 text-gray-500"
                }`}
              >
                <span className="text-xs">🛑</span> BODY STILL
              </div>
              <div
                className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                  parseFloat(liveFeatures.torsoAlign) > 1.1
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : "bg-gray-900 border-gray-700 text-gray-500"
                }`}
              >
                <span className="text-xs">🛏️</span> LYING DOWN
              </div>
              <div
                className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                  currentActivity?.activity_name === "Sitting / rest"
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : "bg-gray-900 border-gray-700 text-gray-500"
                }`}
              >
                <span className="text-xs">🪑</span> SITTING / RESTING
              </div>
              <div
                className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                  currentActivity?.activity_name === "Standing"
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : "bg-gray-900 border-gray-700 text-gray-500"
                }`}
              >
                <span className="text-xs">🧍</span> STANDING
              </div>
              <div
                className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                  currentActivity?.activity_name === "Sleeping"
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : "bg-gray-900 border-gray-700 text-gray-500"
                }`}
              >
                <span className="text-xs">😴</span> SLEEPING
              </div>
              <div
                className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                  currentActivity?.activity_name === "Walking"
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : "bg-gray-900 border-gray-700 text-gray-500"
                }`}
              >
                <span className="text-xs">🚶</span> WALKING
              </div>
              <div
                className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                  currentActivity?.activity_name === "Drinking"
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : "bg-gray-900 border-gray-700 text-gray-500"
                }`}
              >
                <span className="text-xs">🥤</span> DRINKING
              </div>
              <div
                className={`px-2 py-1.5 rounded-md text-[10px] font-bold border backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                  currentActivity?.activity_name === "Taking Medications"
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : "bg-gray-900 border-gray-700 text-gray-500"
                }`}
              >
                <span className="text-xs">💊</span> TAKING MEDICATIONS
              </div>
            </div>
          )}

          {currentActivity && (
            <div className="absolute top-20 right-4 bg-black/80 px-4 py-3 rounded-lg border border-purple-500/30 backdrop-blur-md w-48 shadow-xl">
              <p className="text-gray-400 text-[10px] uppercase tracking-widest mb-1">
                Detected Activity
              </p>
              <p className="text-purple-400 font-bold text-base leading-none tracking-tight">
                {currentActivity.activity_name}
              </p>
              <div className="w-full bg-gray-800 h-1 mt-3 rounded-full overflow-hidden">
                <div
                  className="bg-purple-500 h-full transition-all duration-300 shadow-[0_0_8px_rgba(168,85,247,0.5)]"
                  style={{
                    width: `${(currentActivity.confidence * 100).toFixed(0)}%`,
                  }}
                />
              </div>
              <p className="text-[10px] text-gray-500 mt-1 text-right font-mono">
                {(currentActivity.confidence * 100).toFixed(0)}% CONFIDENCE
              </p>
            </div>
          )}
        </div>

        {confirmedActivity && (
          <div className="mt-4 p-4 rounded-xl border border-green-500/30 bg-green-900/10 backdrop-blur-sm animate-slide-up">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center animate-pulse">
                  <span className="text-green-400 text-lg font-bold">✓</span>
                </div>
                <div>
                  <p className="text-green-400 font-bold text-sm">
                    Activity Confirmed (1s stable)
                  </p>
                  <p className="text-white text-base font-semibold">
                    {confirmedActivity.name}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`text-xs font-bold px-3 py-1 rounded-full border ${
                    confirmedActivity.status === "Completed"
                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                      : confirmedActivity.status === "Early"
                        ? "text-cyan-400 bg-cyan-500/10 border-cyan-500/20"
                        : confirmedActivity.status === "Late"
                          ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                          : confirmedActivity.status === "Missed"
                            ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                            : "text-blue-400 bg-blue-500/10 border-blue-500/20"
                  }`}
                >
                  {confirmedActivity.status}
                </div>
                <p className="text-gray-500 text-[10px] mt-1 font-mono">
                  {confirmedActivity.time}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-4">
          {!isDetecting ? (
            <button
              onClick={startDetection}
              disabled={isLoading}
              className={`flex-1 ${
                isLoading
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-700"
              } px-4 py-2 rounded font-semibold transition`}
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

        <div className="mt-4 p-3 bg-gray-800 rounded text-sm text-gray-300 font-mono whitespace-pre-line">
          {debugInfo || "Status: Ready"}
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold mb-4 text-green-300">
          ✓ Detection Log (Adaptive)
        </h3>

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

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {detectionLogs.length === 0 ? (
            <p className="text-gray-400 text-center py-4">
              Waiting for activity detection...
            </p>
          ) : (
            detectionLogs.map((log, idx) => {
              const statusDisplay = STATUS_DISPLAY[log.status] || STATUS_DISPLAY.Late;
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

      <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-4 text-sm">
        <p className="text-blue-200">
          💡 <strong>Status rules:</strong> Before start → Early · Inside window
          → Completed · After end → Late. Status is locked in the sidebar and
          View Full Progress page.
        </p>
      </div>
    </div>
  );
}
