import { useEffect, useState } from "react";
import { getActivityLogs, getNotifications, getSchedule } from "../services/scheduleApi";

const getActivityIcon = (name) => {
  const n = name.toLowerCase();
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

export default function Reports() {
  const [logs, setLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("logs");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [logsRes, notifRes, schedRes] = await Promise.all([
        getActivityLogs(),
        getNotifications(false), // get all, not just unread
        getSchedule()
      ]);
      setLogs(logsRes.data || []);
      setNotifications(notifRes.data || []);
      setSchedule(schedRes.data || []);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const stats = {
    Done: logs.filter(l => l.status === "Done" || l.status === "On Time").length,
    Late: logs.filter(l => l.status === "Late" || l.status === "Slightly Late").length,
    Missed: logs.filter(l => l.status === "Missed").length
  };

  return (
    <div className="w-full pb-20 animate-slide-up">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10">
        <div>
          <h1 className="text-4xl font-extrabold text-white tracking-tight">Activity Reports</h1>
          <p className="text-gray-400 mt-2 text-sm">Historical logs and system alerts</p>
        </div>
        <button onClick={fetchData} className="mt-6 md:mt-0 px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white font-semibold text-sm rounded-xl transition-colors border border-gray-700 shadow-lg">
          ↻ Refresh Data
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all"></div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider relative z-10">Done</p>
          <div className="mt-4 flex items-end gap-3 relative z-10">
            <span className="text-4xl font-bold text-emerald-400">{stats.Done}</span>
          </div>
        </div>

        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all"></div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider relative z-10">Late</p>
          <div className="mt-4 flex items-end gap-3 relative z-10">
            <span className="text-4xl font-bold text-amber-400">{stats.Late}</span>
          </div>
        </div>

        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl group-hover:bg-rose-500/20 transition-all"></div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider relative z-10">Missed</p>
          <div className="mt-4 flex items-end gap-3 relative z-10">
            <span className="text-4xl font-bold text-rose-400">{stats.Missed}</span>
          </div>
        </div>

        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider relative z-10">Total Logs</p>
          <div className="mt-4 flex items-end gap-3 relative z-10">
            <span className="text-4xl font-bold text-white group-hover:text-blue-400 transition-colors">{logs.length}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: 📅 Selected Schedule Summary (1/3 width) */}
        <div className="lg:col-span-1 bg-gray-900/40 backdrop-blur-md rounded-2xl border border-gray-800/60 shadow-lg p-6 flex flex-col h-fit">
          <h2 className="text-lg font-bold text-white flex items-center gap-2.5 mb-6">
            <span className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm">📅</span>
            Routine Summary
          </h2>

          {schedule.length === 0 ? (
            <div className="py-12 text-center text-gray-500 flex-1 flex flex-col items-center justify-center">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-sm">No active routine found.</p>
            </div>
          ) : (
            <div className="space-y-4 flex-1">
              {schedule[0]?.activities?.map((activity, idx) => {
                // Find matching log for today to mark status
                const log = logs.find(l => l.activity_name === activity.activity_name);
                
                let statusText = "Monitored";
                let statusColor = "text-blue-400 bg-blue-500/10 border-blue-500/20";
                let statusIcon = "⏳";

                if (log) {
                  if (log.status === "Done" || log.status === "On Time") {
                    statusText = "Completed";
                    statusColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                    statusIcon = "✅";
                  } else if (log.status === "Early") {
                    statusText = "Early";
                    statusColor = "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
                    statusIcon = "⏱️";
                  } else if (log.status === "Late" || log.status === "Slightly Late") {
                    statusText = "Late";
                    statusColor = "text-amber-400 bg-amber-500/10 border-amber-500/20";
                    statusIcon = "⏰";
                  } else if (log.status === "Missed") {
                    statusText = "Missed";
                    statusColor = "text-rose-400 bg-rose-500/10 border-rose-500/20";
                    statusIcon = "❌";
                  }
                }

                return (
                  <div key={idx} className="p-4 bg-gray-950/40 rounded-xl border border-gray-800/80 hover:border-gray-700 transition duration-200">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-lg bg-gray-900/80 border border-gray-800 flex items-center justify-center text-xl">
                          {getActivityIcon(activity.activity_name)}
                        </span>
                        <div>
                          <p className="text-sm font-bold text-white">{activity.activity_name}</p>
                          <p className="text-[11px] text-gray-500 font-mono tracking-tight mt-0.5">
                            {activity.start_time} — {activity.end_time}
                          </p>
                        </div>
                      </div>
                      <div className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${statusColor}`}>
                        <span>{statusIcon}</span>
                        <span>{statusText}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Original Tabs (2/3 width) */}
        <div className="lg:col-span-2 bg-gray-900/40 backdrop-blur-md rounded-2xl border border-gray-800/60 shadow-lg overflow-hidden flex flex-col min-h-[500px]">
          <div className="flex border-b border-gray-800/60 bg-gray-950/30">
            <button
              onClick={() => setActiveTab("logs")}
              className={`px-8 py-4 font-semibold text-sm transition-colors border-b-2 ${
                activeTab === "logs" ? "border-blue-500 text-blue-400 bg-blue-500/5" : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"
              }`}
            >
              📋 Activity Logs
            </button>
            <button
              onClick={() => setActiveTab("notifications")}
              className={`px-8 py-4 font-semibold text-sm transition-colors border-b-2 ${
                activeTab === "notifications" ? "border-rose-500 text-rose-400 bg-rose-500/5" : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"
              }`}
            >
              🔔 All Notifications
            </button>
          </div>

          <div className="p-6 flex-1 overflow-auto">
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
              </div>
            ) : (
              <>
                {activeTab === "logs" && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
                        <th className="pb-3 font-semibold">Activity</th>
                        <th className="pb-3 font-semibold">Detected At</th>
                        <th className="pb-3 font-semibold text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {logs.length > 0 ? (
                        logs.map((log, idx) => {
                          let statusClass = "bg-gray-800 text-gray-400 border-gray-700";
                          let statusText = log.status || "Unknown";
                          if (statusText === "Done" || statusText === "On Time") {
                            statusClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                            statusText = "Done";
                          }
                          if (statusText === "Late" || statusText === "Slightly Late") {
                            statusClass = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                            statusText = "Late";
                          }
                          if (statusText === "Missed") {
                            statusClass = "bg-rose-500/10 text-rose-400 border-rose-500/20";
                          }

                          return (
                            <tr key={idx} className="hover:bg-gray-800/20 transition-colors">
                              <td className="py-4 text-sm font-medium text-gray-200">{log.activity_name}</td>
                              <td className="py-4 text-xs text-gray-400 font-mono">
                                {log.detected_at ? new Date(log.detected_at).toLocaleString() : "N/A"}
                              </td>
                              <td className="py-4 text-center">
                                <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${statusClass}`}>
                                  {statusText}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan="3" className="py-12 text-center text-gray-500 text-sm">No activity logs found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                {activeTab === "notifications" && (
                  <div className="space-y-3">
                    {notifications.length > 0 ? (
                      notifications.map((notif, idx) => (
                        <div key={idx} className={`p-4 rounded-xl border flex items-start gap-4 transition-colors ${
                          notif.read 
                            ? "bg-gray-900/30 border-gray-800" 
                            : "bg-rose-500/5 border-rose-500/20"
                        }`}>
                          <div className={`mt-0.5 w-2 h-2 rounded-full ${notif.read ? 'bg-gray-700' : 'bg-rose-500 shadow-[0_0_8px_rgba(225,29,72,0.5)]'}`}></div>
                          <div>
                            <p className={`text-sm font-semibold ${notif.read ? 'text-gray-300' : 'text-rose-200'}`}>
                              {notif.activity_name || "Alert"}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">{notif.message}</p>
                            <p className="text-[10px] text-gray-500 mt-2 font-mono">
                              {new Date(notif.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-12 text-center text-gray-500 text-sm">No notifications found.</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
