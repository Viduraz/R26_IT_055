// gateway-dashboard/frontend/src/pages/CaregiverDashboard.jsx
import { useEffect, useState } from "react";
import { getCaregiverProfile } from "../services/dashboardApi";
import { useAuth } from "@shared/hooks/useAuth";

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icons = {
  Face: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-4.66Z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-4.66Z"/>
    </svg>
  ),
  Clock: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Heart: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  ),
  Shield: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  Log: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
    </svg>
  ),
  LogOut: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  Activity: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  MapPin: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  Camera: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  ),
};

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

function InfoCard({ label, value, icon: IconComp, colorClass, gradient, note }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-white/8 p-5 group hover:border-white/15 transition-all duration-300`} style={{ background: "rgba(15,23,42,0.6)" }}>
      <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${gradient}`} />
      <div className="relative flex items-start justify-between">
        <div className="min-w-0 flex-1 mr-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">{label}</p>
          <p className={`text-base font-semibold leading-snug ${colorClass}`}>{value || "—"}</p>
          {note && <p className="text-xs text-gray-600 mt-1">{note}</p>}
        </div>
        <div className={`p-2.5 rounded-xl bg-white/5 ring-1 ring-white/10 flex-shrink-0 ${colorClass}`}>
          <IconComp />
        </div>
      </div>
    </div>
  );
}

