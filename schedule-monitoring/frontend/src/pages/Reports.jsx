import { useEffect, useState } from "react";
import {
  getActivityLogs,
  getNotifications,
  getSchedule,
  getDayReport,
  getWeekReport,
} from "../services/scheduleApi";

const getActivityIcon = (name) => {
  const n = (name || "").toLowerCase();
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

const todayStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const FINAL_STATUSES = ["Completed", "Early", "Late", "Missed", "Not Done", "Done", "Complete"];

const normalizeStatus = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (["Completed", "Complete", "Done", "On Time"].includes(s)) return "Completed";
  if (s === "Early") return "Early";
  if (["Late", "Slightly Late"].includes(s)) return "Late";
  if (s === "Missed") return "Missed";
  if (s === "Not Done") return "Not Done";
  if (FINAL_STATUSES.includes(s)) return s;
  return null;
};

export default function Reports() {
  const [logs, setLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("logs");
  const [reportMode, setReportMode] = useState("day");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [dayReport, setDayReport] = useState(null);
  const [weekReport, setWeekReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [lockedStatuses, setLockedStatuses] = useState({});

  const selectedSchedule = schedule[0] || null;
  const today = todayStr();

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (activeTab === "reports") {
      fetchReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, reportMode, selectedDate]);

  // Load same locked statuses used by Schedule Progress
  useEffect(() => {
    if (!selectedSchedule?.schedule_id) {
      setLockedStatuses({});
      return;
    }
    try {
      const key = `lockedStatuses_${selectedSchedule.schedule_id}_${today}`;
      const saved = localStorage.getItem(key);
      setLockedStatuses(saved ? JSON.parse(saved) : {});
    } catch {
      setLockedStatuses({});
    }
  }, [selectedSchedule?.schedule_id, today, logs]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [logsRes, notifRes, schedRes] = await Promise.all([
        getActivityLogs(),
        getNotifications(false),
        getSchedule(),
      ]);
      setLogs(logsRes.data || []);
      setNotifications(notifRes.data || []);
      setSchedule(schedRes.data || []);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchReport = async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      if (reportMode === "day") {
        const res = await getDayReport(selectedDate);
        setDayReport(res.data || null);
      } else {
        const res = await getWeekReport(selectedDate);
        setWeekReport(res.data || null);
      }
    } catch (error) {
      console.error("Error fetching report:", error);
      setReportError("Couldn't load that report. Try a different date.");
    } finally {
      setReportLoading(false);
    }
  };

  // Resolve status for one activity (same priority as progress page)
  const getActivityStatus = (activity) => {
    const locked = lockedStatuses[activity.activity_name];
    if (locked && FINAL_STATUSES.includes(locked)) {
      return normalizeStatus(locked) || locked;
    }

    const matchingLogs = logs.filter(
      (l) =>
        l.activity_name === activity.activity_name &&
        (!l.date || l.date === today)
    );
    matchingLogs.sort((a, b) => {
      const ta = new Date(a.completed_at || a.detected_at || a.timestamp || 0).getTime();
      const tb = new Date(b.completed_at || b.detected_at || b.timestamp || 0).getTime();
      return tb - ta;
    });
    const log = matchingLogs[0];
    const fromLog = normalizeStatus(log?.display_status || log?.status);
    if (fromLog) return fromLog;

    return "Pending";
  };

  // Summary stats from locked statuses + logs (matches View Full Progress)
  const activities = selectedSchedule?.activities || [];
  const activityStatuses = activities.map((a) => ({
    ...a,
    status: getActivityStatus(a),
  }));

  const stats = {
    Completed: activityStatuses.filter((a) => a.status === "Completed").length,
    Early: activityStatuses.filter((a) => a.status === "Early").length,
    Late: activityStatuses.filter((a) => a.status === "Late").length,
    Missed: activityStatuses.filter((a) => a.status === "Missed").length,
  };

  const doneCount = stats.Completed + stats.Early;
  const totalActivities = activities.length;
  const progressPct =
    totalActivities > 0 ? Math.round((doneCount / totalActivities) * 100) : 0;

  const statusBadge = (status) => {
    if (status === "Completed") {
      return {
        text: "Completed",
        color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
        icon: "✅",
      };
    }
    if (status === "Early") {
      return {
        text: "Early",
        color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
        icon: "⏱️",
      };
    }
    if (status === "Late") {
      return {
        text: "Late",
        color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
        icon: "⏰",
      };
    }
    if (status === "Missed") {
      return {
        text: "Missed",
        color: "text-rose-400 bg-rose-500/10 border-rose-500/20",
        icon: "❌",
      };
    }
    return {
      text: status || "Pending",
      color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
      icon: "⏳",
    };
  };

  return (
    <div className="w-full pb-20 animate-slide-up">
      {/* Hero Banner */}
      <div className="mb-10 rounded-3xl border border-gray-800 bg-gray-900/40 backdrop-blur-md p-6 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-56 h-56 bg-purple-500/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row gap-6 items-center relative z-10">
          <div className="flex-1">
            <div className="inline-block px-3 py-1 bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-bold rounded-full mb-3 uppercase tracking-widest">
              Analytics & Insights
            </div>
            <h1 className="text-4xl font-extrabold text-white tracking-tight">
              Activity Reports
            </h1>
            <p className="text-gray-400 mt-2 text-sm">
              Live progress + historical logs and system alerts
            </p>
          </div>
          <img
            src={`${import.meta.env.BASE_URL}reports-hero.png`}
            alt="Reports"
            className="w-32 h-32 rounded-2xl object-cover border border-gray-700/50 shadow-lg"
          />
        </div>
        <div className="mt-4 relative z-10">
          <button
            onClick={fetchData}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white font-semibold text-sm rounded-xl transition-colors border border-gray-700 shadow-lg"
          >
            ↻ Refresh Data
          </button>
        </div>
      </div>

      {/* Top stats — same meaning as View Full Progress */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl"></div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider relative z-10">
            Completed
          </p>
          <div className="mt-3 relative z-10">
            <span className="text-3xl font-bold text-emerald-400">{stats.Completed}</span>
          </div>
        </div>
        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/10 rounded-full blur-2xl"></div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider relative z-10">
            Early
          </p>
          <div className="mt-3 relative z-10">
            <span className="text-3xl font-bold text-sky-400">{stats.Early}</span>
          </div>
        </div>
        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl"></div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider relative z-10">
            Late
          </p>
          <div className="mt-3 relative z-10">
            <span className="text-3xl font-bold text-amber-400">{stats.Late}</span>
          </div>
        </div>
        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl"></div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider relative z-10">
            Missed
          </p>
          <div className="mt-3 relative z-10">
            <span className="text-3xl font-bold text-rose-400">{stats.Missed}</span>
          </div>
        </div>
        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl"></div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider relative z-10">
            Progress
          </p>
          <div className="mt-3 relative z-10">
            <span className="text-3xl font-bold text-white">
              {doneCount}/{totalActivities || 0}
            </span>
            <span className="text-sm text-gray-400 ml-2">{progressPct}%</span>
          </div>
        </div>
      </div>

      {/* Overall progress bar */}
      {totalActivities > 0 && (
        <div className="mb-10 bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-300">Overall Progress</span>
            <span className="text-sm font-semibold text-white">
              {doneCount}/{totalActivities} done · {progressPct}%
            </span>
          </div>
          <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Routine Summary with live statuses */}
        <div className="lg:col-span-1 bg-gray-900/40 backdrop-blur-md rounded-2xl border border-gray-800/60 shadow-lg p-6 flex flex-col h-fit">
          <h2 className="text-lg font-bold text-white flex items-center gap-2.5 mb-6">
            <span className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm">
              📅
            </span>
            Routine Summary
          </h2>

          {activities.length === 0 ? (
            <div className="py-12 text-center text-gray-500 flex-1 flex flex-col items-center justify-center">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-sm">No active routine found.</p>
            </div>
          ) : (
            <div className="space-y-4 flex-1">
              {activityStatuses.map((activity, idx) => {
                const badge = statusBadge(activity.status);
                return (
                  <div
                    key={idx}
                    className="p-4 bg-gray-950/40 rounded-xl border border-gray-800/80 hover:border-gray-700 transition duration-200"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-lg bg-gray-900/80 border border-gray-800 flex items-center justify-center text-xl">
                          {getActivityIcon(activity.activity_name)}
                        </span>
                        <div>
                          <p className="text-sm font-bold text-white">
                            {activity.activity_name}
                          </p>
                          <p className="text-[11px] text-gray-500 font-mono tracking-tight mt-0.5">
                            {activity.start_time} — {activity.end_time}
                          </p>
                        </div>
                      </div>
                      <div
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${badge.color}`}
                      >
                        <span>{badge.icon}</span>
                        <span>{badge.text}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Tabs */}
        <div className="lg:col-span-2 bg-gray-900/40 backdrop-blur-md rounded-2xl border border-gray-800/60 shadow-lg overflow-hidden flex flex-col min-h-[500px]">
          <div className="flex border-b border-gray-800/60 bg-gray-950/30">
            <button
              onClick={() => setActiveTab("logs")}
              className={`px-6 py-4 font-semibold text-sm transition-colors border-b-2 ${
                activeTab === "logs"
                  ? "border-blue-500 text-blue-400 bg-blue-500/5"
                  : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"
              }`}
            >
              📋 Activity Logs
            </button>
            <button
              onClick={() => setActiveTab("notifications")}
              className={`px-6 py-4 font-semibold text-sm transition-colors border-b-2 ${
                activeTab === "notifications"
                  ? "border-rose-500 text-rose-400 bg-rose-500/5"
                  : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"
              }`}
            >
              🔔 All Notifications
            </button>
            <button
              onClick={() => setActiveTab("reports")}
              className={`px-6 py-4 font-semibold text-sm transition-colors border-b-2 ${
                activeTab === "reports"
                  ? "border-purple-500 text-purple-400 bg-purple-500/5"
                  : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"
              }`}
            >
              📆 Day / Week Reports
            </button>
          </div>

          <div className="p-6 flex-1 overflow-auto">
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
              </div>
            ) : (
              <>
                {activeTab === "logs" && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
                        <th className="pb-3 font-semibold">Activity</th>
                        <th className="pb-3 font-semibold">Detected At</th>
                        <th className="pb-3 font-semibold text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {logs.length > 0 ? (
                        logs.map((log, idx) => {
                          const status =
                            normalizeStatus(log.display_status || log.status) ||
                            log.status ||
                            "Unknown";
                          let statusClass = "bg-gray-800 text-gray-400 border-gray-700";
                          if (status === "Completed") {
                            statusClass =
                              "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                          } else if (status === "Early") {
                            statusClass =
                              "bg-sky-500/10 text-sky-400 border-sky-500/20";
                          } else if (status === "Late") {
                            statusClass =
                              "bg-amber-500/10 text-amber-400 border-amber-500/20";
                          } else if (status === "Missed") {
                            statusClass =
                              "bg-rose-500/10 text-rose-400 border-rose-500/20";
                          }
                          return (
                            <tr key={idx} className="hover:bg-gray-800/20 transition-colors">
                              <td className="py-4 text-sm font-medium text-gray-200">
                                {log.activity_name}
                              </td>
                              <td className="py-4 text-xs text-gray-400 font-mono">
                                {log.detected_at
                                  ? new Date(log.detected_at).toLocaleString()
                                  : "N/A"}
                              </td>
                              <td className="py-4 text-center">
                                <span
                                  className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${statusClass}`}
                                >
                                  {status}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td
                            colSpan="3"
                            className="py-12 text-center text-gray-500 text-sm"
                          >
                            No activity logs found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                {activeTab === "notifications" && (
                  <div className="space-y-3">
                    {notifications.length > 0 ? (
                      notifications.map((notif, idx) => (
                        <div
                          key={idx}
                          className={`p-4 rounded-xl border flex items-start gap-4 transition-colors ${
                            notif.read
                              ? "bg-gray-900/30 border-gray-800"
                              : "bg-rose-500/5 border-rose-500/20"
                          }`}
                        >
                          <div
                            className={`mt-0.5 w-2 h-2 rounded-full ${
                              notif.read
                                ? "bg-gray-700"
                                : "bg-rose-500 shadow-[0_0_8px_rgba(225,29,72,0.5)]"
                            }`}
                          ></div>
                          <div>
                            <p
                              className={`text-sm font-semibold ${
                                notif.read ? "text-gray-300" : "text-rose-200"
                              }`}
                            >
                              {notif.activity_name || "Alert"}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">{notif.message}</p>
                            <p className="text-[10px] text-gray-500 mt-2 font-mono">
                              {new Date(notif.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-12 text-center text-gray-500 text-sm">
                        No notifications found.
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "reports" && (
                  <div>
                    <div className="flex flex-wrap items-center gap-3 mb-6">
                      <div className="flex rounded-xl border border-gray-800 overflow-hidden">
                        <button
                          onClick={() => setReportMode("day")}
                          className={`px-4 py-2 text-sm font-semibold transition-colors ${
                            reportMode === "day"
                              ? "bg-purple-500/20 text-purple-300"
                              : "bg-gray-950/40 text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          Day
                        </button>
                        <button
                          onClick={() => setReportMode("week")}
                          className={`px-4 py-2 text-sm font-semibold transition-colors ${
                            reportMode === "week"
                              ? "bg-purple-500/20 text-purple-300"
                              : "bg-gray-950/40 text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          Week
                        </button>
                      </div>
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="bg-gray-950/40 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500/50"
                      />
                      {reportMode === "week" && (
                        <span className="text-xs text-gray-500">
                          Week starting from the date above (7 days)
                        </span>
                      )}
                    </div>

                    {reportLoading ? (
                      <div className="py-12 flex items-center justify-center">
                        <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                      </div>
                    ) : reportError ? (
                      <div className="py-12 text-center text-rose-400 text-sm">
                        {reportError}
                      </div>
                    ) : reportMode === "day" ? (
                      dayReport ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                              Done
                            </p>
                            <p className="text-2xl font-bold text-emerald-400">
                              {dayReport.counts?.done ?? dayReport.counts?.Completed ?? 0}
                            </p>
                          </div>
                          <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                              Late
                            </p>
                            <p className="text-2xl font-bold text-amber-400">
                              {dayReport.counts?.late ?? dayReport.counts?.Late ?? 0}
                            </p>
                          </div>
                          <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                              Missed
                            </p>
                            <p className="text-2xl font-bold text-rose-400">
                              {dayReport.counts?.missed ?? dayReport.counts?.Missed ?? 0}
                            </p>
                          </div>
                          <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                              Total
                            </p>
                            <p className="text-2xl font-bold text-white">
                              {dayReport.counts?.total ?? 0}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="py-12 text-center text-gray-500 text-sm">
                          No archived report yet for {selectedDate}. Reports are created when a
                          new routine replaces the previous one.
                        </div>
                      )
                    ) : (
                      weekReport && (
                        <div>
                          <table className="w-full text-left border-collapse mb-6">
                            <thead>
                              <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
                                <th className="pb-3 font-semibold">Date</th>
                                <th className="pb-3 font-semibold text-center">Done</th>
                                <th className="pb-3 font-semibold text-center">Late</th>
                                <th className="pb-3 font-semibold text-center">Missed</th>
                                <th className="pb-3 font-semibold text-center">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800/50">
                              {(weekReport.daily_reports || []).map((r, idx) => (
                                <tr key={idx}>
                                  <td className="py-3 text-sm text-gray-200 font-mono">
                                    {r.date}
                                  </td>
                                  {r.counts ? (
                                    <>
                                      <td className="py-3 text-center text-emerald-400 font-semibold">
                                        {r.counts.done ?? r.counts.Completed ?? 0}
                                      </td>
                                      <td className="py-3 text-center text-amber-400 font-semibold">
                                        {r.counts.late ?? r.counts.Late ?? 0}
                                      </td>
                                      <td className="py-3 text-center text-rose-400 font-semibold">
                                        {r.counts.missed ?? r.counts.Missed ?? 0}
                                      </td>
                                      <td className="py-3 text-center text-white font-semibold">
                                        {r.counts.total ?? 0}
                                      </td>
                                    </>
                                  ) : (
                                    <td
                                      colSpan="4"
                                      className="py-3 text-center text-gray-600 text-xs"
                                    >
                                      No report yet
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 text-center">
                              <p className="text-xs text-purple-300 uppercase tracking-wider mb-1">
                                Week Done
                              </p>
                              <p className="text-2xl font-bold text-emerald-400">
                                {weekReport.weekly_totals?.done ?? 0}
                              </p>
                            </div>
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 text-center">
                              <p className="text-xs text-purple-300 uppercase tracking-wider mb-1">
                                Week Late
                              </p>
                              <p className="text-2xl font-bold text-amber-400">
                                {weekReport.weekly_totals?.late ?? 0}
                              </p>
                            </div>
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 text-center">
                              <p className="text-xs text-purple-300 uppercase tracking-wider mb-1">
                                Week Missed
                              </p>
                              <p className="text-2xl font-bold text-rose-400">
                                {weekReport.weekly_totals?.missed ?? 0}
                              </p>
                            </div>
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 text-center">
                              <p className="text-xs text-purple-300 uppercase tracking-wider mb-1">
                                Week Total
                              </p>
                              <p className="text-2xl font-bold text-white">
                                {weekReport.weekly_totals?.total ?? 0}
                              </p>
                            </div>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}