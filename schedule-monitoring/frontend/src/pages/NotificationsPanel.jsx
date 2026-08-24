// schedule-monitoring/frontend/src/pages/NotificationsPanel.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../services/scheduleApi";

const PATIENT_ID = "patient_001";
const VOICE_REPEAT_MS = 20000;

const ALERT_CONFIG = {
  late: {
    label: "Late",
    bg: "bg-amber-500/10 border-amber-500/30",
    text: "text-amber-300",
    icon: "⚠️",
    dot: "bg-amber-400",
    largeBg:
      "bg-gradient-to-br from-amber-500/30 to-amber-900/50 border-amber-400",
    largeTitle: "text-amber-200",
    flashClass: "alert-flash-amber",
  },
  missed: {
    label: "Missed",
    bg: "bg-rose-500/10 border-rose-500/30",
    text: "text-rose-300",
    icon: "❌",
    dot: "bg-rose-400",
    largeBg:
      "bg-gradient-to-br from-rose-500/35 to-rose-900/55 border-rose-400",
    largeTitle: "text-rose-200",
    flashClass: "alert-flash-rose",
  },
  caregiver_missing: {
    label: "No Caregiver",
    bg: "bg-orange-500/10 border-orange-500/30",
    text: "text-orange-300",
    icon: "🚨",
    dot: "bg-orange-400",
    largeBg:
      "bg-gradient-to-br from-orange-500/30 to-orange-900/50 border-orange-400",
    largeTitle: "text-orange-200",
    flashClass: "alert-flash-amber",
  },
};

function timeAgo(isoStr) {
  if (!isoStr) return "";
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(isoStr).toLocaleDateString();
}

function formatTime(isoStr) {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isCritical(n) {
  const t = (n.alert_type || n.status || "").toLowerCase();
  return t === "late" || t === "missed" || t === "caregiver_missing";
}

function buildSpokenMessage(n, type) {
  const activity = n.task_name || n.activity_name || "an activity";
  if (type === "missed") {
    return `Missed activity alert. ${activity} has been missed. Please look after the patient immediately.`;
  }
  if (type === "late") {
    return `Late activity alert. ${activity} is late. Please look after the patient and assist if needed.`;
  }
  if (type === "caregiver_missing") {
    return `Caregiver not detected. Please confirm someone is present to assist the patient.`;
  }
  return `Alert. ${activity} needs your attention. Please look after the patient.`;
}

function speak(text, { urgent = false } = {}) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = urgent ? 1.0 : 0.95;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(
        (v) =>
          v.lang?.startsWith("en") &&
          /female|Samantha|Google US English/i.test(v.name)
      ) || voices.find((v) => v.lang?.startsWith("en"));
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn("Speech synthesis failed:", e);
  }
}

