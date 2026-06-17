// gateway-dashboard/frontend/src/pages/AdminDashboard.jsx
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminSummary } from "../services/dashboardApi";
import { useAuth } from "@shared/hooks/useAuth";

// ── Icons (inline SVG to avoid dependencies) ────────────────────────────────
const Icon = {
  Users: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Shield: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  Activity: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  Bell: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  ),
  Server: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
      <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
  ),
  Eye: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  LogOut: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  Refresh: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Warning: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  Clock: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Fingerprint: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/>
      <path d="M5 19.5C5.5 18 6 15 6 12c0-1.7.7-3.3 1.8-4.5"/>
      <path d="M17.5 5.5C19 7 20 9.4 20 12c0 4.2-1.7 7-3 8.5"/>
      <path d="M10.5 4.8c.4-.1.8-.3 1.5-.3C15.1 4.5 18 7.4 18 12c0 3-1.5 5.5-2 6"/>
      <path d="M9 12c0-1.7 1.3-3 3-3s3 1.3 3 3c0 2-.5 5-2 8"/>
      <path d="M9 11.5C9 9.6 10.3 8 12 8"/>
    </svg>
  ),
  Map: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
      <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
    </svg>
  ),
  Brain: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-4.66Z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-4.66Z"/>
    </svg>
  ),
  Calendar: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
};

