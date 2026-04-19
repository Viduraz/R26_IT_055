// schedule-monitoring/frontend/src/pages/Reports.jsx
import { useEffect, useState } from "react";
import { getActivityLogs, getNotifications, markNotificationRead, getSchedule } from "../services/scheduleApi";

const STATUS_COLORS = {
  "On Time": "bg-green-900 border-green-700 text-green-300",
  "Slightly Late": "bg-yellow-900 border-yellow-700 text-yellow-300",
  "Late": "bg-red-900 border-red-700 text-red-300",
  "Done": "bg-green-900 border-green-700 text-green-300",
};

export default function Reports() {
  const [logs, setLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("logs");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [logsRes, notifRes] = await Promise.all([
        getActivityLogs(),
        getNotifications()
      ]);
      setLogs(logsRes.data || []);
      setNotifications(notifRes.data || []);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const stats = {
    "On Time": logs.filter(l => l.status === "On Time").length,
    "Slightly Late": logs.filter(l => l.status === "Slightly Late").length,
    "Late": logs.filter(l => l.status === "Late").length
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-2">📊 Activity Reports</h1>
      <p className="text-xs text-blue-400 mb-8">Phase 1: Adaptive Grace Periods</p>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-green-900/20 border border-green-700 rounded p-4">
          <p className="text-xs text-gray-400">On Time</p>
          <p className="text-2xl font-bold text-green-300">{stats["On Time"]}</p>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-700 rounded p-4">
          <p className="text-xs text-gray-400">Slightly Late</p>
          <p className="text-2xl font-bold text-yellow-300">{stats["Slightly Late"]}</p>
        </div>
        <div className="bg-red-900/20 border border-red-700 rounded p-4">
          <p className="text-xs text-gray-400">Late</p>
          <p className="text-2xl font-bold text-red-300">{stats["Late"]}</p>
        </div>
        <div className="bg-blue-900/20 border border-blue-700 rounded p-4">
          <p className="text-xs text-gray-400">Total</p>
          <p className="text-2xl font-bold text-blue-300">{logs.length}</p>
        </div>
      </div>

      <div className="flex gap-4 mb-6 border-b border-gray-700">
        <button
          onClick={() => setActiveTab("logs")}
          className={`pb-3 px-4 font-semibold ${activeTab === "logs" ? "text-white border-b-2 border-blue-400" : "text-gray-400"}`}
        >
          📋 Logs
        </button>
        <button
          onClick={() => setActiveTab("notifications")}
          className={`pb-3 px-4 font-semibold ${activeTab === "notifications" ? "text-white border-b-2 border-blue-400" : "text-gray-400"}`}
        >
          🔔 Notifications
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <>
          {activeTab === "logs" && (
            <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800 border-b border-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left">Activity</th>
                    <th className="px-4 py-3 text-left">Time</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-center">Grace</th>
                    <th className="px-4 py-3 text-center">Delay</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length > 0 ? (
                    logs.map((log, idx) => (
                      <tr key={idx} className="border-b border-gray-700">
                        <td className="px-4 py-3">{log.activity_name}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {log.detected_at ? new Date(log.detected_at).toLocaleTimeString() : "N/A"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-semibold border ${STATUS_COLORS[log.status] || "bg-gray-700"}`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">{log.adaptive_grace_minutes || 20} min</td>
                        <td className="px-4 py-3 text-center">{log.delay_minutes || "--"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="px-4 py-8 text-center text-gray-400">No logs</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "notifications" && (
            <div className="space-y-4">
              {notifications.length > 0 ? (
                notifications.map((notif, idx) => (
                  <div key={idx} className={`border rounded p-4 ${notif.read ? "bg-gray-900/50" : "bg-blue-900/20 border-blue-700"}`}>
                    <h3 className="font-semibold">{notif.title}</h3>
                    <p className="text-sm text-gray-300 mt-1">{notif.message}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-400">No notifications</p>
              )}
            </div>
          )}
        </>
      )}

      <button onClick={fetchData} className="mt-8 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded">
        ↻ Refresh
      </button>
    </div>
  );
}
