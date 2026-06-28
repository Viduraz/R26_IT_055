
import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getDeviations, getSchedule, getNotifications, getActivityLogs, deleteSchedule } from "../services/scheduleApi";
import ActivityDetectorMonitor from "../components/ActivityDetectorMonitor";
import AlertModal from "../components/AlertModal";
import toast from "react-hot-toast";

const getActivityIcon = (name) => {
  const n = name.toLowerCase();
  if (n.includes("eat") || n.includes("breakfast") || n.includes("dinner") || n.includes("lunch") || n.includes("food")) return "🍲";
  if (n.includes("med") || n.includes("pill") || n.includes("tablet")) return "💊";
  if (n.includes("therapy") || n.includes("exercise") || n.includes("physio")) return "🏃‍♂️";
  if (n.includes("walk")) return "🚶‍♂️";
  if (n.includes("read") || n.includes("book")) return "📖";
  if (n.includes("sleep") || n.includes("bed") || n.includes("rest")) return "🌙";
  if (n.includes("stand")) return "🧍";
  if (n.includes("drink") || n.includes("water") || n.includes("hydrate")) return "💧";
  return "📋";
};

const getActivityCategory = (name) => {
  const n = name.toLowerCase();
  if (n.includes("eat") || n.includes("breakfast") || n.includes("dinner") || n.includes("lunch")) return "Nutrition & Dining";
  if (n.includes("med") || n.includes("pill") || n.includes("tablet")) return "Healthcare & Meds";
  if (n.includes("therapy") || n.includes("exercise")) return "Mobility & Therapy";
  if (n.includes("walk")) return "Leisure & Walking";
  if (n.includes("read") || n.includes("book")) return "Leisure & Cognitive";
  if (n.includes("sleep") || n.includes("bed") || n.includes("rest")) return "Rest & Recovery";
  if (n.includes("drink") || n.includes("water")) return "Hydration";
  return "Daily Routine";
};

const isCurrentActivity = (start, end) => {
  try {
    const now = new Date();
    const [sHr, sMin] = start.split(":").map(Number);
    const [eHr, eMin] = end.split(":").map(Number);

    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = sHr * 60 + sMin;
    const endMin = eHr * 60 + eMin;

    return nowMin >= startMin && nowMin <= endMin;
  } catch (e) {
    return false;
  }
};

