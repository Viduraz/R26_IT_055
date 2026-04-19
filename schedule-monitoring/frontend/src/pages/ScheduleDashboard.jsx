// schedule-monitoring/frontend/src/pages/ScheduleDashboard.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDeviations, getSchedule, getNotifications, getActivityLogs } from "../services/scheduleApi";
import ActivityDetectorMonitor from "../components/ActivityDetectorMonitor";

export default function ScheduleDashboard() {
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState([]);
  const [deviations, setDeviations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDetector, setShowDetector] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [devRes, schedRes, notifRes, logsRes] = await Promise.all([
        getDeviations(),
        getSchedule(),
        getNotifications(),
        getActivityLogs()
      ]);
      setDeviations(devRes.data || []);
      setSchedule(schedRes.data || []);
      setNotifications(notifRes.data || []);
      setRecentLogs((logsRes.data || []).slice(0, 5)); // Last 5 logs
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold">Schedule Monitoring Dashboard</h1>
          <p className="text-gray-400 mt-1">Real-time activity tracking and alerts</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate("/routine-setup")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold text-sm transition"
          >
            ➕ Create Schedule
          </button>
          <button
            onClick={() => setShowDetector(!showDetector)}
            className={`px-4 py-2 rounded font-semibold text-sm transition ${
              showDetector
                ? "bg-green-600 hover:bg-green-700"
                : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            📷 {showDetector ? "Hide" : "Show"} Detector
          </button>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded font-semibold text-sm"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-gray-400">Loading dashboard...</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Activity Detector - Conditionally Visible */}
          {showDetector && (
            <div className="mb-8">
              <ActivityDetectorMonitor />
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Schedule Status */}
            <div className="bg-gradient-to-br from-blue-900 to-blue-800 border border-blue-700 rounded-xl p-6">
              <p className="text-blue-300 text-sm font-semibold">Today's Activities</p>
              <p className="text-3xl font-bold mt-2">
                {schedule.length > 0 ? schedule[0]?.activities?.length || 0 : 0}
              </p>
              <p className="text-xs text-blue-400 mt-2">Scheduled activities</p>
            </div>

            {/* Unread Notifications */}
            <div
              className={`border rounded-xl p-6 transition ${
                unreadCount > 0
                  ? "bg-gradient-to-br from-red-900 to-red-800 border-red-700"
                  : "bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700"
              }`}
            >
              <p className={`text-sm font-semibold ${unreadCount > 0 ? "text-red-300" : "text-gray-400"}`}>
                Unread Alerts
              </p>
              <p className="text-3xl font-bold mt-2">{unreadCount}</p>
              <p className={`text-xs mt-2 ${unreadCount > 0 ? "text-red-400" : "text-gray-500"}`}>
                {unreadCount > 0 ? "Require attention" : "All clear"}
              </p>
            </div>

            {/* Deviations */}
            <div className="bg-gradient-to-br from-yellow-900 to-yellow-800 border border-yellow-700 rounded-xl p-6">
              <p className="text-yellow-300 text-sm font-semibold">Deviations</p>
              <p className="text-3xl font-bold mt-2">{deviations.length}</p>
              <p className="text-xs text-yellow-400 mt-2">Unexpected activities</p>
            </div>

            {/* Recent Activity */}
            <div className="bg-gradient-to-br from-green-900 to-green-800 border border-green-700 rounded-xl p-6">
              <p className="text-green-300 text-sm font-semibold">Detected Today</p>
              <p className="text-3xl font-bold mt-2">{recentLogs.length}</p>
              <p className="text-xs text-green-400 mt-2">Activities logged</p>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Schedule and Recent Activity */}
            <div className="lg:col-span-2 space-y-8">
              {/* Current Schedule */}
              <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
                <h2 className="text-xl font-semibold mb-4">Today's Schedule</h2>
                {schedule.length === 0 ? (
                  <p className="text-gray-400 text-sm">No schedule set</p>
                ) : (
                  <div className="space-y-2">
                    {schedule[0]?.activities?.map((activity, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-3 px-4 bg-gray-800 rounded-lg border border-gray-700"
                      >
                        <div>
                          <p className="font-medium">{activity.activity_name}</p>
                          <p className="text-xs text-gray-400">
                            {activity.start_time}–{activity.end_time}
                          </p>
                        </div>
                        <div className="text-2xl">📍</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Activity Logs with Adaptive Info */}
              <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
                <h2 className="text-xl font-semibold mb-4">Recent Activity Logs (Phase 1: Adaptive)</h2>
                {recentLogs.length === 0 ? (
                  <p className="text-gray-400 text-sm">No activities detected yet</p>
                ) : (
                  <div className="space-y-2">
                    {recentLogs.map((log, idx) => {
                      // Map old and new status types
                      const statusType = log.status || "Unknown";
                      let statusColor = "bg-gray-900/20 border-gray-700 text-gray-300";
                      let statusIcon = "?";
                      
                      if (statusType === "On Time" || statusType === "Done") {
                        statusColor = "bg-green-900/20 border-green-700 text-green-300";
                        statusIcon = "✓";
                      } else if (statusType === "Slightly Late") {
                        statusColor = "bg-yellow-900/20 border-yellow-700 text-yellow-300";
                        statusIcon = "⚠";
                      } else if (statusType === "Late" || statusType === "Missed") {
                        statusColor = "bg-red-900/20 border-red-700 text-red-300";
                        statusIcon = "✕";
                      }

                      return (
                        <div
                          key={idx}
                          className={`py-3 px-4 rounded-lg border flex items-start gap-3 ${statusColor}`}
                        >
                          <span className="text-lg pt-0.5">{statusIcon}</span>
                          <div className="flex-1">
                            <div className="flex justify-between">
                              <p className="font-medium">{log.activity_name}</p>
                              <span className="text-xs px-2 py-1 rounded bg-black/30">{statusType}</span>
                            </div>
                            <p className="text-xs opacity-75 mt-1">
                              {log.detected_at
                                ? new Date(log.detected_at).toLocaleTimeString()
                                : "Not detected"}
                            </p>
                            {/* Show adaptive threshold details if available */}
                            {log.adaptive_grace_minutes !== undefined && (
                              <div className="flex gap-4 text-xs opacity-70 mt-2">
                                <span>Grace: {log.adaptive_grace_minutes}min</span>
                                <span>Delay: {log.delay_minutes}min</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Alerts & Issues */}
            <div className="space-y-8">
              {/* Alerts Section */}
              <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <span className="text-xl">🔔</span>
                  Alerts {unreadCount > 0 && <span className="ml-auto bg-red-600 rounded-full px-2 text-sm">{unreadCount}</span>}
                </h2>

                {notifications.filter((n) => !n.read).length === 0 ? (
                  <p className="text-gray-400 text-sm">No new alerts</p>
                ) : (
                  <div className="space-y-2">
                    {notifications
                      .filter((n) => !n.read)
                      .slice(0, 5)
                      .map((notif) => (
                        <div
                          key={notif.notification_id}
                          className={`py-3 px-3 rounded-lg border text-sm ${
                            notif.status === "Late"
                              ? "bg-yellow-900/30 border-yellow-700 text-yellow-300"
                              : "bg-red-900/30 border-red-700 text-red-300"
                          }`}
                        >
                          <p className="font-semibold">{notif.activity_name}</p>
                          <p className="text-xs mt-1 opacity-80">{notif.message}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Deviations Section */}
              <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
                <h2 className="text-xl font-semibold mb-4">Deviations</h2>
                {deviations.length === 0 ? (
                  <p className="text-gray-400 text-sm">No deviations detected</p>
                ) : (
                  <div className="space-y-2">
                    {deviations.slice(0, 5).map((d, i) => (
                      <div key={i} className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-3 text-sm">
                        <p className="text-yellow-300 font-semibold">{d.expected_activity}</p>
                        <p className="text-xs text-yellow-400 mt-1">
                          Got: {d.observed_activity}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(d.detected_at).toLocaleTimeString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
