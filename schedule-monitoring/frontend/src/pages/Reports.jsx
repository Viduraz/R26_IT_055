// schedule-monitoring/frontend/src/pages/Reports.jsx
import { useEffect, useState } from "react";
import { getActivityLogs, getNotifications, markNotificationRead, getSchedule } from "../services/scheduleApi";

const STATUS_COLORS = {
  "Done": "bg-green-900 border-green-700 text-green-300",
  "Late": "bg-yellow-900 border-yellow-700 text-yellow-300",
  "Missed": "bg-red-900 border-red-700 text-red-300"
};

const STATUS_ICONS = {
  "Done": "✓",
  "Late": "⚠",
  "Missed": "✕"
};

export default function Reports() {
  const [logs, setLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("logs"); // "logs", "notifications", "summary"

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [logsRes, notifRes, schedRes] = await Promise.all([
        getActivityLogs(),
        getNotifications(),
        getSchedule()
      ]);
      setLogs(logsRes.data || []);
      setNotifications(notifRes.data || []);
      setSchedule(schedRes.data || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async (notificationId) => {
    try {
      await markNotificationRead(notificationId);
      setNotifications(
        notifications.map((n) =>
          n.notification_id === notificationId ? { ...n, read: true } : n
        )
      );
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const getStatistics = () => {
    const stats = { Done: 0, Late: 0, Missed: 0 };
    logs.forEach((log) => {
      if (stats.hasOwnProperty(log.status)) {
        stats[log.status]++;
      }
    });
    return stats;
  };

  const stats = getStatistics();

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-2">Activity Monitoring</h1>
      <p className="text-gray-400 mb-8">Track detected activities, status, and notifications.</p>

      {/* Tabs */}
      <div className="flex gap-4 mb-8 border-b border-gray-800">
        <button
          onClick={() => setActiveTab("logs")}
          className={`pb-3 px-1 font-semibold transition ${
            activeTab === "logs"
              ? "text-blue-400 border-b-2 border-blue-400"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          Activity Logs
        </button>
        <button
          onClick={() => setActiveTab("notifications")}
          className={`pb-3 px-1 font-semibold transition relative ${
            activeTab === "notifications"
              ? "text-blue-400 border-b-2 border-blue-400"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          Notifications
          {notifications.filter((n) => !n.read).length > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-600 text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {notifications.filter((n) => !n.read).length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("summary")}
          className={`pb-3 px-1 font-semibold transition ${
            activeTab === "summary"
              ? "text-blue-400 border-b-2 border-blue-400"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          Summary
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-400">Loading data...</p>
        </div>
      ) : (
        <>
          {/* Activity Logs Tab */}
          {activeTab === "logs" && (
            <div className="space-y-4">
              {logs.length === 0 ? (
                <div className="bg-gray-900 rounded-xl p-8 border border-gray-800 text-center">
                  <p className="text-gray-400">No activities detected yet</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {logs.map((log, index) => (
                    <div
                      key={index}
                      className={`rounded-xl p-4 border ${STATUS_COLORS[log.status] || "bg-gray-900 border-gray-800 text-gray-300"}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-bold">{STATUS_ICONS[log.status]}</span>
                            <h3 className="text-lg font-semibold">{log.activity_name}</h3>
                            <span className="text-xs px-2 py-1 rounded bg-black/30">
                              {log.status}
                            </span>
                          </div>
                          <p className="text-sm mt-2 opacity-80">
                            Expected: {log.expected_start}–{log.expected_end}
                          </p>
                          {log.detected_at && (
                            <p className="text-sm mt-1 opacity-80">
                              Detected: {new Date(log.detected_at).toLocaleTimeString()}
                            </p>
                          )}
                          {log.detection_confidence > 0 && (
                            <p className="text-xs mt-1 opacity-75">
                              Confidence: {(log.detection_confidence * 100).toFixed(0)}%
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === "notifications" && (
            <div className="space-y-4">
              {notifications.length === 0 ? (
                <div className="bg-gray-900 rounded-xl p-8 border border-gray-800 text-center">
                  <p className="text-gray-400">No notifications</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {notifications.map((notif) => (
                    <div
                      key={notif.notification_id}
                      className={`rounded-xl p-4 border transition ${
                        notif.read
                          ? "bg-gray-900 border-gray-800 opacity-60"
                          : notif.status === "Late"
                          ? "bg-yellow-900 border-yellow-700"
                          : "bg-red-900 border-red-700"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold">
                              {notif.status === "Late" ? "⚠" : "✕"}
                            </span>
                            <h3 className="font-semibold">{notif.activity_name}</h3>
                            <span className="text-xs px-2 py-1 rounded bg-black/30">
                              {notif.status}
                            </span>
                          </div>
                          <p className="text-sm mt-2">{notif.message}</p>
                          <p className="text-xs mt-2 opacity-60">
                            {new Date(notif.created_at).toLocaleString()}
                          </p>
                        </div>
                        {!notif.read && (
                          <button
                            onClick={() => handleMarkRead(notif.notification_id)}
                            className="ml-4 text-xs px-3 py-1 rounded bg-white/20 hover:bg-white/30"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Summary Tab */}
          {activeTab === "summary" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Statistics Cards */}
              <div className="bg-green-900 border border-green-700 rounded-xl p-6">
                <p className="text-green-300 text-sm font-semibold">Completed</p>
                <p className="text-4xl font-bold mt-2">{stats.Done}</p>
                <p className="text-xs text-green-400 mt-2">Activities done on time</p>
              </div>

              <div className="bg-yellow-900 border border-yellow-700 rounded-xl p-6">
                <p className="text-yellow-300 text-sm font-semibold">Late</p>
                <p className="text-4xl font-bold mt-2">{stats.Late}</p>
                <p className="text-xs text-yellow-400 mt-2">Activities after 20-min deadline</p>
              </div>

              <div className="bg-red-900 border border-red-700 rounded-xl p-6">
                <p className="text-red-300 text-sm font-semibold">Missed</p>
                <p className="text-4xl font-bold mt-2">{stats.Missed}</p>
                <p className="text-xs text-red-400 mt-2">Activities not detected</p>
              </div>

              {/* Schedule Overview */}
              <div className="md:col-span-3 bg-gray-900 rounded-xl p-6 border border-gray-800">
                <h3 className="text-lg font-semibold mb-4">Today's Schedule</h3>
                {schedule.length === 0 ? (
                  <p className="text-gray-400 text-sm">No schedule set</p>
                ) : (
                  <div className="space-y-2">
                    {schedule[0]?.activities?.map((activity, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center py-2 px-3 bg-gray-800 rounded border border-gray-700"
                      >
                        <span className="font-medium">{activity.activity_name}</span>
                        <span className="text-sm text-gray-400">
                          {activity.start_time}–{activity.end_time}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Efficiency Metric */}
              <div className="md:col-span-3 bg-blue-900 border border-blue-700 rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-2">Efficiency Score</h3>
                {logs.length > 0 ? (
                  <>
                    <div className="flex items-end gap-4">
                      <div>
                        <p className="text-4xl font-bold">
                          {stats.Done > 0
                            ? Math.round((stats.Done / (stats.Done + stats.Late + stats.Missed)) * 100)
                            : 0}
                          %
                        </p>
                      </div>
                      <p className="flex-1 text-blue-300 text-sm">
                        {stats.Done} of {stats.Done + stats.Late + stats.Missed} activities completed on schedule
                      </p>
                    </div>
                    <div className="w-full bg-black/30 rounded-full h-2 mt-4">
                      <div
                        className="bg-blue-400 h-2 rounded-full transition-all"
                        style={{
                          width:
                            stats.Done > 0
                              ? `${(stats.Done / (stats.Done + stats.Late + stats.Missed)) * 100}%`
                              : "0%"
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-blue-300 text-sm">No activities detected yet</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Refresh Button */}
      <button
        onClick={fetchData}
        className="mt-8 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded font-semibold text-sm"
      >
        ↻ Refresh
      </button>
    </div>
  );
}
