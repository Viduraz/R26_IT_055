/**
 * anomaly-detection/frontend/src/pages/DetectionHistory.jsx
 * Full event history table with severity color coding and auto-refresh.
 */
import { useEffect, useState, useCallback } from "react";
import axios from "axios";

const ANOMALY_API = import.meta.env.VITE_ANOMALY_BACKEND_URL || "http://localhost:8003/api/anomaly";

const SEV_STYLE = {
  critical: "bg-red-900/40 border-red-600/50 text-red-300",
  high:     "bg-orange-900/40 border-orange-600/50 text-orange-300",
  medium:   "bg-yellow-900/40 border-yellow-600/50 text-yellow-300",
  low:      "bg-indigo-900/40 border-indigo-600/50 text-indigo-300",
  none:     "bg-gray-800/60 border-gray-700 text-gray-400",
};

const TYPE_ICON = {
  fall_detected:        "🚨",
  aggression_detected:  "⚠️",
  prolonged_inactivity: "😴",
  inactivity_warning:   "⏱️",
  unusual_movement:     "❓",
  normal_activity:      "✅",
};

export default function DetectionHistory() {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [filter, setFilter]   = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${ANOMALY_API}/history`);
      setLogs(Array.isArray(data) ? data : []);
      setError("");
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === "all" ? logs : logs.filter(l => l.severity === filter);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Detection History</h1>
            <p className="text-gray-400 text-sm mt-1">All anomaly events logged to MongoDB</p>
          </div>
          <button onClick={load}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl transition-all">
            ↻ Refresh
          </button>
        </div>

        {/* Nav */}
        <div className="flex gap-2 mb-5 text-sm">
          {[["Dashboard", "/"], ["History", "/history"], ["Model Status", "/model-status"]].map(([label, href]) => (
            <a key={href} href={href}
              className={`px-4 py-1.5 rounded-lg border transition-colors ${
                href === "/history"
                  ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                  : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"
              }`}>
              {label}
            </a>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {["all", "critical", "high", "medium", "none"].map(f => (
            <button key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-bold uppercase rounded-lg border transition-all ${
                filter === f
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
              }`}>
              {f}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-500 self-center">{filtered.length} events</span>
        </div>

        {/* Table */}
        {error && (
          <div className="bg-red-900/30 border border-red-500/50 text-red-300 text-sm p-4 rounded-2xl mb-4">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500 gap-3">
            <span className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
            Loading events…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-600">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-lg font-bold">No events logged yet</p>
            <p className="text-sm mt-1">Start monitoring on the dashboard to generate events</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((log, i) => {
              const sev    = log.severity || "none";
              const cls    = SEV_STYLE[sev] || SEV_STYLE.none;
              const icon   = TYPE_ICON[log.anomaly_type] || "📌";
              const ts     = log.timestamp ? new Date(log.timestamp).toLocaleString() : "–";
              return (
                <div key={i} className={`border rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-3 transition-all ${cls}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{icon}</span>
                    <div>
                      <p className="font-bold text-sm">{(log.anomaly_type || "unknown").replace(/_/g," ").toUpperCase()}</p>
                      <p className="text-xs opacity-70 mt-0.5">Person: {log.person_id || "–"} · Source: {log.source || "–"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <span className="opacity-80">Conf: {((log.confidence||0)*100).toFixed(0)}%</span>
                    <span className={`px-2 py-0.5 rounded font-bold uppercase ${
                      sev === "critical" ? "bg-red-600/40" :
                      sev === "high"     ? "bg-orange-600/40" :
                      sev === "medium"   ? "bg-yellow-600/40" : "bg-gray-700"
                    }`}>{sev}</span>
                    <span className="text-gray-500">{ts}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
