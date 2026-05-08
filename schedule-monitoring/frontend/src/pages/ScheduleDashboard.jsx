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
