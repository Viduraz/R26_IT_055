/**
 * gateway-dashboard/frontend/src/pages/AlertsCenter.jsx
 * Aggregated alert feed from all microservices via GET /api/gateway/alerts
 */
import { useEffect, useState, useCallback } from "react";
import gatewayApi from "../services/gatewayApi";

// ── Constants ─────────────────────────────────────────────────────────────────
const SOURCE_LABELS = {
  "face-verification": { label: "Face", color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  "tracking-geofencing": { label: "Tracking", color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
  "anomaly-detection": { label: "Anomaly", color: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
  "schedule-monitoring": { label: "Schedule", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
};

const SEV_CONFIG = {
  critical: { row: "border-l-4 border-red-500 bg-red-500/8", badge: "bg-red-500/20 text-red-300", dot: "bg-red-400" },
  warning: { row: "border-l-4 border-amber-500 bg-amber-500/8", badge: "bg-amber-500/20 text-amber-300", dot: "bg-amber-400" },
  info: { row: "border-l-4 border-blue-500 bg-blue-500/8", badge: "bg-blue-500/20 text-blue-300", dot: "bg-blue-400" },
  success: { row: "border-l-4 border-emerald-500 bg-emerald-500/8", badge: "bg-emerald-500/20 text-emerald-300", dot: "bg-emerald-400" },
};

function formatTs(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d) ? String(ts) : d.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

function SourceBadge({ source }) {
  const cfg = SOURCE_LABELS[source] || { label: source || "System", color: "bg-slate-700 text-slate-300 border-slate-600" };
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function AlertRow({ alert, dismissed, onDismiss }) {
  const sev = (alert.severity || alert.status || "warning").toLowerCase();
  const cfg = SEV_CONFIG[sev] || SEV_CONFIG.warning;
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl transition-all duration-300 ${dismissed ? "opacity-30" : ""} ${cfg.row}`}>
      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{sev.toUpperCase()}</span>
          <SourceBadge source={alert.source} />
          <span className="text-sm text-white font-medium truncate">
            {alert.event_type || alert.type || alert.message || "Event"}
          </span>
        </div>
        {alert.patient_id && (
          <p className="text-xs text-slate-500">Patient: <span className="text-slate-400 font-mono">{alert.patient_id}</span></p>
        )}
        <p className="text-xs text-slate-600 mt-0.5">{formatTs(alert.timestamp || alert.time)}</p>
      </div>
      {!dismissed && (
        <button
          onClick={() => onDismiss(alert)}
          className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg bg-white/6 hover:bg-white/12 text-slate-400 hover:text-white border border-white/10 transition-all"
        >
          ACK
        </button>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const FILTERS = ["All", "Critical", "Warning", "Info"];

export default function AlertsCenter() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [filter, setFilter] = useState("All");
  const [dismissed, setDismissed] = useState(new Set());

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await gatewayApi.get("/alerts");
      const data = Array.isArray(res.data) ? res.data : (res.data?.alerts || []);
      setAlerts(data);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Alerts fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, 30_000);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  const handleDismiss = (alert) => {
    setDismissed((prev) => new Set([...prev, alert.timestamp || alert.time || Math.random()]));
  };

  const filtered = alerts.filter((a) => {
    if (filter === "All") return true;
    const sev = (a.severity || a.status || "warning").toLowerCase();
    return sev === filter.toLowerCase();
  });

  const activeCount = filtered.filter((a) => {
    const key = a.timestamp || a.time;
    return !dismissed.has(key);
  }).length;

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #030712 0%, #0a0f1e 50%, #030712 100%)" }}>
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-rose-600/6 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-indigo-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Alerts Center</h1>
            <p className="text-slate-400 text-sm mt-1">Aggregated feed from all monitoring services</p>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-slate-600">
                Updated {lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={fetchAlerts}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 text-slate-300 hover:text-white text-sm font-medium transition-all"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Summary pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(SOURCE_LABELS).map(([key, { label, color }]) => {
            const count = alerts.filter((a) => a.source === key).length;
            return (
              <div key={key} className="rounded-xl border border-white/8 p-4 text-center" style={{ background: "rgba(15,23,42,0.6)" }}>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${color}`}>{label}</span>
                <p className="text-2xl font-bold text-white mt-2">{count}</p>
                <p className="text-xs text-slate-600 mt-0.5">alerts</p>
              </div>
            );
          })}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Filter:</span>
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${filter === f
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                  : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20 hover:text-white"
                }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-500">{activeCount} unacknowledged</span>
        </div>

        {/* Alert list */}
        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(15,23,42,0.6)" }}>
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-400 text-sm">Loading alerts...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">✅</div>
              <p className="text-slate-400 font-medium">No alerts match this filter</p>
              <p className="text-slate-600 text-sm mt-1">All systems are running normally</p>
            </div>
          ) : (
            <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
              {filtered.map((alert, i) => {
                const key = alert.timestamp || alert.time || i;
                return (
                  <AlertRow
                    key={i}
                    alert={alert}
                    dismissed={dismissed.has(key)}
                    onDismiss={() => handleDismiss(alert)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
