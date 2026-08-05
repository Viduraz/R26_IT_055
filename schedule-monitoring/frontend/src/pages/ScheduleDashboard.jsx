import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  getDeviations,
  getSchedule,
  getNotifications,
  getActivityLogs,
  deleteSchedule,
  createSchedule,
} from "../services/scheduleApi";
import ActivityDetectorMonitor from "../components/ActivityDetectorMonitor";
import AlertModal from "../components/AlertModal";
import toast from "react-hot-toast";

const getActivityIcon = (name) => {
  const n = name.toLowerCase();
  if (
    n.includes("eat") ||
    n.includes("breakfast") ||
    n.includes("dinner") ||
    n.includes("lunch") ||
    n.includes("food")
  )
    return "🍲";
  if (n.includes("med") || n.includes("pill") || n.includes("tablet"))
    return "💊";
  if (n.includes("therapy") || n.includes("exercise") || n.includes("physio"))
    return "🏃‍♂️";
  if (n.includes("walk")) return "🚶‍♂️";
  if (n.includes("read") || n.includes("book")) return "📖";
  if (n.includes("sleep") || n.includes("bed") || n.includes("rest"))
    return "🌙";
  if (n.includes("stand")) return "🧍";
  if (n.includes("drink") || n.includes("water") || n.includes("hydrate"))
    return "💧";
  return "📋";
};

const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = String(timeStr).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

const getTodayStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const FINAL_STATUSES = ["Completed", "Early", "Late", "Missed", "Not Done"];

const SIDEBAR_STATUS_STYLE = {
  Completed: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    border: "border-emerald-500/40",
    icon: "✅",
  },
  Early: {
    bg: "bg-sky-500/15",
    text: "text-sky-400",
    border: "border-sky-500/40",
    icon: "⏰",
  },
  Late: {
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/40",
    icon: "⏳",
  },
  Missed: {
    bg: "bg-rose-500/15",
    text: "text-rose-400",
    border: "border-rose-500/40",
    icon: "❌",
  },
  "Not Done": {
    bg: "bg-orange-500/15",
    text: "text-orange-400",
    border: "border-orange-500/40",
    icon: "🚫",
  },
  "In Progress": {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/40",
    icon: "🔄",
  },
  Pending: {
    bg: "bg-gray-500/15",
    text: "text-gray-400",
    border: "border-gray-600/40",
    icon: "🕒",
  },
};

const normalizeNotifications = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.notifications))
    return payload.notifications;
  return [];
};

const saveLockedStatuses = (scheduleId, todayStr, statuses) => {
  if (!scheduleId) return;
  try {
    localStorage.setItem(
      `lockedStatuses_${scheduleId}_${todayStr}`,
      JSON.stringify(statuses)
    );
  } catch { }
};

