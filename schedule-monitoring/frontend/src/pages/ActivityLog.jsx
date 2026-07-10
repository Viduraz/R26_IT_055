// schedule-monitoring/frontend/src/pages/ActivityLog.jsx
import { useState, useEffect, useCallback } from "react";
import { getActivityLogs } from "../services/scheduleApi";

const PATIENT_ID = "patient_001";

const STATUS_CFG = {
  done:              { label: "Done",          cls: "badge-done"             },
  late:              { label: "Late",          cls: "badge-late"             },
  missed:            { label: "Missed",        cls: "badge-missed"           },
  caregiver_missing: { label: "No Caregiver",  cls: "badge-caregiver_missing"},
  pending:           { label: "Pending",       cls: "badge-pending"          },
  requires_review:   { label: "Review",        cls: "badge-requires_review"  },
};

const TASK_TYPE_ICONS = {
  meal: "🍽", medication: "💊", sleep: "😴", rest: "🛋",
  exercise: "🚶", hydration: "💧", caregiver_assisted: "🤝", other: "📋",
};

const ALL_STATUSES = ["all", "done", "late", "missed", "caregiver_missing"];

function formatDate(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleDateString("en-IN", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return isoStr; }
}

function formatTime(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch { return isoStr; }
}

export default function ActivityLog({ patientId = PATIENT_ID }) {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter]     = useState("");
  const [search, setSearch]             = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getActivityLogs(patientId);
      setLogs(Array.isArray(r.data) ? r.data : []);
    } catch { setLogs([]); } finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const filtered = logs.filter((log) => {
    if (statusFilter !== "all" && log.status !== statusFilter) return false;
    if (dateFilter && log.date !== dateFilter) return false;
    if (search && !log.task_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Summary counts
  const counts = logs.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});

  const uniqueDates = [...new Set(logs.map((l) => l.date).filter(Boolean))].sort().reverse();

  return (
    <div className="p-8 max-w-6xl mx-auto fade-in">
      {/* Hero Banner */}
      <div className="mb-8 rounded-3xl border border-gray-800 bg-gray-900/40 backdrop-blur-md p-6 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-56 h-56 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row gap-6 items-center relative z-10">
          <div className="flex-1">
            <div className="inline-block px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold rounded-full mb-3 uppercase tracking-widest">
              Activity Tracking
            </div>
            <h1 className="text-2xl font-bold text-white">Activity Log</h1>
            <p className="text-gray-500 text-sm mt-1">Full history of detected activities vs. scheduled tasks.</p>
          </div>
          <img 
            src={`${import.meta.env.BASE_URL}activity-log.png`} 
            alt="Activity Log" 
            className="w-28 h-28 rounded-2xl object-cover border border-gray-700/50 shadow-lg"
          />
        </div>
        <div className="mt-4 relative z-10">
          <button onClick={fetchLogs} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Summary mini-cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {["done", "late", "missed", "caregiver_missing", "pending"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s === statusFilter ? "all" : s)}
            className={`flex flex-col items-center py-3 px-2 rounded-xl border text-sm font-medium transition-all ${
              statusFilter === s
                ? "border-indigo-500 bg-indigo-600/10"
                : "border-gray-800 bg-gray-900 hover:border-gray-700"
            }`}
          >
            <span className={`badge ${STATUS_CFG[s]?.cls || ""}`}>{STATUS_CFG[s]?.label}</span>
            <span className="text-white font-bold text-xl mt-1.5">{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          placeholder="Search task name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-900 border border-gray-800 focus:border-indigo-500 text-white text-sm rounded-xl px-4 py-2 outline-none transition-colors w-56"
        />
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 focus:border-indigo-500 text-white text-sm rounded-xl px-4 py-2 outline-none"
        >
          <option value="">All Dates</option>
          {uniqueDates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 focus:border-indigo-500 text-white text-sm rounded-xl px-4 py-2 outline-none"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{s === "all" ? "All Statuses" : STATUS_CFG[s]?.label || s}</option>
          ))}
        </select>
        {(search || dateFilter !== "" || statusFilter !== "all") && (
          <button
            onClick={() => { setSearch(""); setDateFilter(""); setStatusFilter("all"); }}
            className="text-sm text-gray-500 hover:text-gray-300 px-3 py-2 bg-gray-900 border border-gray-800 rounded-xl"
          >
            Clear filters
          </button>
        )}
        <span className="text-gray-600 text-sm self-center ml-auto">{filtered.length} records</span>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} /></div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center">
            <img src={`${import.meta.env.BASE_URL}activity-log.png`} alt="No activity records" className="w-32 h-32 mx-auto rounded-2xl object-cover mb-6 opacity-60 border border-gray-800" />
            <p className="text-gray-400 font-medium">No activity records found</p>
            <p className="text-gray-600 text-sm mt-1">
              Activity logs are created when the vision module sends detection events or tasks are evaluated as missed.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {["Date", "Task", "Type", "Scheduled", "Detected At", "Activity", "Caregiver", "Status"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((log, i) => (
                  <tr key={log.log_id || i} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors fade-in">
                    <td className="px-5 py-3.5 text-gray-400 text-xs whitespace-nowrap">{formatDate(log.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-white font-medium flex items-center gap-2 whitespace-nowrap">
                        {TASK_TYPE_ICONS[log.task_type] || "📋"} {log.task_name}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs capitalize">{log.task_type?.replace("_"," ")}</td>
                    <td className="px-5 py-3.5 text-gray-400 font-mono text-xs whitespace-nowrap">{log.scheduled_range || "—"}</td>
                    <td className="px-5 py-3.5 text-gray-400 font-mono text-xs whitespace-nowrap">
                      {log.detected_at ? formatTime(log.detected_at) : <span className="text-rose-400">Not detected</span>}
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs capitalize">{log.detected_activity || "—"}</td>
                    <td className="px-5 py-3.5">
                      {log.caregiver_required ? (
                        log.caregiver_present
                          ? <span className="text-emerald-400 text-xs font-medium">✓ Present</span>
                          : <span className="text-orange-400 text-xs font-medium">✕ Absent</span>
                      ) : (
                        <span className="text-gray-600 text-xs">Not required</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`badge ${STATUS_CFG[log.status]?.cls || "badge-pending"}`}>
                        {STATUS_CFG[log.status]?.label || log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}