export default function NotificationsPanel({ patientId = PATIENT_ID }) {
  const [data, setData] = useState({ notifications: [], unread_count: 0 });
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState("all");
  const [dismissedPopupIds, setDismissedPopupIds] = useState(new Set());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const speechTimersRef = useRef({});

  const fetchData = useCallback(async () => {
    try {
      const r = await getNotifications(patientId);
      const payload = r.data || {};
      const list = Array.isArray(payload)
        ? payload
        : payload.notifications || [];
      setData({
        notifications: list,
        unread_count:
          payload.unread_count ?? list.filter((n) => !n.read).length,
      });
    } catch {
      try {
        const r2 = await getNotifications();
        const payload = r2.data || {};
        const list = Array.isArray(payload)
          ? payload
          : payload.notifications || [];
        setData({
          notifications: list,
          unread_count:
            payload.unread_count ?? list.filter((n) => !n.read).length,
        });
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 15000);
    return () => clearInterval(id);
  }, [fetchData]);

  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  const allNotifs = data.notifications || [];
  const displayed = allNotifs.filter((n) =>
    filter === "unread" ? !n.read : true
  );

  const criticalUnread = allNotifs.filter(
    (n) =>
      !n.read &&
      isCritical(n) &&
      !dismissedPopupIds.has(n.notification_id)
  );

  useEffect(() => {
    if (!soundEnabled) return;
    const activeIds = new Set(criticalUnread.map((n) => n.notification_id));

    Object.keys(speechTimersRef.current).forEach((id) => {
      if (!activeIds.has(id)) {
        clearInterval(speechTimersRef.current[id]);
        delete speechTimersRef.current[id];
      }
    });

    criticalUnread.forEach((n) => {
      const id = n.notification_id;
      if (speechTimersRef.current[id]) return;
      const type = (n.alert_type || n.status || "missed").toLowerCase();
      const message = buildSpokenMessage(n, type);
      const urgent = type === "missed";
      speak(message, { urgent });
      speechTimersRef.current[id] = setInterval(() => {
        speak(message, { urgent });
      }, VOICE_REPEAT_MS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criticalUnread.map((n) => n.notification_id).join(","), soundEnabled]);

  useEffect(() => {
    return () => {
      Object.values(speechTimersRef.current).forEach(clearInterval);
      speechTimersRef.current = {};
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const stopSpeechFor = (notifId) => {
    if (speechTimersRef.current[notifId]) {
      clearInterval(speechTimersRef.current[notifId]);
      delete speechTimersRef.current[notifId];
    }
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      speak("Sound alerts are now on. Late and missed activities will be announced.");
    } else {
      Object.values(speechTimersRef.current).forEach(clearInterval);
      speechTimersRef.current = {};
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    }
  };

  const handleMarkRead = async (notifId) => {
    stopSpeechFor(notifId);
    await markNotificationRead(notifId).catch(() => {});
    setDismissedPopupIds((prev) => new Set([...prev, notifId]));
    fetchData();
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    Object.values(speechTimersRef.current).forEach(clearInterval);
    speechTimersRef.current = {};
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    await markAllNotificationsRead(patientId).catch(() => {});
    await fetchData();
    setMarkingAll(false);
  };

  const handleDismissPopup = (notifId) => {
    stopSpeechFor(notifId);
    setDismissedPopupIds((prev) => new Set([...prev, notifId]));
  };

  return (
    <div className="p-8 max-w-3xl mx-auto fade-in">
      {/* Flash keyframes */}
      <style>{`
        @keyframes alertPulseRose {
          0%, 100% { box-shadow: 0 0 0 0 rgba(244,63,94,0.55); border-color: rgb(251,113,133); }
          50% { box-shadow: 0 0 40px 8px rgba(244,63,94,0.45); border-color: rgb(255,255,255); }
        }
        @keyframes alertPulseAmber {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.55); border-color: rgb(251,191,36); }
          50% { box-shadow: 0 0 40px 8px rgba(245,158,11,0.45); border-color: rgb(255,255,255); }
        }
        @keyframes screenFlashRose {
          0%, 100% { background: rgba(244,63,94,0.08); }
          50% { background: rgba(244,63,94,0.22); }
        }
        @keyframes screenFlashAmber {
          0%, 100% { background: rgba(245,158,11,0.08); }
          50% { background: rgba(245,158,11,0.20); }
        }
        .alert-flash-rose {
          animation: alertPulseRose 1.2s ease-in-out infinite;
        }
        .alert-flash-amber {
          animation: alertPulseAmber 1.2s ease-in-out infinite;
        }
        .alert-screen-rose {
          animation: screenFlashRose 1.2s ease-in-out infinite;
        }
        .alert-screen-amber {
          animation: screenFlashAmber 1.2s ease-in-out infinite;
        }
      `}</style>

      {/* Full-width flashing critical alerts */}
      {criticalUnread.length > 0 && (
        <div className="space-y-4 mb-8">
          {criticalUnread.map((n) => {
            const type = (n.alert_type || n.status || "missed").toLowerCase();
            const cfg = ALERT_CONFIG[type] || ALERT_CONFIG.missed;
            const title =
              n.task_name || n.activity_name || cfg.label + " Alert";
            const screenClass =
              type === "missed" ? "alert-screen-rose" : "alert-screen-amber";

            return (
              <div
                key={n.notification_id}
                className={`relative border-4 rounded-3xl p-7 shadow-2xl ${cfg.largeBg} ${cfg.flashClass} ${screenClass}`}
              >
                <div className="absolute top-3 right-3 flex gap-1">
                  <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping" />
                  <span className="w-3 h-3 rounded-full bg-rose-500" />
                </div>

                <div className="flex items-start gap-5">
                  <div className="text-6xl leading-none shrink-0 animate-pulse">
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span
                        className={`text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full border ${cfg.bg} ${cfg.text}`}
                      >
                        {cfg.label} — Please look after the patient
                      </span>
                      <span className="text-xs text-gray-300 font-mono">
                        {formatTime(n.created_at)} · {timeAgo(n.created_at)}
                      </span>
                      {soundEnabled && (
                        <span className="text-xs text-white/80">🔊 Voice on</span>
                      )}
                    </div>
                    <h2
                      className={`text-3xl font-extrabold ${cfg.largeTitle} mb-2`}
                    >
                      {title}
                    </h2>
                    <p className="text-white text-lg leading-relaxed">
                      {n.message ||
                        (type === "missed"
                          ? "This scheduled activity was missed. Please check on the patient immediately."
                          : "This activity is late. Please check on the patient and assist if needed.")}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-6">
                      <button
                        onClick={() => handleMarkRead(n.notification_id)}
                        className="px-6 py-3 bg-white text-gray-900 hover:bg-gray-100 text-sm font-bold rounded-xl transition-colors shadow-lg"
                      >
                        Acknowledge
                      </button>
                      <button
                        onClick={() => handleDismissPopup(n.notification_id)}
                        className="px-6 py-3 text-white/80 hover:text-white text-sm font-medium transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hero */}
      <div className="mb-8 rounded-3xl border border-gray-800 bg-gray-900/40 backdrop-blur-md p-6 relative overflow-hidden">
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
            <p className="text-gray-500 text-sm mt-1">
              Flashing alerts + voice for Late and Missed activities.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4 relative z-10">
          <button
            onClick={handleToggleSound}
            className={`px-4 py-2 text-sm rounded-xl transition-colors border ${
              soundEnabled
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
            }`}
          >
            {soundEnabled ? "🔊 Sound Alerts: On" : "🔇 Sound Alerts: Off"}
          </button>
          {data.unread_count > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="px-4 py-2 text-sm bg-gray-800 border border-gray-700 text-gray-300 hover:text-white rounded-xl"
            >
              {markingAll ? "Marking…" : "Mark All Read"}
            </button>
          )}
          <button
            onClick={fetchData}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters + list (same as before) */}
      <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit mb-6">
        {["all", "unread"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
              filter === f
                ? "bg-indigo-600 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {f === "unread"
              ? `Unread (${data.unread_count})`
              : `All (${allNotifs.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          No notifications yet. Late / Missed alerts will flash and speak here.
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((n) => {
            const type = (n.alert_type || n.status || "").toLowerCase();
            const cfg = ALERT_CONFIG[type] || {
              label: n.alert_type || n.status || "Info",
              bg: "bg-gray-900 border-gray-800",
              text: "text-gray-300",
              icon: "ℹ️",
              dot: "bg-gray-500",
            };
            const title = n.task_name || n.activity_name || cfg.label;
            return (
              <div
                key={n.notification_id}
                className={`border rounded-2xl p-5 ${cfg.bg} ${
                  n.read ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="text-2xl">{cfg.icon}</div>
                  <div className="flex-1">
                    <div className="flex justify-between gap-2">
                      <div>
                        <p className={`font-semibold text-sm ${cfg.text}`}>
                          {title}
                        </p>
                        <p className="text-gray-300 text-sm mt-1">{n.message}</p>
                      </div>
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full border h-fit ${cfg.bg} ${cfg.text}`}
                      >
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-gray-600 text-xs mt-2">
                      {timeAgo(n.created_at)} · {formatTime(n.created_at)}
                    </p>
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