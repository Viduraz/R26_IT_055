// schedule-monitoring/frontend/src/pages/NotificationsPanel.jsx
import { useState, useEffect, useCallback } from "react";
import { getNotifications, markNotificationRead, markAllNotificationsRead } from "../services/scheduleApi";

const PATIENT_ID = "patient_001";

const ALERT_CONFIG = {
  late:              { label: "Late",             bg: "bg-amber-500/10 border-amber-500/20",  text: "text-amber-300",  icon: "⚠️", dot: "bg-amber-400" },
  missed:            { label: "Missed",           bg: "bg-rose-500/10 border-rose-500/20",    text: "text-rose-300",   icon: "❌", dot: "bg-rose-400"  },
  caregiver_missing: { label: "No Caregiver",     bg: "bg-orange-500/10 border-orange-500/20",text: "text-orange-300", icon: "🚨", dot: "bg-orange-400"},
};

function timeAgo(isoStr) {
  if (!isoStr) return "";
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(isoStr).toLocaleDateString();
}

function formatTime(isoStr) {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export default function NotificationsPanel({ patientId = PATIENT_ID }) {
  const [data, setData]       = useState({ notifications: [], unread_count: 0 });
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter]   = useState("all");   // "all" | "unread"

  const fetchData = useCallback(async () => {
    try {
      const r = await getNotifications(patientId);
      setData(r.data);
    } catch {} finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleMarkRead = async (notifId) => {
    await markNotificationRead(notifId).catch(() => {});
    fetchData();
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    await markAllNotificationsRead(patientId).catch(() => {});
    await fetchData();
    setMarkingAll(false);
  };

  const displayed = (data.notifications || []).filter((n) =>
    filter === "unread" ? !n.read : true
  );

  return (
    <div className="p-8 max-w-3xl mx-auto fade-in">
      {/* Hero Banner */}
      <div className="mb-8 rounded-3xl border border-gray-800 bg-gray-900/40 backdrop-blur-md p-6 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-56 h-56 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row gap-6 items-center relative z-10">
          <div className="flex-1">
            <div className="inline-block px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold rounded-full mb-3 uppercase tracking-widest">
              Alert Center
            </div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              Notifications
              {data.unread_count > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-rose-500 text-white text-sm font-bold">
                  {data.unread_count}
                </span>
              )}
            </h1>
            <p className="text-gray-500 text-sm mt-1">Alerts sent to family member for late, missed, or caregiver-absent tasks.</p>
          </div>
          <img 
            src={`${import.meta.env.BASE_URL}notifications.png`} 
            alt="Notifications" 
            className="w-28 h-28 rounded-2xl object-cover border border-gray-700/50 shadow-lg"
          />
        </div>
        <div className="flex items-center gap-3 mt-4 relative z-10">
          {data.unread_count > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="px-4 py-2 text-sm bg-gray-800 border border-gray-700 text-gray-300 hover:text-white rounded-xl hover:bg-gray-700 transition-colors"
            >
              {markingAll ? "Marking…" : "Mark All Read"}
            </button>
          )}
          <button onClick={fetchData} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit mb-6">
        {["all", "unread"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              filter === f
                ? "bg-indigo-600 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {f === "unread" ? `Unread (${data.unread_count})` : `All (${data.notifications?.length || 0})`}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} /></div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16">
          <img src={`${import.meta.env.BASE_URL}notifications.png`} alt="No notifications" className="w-32 h-32 mx-auto rounded-2xl object-cover mb-6 opacity-60 border border-gray-800" />
          <p className="text-gray-400 font-medium">
            {filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </p>
          <p className="text-gray-600 text-sm mt-1">
            Alerts will appear here when tasks are late, missed, or the caregiver is absent.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((n) => {
            const cfg = ALERT_CONFIG[n.alert_type] || {
              label: n.alert_type,
              bg: "bg-gray-900 border-gray-800",
              text: "text-gray-300",
              icon: "ℹ️",
              dot: "bg-gray-500",
            };
            return (
              <div
                key={n.notification_id}
                className={`border rounded-2xl p-5 transition-all fade-in ${cfg.bg} ${
                  n.read ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="text-2xl leading-none mt-0.5">{cfg.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={`font-semibold text-sm ${cfg.text}`}>{n.task_name}</p>
                        <p className="text-gray-300 text-sm mt-1 leading-snug">{n.message}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span className={`badge ${
                          n.alert_type === "late"              ? "badge-late"              :
                          n.alert_type === "missed"            ? "badge-missed"            :
                          n.alert_type === "caregiver_missing" ? "badge-caregiver_missing" :
                          "badge-pending"
                        }`}>
                          {cfg.label}
                        </span>
                        {!n.read && (
                          <button
                            onClick={() => handleMarkRead(n.notification_id)}
                            className="text-xs text-gray-500 hover:text-gray-300 underline transition-colors"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                      <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      <p className="text-gray-600 text-xs">{timeAgo(n.created_at)} · {formatTime(n.created_at)}</p>
                      {!n.read && <span className="text-xs text-indigo-400 font-medium">● New</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}