export default function ScheduleDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const assetBase = import.meta.env.BASE_URL;
  const fromSetup = location.state?.fromSetup === true;

  const [schedule, setSchedule] = useState([]);
  const [deviations, setDeviations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [allLogs, setAllLogs] = useState([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showDetector, setShowDetector] = useState(fromSetup);
  const [activeAlert, setActiveAlert] = useState(null);
  const prevUnreadCount = useRef(0);
  const shownMissedRef = useRef(new Set());
  const [lockedStatuses, setLockedStatuses] = useState({});
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showProgressSidebar, setShowProgressSidebar] = useState(false);

  const selectedSchedule = schedule[0] || null;
  const todayStr = getTodayStr();

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    if (!selectedSchedule?.schedule_id) {
      setLockedStatuses({});
      return;
    }
    const key = `lockedStatuses_${selectedSchedule.schedule_id}_${todayStr}`;
    try {
      const saved = localStorage.getItem(key);
      setLockedStatuses(saved ? JSON.parse(saved) : {});
    } catch {
      setLockedStatuses({});
    }
  }, [selectedSchedule?.schedule_id, todayStr]);

  useEffect(() => {
    if (!selectedSchedule?.activities?.length) return;
    setLockedStatuses((prev) => {
      let changed = false;
      const next = { ...prev };
      selectedSchedule.activities.forEach((activity) => {
        if (next[activity.activity_name]) return;
        const matchingLog = allLogs.find(
          (l) =>
            l.activity_name === activity.activity_name &&
            (!l.date || l.date === todayStr)
        );
        const logStatus = matchingLog?.display_status || matchingLog?.status;
        if (logStatus && FINAL_STATUSES.includes(logStatus)) {
          next[activity.activity_name] = logStatus;
          changed = true;
        }
      });
      if (changed) {
        saveLockedStatuses(selectedSchedule.schedule_id, todayStr, next);
        return next;
      }
      return prev;
    });
  }, [allLogs, selectedSchedule, todayStr]);

  const handleStartTracking = () => {
    if (selectedSchedule) {
      setShowDetector((current) => !current);
    } else {
      toast.error("Please set up a routine before starting live tracking.", {
        icon: "⚠️",
        duration: 3000,
      });
      setTimeout(() => navigate("/routine-setup"), 1500);
    }
  };

  const fetchData = async () => {
    try {
      const [devRes, schedRes, notifRes, logsRes] = await Promise.all([
        getDeviations(),
        getSchedule(),
        getNotifications(),
        getActivityLogs(),
      ]);
      setDeviations(devRes.data || []);
      setSchedule(schedRes.data || []);
      const newNotifs = normalizeNotifications(notifRes.data);
      setNotifications(newNotifs);
      const newUnreadCount = newNotifs.filter((n) => !n.read).length;
      if (
        newUnreadCount > prevUnreadCount.current &&
        prevUnreadCount.current !== 0
      ) {
        toast.error(`You have new alerts! Check the notifications.`, {
          icon: "⚠️",
          duration: 4000,
        });
        const missedNotifs = newNotifs.filter(
          (n) =>
            !n.read &&
            n.status === "Missed" &&
            !shownMissedRef.current.has(n.notification_id)
        );
        if (missedNotifs.length > 0) {
          const m = missedNotifs[0];
          shownMissedRef.current.add(m.notification_id);
          setActiveAlert({
            status: "Missed",
            activityName: m.activity_name,
            message: m.message,
            time: new Date(m.created_at || Date.now()).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          });
        }
      }
      prevUnreadCount.current = newUnreadCount;
      const logs = logsRes.data || [];
      setTotalLogs(logs.length);
      setRecentLogs(logs.slice(0, 5));
      setAllLogs(logs);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteIndividualActivity = async (activityName) => {
    try {
      if (!selectedSchedule) return;
      const currentSched = selectedSchedule;
      const updatedActivities = currentSched.activities.filter(
        (act) => act.activity_name !== activityName
      );
      if (updatedActivities.length === 0) {
        await deleteSchedule(currentSched.schedule_id);
        try {
          localStorage.removeItem(
            `lockedStatuses_${currentSched.schedule_id}_${todayStr}`
          );
        } catch { }
        toast.success("All activities deleted. Routine cleared!", {
          icon: "🗑",
        });
        setSchedule([]);
        setShowDetector(false);
        setShowProgressSidebar(false);
        setLockedStatuses({});
        return;
      }
      await createSchedule(updatedActivities, currentSched.description || "");
      setLockedStatuses((prev) => {
        const next = { ...prev };
        delete next[activityName];
        saveLockedStatuses(currentSched.schedule_id, todayStr, next);
        return next;
      });
      toast.success(`"${activityName}" deleted and schedule saved!`, {
        icon: "🗑",
      });
      fetchData();
    } catch (e) {
      console.error("Failed to delete activity:", e);
      toast.error("Failed to delete activity.");
    }
  };

  const handleDeleteSchedule = async () => {
    if (!selectedSchedule) return;
    if (
      window.confirm(
        "Are you sure you want to delete the current routine? All associated logs will be cleared."
      )
    ) {
      try {
        await deleteSchedule(selectedSchedule.schedule_id);
        try {
          localStorage.removeItem(
            `lockedStatuses_${selectedSchedule.schedule_id}_${todayStr}`
          );
        } catch { }
        toast.success("Routine deleted successfully", { icon: "🗑" });
        setSchedule([]);
        setShowDetector(false);
        setRecentLogs([]);
        setAllLogs([]);
        setTotalLogs(0);
        setDeviations([]);
        setNotifications([]);
        setShowProgressSidebar(false);
        setLockedStatuses({});
      } catch (err) {
        toast.error("Failed to delete routine");
      }
    }
  };

  const getSidebarStatus = (activity) => {
    const locked = lockedStatuses[activity.activity_name];
    if (locked) return locked;

    const matchingLog = allLogs.find(
      (l) =>
        l.activity_name === activity.activity_name &&
        (!l.date || l.date === todayStr)
    );
    const logStatus = matchingLog?.display_status || matchingLog?.status;
    if (logStatus && FINAL_STATUSES.includes(logStatus)) {
      return logStatus;
    }

    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const startMin = timeToMinutes(activity.start_time);
    const endMin = timeToMinutes(activity.end_time);

    if (nowMin > endMin) return "Missed";
    if (nowMin >= startMin && nowMin <= endMin) return "In Progress";
    return "Pending";
  };

  const sidebarActivities = (selectedSchedule?.activities || []).map(
    (activity) => ({
      ...activity,
      status: getSidebarStatus(activity),
    })
  );

  const sidebarCounts = {
    Completed: sidebarActivities.filter((a) => a.status === "Completed").length,
    Early: sidebarActivities.filter((a) => a.status === "Early").length,
    Late: sidebarActivities.filter((a) => a.status === "Late").length,
    Missed: sidebarActivities.filter((a) => a.status === "Missed").length,
  };

  const sidebarTotal = sidebarActivities.length;
  const sidebarDoneCount = sidebarCounts.Completed + sidebarCounts.Early;
  const sidebarPct =
    sidebarTotal > 0 ? Math.round((sidebarDoneCount / sidebarTotal) * 100) : 0;

  return (
    <div className="w-full pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Live Dashboard
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Real-time health metrics and routine monitoring.
          </p>
        </div>

        <div className="hidden md:flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/40 backdrop-blur-md px-3 py-3 shadow-lg shadow-blue-950/10">
          <div className="w-14 h-14 rounded-xl overflow-hidden border border-gray-700/60 shrink-0">
            <img
              src={`${assetBase}system-overview.png`}
              alt="System overview"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="pr-2">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">
              Live View
            </p>
            <p className="text-sm text-white font-medium">
              Monitoring pipeline active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/40 backdrop-blur-md px-4 py-3 shadow-lg shadow-blue-950/10">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">
              Current Time
            </p>
            <p className="text-lg font-mono font-bold text-white tabular-nums">
              {currentTime.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button
            onClick={() => navigate("/routine-setup")}
            className="px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 border border-gray-700 bg-gray-900/70 text-white hover:bg-gray-800"
          >
            Set up a routine
          </button>
          <button
            onClick={handleStartTracking}
            disabled={!selectedSchedule}
            className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 shadow-lg flex items-center gap-2 ${showDetector
                ? "bg-rose-500/10 text-rose-400 border border-rose-500/50 hover:bg-rose-500/20"
                : selectedSchedule
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30 hover:shadow-blue-900/50"
                  : "bg-gray-700 text-gray-400 cursor-not-allowed"
              }`}
          >
            {showDetector ? "⏹ Stop Camera" : "▶ Start Live Tracking"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
      ) : (
        <div
          className="space-y-8 animate-slide-up"
          style={{ animationDelay: "0.1s" }}
        >
          {selectedSchedule && (
            <div
              className={`mb-2 rounded-2xl overflow-hidden shadow-2xl border border-gray-800 bg-gray-900/50 backdrop-blur-xl ${showDetector ? "" : "opacity-95"
                }`}
            >
              <div className="flex justify-end px-4 pt-4">
                <button
                  onClick={() => setShowProgressSidebar(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow-md transition-colors flex items-center gap-2"
                >
                  📊 Schedule Progress
                </button>
              </div>
              <ActivityDetectorMonitor
                schedule={selectedSchedule}
                autoStart={showDetector}
                onActivityConfirmed={(info) => {
                  if (
                    info?.activity_name &&
                    FINAL_STATUSES.includes(info.status)
                  ) {
                    setLockedStatuses((prev) => {
                      const next = {
                        ...prev,
                        [info.activity_name]: info.status,
                      };
                      saveLockedStatuses(
                        selectedSchedule.schedule_id,
                        todayStr,
                        next
                      );
                      return next;
                    });
                  }
                  fetchData();
                }}
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-900/20 group relative overflow-hidden">
              <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2 relative z-10">
                <span>🌙</span> Sleep Quality
              </p>
              <div className="mt-4 flex items-end gap-3 mb-4 relative z-10">
                <span className="text-4xl font-bold text-white group-hover:text-indigo-400 transition-colors">
                  85%
                </span>
                <span className="text-sm text-gray-500 mb-1">
                  7h 45m (Restful)
                </span>
              </div>
            </div>

            <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-900/20 group relative overflow-hidden">
              <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2 relative z-10">
                <span>👣</span> Step Count
              </p>
              <div className="mt-4 flex items-end gap-3 mb-4 relative z-10">
                <span className="text-4xl font-bold text-white group-hover:text-emerald-400 transition-colors">
                  4,230
                </span>
                <span className="text-sm text-gray-500 mb-1">steps today</span>
              </div>
            </div>

            <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-900/20 group relative overflow-hidden">
              <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"></div>
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2 relative z-10">
                <span>⚡</span> Activity Level
              </p>
              <div className="mt-4 flex items-end gap-3 mb-4 relative z-10">
                <span className="text-4xl font-bold text-white group-hover:text-amber-400 transition-colors">
                  Active
                </span>
                <span className="text-sm text-gray-500 mb-1">
                  Moderate pace
                </span>
              </div>
            </div>
          </div>

          {!selectedSchedule && (
            <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl p-12 border border-gray-800/60 text-center text-gray-500">
              <p className="mb-4 text-4xl">📭</p>
              <p>
                {schedule.length === 0
                  ? "No routine established yet."
                  : "Set up a routine to start live monitoring."}
              </p>
              <button
                onClick={() => navigate("/routine-setup")}
                className="mt-4 text-blue-400 hover:text-blue-300 text-sm font-medium transition"
              >
                Set up a routine →
              </button>
            </div>
          )}
        </div>
      )}

      {showProgressSidebar && (
        <>
          <div
            className="fixed inset-0 z-40 sidebar-overlay"
            onClick={() => setShowProgressSidebar(false)}
          />
          <div className="fixed top-0 right-0 h-full w-full max-w-sm z-50 sidebar-slide-in bg-gray-950 border-l border-gray-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm">
                  📊
                </span>
                Schedule Progress
              </h2>
              <button
                onClick={() => setShowProgressSidebar(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              {!selectedSchedule ? (
                <div className="text-center text-gray-500 py-12">
                  <p className="text-3xl mb-3">📭</p>
                  <p>No routine established yet.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-900/60 border border-emerald-500/30 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-emerald-400">
                        {sidebarCounts.Completed}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1">
                        Completed
                      </div>
                    </div>
                    <div className="bg-gray-900/60 border border-sky-500/30 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-sky-400">
                        {sidebarCounts.Early}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1">Early</div>
                    </div>
                    <div className="bg-gray-900/60 border border-amber-500/30 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-amber-400">
                        {sidebarCounts.Late}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1">Late</div>
                    </div>
                    <div className="bg-gray-900/60 border border-rose-500/30 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-rose-400">
                        {sidebarCounts.Missed}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1">
                        Missed
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-gray-400">
                        Overall Progress
                      </span>
                      <span className="text-xs font-semibold text-white">
                        {sidebarDoneCount}/{sidebarTotal} · {sidebarPct}%
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 rounded-full transition-all duration-500"
                        style={{ width: `${sidebarPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    {sidebarActivities.map((activity, idx) => {
                      const cfg =
                        SIDEBAR_STATUS_STYLE[activity.status] ||
                        SIDEBAR_STATUS_STYLE.Pending;
                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${cfg.border} ${cfg.bg}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-lg shrink-0">
                              {getActivityIcon(activity.activity_name)}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate">
                                {activity.activity_name}
                              </p>
                              <p className="text-[11px] text-gray-500">
                                {activity.start_time} – {activity.end_time}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold ${cfg.text}`}
                            >
                              {cfg.icon} {activity.status}
                            </span>
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete "${activity.activity_name}" from the routine?`
                                  )
                                ) {
                                  handleDeleteIndividualActivity(
                                    activity.activity_name
                                  );
                                }
                              }}
                              className="w-7 h-7 flex items-center justify-center rounded-md text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                              title={`Delete ${activity.activity_name}`}
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {sidebarActivities.length === 0 && (
                      <p className="text-center text-gray-500 text-sm py-6">
                        No activities in this routine.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-800 space-y-2">
              {selectedSchedule && (
                <button
                  onClick={handleDeleteSchedule}
                  className="w-full px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-sm font-semibold rounded-lg border border-rose-500/30 transition-colors flex items-center justify-center gap-2"
                >
                  <span>🗑</span> Delete Routine
                </button>
              )}
              <button
                onClick={() => {
                  setShowProgressSidebar(false);
                  navigate("/schedule-progress");
                }}
                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow-md transition-colors"
              >
                View Full Progress →
              </button>
            </div>
          </div>
        </>
      )}

      <AlertModal alert={activeAlert} onDismiss={() => setActiveAlert(null)} />
    </div>
  );
}