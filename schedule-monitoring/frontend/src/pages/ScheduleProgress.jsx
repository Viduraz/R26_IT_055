// schedule-monitoring/frontend/src/pages/ScheduleProgress.jsx
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  getSchedule,
  getActivityLogs,
  deleteSchedule,
  getDayReport,
  getWeekReport,
} from "../services/scheduleApi";
import toast from "react-hot-toast";

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

const getTodayStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = String(timeStr).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// FIX (Dashboard Schedule Sidebar & Detection Status Fix plan):
// The backend (monitoring_service.py) now decides Completed vs Late using
// each activity's own start_time/end_time boundary instead of a fixed
// 20-minute cutoff, and once a log exists for {schedule_id, date} with a
// final status it is locked (see FINAL_LOG_STATUSES / the dedup guard in
// process_detection_event()). So the first thing this function does is
// trust that persisted, locked display_status completely and return it
// as-is — it must NEVER be recomputed or overridden once a log exists.
//
// The fallback branch below (no log written yet) mirrors the exact same
// end_time boundary the backend uses, so a not-yet-detected activity shows
// "Missed" the moment its window closes, "In Progress" while inside its
// window, and "Upcoming" beforehand — consistent with the backend's rules,
// with no 20-minute threshold anywhere in this calculation.
const computeStatus = (activity, log, nowMinutes) => {
  if (log && log.display_status) {
    // Locked/final status from the database — trust it verbatim.
    return log.display_status;
  }
  const startMin = timeToMinutes(activity.start_time);
  const endMin = timeToMinutes(activity.end_time);
  if (nowMinutes > endMin) return "Missed";
  if (nowMinutes >= startMin && nowMinutes <= endMin) return "In Progress";
  return "Upcoming";
};