const STATUS_BADGE = {
  enrolled: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", dot: "bg-emerald-400", label: "Biometrically Enrolled" },
  pending:  { bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/30",   dot: "bg-amber-400",   label: "Enrollment Pending"     },
};

const VERIFY_STATUS = {
  Success: { bg: "bg-emerald-500/12", border: "border-emerald-500/25", text: "text-emerald-400", dot: "bg-emerald-400" },
  Failed:  { bg: "bg-red-500/12",     border: "border-red-500/25",     text: "text-red-400",     dot: "bg-red-400"     },
};

export default function CaregiverDashboard() {
  const { token, logout } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const now = useNow();

  useEffect(() => {
    if (!token) return;
    getCaregiverProfile(token)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  const faceStatus = data?.profile?.face_status || "pending";
  const faceCfg    = STATUS_BADGE[faceStatus] || STATUS_BADGE.pending;

  // Quick stats for the top strip
  const quickStats = data ? [
    { label: "Verifications Today",  value: data.recent_verifications?.length ?? 0,   color: "text-indigo-400" },
    { label: "Success Rate",         value: data.recent_verifications?.length
        ? `${Math.round((data.recent_verifications.filter(v => v.status === "Success").length / data.recent_verifications.length) * 100)}%`
        : "—",                                                                         color: "text-emerald-400" },
    { label: "Avg Confidence",       value: data.recent_verifications?.length
        ? `${(data.recent_verifications.reduce((s, v) => s + parseFloat(v.confidence || 0), 0) / data.recent_verifications.length).toFixed(1)}%`
        : "—",                                                                         color: "text-purple-400"  },
  ] : [];

  const actions = [
    { label: "Live Stream",       href: "/live-stream",   emoji: "📹", color: "from-indigo-600/80 to-indigo-800/80"  },
    { label: "System Overview",   href: "/system-overview", emoji: "🖥️", color: "from-slate-600/80 to-slate-800/80"  },
    { label: "Alerts",            href: "/alerts",        emoji: "🔔", color: "from-rose-600/80 to-rose-800/80"     },
  ];

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #030712 0%, #0a0f1e 50%, #030712 100%)" }}>
      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-purple-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 left-0 w-80 h-80 bg-indigo-600/6 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-medium text-purple-400 bg-purple-500/15 border border-purple-500/25 px-2.5 py-0.5 rounded-full">
                🩺 Caregiver
              </span>
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${faceCfg.bg} ${faceCfg.text} ${faceCfg.border}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${faceCfg.dot}`} />
                {faceCfg.label}
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              {loading ? "Caregiver Portal" : `Welcome, ${(data?.profile?.name || "").split(" ")[0] || "Caregiver"}`}
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              {now.toLocaleString("en-IN", { weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/20 hover:bg-red-600/35 border border-red-500/30 text-red-400 hover:text-red-300 text-sm font-medium transition-all self-start sm:self-auto"
          >
            <Icons.LogOut /> Sign Out
          </button>
        </div>

        {loading ? (
          <div className="space-y-6 animate-pulse">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-white/5" />)}
            </div>
            <div className="h-64 rounded-2xl bg-white/5" />
          </div>
        ) : (
          <>
            {/* ── Info Cards ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <InfoCard
                label="Face Auth Status"
                value={faceStatus === "enrolled" ? "Enrolled ✓" : "Pending Setup"}
                icon={Icons.Face}
                colorClass={faceStatus === "enrolled" ? "text-emerald-400" : "text-amber-400"}
                gradient="bg-gradient-to-br from-purple-600/8 to-purple-900/4"
              />
              <InfoCard
                label="Current Shift"
                value={data.profile.shift}
                icon={Icons.Clock}
                colorClass="text-indigo-400"
                gradient="bg-gradient-to-br from-indigo-600/8 to-indigo-900/4"
              />
              <InfoCard
                label="Assigned Elder"
                value={data.profile.assigned_elder}
                icon={Icons.Heart}
                colorClass="text-rose-400"
                gradient="bg-gradient-to-br from-rose-600/8 to-rose-900/4"
              />
              <InfoCard
                label="Access Level"
                value="Full Monitoring"
                icon={Icons.Shield}
                colorClass="text-cyan-400"
                gradient="bg-gradient-to-br from-cyan-600/8 to-cyan-900/4"
                note="Camera · Tracking · Alerts"
              />
            </div>

            {/* ── Quick stats strip ─────────────────────────────────────────── */}
            {quickStats.length > 0 && (
              <div className="grid grid-cols-3 gap-4">
                {quickStats.map((s) => (
                  <div key={s.label} className="rounded-xl border border-white/8 bg-white/3 p-3 text-center">
                    <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Verification Logs + Duties side by side ───────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

              {/* Verification Logs (wider) */}
              <div className="lg:col-span-3 rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(15,23,42,0.6)" }}>
                <div className="flex items-center gap-2 p-5 border-b border-white/8">
                  <span className="text-indigo-400"><Icons.Log /></span>
                  <h2 className="font-semibold text-white">Face Verification Access Logs</h2>
                </div>
                <div className="p-4 space-y-2.5 max-h-72 overflow-y-auto custom-scroll">
                  {data.recent_verifications?.length > 0 ? data.recent_verifications.map((v, i) => {
                    const cfg = VERIFY_STATUS[v.status] || VERIFY_STATUS.Failed;
                    return (
                      <div key={i} className={`flex items-center justify-between p-3.5 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${cfg.dot} flex-shrink-0`} />
                          <div>
                            <span className={`text-sm font-semibold ${cfg.text}`}>{v.status}</span>
                            <p className="text-xs text-gray-500 mt-0.5">{v.date}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-400 font-medium">Confidence</p>
                          <p className={`text-sm font-bold ${cfg.text}`}>{v.confidence}</p>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="py-12 text-center text-gray-600">
                      <p>No verification records yet</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Today's Duties */}
              <div className="lg:col-span-2 rounded-2xl border border-white/8" style={{ background: "rgba(15,23,42,0.6)" }}>
                <div className="flex items-center gap-2 p-5 border-b border-white/8">
                  <span className="text-emerald-400"><Icons.Activity /></span>
                  <h2 className="font-semibold text-white">Today's Duties</h2>
                </div>
                <div className="p-4 space-y-1">
                  {[
                    { time: "08:00", task: "Morning check-in",         done: true  },
                    { time: "09:30", task: "Medication administration", done: true  },
                    { time: "12:00", task: "Lunch & vitals",            done: true  },
                    { time: "15:00", task: "Afternoon walk",            done: false },
                    { time: "18:00", task: "Evening check",             done: false },
                    { time: "20:00", task: "Night handover",            done: false },
                  ].map((item, i) => (
                    <div key={i} className={`flex items-center gap-3 p-2.5 rounded-lg ${item.done ? "opacity-50" : "hover:bg-white/4"} transition-colors`}>
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${item.done ? "bg-emerald-500 border-emerald-500" : "border-gray-600"}`}>
                        {item.done && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                      <span className="text-xs text-gray-500 w-10 flex-shrink-0">{item.time}</span>
                      <span className={`text-sm ${item.done ? "line-through text-gray-600" : "text-gray-300"}`}>{item.task}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Quick Actions ─────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(15,23,42,0.6)" }}>
              <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
                <Icons.Camera /> Quick Access
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {actions.map((a) => (
                  <a
                    key={a.label}
                    href={a.href}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border border-white/10 bg-gradient-to-r ${a.color} hover:opacity-90 hover:-translate-y-0.5 transition-all duration-200 group`}
                  >
                    <span className="text-2xl group-hover:scale-110 transition-transform">{a.emoji}</span>
                    <span className="text-sm font-semibold text-white">{a.label}</span>
                    <span className="ml-auto text-white/50 group-hover:text-white/80 transition text-sm">→</span>
                  </a>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>
    </div>
  );
}
