/**
 * gateway-dashboard/frontend/src/pages/SystemOverview.jsx
 * Live system health overview — polls GET /api/gateway/overview every 30s.
 */
import { useEffect, useState, useCallback } from "react";
import gatewayApi from "../services/gatewayApi";

// ── Service config ─────────────────────────────────────────────────────────────
const SERVICES = [
  { key: "auth", label: "Auth Service", port: 8000, emoji: "🔐", color: "indigo" },
  { key: "face", label: "Face Verification", port: 8001, emoji: "👁️", color: "purple" },
  { key: "tracking", label: "Tracking & Geo", port: 8002, emoji: "📍", color: "cyan" },
  { key: "anomaly", label: "Anomaly Detection", port: 8003, emoji: "🧠", color: "rose" },
  { key: "schedule", label: "Schedule Monitor", port: 8004, emoji: "📅", color: "emerald" },
];

const COLOR_MAP = {
  indigo: { ring: "ring-indigo-500/30", bg: "bg-indigo-500/10", text: "text-indigo-400" },
  purple: { ring: "ring-purple-500/30", bg: "bg-purple-500/10", text: "text-purple-400" },
  cyan: { ring: "ring-cyan-500/30", bg: "bg-cyan-500/10", text: "text-cyan-400" },
  rose: { ring: "ring-rose-500/30", bg: "bg-rose-500/10", text: "text-rose-400" },
  emerald: { ring: "ring-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-400" },
};

function StatusDot({ status }) {
  if (status === "ok") return <><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" /><span className="text-xs font-semibold text-emerald-400">Online</span></>;
  if (status === "degraded") return <><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /><span className="text-xs font-semibold text-amber-400">Degraded</span></>;
  if (status === "unreachable") return <><span className="w-2.5 h-2.5 rounded-full bg-red-400" /><span className="text-xs font-semibold text-red-400">Offline</span></>;
  return <><span className="w-2.5 h-2.5 rounded-full bg-slate-500 animate-pulse" /><span className="text-xs text-slate-500">Checking…</span></>;
}

function ServiceCard({ svc, status }) {
  const c = COLOR_MAP[svc.color];
  const isOk = status === "ok";
  return (
    <div className={`relative rounded-2xl border p-6 transition-all duration-300 ring-1 ring-transparent hover:${c.ring} ${isOk ? "border-white/8" : status === "degraded" ? "border-amber-500/30" : status ? "border-red-500/30" : "border-white/8"
      }`} style={{ background: "rgba(15,23,42,0.6)" }}>
      {/* Color accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl ${isOk ? `${c.bg.replace("/10", "/40")}` : "bg-red-500/30"}`} />

      <div className="flex items-start justify-between">
        <div className={`w-12 h-12 rounded-xl ${c.bg} flex items-center justify-center text-2xl mb-4`}>
          {svc.emoji}
        </div>
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
        </div>
      </div>

      <h3 className="font-bold text-white text-base">{svc.label}</h3>
      <p className="text-xs text-slate-500 mt-0.5">Port {svc.port}</p>

      <a
        href={`http://localhost:${svc.port}/docs`}
        target="_blank"
        rel="noreferrer"
        className={`mt-4 inline-flex items-center gap-1 text-xs ${c.text} hover:underline`}
      >
        API Docs →
      </a>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SystemOverview() {
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await gatewayApi.get("/overview");
      setStatuses(res.data?.services || {});
      setLastRefresh(new Date());
    } catch (err) {
      console.error("System overview fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    const id = setInterval(fetchOverview, 30_000);
    return () => clearInterval(id);
  }, [fetchOverview]);

  const online = SERVICES.filter((s) => statuses[s.key] === "ok").length;
  const degraded = SERVICES.filter((s) => statuses[s.key] === "degraded").length;
  const offline = SERVICES.filter((s) => statuses[s.key] === "unreachable").length;
  const checking = SERVICES.filter((s) => !statuses[s.key]).length;

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #030712 0%, #0a0f1e 50%, #030712 100%)" }}>
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/3 w-96 h-96 bg-indigo-600/6 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-cyan-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">System Overview</h1>
            <p className="text-slate-400 text-sm mt-1">Live health status of all microservices</p>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-slate-600">
                Updated {lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <button
              onClick={fetchOverview}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 text-slate-300 hover:text-white text-sm font-medium transition-all"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Summary stat row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Services", value: SERVICES.length, color: "text-white" },
            { label: "Online", value: online, color: "text-emerald-400" },
            { label: "Degraded", value: degraded, color: "text-amber-400" },
            { label: "Offline", value: offline, color: "text-red-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-white/8 p-4 text-center" style={{ background: "rgba(15,23,42,0.6)" }}>
              <p className={`text-3xl font-bold tabular-nums ${color}`}>{loading ? "—" : value}</p>
              <p className="text-xs text-slate-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Overall health banner */}
        {!loading && (
          <div className={`rounded-xl border px-5 py-3 text-sm font-semibold flex items-center gap-2 ${offline > 0 ? "border-red-500/30 bg-red-500/8 text-red-300"
              : degraded > 0 ? "border-amber-500/30 bg-amber-500/8 text-amber-300"
                : checking > 0 ? "border-slate-600 bg-white/4 text-slate-400"
                  : "border-emerald-500/30 bg-emerald-500/8 text-emerald-300"
            }`}>
            <span className={`w-2 h-2 rounded-full ${offline > 0 ? "bg-red-400" : degraded > 0 ? "bg-amber-400 animate-pulse" : "bg-emerald-400 animate-pulse"}`} />
            {offline > 0 ? `${offline} service${offline > 1 ? "s" : ""} offline — attention required`
              : degraded > 0 ? `${degraded} service${degraded > 1 ? "s" : ""} degraded`
                : checking > 0 ? "Checking service statuses…"
                  : "All systems operational"}
          </div>
        )}

        {/* Service grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {SERVICES.map((svc) => (
            <ServiceCard key={svc.key} svc={svc} status={loading ? undefined : statuses[svc.key]} />
          ))}
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-slate-700 pt-2">
          Auto-refreshes every 30 seconds · {SERVICES.length} services monitored
        </div>
      </div>
    </div>
  );
}