const statusConfig = {
  Completed: { label: "Completed", bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/40", dot: "bg-emerald-400", icon: "✅" },
  Early: { label: "Early", bg: "bg-sky-500/15", text: "text-sky-400", border: "border-sky-500/40", dot: "bg-sky-400", icon: "⏰" },
  Late: { label: "Late", bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/40", dot: "bg-amber-400", icon: "⏳" },
  Missed: { label: "Missed", bg: "bg-rose-500/15", text: "text-rose-400", border: "border-rose-500/40", dot: "bg-rose-400", icon: "❌" },
  "Not Done": { label: "Not Done", bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/40", dot: "bg-orange-400", icon: "🚫" },
  "In Progress": { label: "In Progress", bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/40", dot: "bg-blue-400 animate-pulse", icon: "🔄" },
  Upcoming: { label: "Upcoming", bg: "bg-gray-500/15", text: "text-gray-400", border: "border-gray-600/40", dot: "bg-gray-500", icon: "🕒" },
  Done: { label: "Completed", bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/40", dot: "bg-emerald-400", icon: "✅" },
};

const emptyCounts = () => ({
  Completed: 0, Early: 0, Late: 0, Missed: 0, "In Progress": 0, Upcoming: 0,
});

export default function ScheduleProgress() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState("live");
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [weekStart, setWeekStart] = useState(getTodayStr());
  const [schedule, setSchedule] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dayReport, setDayReport] = useState(null);
  const [weekReport, setWeekReport] = useState(null);
  const [histLoading, setHistLoading] = useState(false);

  const selectedSchedule = schedule[0] || null;
  const todayStr = getTodayStr();

  const fetchLive = useCallback(async () => {
    try {
      const [schedRes, logsRes] = await Promise.all([getSchedule(), getActivityLogs()]);
      setSchedule(schedRes.data || []);
      setLogs(logsRes.data || []);
    } catch (err) {
      console.error("Failed to load live progress data:", err);
      toast.error("Could not load schedule progress");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, 5000);
    return () => clearInterval(interval);
  }, [fetchLive]);

  useEffect(() => {
    const clock = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  const fetchDay = useCallback(async (date) => {
    setHistLoading(true);
    try {
      const res = await getDayReport(date);
      setDayReport(res.data || null);
    } catch (err) {
      console.error("Day report failed:", err);
      setDayReport(null);
      toast.error("No archived report for that day");
    } finally {
      setHistLoading(false);
    }
  }, []);

  const fetchWeek = useCallback(async (start) => {
    setHistLoading(true);
    try {
      const res = await getWeekReport(start);
      setWeekReport(res.data || null);
    } catch (err) {
      console.error("Week report failed:", err);
      setWeekReport(null);
      toast.error("Could not load week report");
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === "day") fetchDay(selectedDate);
  }, [viewMode, selectedDate, fetchDay]);

  useEffect(() => {
    if (viewMode === "week") fetchWeek(weekStart);
  }, [viewMode, weekStart, fetchWeek]);

  const handleDeleteSchedule = async () => {
    if (!selectedSchedule) return;
    if (window.confirm("Are you sure you want to delete the current routine? All associated logs will be cleared.")) {
      try {
        await deleteSchedule(selectedSchedule.schedule_id);
        toast.success("Routine deleted successfully", { icon: "🗑" });
        setSchedule([]);
        setLogs([]);
      } catch (err) {
        toast.error("Failed to delete routine");
      }
    }
  };

  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  const activitiesWithStatus = (selectedSchedule?.activities || []).map((activity) => {
    const log = logs.find(
      (l) =>
        l.activity_name === activity.activity_name &&
        (!l.date || l.date === todayStr)
    );
    const status = computeStatus(activity, log, nowMinutes);
    return { ...activity, log, status };
  });

  const liveCounts = emptyCounts();
  activitiesWithStatus.forEach((a) => {
    if (liveCounts[a.status] !== undefined) liveCounts[a.status]++;
  });

  const liveTotal = activitiesWithStatus.length;
  const liveDone = liveCounts.Completed + liveCounts.Early;
  const livePct = liveTotal > 0 ? Math.round((liveDone / liveTotal) * 100) : 0;

  const normalizeArchiveCounts = (raw) => {
    if (!raw) return emptyCounts();
    const src = raw.counts || raw.summary || raw;
    return {
      Completed: src.Completed ?? src.Done ?? src.completed ?? src.done ?? 0,
      Early: src.Early ?? src.early ?? 0,
      Late: src.Late ?? src.late ?? 0,
      Missed: src.Missed ?? src.missed ?? 0,
      "In Progress": src["In Progress"] ?? src.in_progress ?? 0,
      Upcoming: src.Upcoming ?? src.upcoming ?? 0,
    };
  };

  const renderSummaryCards = (counts) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-emerald-400">{counts.Completed}</div>
        <div className="text-xs text-gray-400 mt-1">Completed</div>
      </div>
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-sky-400">{counts.Early}</div>
        <div className="text-xs text-gray-400 mt-1">Early</div>
      </div>
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-amber-400">{counts.Late}</div>
        <div className="text-xs text-gray-400 mt-1">Late</div>
      </div>
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-rose-400">{counts.Missed}</div>
        <div className="text-xs text-gray-400 mt-1">Missed</div>
      </div>
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-blue-400">{counts["In Progress"]}</div>
        <div className="text-xs text-gray-400 mt-1">In Progress</div>
      </div>
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-gray-400">{counts.Upcoming}</div>
        <div className="text-xs text-gray-400 mt-1">Upcoming</div>
      </div>
    </div>
  );

  const renderActivityRow = (activity, idx) => {
    const status = activity.status || activity.display_status || "Upcoming";
    const cfg = statusConfig[status] || statusConfig.Upcoming;
    return (
      <div key={idx} className={`relative flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl border ${cfg.border} ${cfg.bg} transition-all`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-2xl shrink-0">{getActivityIcon(activity.activity_name)}</span>
          <div className="min-w-0">
            <div className="font-semibold text-white truncate">{activity.activity_name}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {activity.start_time} – {activity.end_time}
              {activity.duration ? ` · ${activity.duration}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${cfg.border} ${cfg.bg} ${cfg.text}`}>
            <span className={`w-2 h-2 rounded-full ${cfg.dot}`}></span>
            {cfg.icon} {cfg.label}
          </span>
        </div>
        {(activity.log?.completed_at || activity.log?.timestamp || activity.completed_at) && (
          <div className="text-xs text-gray-500 sm:text-right w-full sm:w-auto">
            {new Date(activity.log?.completed_at || activity.log?.timestamp || activity.completed_at)
              .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Schedule Progress Tracking</h1>
          <p className="text-gray-400 text-sm mt-1">Live + archived status — Early · Late · Missed · Completed</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 border border-gray-700 bg-gray-900/70 text-white hover:bg-gray-800"
          >
            ← Back to Dashboard
          </button>
          {selectedSchedule && viewMode === "live" && (
            <button
              onClick={handleDeleteSchedule}
              className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold rounded-lg border border-rose-500/30 transition-colors flex items-center gap-2"
            >
              <span>🗑</span> Delete Routine
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { id: "live", label: "Live Today" },
          { id: "day", label: "Day Report" },
          { id: "week", label: "Week Report" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setViewMode(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              viewMode === tab.id
                ? "bg-blue-600 text-white shadow-md"
                : "bg-gray-900/60 text-gray-400 border border-gray-700 hover:bg-gray-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {viewMode === "live" && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
          ) : !selectedSchedule ? (
            <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl p-12 border border-gray-800/60 text-center">
              <p className="text-5xl mb-4">📭</p>
              <p className="text-gray-400 mb-4">No routine established yet.</p>
              <button onClick={() => navigate("/routine-setup")} className="text-blue-400 hover:text-blue-300 text-sm font-medium transition">
                Set up a routine →
              </button>
            </div>
          ) : (
            <div className="space-y-8 animate-slide-up">
              {renderSummaryCards(liveCounts)}
              <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl p-6 border border-gray-800/60">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium text-gray-300">Overall Progress</span>
                  <span className="text-sm font-semibold text-white">{liveDone}/{liveTotal} done · {livePct}%</span>
                </div>
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 rounded-full transition-all duration-500" style={{ width: `${livePct}%` }} />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Current time: {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </p>
              </div>
              <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl p-6 sm:p-8 border border-gray-800/60 shadow-lg">
                <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-3 mb-6">
                  <span className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm">📊</span>
                  Activity Status
                </h2>
                <div className="space-y-4">
                  {activitiesWithStatus.map((a, i) => renderActivityRow(a, i))}
                  {activitiesWithStatus.length === 0 && (
                    <p className="text-center text-gray-500 py-8">No activities in this routine.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {viewMode === "day" && (
        <div className="space-y-6 animate-slide-up">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-400">Select date:</label>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            <button onClick={() => fetchDay(selectedDate)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg">Load</button>
          </div>
          {histLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : !dayReport ? (
            <div className="bg-gray-900/40 rounded-2xl p-12 border border-gray-800/60 text-center text-gray-500">
              No archived report for {selectedDate}.
            </div>
          ) : (
            <>
              {renderSummaryCards(normalizeArchiveCounts(dayReport))}
              <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl p-6 sm:p-8 border border-gray-800/60">
                <h2 className="text-lg font-semibold text-gray-100 mb-4">Activities — {selectedDate}</h2>
                <div className="space-y-4">
                  {(dayReport.activities || dayReport.items || []).map((a, i) =>
                    renderActivityRow({ ...a, status: a.status || a.display_status || a.result }, i)
                  )}
                  {!(dayReport.activities || dayReport.items || []).length && (
                    <p className="text-center text-gray-500 py-6">No activity details stored for this day.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {viewMode === "week" && (
        <div className="space-y-6 animate-slide-up">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-400">Week starting:</label>
            <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            <button onClick={() => fetchWeek(weekStart)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg">Load Week</button>
          </div>
          {histLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : !weekReport ? (
            <div className="bg-gray-900/40 rounded-2xl p-12 border border-gray-800/60 text-center text-gray-500">
              No week report available for that range.
            </div>
          ) : (
            <>
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-3">Weekly Totals</h3>
                {renderSummaryCards(normalizeArchiveCounts(weekReport.totals || weekReport))}
              </div>
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-gray-400">Per-Day Breakdown</h3>
                {(weekReport.daily_reports || weekReport.days || weekReport.reports || []).map((day, idx) => {
                  const c = normalizeArchiveCounts(day);
                  const dateLabel = day.date || day.day || `Day ${idx + 1}`;
                  return (
                    <div key={idx} className="bg-gray-900/40 border border-gray-800/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="font-semibold text-white w-32 shrink-0">{dateLabel}</div>
                      <div className="flex flex-wrap gap-3 text-xs">
                        <span className="text-emerald-400">✅ {c.Completed}</span>
                        <span className="text-sky-400">⏰ {c.Early}</span>
                        <span className="text-amber-400">⏳ {c.Late}</span>
                        <span className="text-rose-400">❌ {c.Missed}</span>
                      </div>
                      <button onClick={() => { setSelectedDate(dateLabel); setViewMode("day"); }}
                        className="sm:ml-auto text-blue-400 hover:text-blue-300 text-xs font-medium">
                        View day →
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