export default function ScheduleDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromSetup = location.state?.fromSetup === true;

  const [schedule, setSchedule] = useState([]);
  const [deviations, setDeviations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showDetector, setShowDetector] = useState(false);
  const [activeAlert, setActiveAlert] = useState(null);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);
  const prevUnreadCount = useRef(0);
  const shownMissedRef = useRef(new Set());

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!loading && schedule.length > 0 && !hasAutoOpened) {
      setShowDetector(true);
      setHasAutoOpened(true);
      if (fromSetup) {
        toast.success("Routine active! Camera tracking started.", {
          icon: "📷",
          duration: 4000,
        });
      }
    }
  }, [loading, schedule.length, hasAutoOpened, fromSetup]);

  const handleStartTracking = () => {
    if (schedule.length > 0) {
      setShowDetector(!showDetector);
    } else {
      toast.error("No active routine! Please set up a schedule first.", { icon: "⚠️", duration: 3000 });
      setTimeout(() => navigate("/routine-setup"), 1500);
    }
  };

  const fetchData = async () => {
    try {
      const [devRes, schedRes, notifRes, logsRes] = await Promise.all([
        getDeviations(),
        getSchedule(),
        getNotifications(),
        getActivityLogs()
      ]);
      setDeviations(devRes.data || []);
      setSchedule(schedRes.data || []);

      const newNotifs = notifRes.data || [];
      setNotifications(newNotifs);

      const newUnreadCount = newNotifs.filter(n => !n.read).length;
      if (newUnreadCount > prevUnreadCount.current && prevUnreadCount.current !== 0) {
        toast.error(`You have new alerts! Check the notifications.`, {
          icon: '⚠️',
          duration: 4000,
        });

        // Show full-screen modal for new Missed notifications
        const missedNotifs = newNotifs.filter(
          n => !n.read && n.status === "Missed" && !shownMissedRef.current.has(n.notification_id)
        );
        if (missedNotifs.length > 0) {
          const m = missedNotifs[0];
          shownMissedRef.current.add(m.notification_id);
          setActiveAlert({
            status: "Missed",
            activityName: m.activity_name,
            message: m.message,
            time: new Date(m.created_at || Date.now()).toLocaleString([], {
              month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit'
            }),
          });
        }
      }
      prevUnreadCount.current = newUnreadCount;

      const logs = logsRes.data || [];
      setTotalLogs(logs.length);
      setRecentLogs(logs.slice(0, 5));
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteIndividualActivity = async (activityName) => {
    try {
      if (!schedule || schedule.length === 0) return;
      const currentSched = schedule[0];
      const updatedActivities = currentSched.activities.filter(
        (act) => act.activity_name !== activityName
      );

      if (updatedActivities.length === 0) {
        await deleteSchedule(currentSched.schedule_id);
        toast.success("All activities deleted. Routine cleared!", { icon: "🗑" });
        setSchedule([]);
        return;
      }

      await createSchedule(updatedActivities, currentSched.description || "");
      toast.success(`"${activityName}" deleted and schedule saved!`, { icon: "🗑" });
      fetchData();
    } catch (e) {
      console.error("Failed to delete activity:", e);
      toast.error("Failed to delete activity.");
    }
  };

  const handleDeleteSchedule = async () => {
    if (!schedule.length) return;
    if (window.confirm("Are you sure you want to delete the current routine? All associated logs will be cleared.")) {
      try {
        await deleteSchedule(schedule[0].schedule_id);
        toast.success("Routine deleted successfully", { icon: "🗑" });
        setSchedule([]);
        setRecentLogs([]);
        setTotalLogs(0);
        setDeviations([]);
        setNotifications([]);
      } catch (err) {
        toast.error("Failed to delete routine");
      }
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const todayActivities = schedule.length > 0 ? schedule[0]?.activities?.length || 0 : 0;

  return (
    <div className="w-full pb-20">
      {/* Dashboard Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Live Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Real-time health metrics and routine monitoring.</p>
        </div>
        <button
          onClick={handleStartTracking}
          className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 shadow-lg flex items-center gap-2 ${showDetector
              ? "bg-rose-500/10 text-rose-400 border border-rose-500/50 hover:bg-rose-500/20"
              : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30 hover:shadow-blue-900/50"
            }`}
        >
          {showDetector ? "⏹ Stop Camera" : "▶ Start Live Tracking"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="space-y-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>

          {/* Activity Detector - Conditionally Visible */}
          {showDetector && (
            <div className="mb-10 rounded-2xl overflow-hidden shadow-2xl border border-gray-800 bg-gray-900/50 backdrop-blur-xl">
              <ActivityDetectorMonitor />
            </div>
          )}

          {/* Health Metrics KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-900/20 group relative overflow-hidden">
              <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2 relative z-10"><span>🌙</span> Sleep Quality</p>
              <div className="mt-4 flex items-end gap-3 mb-4 relative z-10">
                <span className="text-4xl font-bold text-white group-hover:text-indigo-400 transition-colors">85%</span>
                <span className="text-sm text-gray-500 mb-1">7h 45m (Restful)</span>
              </div>
              <div className="w-full h-12 mt-2 relative z-10">
                <svg viewBox="0 0 100 30" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                  <path d="M0 25 C 10 25, 15 5, 25 5 C 35 5, 40 25, 50 25 C 60 25, 65 10, 75 10 C 85 10, 90 20, 100 20"
                    fill="none" stroke="currentColor" strokeWidth="2.5" className="text-indigo-500/80 group-hover:text-indigo-400 transition-colors drop-shadow-[0_4px_6px_rgba(99,102,241,0.4)]" />
                  <path d="M0 25 C 10 25, 15 5, 25 5 C 35 5, 40 25, 50 25 C 60 25, 65 10, 75 10 C 85 10, 90 20, 100 20 L 100 30 L 0 30 Z"
                    fill="url(#indigoGrad)" className="opacity-20" />
                  <defs>
                    <linearGradient id="indigoGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity="1" />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>

            <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-900/20 group relative overflow-hidden">
              <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2 relative z-10"><span>👣</span> Step Count</p>
              <div className="mt-4 flex items-end gap-3 mb-4 relative z-10">
                <span className="text-4xl font-bold text-white group-hover:text-emerald-400 transition-colors">4,230</span>
                <span className="text-sm text-gray-500 mb-1">steps today</span>
              </div>
              <div className="w-full h-12 mt-2 flex items-end justify-between gap-1.5 relative z-10">
                {[40, 60, 45, 80, 55, 90, 65].map((h, i) => (
                  <div key={i} className="w-full h-full bg-emerald-500/10 rounded-t-sm group-hover:bg-emerald-500/20 transition-colors relative group/bar">
                    <div
                      className="absolute bottom-0 w-full bg-emerald-500 rounded-t-sm shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all duration-500"
                      style={{ height: `${h}%` }}
                    ></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-900/20 group relative overflow-hidden">
              <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"></div>
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2 relative z-10"><span>⚡</span> Activity Level</p>
              <div className="mt-4 flex items-end gap-3 mb-4 relative z-10">
                <span className="text-4xl font-bold text-white group-hover:text-amber-400 transition-colors">Active</span>
                <span className="text-sm text-gray-500 mb-1">Moderate pace</span>
              </div>
              <div className="w-full h-12 mt-2 relative z-10">
                <svg viewBox="0 0 100 30" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                  <polyline points="0,25 20,25 25,10 30,28 35,5 40,25 60,25 65,15 70,25 100,25"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
                    className="text-amber-500 group-hover:text-amber-400 transition-colors drop-shadow-[0_2px_8px_rgba(245,158,11,0.6)]" />
                </svg>
              </div>
            </div>
          </div>

          <div className="pt-4">

            {/* Timeline */}
            <div className="w-full space-y-8">
              <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl p-8 border border-gray-800/60 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-blue-500/5 rounded-full blur-3xl"></div>
                <div className="flex justify-between items-center mb-8 relative z-10">
                  <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm">📅</span>
                    Today's Routine
                  </h2>
                  {schedule.length > 0 && (
                    <button
                      onClick={handleDeleteSchedule}
                      className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold rounded-lg border border-rose-500/30 transition-colors flex items-center gap-2"
                    >
                      <span>🗑</span> Delete Routine
                    </button>
                  )}
                </div>

                {schedule.length === 0 ? (
                  <div className="py-12 text-center text-gray-500 relative z-10">
                    <p className="mb-4 text-4xl">📭</p>
                    <p>No routine established yet.</p>
                    <button onClick={() => navigate("/routine-setup")} className="mt-4 text-blue-400 hover:text-blue-300 text-sm font-medium transition">
                      Set up a routine →
                    </button>
                  </div>
                ) : (
                  <div className="relative border-l-2 border-gray-800/80 sm:ml-20 ml-12 space-y-8 py-2 z-10">
                    {schedule[0]?.activities?.map((activity, idx) => {
                      // Find if there is a log for this
                      const log = recentLogs.find(l => l.activity_name === activity.activity_name);
                      const isCurrent = isCurrentActivity(activity.start_time, activity.end_time);

                      let statusDot = "bg-gray-800 border-gray-700";
                      let statusText = "Planned";
                      let textClass = "text-purple-400 bg-purple-500/10 border-purple-500/20";
                      let progress = 0;
                      let barColor = "bg-gray-800";
                      let glowClass = "hover:shadow-gray-900/10 border-gray-800";

                      if (log) {
                        if (log.status === "Done" || log.status === "On Time") {
                          statusDot = "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] border-emerald-900";
                          statusText = "Completed";
                          textClass = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                          progress = 100;
                          barColor = "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]";
                          glowClass = "hover:shadow-emerald-950/10 border-emerald-900/40 hover:border-emerald-500/30";
                        }
                        else if (log.status === "Early") {
                          statusDot = "bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.5)] border-cyan-900";
                          statusText = "Early";
                          textClass = "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
                          progress = 100;
                          barColor = "bg-cyan-500 shadow-[0_0_8px_rgba(34,211,238,0.5)]";
                          glowClass = "hover:shadow-cyan-950/10 border-cyan-900/40 hover:border-cyan-500/30";
                        }
                        else if (log.status === "Late" || log.status === "Slightly Late") {
                          statusDot = "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.5)] border-amber-900";
                          statusText = "Late";
                          textClass = "text-amber-400 bg-amber-500/10 border-amber-500/20";
                          progress = 65;
                          barColor = "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]";
                          glowClass = "hover:shadow-amber-950/10 border-amber-900/40 hover:border-amber-500/30";
                        }
                        else if (log.status === "Missed") {
                          statusDot = "bg-rose-500 shadow-[0_0_12px_rgba(225,29,72,0.5)] border-rose-900";
                          statusText = "Missed";
                          textClass = "text-rose-400 bg-rose-500/10 border-rose-500/20";
                          progress = 0;
                          barColor = "bg-rose-500/20";
                          glowClass = "hover:shadow-rose-950/10 border-rose-950/40 hover:border-rose-500/30";
                        }
                      } else if (isCurrent) {
                        statusDot = "bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)] border-blue-900 animate-pulse";
                        statusText = "In Progress";
                        textClass = "text-blue-400 bg-blue-500/10 border-blue-500/20";
                        progress = 65;
                        barColor = "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]";
                        glowClass = "hover:shadow-blue-950/10 border-blue-900/40 hover:border-blue-500/30";
                      }

                      return (
                        <div key={idx} className="relative pl-8 sm:pl-12 group transition-all duration-300">
                          {/* Thread Dot */}
                          <div className={`absolute -left-[9px] top-8 w-4 h-4 rounded-full border-2 ${statusDot} transition-all duration-300 group-hover:scale-125 z-10`} />

                          {/* Left Time Label */}
                          <div className="absolute -left-12 sm:-left-20 top-7 text-xs font-semibold text-gray-500 tracking-tight text-right w-10 sm:w-16 group-hover:text-gray-400 transition-colors">
                            {activity.start_time}
                          </div>

                          {/* Beautiful Glassmorphic Card */}
                          <div className={`bg-gray-800/20 hover:bg-gray-800/40 hover:shadow-2xl transition-all duration-300 border ${glowClass} rounded-2xl p-6 backdrop-blur-sm`}>
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                              <div className="flex items-center gap-4">
                                <span className="w-12 h-12 rounded-xl bg-gray-800/80 flex items-center justify-center text-2xl border border-gray-700/50 shadow-md group-hover:scale-105 transition-transform duration-300">
                                  {getActivityIcon(activity.activity_name)}
                                </span>
                                <div>
                                  <h4 className="font-bold text-lg text-white group-hover:text-blue-400 transition-colors">{activity.activity_name}</h4>
                                  <p className="text-xs text-gray-500 font-medium mt-0.5">{getActivityCategory(activity.activity_name)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-gray-500 font-mono tracking-tight bg-gray-800/40 px-2.5 py-1 rounded-lg border border-gray-800">
                                  {activity.start_time} — {activity.end_time}
                                </span>
                                <div className={`text-xs font-bold px-3 py-1 rounded-full border ${textClass}`}>
                                  {statusText}
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Are you sure you want to delete "${activity.activity_name}" from the routine?`)) {
                                      handleDeleteIndividualActivity(activity.activity_name);
                                    }
                                  }}
                                  className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center text-sm shadow-md"
                                  title="Delete Activity"
                                >
                                  🗑
                                </button>
                              </div>
                            </div>

                            {/* Progress Bar */}
                            <div className="mt-5">
                              <div className="flex justify-between items-center text-xs text-gray-500 mb-1.5 font-medium">
                                <span>Progress</span>
                                <span>{progress}%</span>
                              </div>
                              <div className="w-full h-2 bg-gray-800/60 rounded-full overflow-hidden border border-gray-800">
                                <div
                                  className={`h-full rounded-full ${barColor} transition-all duration-500`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Full-screen Missed alert modal */}
      <AlertModal
        alert={activeAlert}
        onDismiss={() => setActiveAlert(null)}
      />

// schedule-monitoring/frontend/src/pages/ScheduleDashboard.jsx
import { useEffect, useState, useCallback } from "react";
import { getTodayStatus, sendDetectionEvent, triggerMissedEval } from "../services/scheduleApi";

const PATIENT_ID = "patient_001";

const STATUS_CONFIG = {
  done:              { label: "Done",             dot: "bg-emerald-400", badge: "badge-done",     icon: "✓" },
  late:              { label: "Late",             dot: "bg-amber-400",   badge: "badge-late",     icon: "⚠" },
  missed:            { label: "Missed",           dot: "bg-rose-400",    badge: "badge-missed",   icon: "✕" },
  caregiver_missing: { label: "No Caregiver",    dot: "bg-orange-400",  badge: "badge-caregiver_missing", icon: "⚡" },
  pending:           { label: "Pending",          dot: "bg-sky-400",     badge: "badge-pending",  icon: "◷" },
  requires_review:   { label: "Review",           dot: "bg-purple-400",  badge: "badge-requires_review", icon: "?" },
};

const TASK_TYPE_ICONS = {
  meal: "🍽", medication: "💊", sleep: "😴", rest: "🛋",
  exercise: "🚶", hydration: "💧", caregiver_assisted: "🤝", other: "📋",
};

const DETECT_ACTIVITIES = [
  { value: "eating",    label: "Eating" },
  { value: "sleeping",  label: "Sleeping" },
  { value: "walking",   label: "Walking" },
  { value: "sitting",   label: "Sitting / Resting" },
  { value: "medication",label: "Medication" },
  { value: "drinking",  label: "Drinking / Hydration" },
  { value: "wake_up",   label: "Wake Up" },
  { value: "exercise",  label: "Exercise" },
  { value: "bathing",   label: "Bathing" },
];

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>;
}

function StatCard({ label, value, color, sub }) {
  return (
    <div className={`bg-gray-900 border rounded-2xl p-5 flex flex-col gap-1 transition-all hover:border-opacity-40 ${color}`}>
      <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-bold text-white">{value}</p>
      {sub && <p className="text-gray-600 text-xs">{sub}</p>}
    </div>
  );
}

function getCurrentTask(tasks) {
  const now = new Date();
  const hm = now.getHours() * 60 + now.getMinutes();
  return tasks.find((t) => {
    const [sh, sm] = t.start_time.split(":").map(Number);
    const [eh, em] = t.end_time.split(":").map(Number);
    return hm >= sh * 60 + sm && hm <= eh * 60 + em;
  }) || null;
}

function getNextTask(tasks) {
  const now = new Date();
  const hm = now.getHours() * 60 + now.getMinutes();
  return tasks.find((t) => {
    const [sh, sm] = t.start_time.split(":").map(Number);
    return sh * 60 + sm > hm && t.status === "pending";
  }) || null;
}

export default function ScheduleDashboard({ patientId = PATIENT_ID }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [countdown, setCountdown] = useState(30);
  const [simOpen, setSimOpen]   = useState(false);
  const [simForm, setSimForm]   = useState({ detected_activity: "eating", caregiver_present: true, confidence: 0.9 });
  const [simStatus, setSimStatus] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const r = await getTodayStatus(patientId);
      setData(r.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setCountdown(30);
    }
  }, [patientId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 30)), 1000);
    return () => clearInterval(t);
  }, []);

  const handleSimulate = async () => {
    setSimLoading(true); setSimStatus(null);
    try {
      const r = await sendDetectionEvent({ patient_id: patientId, ...simForm });
      setSimStatus({ ok: true, msg: `Matched ${r.data.matched} task(s). ${r.data.results?.map(t => `${t.task_name}: ${t.status}`).join(", ") || "No match"}` });
      fetchData();
    } catch (e) {
      setSimStatus({ ok: false, msg: e.message });
    } finally {
      setSimLoading(false);
    }
  };

  const handleEvalMissed = async () => {
    try {
      await triggerMissedEval(patientId);
      fetchData();
    } catch {}
  };

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="spinner mx-auto mb-3" style={{ width: 36, height: 36, borderWidth: 3 }} />
          <p className="text-gray-500 text-sm">Loading monitoring data…</p>
        </div>
      </div>
    );
  }

  const tasks   = data?.tasks || [];
  const summary = data?.summary || {};
  const currentTask = getCurrentTask(tasks);
  const nextTask    = getNextTask(tasks);

  return (
    <div className="p-8 max-w-6xl mx-auto fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Monitoring Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">{dateStr}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleEvalMissed}
            className="px-4 py-2 text-sm bg-gray-800 border border-gray-700 text-gray-300 rounded-xl hover:bg-gray-700 transition-colors"
          >
            Sweep Missed
          </button>
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-900 border border-gray-800 px-3 py-2 rounded-xl">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live · refreshes in {countdown}s
          </div>
          <button onClick={fetchData} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Total Tasks"       value={summary.total || 0}            color="border-gray-700" />
        <StatCard label="Done"              value={summary.done || 0}             color="border-emerald-500/30" />
        <StatCard label="Late"              value={summary.late || 0}             color="border-amber-500/30" />
        <StatCard label="Missed"            value={summary.missed || 0}           color="border-rose-500/30" />
        <StatCard label="Pending"           value={summary.pending || 0}          color="border-sky-500/30" />
        <StatCard label="No Caregiver"      value={summary.caregiver_missing || 0} color="border-orange-500/30" />
      </div>

      {/* Active & Next Task */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        {/* Current */}
        <div className={`rounded-2xl p-5 border ${currentTask ? "bg-indigo-600/10 border-indigo-500/30" : "bg-gray-900 border-gray-800"}`}>
          <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Currently Active</p>
          {currentTask ? (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-lg font-bold text-white flex items-center gap-2">
                    <span>{TASK_TYPE_ICONS[currentTask.task_type] || "📋"}</span>
                    {currentTask.task_name}
                  </p>
                  <p className="text-indigo-300 text-sm mt-1">{currentTask.start_time} – {currentTask.end_time}</p>
                </div>
                <StatusBadge status={currentTask.status} />
              </div>
              {currentTask.caregiver_required && (
                <p className="text-xs text-orange-400 mt-3">🤝 Caregiver required for this task</p>
              )}
            </>
          ) : (
            <p className="text-gray-500 text-sm">No task active right now</p>
          )}
        </div>

        {/* Next */}
        <div className="rounded-2xl p-5 border bg-gray-900 border-gray-800">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Next Upcoming</p>
          {nextTask ? (
            <>
              <p className="text-lg font-bold text-white flex items-center gap-2">
                <span>{TASK_TYPE_ICONS[nextTask.task_type] || "📋"}</span>
                {nextTask.task_name}
              </p>
              <p className="text-gray-400 text-sm mt-1">{nextTask.start_time} – {nextTask.end_time}</p>
              {nextTask.caregiver_required && (
                <p className="text-xs text-orange-400 mt-2">🤝 Needs caregiver</p>
              )}
            </>
          ) : (
            <p className="text-gray-500 text-sm">No more tasks scheduled today</p>
          )}
        </div>
      </div>

      {/* Task Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
          <h2 className="text-white font-semibold">Today's Schedule</h2>
          <span className="text-gray-500 text-sm">{tasks.length} tasks · {timeStr}</span>
        </div>
        {tasks.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-gray-500">No schedule items found. Create a routine in <strong className="text-gray-400">Routine Setup</strong>.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {["Time", "Task", "Type", "Caregiver", "Status", "Detected At", "Caregiver Present"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, i) => (
                  <tr
                    key={task.schedule_id}
                    className={`border-b border-gray-800/50 transition-colors hover:bg-gray-800/30 ${
                      task.status === "done" ? "opacity-70" : ""
                    }`}
                  >
                    <td className="px-5 py-3.5 text-gray-300 font-mono text-xs whitespace-nowrap">
                      {task.start_time} – {task.end_time}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-white font-medium flex items-center gap-2">
                        {TASK_TYPE_ICONS[task.task_type] || "📋"} {task.task_name}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 capitalize">{task.task_type?.replace("_", " ")}</td>
                    <td className="px-5 py-3.5">
                      {task.caregiver_required
                        ? <span className="text-orange-400 text-xs font-medium">Required</span>
                        : <span className="text-gray-600 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3.5"><StatusBadge status={task.status} /></td>
                    <td className="px-5 py-3.5 text-gray-400 font-mono text-xs">{task.detected_at || "—"}</td>
                    <td className="px-5 py-3.5">
                      {task.caregiver_present
                        ? <span className="text-emerald-400 text-xs">✓ Present</span>
                        : <span className="text-gray-600 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Simulate Detection Panel */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <button
          onClick={() => setSimOpen((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-800/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-white font-medium text-sm">Simulate Vision Detection</p>
              <p className="text-gray-500 text-xs">Test the 20-minute rule without a live camera</p>
            </div>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-gray-500 transition-transform ${simOpen ? "rotate-180" : ""}`}>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" />
          </svg>
        </button>

        {simOpen && (
          <div className="px-6 pb-6 border-t border-gray-800 fade-in">
            <div className="pt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-2">Detected Activity</label>
                <select
                  value={simForm.detected_activity}
                  onChange={(e) => setSimForm((f) => ({ ...f, detected_activity: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                >
                  {DETECT_ACTIVITIES.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-2">Confidence: {Math.round(simForm.confidence * 100)}%</label>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={simForm.confidence}
                  onChange={(e) => setSimForm((f) => ({ ...f, confidence: parseFloat(e.target.value) }))}
                  className="w-full accent-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-2">Caregiver Present</label>
                <button
                  onClick={() => setSimForm((f) => ({ ...f, caregiver_present: !f.caregiver_present }))}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    simForm.caregiver_present
                      ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                      : "bg-gray-800 border-gray-700 text-gray-400"
                  }`}
                >
                  <span>{simForm.caregiver_present ? "✓ Yes" : "✕ No"}</span>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-5">
              <button
                onClick={handleSimulate}
                disabled={simLoading}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2"
              >
                {simLoading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : "▶"}
                Send Detection
              </button>
              {simStatus && (
                <p className={`text-sm ${simStatus.ok ? "text-emerald-400" : "text-rose-400"}`}>
                  {simStatus.msg}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