// ── Utility ──────────────────────────────────────────────────────────────────
const severityConfig = {
  critical: { bg: "bg-red-500/15", border: "border-red-500/40", text: "text-red-400", badge: "bg-red-500/20 text-red-300", dot: "bg-red-400" },
  warning:  { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-400", badge: "bg-amber-500/20 text-amber-300", dot: "bg-amber-400" },
  info:     { bg: "bg-blue-500/15", border: "border-blue-500/40", text: "text-blue-400", badge: "bg-blue-500/20 text-blue-300", dot: "bg-blue-400" },
};

const serviceConfig = [
  { key: "auth",     label: "Auth Service",      port: 8000, icon: Icon.Shield,      color: "indigo" },
  { key: "face",     label: "Face Verification",  port: 8001, icon: Icon.Fingerprint, color: "purple" },
  { key: "tracking", label: "Tracking & Geo",     port: 8002, icon: Icon.Map,         color: "cyan"   },
  { key: "anomaly",  label: "Anomaly Detection",  port: 8003, icon: Icon.Brain,       color: "rose"   },
  { key: "schedule", label: "Schedule Monitor",   port: 8004, icon: Icon.Calendar,    color: "emerald"},
];

const colorMap = {
  indigo:  { ring: "ring-indigo-500/30",  icon: "text-indigo-400",  glow: "shadow-indigo-500/20"  },
  purple:  { ring: "ring-purple-500/30",  icon: "text-purple-400",  glow: "shadow-purple-500/20"  },
  cyan:    { ring: "ring-cyan-500/30",    icon: "text-cyan-400",    glow: "shadow-cyan-500/20"    },
  rose:    { ring: "ring-rose-500/30",    icon: "text-rose-400",    glow: "shadow-rose-500/20"    },
  emerald: { ring: "ring-emerald-500/30", icon: "text-emerald-400", glow: "shadow-emerald-500/20" },
};

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

function useServiceHealth(token) {
  const [health, setHealth] = useState({});
  const check = useCallback(async () => {
    const BASE = import.meta.env.VITE_GATEWAY_BACKEND_URL || "http://localhost:8005/api/gateway";
    const results = {};
    await Promise.all(
      serviceConfig.map(async ({ key }) => {
        try {
          const res = await fetch(`${BASE.replace("/api/gateway", "")}/health-proxy/${key}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          results[key] = res.ok ? "ok" : "degraded";
        } catch {
          results[key] = "unreachable";
        }
      })
    );
    setHealth(results);
  }, [token]);

  useEffect(() => {
    // Optimistic initial state — mark all as ok and let the real check complete
    const init = {};
    serviceConfig.forEach(({ key }) => { init[key] = "ok"; });
    setHealth(init);
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [check]);

  return health;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: IconComp, gradient, delay = 0, href }) {
  const navigate = useNavigate();
  const isClickable = !!href;
  return (
    <div
      onClick={isClickable ? () => navigate(href) : undefined}
      className={`relative overflow-hidden rounded-2xl border border-white/8 p-6 backdrop-blur-sm group hover:border-white/15 transition-all duration-300 hover:-translate-y-0.5 ${isClickable ? "cursor-pointer" : ""}`}
      style={{ background: "rgba(15,23,42,0.6)", animationDelay: `${delay}ms` }}
    >
      <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${gradient}`} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{label}</p>
          <p className="text-4xl font-bold text-white tabular-nums">{value ?? "—"}</p>
          {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-xl ring-1 ring-white/10 bg-white/5 ${gradient}`}>
          <IconComp />
        </div>
      </div>
      {isClickable && (
        <div className="absolute bottom-3 right-4 text-xs text-gray-600 group-hover:text-indigo-400 transition-colors flex items-center gap-1">
          View all →
        </div>
      )}
    </div>
  );
}

function ServiceHealthCard({ svc, status }) {
  const colors = colorMap[svc.color];
  const isOk = status === "ok";
  const isChecking = !status;
  return (
    <div className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-300 ring-1 ring-transparent hover:${colors.ring} ${isOk ? "bg-white/4 border-white/8" : "bg-red-500/5 border-red-500/20"}`}>
      <div className={`p-2 rounded-lg bg-white/5 ${colors.icon}`}>
        <svc.icon />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{svc.label}</p>
        <p className="text-xs text-gray-500">:{svc.port}</p>
      </div>
      <div className="flex items-center gap-1.5">
        {isChecking ? (
          <span className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
        ) : isOk ? (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">Online</span>
          </>
        ) : (
          <>
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-red-400 font-medium capitalize">{status}</span>
          </>
        )}
      </div>
    </div>
  );
}

function AlertRow({ alert, onAcknowledge, acknowledged }) {
  const sev = alert.status || "warning";
  const cfg = severityConfig[sev] || severityConfig.warning;
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border transition-all duration-300 ${acknowledged ? "opacity-40" : ""} ${cfg.bg} ${cfg.border}`}>
      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
            {sev.toUpperCase()}
          </span>
          <span className="text-sm text-white font-medium truncate">{alert.type || "System Alert"}</span>
        </div>
        <div className="flex items-center gap-1 mt-1 text-gray-500 text-xs">
          <Icon.Clock />
          <span>{alert.time || "Just now"}</span>
        </div>
      </div>
      {!acknowledged && (
        <button
          onClick={() => onAcknowledge(alert.id)}
          className="flex-shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-gray-300 hover:text-white border border-white/10 transition-all"
        >
          <Icon.Check />
          ACK
        </button>
      )}
    </div>
  );
}

function RoleBar({ label, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-sm font-bold text-white">{count} <span className="text-gray-500 font-normal text-xs">({pct}%)</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { token, logout } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [acknowledged, setAcknowledged] = useState(new Set());
  const [activeTab, setActiveTab] = useState("alerts");
  const now = useNow();
  const serviceHealth = useServiceHealth(token);

  const fetchData = useCallback(async (isManual = false) => {
    if (!token) return;
    if (isManual) setRefreshing(true);
    try {
      const res = await getAdminSummary(token);
      setData(res);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Admin summary fetch failed:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const id = setInterval(() => fetchData(), 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleAcknowledge = (id) => {
    setAcknowledged((prev) => new Set([...prev, id]));
  };

  const stats = data?.stats || {};
  const alerts = data?.recent_alerts || [];
  const unacknowledgedCount = alerts.filter((a) => !acknowledged.has(a.id)).length;
  const totalUsers = stats.total_users || 0;
  const onlineServices = Object.values(serviceHealth).filter((s) => s === "ok").length;

  // Derived user breakdown
  const userBreakdown = [
    { label: "Admins",         count: Math.max(1, totalUsers - (stats.caregivers || 0) - (stats.families || 0)), color: "bg-indigo-500" },
    { label: "Caregivers",     count: stats.caregivers || 0, color: "bg-purple-500" },
    { label: "Family Members", count: stats.families || 0,   color: "bg-blue-500"   },
  ];

  const quickActions = [
    { label: "Add User",         emoji: "👤", color: "from-indigo-600 to-indigo-700" },
    { label: "View Live Stream", emoji: "📹", color: "from-purple-600 to-purple-700", href: "/live-stream" },
    { label: "System Alerts",    emoji: "🔔", color: "from-rose-600 to-rose-700",    href: "/alerts"      },
    { label: "System Overview",  emoji: "🖥️", color: "from-cyan-600 to-cyan-700",    href: "/system-overview" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #030712 0%, #0a0f1e 50%, #030712 100%)" }}>
      {/* Ambient glow blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-600/6 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-0 w-64 h-64 bg-cyan-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-indigo-400 bg-indigo-500/15 border border-indigo-500/25 px-2.5 py-0.5 rounded-full">
                🛡️ Administrator
              </span>
              {onlineServices === serviceConfig.length && (
                <span className="text-xs font-medium text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 px-2.5 py-0.5 rounded-full">
                  ● All Systems Operational
                </span>
              )}
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              System Administration
            </h1>
            <p className="text-gray-400 mt-1 flex items-center gap-2 text-sm">
              <Icon.Clock />
              {now.toLocaleString("en-IN", { weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 text-gray-300 hover:text-white text-sm font-medium transition-all disabled:opacity-50"
            >
              <span className={refreshing ? "animate-spin" : ""}><Icon.Refresh /></span>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/20 hover:bg-red-600/35 border border-red-500/30 text-red-400 hover:text-red-300 text-sm font-medium transition-all"
            >
              <Icon.LogOut />
              Sign Out
            </button>
          </div>
        </div>

        {loading ? (
          /* ── Skeleton ──────────────────────────────────────────────────── */
          <div className="space-y-6 animate-pulse">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-32 rounded-2xl bg-white/5" />)}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="h-80 rounded-2xl bg-white/5 lg:col-span-2" />
              <div className="h-80 rounded-2xl bg-white/5" />
            </div>
          </div>
        ) : (
          <>
            {/* ── Stat Cards ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total Users"
                value={totalUsers}
                sub="Registered accounts"
                icon={Icon.Users}
                gradient="bg-gradient-to-br from-indigo-600/10 to-indigo-900/5"
                delay={0}
                href="/admin/users"
              />
              <StatCard
                label="Caregivers"
                value={stats.caregivers}
                sub={`${stats.verified_caregivers || 0} biometrically enrolled`}
                icon={Icon.Fingerprint}
                gradient="bg-gradient-to-br from-purple-600/10 to-purple-900/5"
                delay={50}
                href="/admin/users"
              />
              <StatCard
                label="Family Members"
                value={stats.families}
                sub="Active watchers"
                icon={Icon.Eye}
                gradient="bg-gradient-to-br from-blue-600/10 to-blue-900/5"
                delay={100}
                href="/admin/users"
              />
              <StatCard
                label="Active Alerts"
                value={unacknowledgedCount}
                sub={`${alerts.length} total in log`}
                icon={Icon.Bell}
                gradient={unacknowledgedCount > 0 ? "bg-gradient-to-br from-rose-600/10 to-rose-900/5" : "bg-gradient-to-br from-emerald-600/10 to-emerald-900/5"}
                delay={150}
                href="/alerts"
              />
            </div>

            {/* ── Main Grid ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Left — Tabbed panel (Alerts / Timeline) */}
              <div className="lg:col-span-2 rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(15,23,42,0.6)" }}>
                {/* Tab bar */}
                <div className="flex border-b border-white/8">
                  {[
                    { id: "alerts",   label: "Alerts",          badge: unacknowledgedCount },
                    { id: "activity", label: "Activity Log",    badge: null },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? "text-white border-b-2 border-indigo-500 bg-indigo-500/5"
                          : "text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {tab.label}
                      {tab.badge > 0 && (
                        <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center px-4">
                    {lastRefresh && (
                      <span className="text-xs text-gray-600">
                        Updated {lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-5 space-y-3 max-h-[420px] overflow-y-auto custom-scroll">
                  {activeTab === "alerts" && (
                    alerts.length > 0 ? alerts.map((a) => (
                      <AlertRow
                        key={a.id}
                        alert={a}
                        onAcknowledge={handleAcknowledge}
                        acknowledged={acknowledged.has(a.id)}
                      />
                    )) : (
                      <div className="text-center py-16 text-gray-600">
                        <div className="text-4xl mb-3">✅</div>
                        <p className="font-medium">No active alerts</p>
                        <p className="text-sm mt-1">All systems running normally</p>
                      </div>
                    )
                  )}
                  {activeTab === "activity" && (
                    <div className="space-y-0">
                      {[
                        { time: "Just now",     msg: "Admin dashboard accessed",               dot: "bg-indigo-400" },
                        { time: "2 min ago",    msg: "Caregiver face enrollment completed",    dot: "bg-purple-400" },
                        { time: "8 min ago",    msg: "Geofencing zone breach detected",        dot: "bg-rose-400"   },
                        { time: "15 min ago",   msg: "Scheduled medication check passed",      dot: "bg-emerald-400"},
                        { time: "32 min ago",   msg: "New family member account registered",   dot: "bg-blue-400"   },
                        { time: "1 hr ago",     msg: "Anomaly detection model reloaded",       dot: "bg-cyan-400"   },
                        { time: "2 hrs ago",    msg: "System health check: all services OK",   dot: "bg-emerald-400"},
                      ].map((item, i) => (
                        <div key={i} className="flex gap-4 pb-4 relative">
                          <div className="flex flex-col items-center">
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${item.dot}`} />
                            {i < 6 && <span className="w-px flex-1 bg-white/8 mt-1.5" />}
                          </div>
                          <div className="pb-1">
                            <p className="text-sm text-gray-300">{item.msg}</p>
                            <p className="text-xs text-gray-600 mt-0.5">{item.time}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-5">

                {/* Service Health */}
                <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(15,23,42,0.6)" }}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <Icon.Server />
                      Service Health
                    </h2>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      onlineServices === serviceConfig.length
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-rose-500/20 text-rose-400"
                    }`}>
                      {onlineServices}/{serviceConfig.length} Online
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {serviceConfig.map((svc) => (
                      <ServiceHealthCard key={svc.key} svc={svc} status={serviceHealth[svc.key]} />
                    ))}
                  </div>
                </div>

                {/* User Breakdown */}
                <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(15,23,42,0.6)" }}>
                  <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
                    <Icon.Users />
                    User Breakdown
                  </h2>
                  <div className="space-y-4">
                    {userBreakdown.map((row) => (
                      <RoleBar key={row.label} {...row} total={totalUsers} />
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/8 grid grid-cols-2 gap-3 text-center">
                    <div>
                      <p className="text-2xl font-bold text-white">{stats.verified_caregivers ?? "—"}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Biometrically verified</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white">
                        {stats.caregivers > 0 ? `${Math.round(((stats.verified_caregivers || 0) / stats.caregivers) * 100)}%` : "—"}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Enrollment rate</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Quick Actions ────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(15,23,42,0.6)" }}>
              <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
                <Icon.Activity />
                Quick Actions
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {quickActions.map((action) => (
                  <a
                    key={action.label}
                    href={action.href || "#"}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border border-white/10 bg-gradient-to-br ${action.color} hover:opacity-90 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group`}
                  >
                    <span className="text-2xl group-hover:scale-110 transition-transform">{action.emoji}</span>
                    <span className="text-sm font-medium text-white text-center leading-tight">{action.label}</span>
                  </a>
                ))}
              </div>
            </div>

            {/* ── System Info Footer ───────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              {[
                { label: "Platform",   value: "Secure Elder Care v1.0" },
                { label: "Gateway",    value: "Port 8005" },
                { label: "DB",         value: "MongoDB Atlas" },
                { label: "Auth",       value: "JWT RS256" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/5 p-3 bg-white/2">
                  <p className="text-xs text-gray-600 uppercase tracking-wider">{item.label}</p>
                  <p className="text-sm font-medium text-gray-400 mt-1">{item.value}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <style>{`
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}</style>
    </div>
  );
}
