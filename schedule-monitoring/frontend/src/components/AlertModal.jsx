// schedule-monitoring/frontend/src/components/AlertModal.jsx
/**
 * Full-screen alert modal with warning sound + visual flash.
 * Triggered for Early, Late, and Missed activity deviations.
 */
import { useEffect } from "react";

// ── Web Audio Warning Sounds ───────────────────────────────────────────────
function playBeep(ctx, startTime, frequency, duration, volume = 0.4) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "square";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, ctx.currentTime + startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
  osc.start(ctx.currentTime + startTime);
  osc.stop(ctx.currentTime + startTime + duration + 0.05);
}

function playWarningSound(status) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (status === "Missed") {
      // Three urgent high-pitched beeps
      playBeep(ctx, 0.0, 1050, 0.25, 0.5);
      playBeep(ctx, 0.35, 1050, 0.25, 0.5);
      playBeep(ctx, 0.70, 1050, 0.25, 0.5);
    } else if (status === "Late") {
      // Two warning beeps descending
      playBeep(ctx, 0.0, 780, 0.35, 0.4);
      playBeep(ctx, 0.5, 620, 0.35, 0.4);
    } else if (status === "Early") {
      // Single ascending chime
      playBeep(ctx, 0.0, 520, 0.20, 0.3);
      playBeep(ctx, 0.25, 660, 0.20, 0.3);
    }
  } catch (e) {
    console.warn("Audio context unavailable:", e);
  }
}

// ── Config per alert type ──────────────────────────────────────────────────
const ALERT_CONFIG = {
  Early: {
    gradient:   "from-cyan-950 via-slate-900 to-cyan-950",
    border:     "border-cyan-400",
    glowColor:  "#22d3ee",
    flashBg:    "bg-cyan-400",
    iconBg:     "bg-cyan-400/20",
    textColor:  "text-cyan-300",
    badgeBg:    "bg-cyan-500/20 border-cyan-500/50",
    icon:       "⏰",
    title:      "Early Activity Detected",
    subtitle:   "Activity is happening ahead of schedule",
  },
  Late: {
    gradient:   "from-amber-950 via-slate-900 to-amber-950",
    border:     "border-amber-400",
    glowColor:  "#f59e0b",
    flashBg:    "bg-amber-400",
    iconBg:     "bg-amber-400/20",
    textColor:  "text-amber-300",
    badgeBg:    "bg-amber-500/20 border-amber-500/50",
    icon:       "⚠️",
    title:      "Activity Running Late",
    subtitle:   "Activity started past the scheduled time",
  },
  Missed: {
    gradient:   "from-red-950 via-slate-900 to-red-950",
    border:     "border-red-500",
    glowColor:  "#ef4444",
    flashBg:    "bg-red-500",
    iconBg:     "bg-red-500/20",
    textColor:  "text-red-300",
    badgeBg:    "bg-red-500/20 border-red-500/50",
    icon:       "🚨",
    title:      "Activity Missed!",
    subtitle:   "Activity was not performed within the scheduled window",
  },
};

// ── Component ──────────────────────────────────────────────────────────────
export default function AlertModal({ alert, onDismiss }) {
  useEffect(() => {
    if (!alert) return;
    playWarningSound(alert.status);
    // Auto-dismiss Missed alerts after 12 seconds, others after 8
    const timeout = setTimeout(onDismiss, alert.status === "Missed" ? 12000 : 8000);
    return () => clearTimeout(timeout);
  }, [alert]);

  if (!alert) return null;

  const c = ALERT_CONFIG[alert.status] || ALERT_CONFIG.Missed;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">

      {/* Screen flash overlay */}
      <div
        className={`absolute inset-0 ${c.flashBg} animate-screen-flash pointer-events-none`}
        style={{ opacity: 0 }}
      />

      {/* Dimmed backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-md"
        onClick={onDismiss}
      />

      {/* Modal card */}
      <div
        className={`relative z-10 animate-alert-in bg-gradient-to-br ${c.gradient} border-2 ${c.border} rounded-3xl p-10 max-w-lg w-full mx-6 animate-glow-pulse`}
        style={{ "--glow-color": c.glowColor }}
      >
        {/* Glowing top strip */}
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 rounded-t-3xl ${c.flashBg} opacity-80`}
          style={{ boxShadow: `0 0 20px 4px ${c.glowColor}` }}
        />

        {/* Icon */}
        <div className={`w-24 h-24 rounded-full ${c.iconBg} border-2 ${c.border} flex items-center justify-center mx-auto mb-6 animate-icon-bounce`}>
          <span className="text-5xl">{c.icon}</span>
        </div>

        {/* Status badge */}
        <div className="flex justify-center mb-4">
          <span className={`px-4 py-1.5 rounded-full text-sm font-bold border ${c.badgeBg} ${c.textColor} uppercase tracking-widest`}>
            {alert.status}
          </span>
        </div>

        {/* Title */}
        <h2 className={`text-3xl font-extrabold text-center ${c.textColor} mb-2 tracking-tight`}>
          {c.title}
        </h2>
        <p className="text-gray-400 text-center text-sm mb-6">{c.subtitle}</p>

        {/* Activity info */}
        <div className={`rounded-2xl border ${c.border}/30 bg-white/5 p-5 mb-8 space-y-3`}>
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Activity</span>
            <span className={`font-bold text-lg ${c.textColor}`}>{alert.activityName}</span>
          </div>
          {alert.message && (
            <div className="flex justify-between items-start">
              <span className="text-gray-400 text-sm">Details</span>
              <span className="text-white text-sm text-right max-w-[60%]">{alert.message}</span>
            </div>
          )}
          {alert.time && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Time</span>
              <span className="text-white font-mono text-sm">{alert.time}</span>
            </div>
          )}
        </div>

        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          className={`w-full py-4 rounded-2xl font-bold text-lg border-2 ${c.border} ${c.textColor} hover:bg-white/10 transition-all duration-200 active:scale-95`}
        >
          Dismiss Alert
        </button>

        <p className="text-gray-600 text-xs text-center mt-3">
          Auto-dismisses in {alert.status === "Missed" ? 12 : 8}s • Click backdrop to dismiss
        </p>
      </div>
    </div>
  );
}
