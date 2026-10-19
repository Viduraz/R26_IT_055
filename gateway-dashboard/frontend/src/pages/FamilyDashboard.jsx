/**
 * gateway-dashboard/frontend/src/pages/FamilyDashboard.jsx
 * Family member view — elder status + alert feed + caregiver scan.
 * Upgraded from basic gray Tailwind to unified dark glassmorphism.
 */
import { useEffect, useState } from "react";
import { getFamilyAlerts } from "../services/dashboardApi";
import { useAuth } from "@shared/hooks/useAuth";
import ScanCaregiverModal from "../components/ScanCaregiverModal";

// ── Severity config ────────────────────────────────────────────────────────────
const SEV = {
  critical: { border: "border-l-4 border-red-500", badge: "bg-red-500/20 text-red-300", dot: "bg-red-400" },
  error: { border: "border-l-4 border-red-500", badge: "bg-red-500/20 text-red-300", dot: "bg-red-400" },
  warning: { border: "border-l-4 border-amber-500", badge: "bg-amber-500/20 text-amber-300", dot: "bg-amber-400" },
  info: { border: "border-l-4 border-blue-500", badge: "bg-blue-500/20 text-blue-300", dot: "bg-blue-400" },
  success: { border: "border-l-4 border-emerald-500", badge: "bg-emerald-500/20 text-emerald-300", dot: "bg-emerald-400" },
};

function AlertItem({ alert }) {
  const sev = (alert.type || "info").toLowerCase();
  const cfg = SEV[sev] || SEV.info;
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl bg-white/3 ${cfg.border} transition-all`}>
      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${cfg.badge}`}>{sev}</span>
          <span className="text-sm text-slate-200 truncate">{alert.message}</span>
        </div>
        <p className="text-xs text-slate-600">{alert.time}</p>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function FamilyDashboard() {
  const { token, logout } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    getFamilyAlerts(token)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  const isElderSafe = data?.elder_status?.toLowerCase().includes("safe") ?? true;

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #030712 0%, #0a0f1e 50%, #030712 100%)" }}>
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-blue-600/6 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-indigo-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-block text-xs font-semibold text-blue-400 bg-blue-500/15 border border-blue-500/25 px-2.5 py-0.5 rounded-full mb-2">
              👨‍👩‍👧 Family Portal
            </span>
            <h1 className="text-3xl font-bold text-white tracking-tight">Elder Monitoring</h1>
            <p className="text-slate-400 text-sm mt-1">Keep track of your loved ones remotely</p>
          </div>
          <button
            onClick={logout}
            className="flex-shrink-0 px-4 py-2 rounded-xl bg-red-600/20 hover:bg-red-600/35 border border-red-500/30 text-red-400 hover:text-red-300 text-sm font-medium transition-all"
          >
            Sign Out
          </button>
        </div>

        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="grid grid-cols-2 gap-4">
              <div className="h-28 rounded-2xl bg-white/5" />
              <div className="h-28 rounded-2xl bg-white/5" />
            </div>
            <div className="h-64 rounded-2xl bg-white/5" />
          </div>
        ) : (
          <>
            {/* Status cards */}
            <div className="grid grid-cols-2 gap-4">

              {/* Elder Status */}
              <div className={`rounded-2xl border p-5 ${isElderSafe ? "border-emerald-500/30" : "border-red-500/30"}`}
                style={{ background: "rgba(15,23,42,0.65)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Elder Status</p>
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${isElderSafe ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                  <p className={`text-lg font-bold ${isElderSafe ? "text-emerald-400" : "text-red-400"}`}>
                    {data?.elder_status || "Unknown"}
                  </p>
                </div>
              </div>

              {/* Last Seen */}
              <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(15,23,42,0.65)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Last Seen</p>
                <p className="text-lg font-bold text-blue-400">{data?.last_seen || "—"}</p>
              </div>
            </div>

            {/* Alert Feed */}
            <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(15,23,42,0.65)" }}>
              <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
                <h2 className="font-semibold text-white">Recent Activity</h2>
                <span className="text-xs text-slate-500">{data?.alerts?.length || 0} events</span>
              </div>
              <div className="p-4 space-y-3 max-h-72 overflow-y-auto">
                {data?.alerts?.length > 0 ? (
                  data.alerts.map((a, i) => <AlertItem key={i} alert={a} />)
                ) : (
                  <div className="text-center py-10">
                    <div className="text-4xl mb-3">✅</div>
                    <p className="text-slate-400 text-sm">No recent alerts</p>
                    <p className="text-slate-600 text-xs mt-1">Your loved one is safe and monitored</p>
                  </div>
                )}
              </div>
            </div>

            {/* Scan Button */}
            <div>
              <button
                onClick={() => setIsScanning(true)}
                className="flex items-center gap-2.5 px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20 transition-all hover:-translate-y-0.5"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Scan &amp; Verify Caregiver
              </button>
            </div>
          </>
        )}

        <ScanCaregiverModal isOpen={isScanning} onClose={() => setIsScanning(false)} />
      </div>
    </div>
  );
}
