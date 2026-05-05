import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getDeviations, getSchedule, getNotifications, getActivityLogs, deleteSchedule } from "../services/scheduleApi";
import ActivityDetectorMonitor from "../components/ActivityDetectorMonitor";
import AlertModal from "../components/AlertModal";
import toast from "react-hot-toast";

export default function ScheduleDashboard() {
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState([]);
  const [deviations, setDeviations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showDetector, setShowDetector] = useState(false);
  const [activeAlert, setActiveAlert] = useState(null);
  const prevUnreadCount = useRef(0);
  const shownMissedRef = useRef(new Set());

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
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
      
      const newNotifs = notifRes.data || [];
      setNotifications(newNotifs);
      
      const newUnreadCount = newNotifs.filter(n => !n.read).length;
      if (newUnreadCount > prevUnreadCount.current && prevUnreadCount.current !== 0) {
        toast.error(`You have new alerts! Check the notifications.`, {
          icon: '⚠️',
          duration: 4000,
        });

        // Show full-screen modal for new Missed notifications
        const missedNotifs = newNotifs.filter(
          n => !n.read && n.status === "Missed" && !shownMissedRef.current.has(n.notification_id)
        );
        if (missedNotifs.length > 0) {
          const m = missedNotifs[0];
          shownMissedRef.current.add(m.notification_id);
          setActiveAlert({
            status: "Missed",
            activityName: m.activity_name,
            message: m.message,
            time: new Date(m.created_at || Date.now()).toLocaleString([], {
              month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit'
            }),
          });
        }
      }
      prevUnreadCount.current = newUnreadCount;

      const logs = logsRes.data || [];
      setTotalLogs(logs.length);
      setRecentLogs(logs.slice(0, 5));
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSchedule = async () => {
    if (!schedule.length) return;
    if (window.confirm("Are you sure you want to delete the current routine? All associated logs will be cleared.")) {
      try {
        await deleteSchedule(schedule[0].schedule_id);
        toast.success("Routine deleted successfully");
        setSchedule([]);
        setRecentLogs([]);
        setTotalLogs(0);
        setDeviations([]);
        setNotifications([]);
      } catch (err) {
        toast.error("Failed to delete routine");
      }
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const todayActivities = schedule.length > 0 ? schedule[0]?.activities?.length || 0 : 0;

  return (
    <div className="w-full pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 animate-slide-up">
        <div>
          <h1 className="text-4xl font-extrabold text-white tracking-tight">Dashboard</h1>
          <p className="text-gray-400 mt-2 text-sm">Real-time activity tracking and routine monitoring</p>
        </div>
        <div className="flex gap-4 mt-6 md:mt-0">
          <button
            onClick={() => setShowDetector(!showDetector)}
            className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 shadow-lg ${
              showDetector
                ? "bg-rose-500/10 text-rose-400 border border-rose-500/50 hover:bg-rose-500/20"
                : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20"
            }`}
          >
            {showDetector ? "⏹ Hide Camera" : "▶ Start Detection"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="space-y-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
          
          {/* Activity Detector - Conditionally Visible */}
          {showDetector && (
            <div className="mb-10 rounded-2xl overflow-hidden shadow-2xl border border-gray-800 bg-gray-900/50 backdrop-blur-xl">
              <ActivityDetectorMonitor />
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-900/20 group">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Scheduled Today</p>
              <div className="mt-4 flex items-end gap-3">
                <span className="text-4xl font-bold text-white group-hover:text-blue-400 transition-colors">{todayActivities}</span>
                <span className="text-sm text-gray-500 mb-1">activities</span>
              </div>
            </div>

            <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-900/20 group">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Logged Activities</p>
              <div className="mt-4 flex items-end gap-3">
                <span className="text-4xl font-bold text-white group-hover:text-emerald-400 transition-colors">{totalLogs}</span>
                <span className="text-sm text-gray-500 mb-1">detected</span>
              </div>
            </div>

            <div className={`bg-gray-900/40 backdrop-blur-md border rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl group ${unreadCount > 0 ? 'border-rose-500/50 hover:shadow-rose-900/20' : 'border-gray-800'}`}>
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Active Alerts</p>
              <div className="mt-4 flex items-end gap-3">
                <span className={`text-4xl font-bold transition-colors ${unreadCount > 0 ? 'text-rose-400' : 'text-white'}`}>{unreadCount}</span>
                <span className="text-sm text-gray-500 mb-1">unread</span>
              </div>
            </div>

            <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-900/20 group">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Deviations</p>
              <div className="mt-4 flex items-end gap-3">
                <span className="text-4xl font-bold text-white group-hover:text-amber-400 transition-colors">{deviations.length}</span>
                <span className="text-sm text-gray-500 mb-1">recorded</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-4">
            
            {/* Left Column: Timeline */}
            <div className="lg:col-span-2 space-y-8">
              <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl p-8 border border-gray-800/60 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-blue-500/5 rounded-full blur-3xl"></div>
                <div className="flex justify-between items-center mb-8 relative z-10">
                  <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm">📅</span>
                    Today's Routine
                  </h2>
                  {schedule.length > 0 && (
                    <button
                      onClick={handleDeleteSchedule}
                      className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold rounded-lg border border-rose-500/30 transition-colors flex items-center gap-2"
                    >
                      <span>🗑</span> Delete Routine
                    </button>
                  )}
                </div>
                
                {schedule.length === 0 ? (
                  <div className="py-12 text-center text-gray-500 relative z-10">
                    <p className="mb-4 text-4xl">📭</p>
                    <p>No routine established yet.</p>
                    <button onClick={() => navigate("/routine-setup")} className="mt-4 text-blue-400 hover:text-blue-300 text-sm font-medium transition">
                      Set up a routine →
                    </button>
                  </div>
                ) : (
                  <div className="relative border-l-2 border-gray-800/80 ml-4 space-y-8 py-2 z-10">
                    {schedule[0]?.activities?.map((activity, idx) => {
                      // Find if there is a log for this
                      const log = recentLogs.find(l => l.activity_name === activity.activity_name);
                      let statusDot = "bg-gray-800 border-gray-700";
                      let statusText = "Pending";
                      let textClass = "text-gray-500";
                      
                      if (log) {
                        if (log.status === "Done" || log.status === "On Time") { statusDot = "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] border-emerald-900"; statusText = "Done"; textClass = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"; }
                        if (log.status === "Early") { statusDot = "bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.5)] border-cyan-900"; statusText = "Early"; textClass = "text-cyan-400 bg-cyan-500/10 border-cyan-500/20"; }
                        if (log.status === "Late" || log.status === "Slightly Late") { statusDot = "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.5)] border-amber-900"; statusText = "Late"; textClass = "text-amber-400 bg-amber-500/10 border-amber-500/20"; }
                        if (log.status === "Missed") { statusDot = "bg-rose-500 shadow-[0_0_12px_rgba(225,29,72,0.5)] border-rose-900"; statusText = "Missed"; textClass = "text-rose-400 bg-rose-500/10 border-rose-500/20"; }
                      } else {
                        textClass = "text-gray-400 bg-gray-800 border-gray-700";
                      }

                      return (
                        <div key={idx} className="relative pl-8 group">
                          <div className={`absolute -left-[9px] top-1.5 w-4 h-4 rounded-full border-2 ${statusDot} transition-all duration-300 group-hover:scale-125 z-10`} />
                          <div className="bg-gray-800/30 hover:bg-gray-800/60 transition-colors border border-gray-700/50 rounded-xl p-4 flex justify-between items-center backdrop-blur-sm">
                            <div>
                              <p className="font-semibold text-gray-200">{activity.activity_name}</p>
                              <p className="text-xs text-gray-500 mt-1 font-mono tracking-tight">
                                {activity.start_time} — {activity.end_time}
                              </p>
                            </div>
                            <div className={`text-xs font-semibold px-3 py-1 rounded-full border ${textClass}`}>
                              {statusText}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Alerts */}
            <div className="space-y-8">
              <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl p-6 border border-gray-800/60 shadow-lg relative overflow-hidden">
                 <div className="absolute top-0 left-0 p-32 bg-rose-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="flex items-center justify-between mb-6 relative z-10">
                  <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-400 text-sm">🔔</span>
                    Alerts
                  </h2>
                  {unreadCount > 0 && <span className="bg-rose-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-[0_0_10px_rgba(225,29,72,0.4)] animate-pulse-slow">{unreadCount} new</span>}
                </div>

                {notifications.filter(n => !n.read).length === 0 ? (
                  <div className="py-8 text-center relative z-10">
                    <p className="text-4xl mb-3">✅</p>
                    <p className="text-gray-500 text-sm">All clear! No recent alerts.</p>
                  </div>
                ) : (
                  <div className="space-y-3 relative z-10">
                    {notifications.filter(n => !n.read).slice(0, 5).map((notif) => (
                      <div key={notif.notification_id} className="p-4 rounded-xl border border-rose-900/30 bg-rose-950/20 hover:bg-rose-900/30 transition-colors relative overflow-hidden group cursor-pointer">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-rose-500 to-rose-700 group-hover:w-1.5 transition-all"></div>
                        <p className="font-medium text-rose-200 text-sm">{notif.activity_name}</p>
                        <p className="text-xs text-rose-400/80 mt-1">{notif.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}\n

      {/* Full-screen Missed alert modal */}
      <AlertModal
        alert={activeAlert}
        onDismiss={() => setActiveAlert(null)}
      />
    </div>
  );
}
