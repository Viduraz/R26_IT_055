
import { useState } from "react";
import { createSchedule } from "../services/scheduleApi";
import { useNavigate } from "react-router-dom";

const ACTIVITY_TYPES = [
  "Standing up", "Eating", "Drinking", "Taking Medications",
  "Talking", "Walking", "Sitting / rest", "Sleep"
];

const ACTIVITY_COLORS = {
  "Eating": { dot: "#f59e0b", badge: "rgba(245,158,11,0.15)", text: "#fbbf24", border: "rgba(245,158,11,0.4)", icon: "🍽️" },
  "Drinking": { dot: "#3b82f6", badge: "rgba(59,130,246,0.15)", text: "#60a5fa", border: "rgba(59,130,246,0.4)", icon: "🥤" },
  "Taking Medications": { dot: "#a855f7", badge: "rgba(168,85,247,0.15)", text: "#c084fc", border: "rgba(168,85,247,0.4)", icon: "💊" },
  "Walking": { dot: "#22c55e", badge: "rgba(34,197,94,0.15)", text: "#4ade80", border: "rgba(34,197,94,0.4)", icon: "🚶" },
  "Sleep": { dot: "#6366f1", badge: "rgba(99,102,241,0.15)", text: "#818cf8", border: "rgba(99,102,241,0.4)", icon: "🌙" },
  "Standing up": { dot: "#06b6d4", badge: "rgba(6,182,212,0.15)", text: "#22d3ee", border: "rgba(6,182,212,0.4)", icon: "🧍" },
  "Talking": { dot: "#f43f5e", badge: "rgba(244,63,94,0.15)", text: "#fb7185", border: "rgba(244,63,94,0.4)", icon: "💬" },
  "Sitting / rest": { dot: "#94a3b8", badge: "rgba(148,163,184,0.1)", text: "#cbd5e1", border: "rgba(148,163,184,0.3)", icon: "🪑" },
};

const TEMPLATES = {
  morning: {
    name: "Morning Routine", time: "6:00 AM – 8:00 AM", icon: "🌅",
    bg: "linear-gradient(135deg, rgba(180,83,9,0.55) 0%, rgba(124,45,18,0.35) 100%)",
    border: "rgba(251,146,60,0.45)", glow: "rgba(251,146,60,0.2)",
    activities: [
      { activity_name: "Standing up", start_time: "06:00", end_time: "06:15" },
      { activity_name: "Eating", start_time: "06:15", end_time: "06:30" },
      { activity_name: "Walking", start_time: "06:30", end_time: "06:45" },
      { activity_name: "Sitting / rest", start_time: "06:45", end_time: "07:00" }
    ]
  },
  fullday: {
    name: "Full Day Schedule", time: "7:00 AM – 9:00 PM", icon: "📅",
    bg: "linear-gradient(135deg, rgba(29,78,216,0.55) 0%, rgba(30,27,75,0.4) 100%)",
    border: "rgba(96,165,250,0.45)", glow: "rgba(59,130,246,0.2)",
    activities: [
      { activity_name: "Standing up", start_time: "07:00", end_time: "07:30" },
      { activity_name: "Eating", start_time: "07:30", end_time: "08:00" },
      { activity_name: "Walking", start_time: "08:00", end_time: "09:00" },
      { activity_name: "Sitting / rest", start_time: "09:00", end_time: "12:00" },
      { activity_name: "Eating", start_time: "12:00", end_time: "12:30" },
      { activity_name: "Walking", start_time: "12:30", end_time: "13:00" },
      { activity_name: "Sitting / rest", start_time: "13:00", end_time: "17:00" },
      { activity_name: "Eating", start_time: "17:00", end_time: "17:30" },
      { activity_name: "Walking", start_time: "17:30", end_time: "18:00" },
      { activity_name: "Sitting / rest", start_time: "18:00", end_time: "21:00" },
      { activity_name: "Sleep", start_time: "21:00", end_time: "07:00" }
    ]
  },
  testing: {
    name: "Quick Test", time: "Live Dynamic Schedule", icon: "🧪",
    bg: "linear-gradient(135deg, rgba(5,150,105,0.55) 0%, rgba(6,78,59,0.4) 100%)",
    border: "rgba(52,211,153,0.45)", glow: "rgba(16,185,129,0.2)",
    activities: []
  },
  demo: {
    name: "Demo Mode", time: "Live Dynamic Schedule", icon: "🎥",
    bg: "linear-gradient(135deg, rgba(109,40,217,0.55) 0%, rgba(76,5,80,0.4) 100%)",
    border: "rgba(196,181,253,0.45)", glow: "rgba(168,85,247,0.2)",
    activities: []
  }
};

const inputStyle = {
  background: "rgba(7,10,20,0.7)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  color: "#e2e8f0",
  padding: "12px 16px",
  fontSize: "14px",
  width: "100%",
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
};

const cardStyle = {
  background: "rgba(10,15,30,0.7)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "20px",
  padding: "28px",
  boxShadow: "0 8px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
};

export default function RoutineSetup() {
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);
  const [description, setDescription] = useState("");
  const [currentActivity, setCurrentActivity] = useState("");
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("06:30");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [focusedField, setFocusedField] = useState(null);

  const loadTemplate = (key) => {
    let template = { ...TEMPLATES[key] };
    if (key === "testing") {
      const now = new Date();
      const fmt = (d) => d.toTimeString().substring(0, 5);
      template.activities = ACTIVITY_TYPES.map((name, i) => ({
        activity_name: name,
        start_time: fmt(new Date(now.getTime() + i * 60000)),
        end_time: fmt(new Date(now.getTime() + (i + 1) * 60000))
      }));
    } else if (key === "demo") {
      const now = new Date();
      const fmt = (d) => d.toTimeString().substring(0, 5);
      template.activities = ACTIVITY_TYPES.slice(0, 5).map((name, i) => ({
        activity_name: name,
        start_time: fmt(new Date(now.getTime() + i * 60000)),
        end_time: fmt(new Date(now.getTime() + (i + 1) * 60000))
      }));
    }
    setActivities(template.activities);
    setDescription(template.name + " schedule");
    setMessage(`✓ Loaded: ${template.name}`);
    setTimeout(() => setMessage(""), 3000);
  };

  const clearAll = () => {
    setActivities([]); setDescription(""); setCurrentActivity("");
    setStartTime("06:00"); setEndTime("06:30");
    setMessage("Cleared all activities");
    setTimeout(() => setMessage(""), 3000);
  };

  const addActivity = () => {
    if (!currentActivity || !startTime || !endTime) {
      setError("Please fill in all fields"); setTimeout(() => setError(""), 3000); return;
    }
    if (new Date(`2000-01-01 ${startTime}`) >= new Date(`2000-01-01 ${endTime}`)) {
      setError("Start time must be before end time"); setTimeout(() => setError(""), 3000); return;
    }
    setActivities([...activities, { activity_name: currentActivity, start_time: startTime, end_time: endTime }]);
    setCurrentActivity(""); setError("");
  };

  const removeActivity = (index) => setActivities(activities.filter((_, i) => i !== index));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (activities.length === 0) { setError("Please add at least one activity"); setTimeout(() => setError(""), 3000); return; }
    setLoading(true); setError(""); setMessage("");
    try {
      await createSchedule(activities, description);
      setMessage("✓ Schedule created successfully!");
      setTimeout(() => navigate("/dashboard", { state: { fromSetup: true } }), 1500);
    } catch (err) {
      setError(err.response?.data?.detail || "Unknown error - check console");
    } finally { setLoading(false); }
  };

  const getFocusStyle = (name) => focusedField === name
    ? { borderColor: "rgba(99,102,241,0.8)", boxShadow: "0 0 0 3px rgba(99,102,241,0.15)" }
    : {};

  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden", background: "#06080f" }}>
      {/* Background glow blobs */}
      <div style={{ position: "fixed", top: "-100px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(109,40,217,0.35) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "fixed", bottom: "-120px", left: "-80px", width: "400px", height: "400px", borderRadius: "50%", background: "radial-gradient(circle, rgba(29,78,216,0.25) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "fixed", top: "40%", left: "40%", width: "300px", height: "300px", borderRadius: "50%", background: "radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1, padding: "40px 24px 80px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "44px" }}>
          <h1 style={{ fontSize: "clamp(2.2rem, 5vw, 3.5rem)", fontWeight: 900, color: "#fff", margin: 0, letterSpacing: "-0.02em", textShadow: "0 0 60px rgba(139,92,246,0.5), 0 2px 4px rgba(0,0,0,0.5)" }}>
            Routine Setup
          </h1>
          <p style={{ color: "rgba(148,163,184,0.8)", fontSize: "15px", marginTop: "10px", letterSpacing: "0.01em" }}>
            Design a personalized daily care schedule
          </p>
        </div>

        {/* Template Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "28px" }}>
          {Object.entries(TEMPLATES).map(([key, t]) => (
            <button key={key} onClick={() => loadTemplate(key)}
              style={{
                background: t.bg, border: `1px solid ${t.border}`, borderRadius: "18px",
                padding: "20px 18px", cursor: "pointer", textAlign: "left",
                boxShadow: `0 8px 32px ${t.glow}, 0 2px 8px rgba(0,0,0,0.4)`,
                transition: "transform 0.2s, box-shadow 0.2s",
                backdropFilter: "blur(12px)",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 16px 48px ${t.glow}, 0 4px 12px rgba(0,0,0,0.5)`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 8px 32px ${t.glow}, 0 2px 8px rgba(0,0,0,0.4)`; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                <span style={{ fontSize: "28px" }}>{t.icon}</span>
                <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 10px", background: "rgba(0,0,0,0.35)", color: "rgba(255,255,255,0.6)", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(4px)" }}>
                  {t.activities.length > 0 ? `${t.activities.length} items` : "Dynamic"}
                </span>
              </div>
              <div style={{ fontWeight: 700, color: "#fff", fontSize: "14px", marginBottom: "4px" }}>{t.name}</div>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>{t.time}</div>
            </button>
          ))}
        </div>

        {/* Main 2-column grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>

          {/* LEFT: Add Activity */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#fff", margin: "0 0 24px 0" }}>Add Activity</h2>

            <div style={{ marginBottom: "18px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "rgba(148,163,184,0.8)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>Activity Type</label>
              <div style={{ position: "relative" }}>
                <select value={currentActivity} onChange={e => setCurrentActivity(e.target.value)}
                  onFocus={() => setFocusedField("activity")} onBlur={() => setFocusedField(null)}
                  style={{ ...inputStyle, appearance: "none", cursor: "pointer", paddingRight: "40px", ...getFocusStyle("activity") }}>
                  <option value="">Select activity...</option>
                  {ACTIVITY_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <div style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "rgba(148,163,184,0.6)", pointerEvents: "none", fontSize: "12px" }}>▼</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "18px" }}>
              {[["Start Time", "startTime", startTime, setStartTime], ["End Time", "endTime", endTime, setEndTime]].map(([label, name, val, setter]) => (
                <div key={name}>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "rgba(148,163,184,0.8)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>{label}</label>
                  <input type="time" value={val} onChange={e => setter(e.target.value)}
                    onFocus={() => setFocusedField(name)} onBlur={() => setFocusedField(null)}
                    style={{ ...inputStyle, ...getFocusStyle(name) }} />
                </div>
              ))}
            </div>

            <button onClick={addActivity}
              style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", cursor: "pointer", fontWeight: 700, fontSize: "14px", color: "#fff", background: "linear-gradient(135deg, #4f46e5 0%, #2563eb 100%)", boxShadow: "0 4px 20px rgba(79,70,229,0.45)", marginBottom: "22px", transition: "transform 0.15s, box-shadow 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(79,70,229,0.6)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(79,70,229,0.45)"; }}
            >
              Add to Schedule
            </button>

            <div style={{ paddingTop: "18px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "rgba(148,163,184,0.8)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
                Description <span style={{ textTransform: "none", color: "rgba(100,116,139,0.7)", fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                placeholder="e.g., Weekday routine for morning care..."
                rows={3} onFocus={() => setFocusedField("desc")} onBlur={() => setFocusedField(null)}
                style={{ ...inputStyle, resize: "none", lineHeight: "1.5", ...getFocusStyle("desc") }} />
            </div>
          </div>

          {/* RIGHT: Schedule Preview */}
          <div style={{ ...cardStyle, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#fff", margin: 0 }}>Schedule Preview</h2>
              <span style={{ fontSize: "11px", fontWeight: 700, padding: "4px 14px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", color: "rgba(148,163,184,0.8)" }}>
                {activities.length} {activities.length === 1 ? "activity" : "activities"}
              </span>
            </div>

            <div style={{ flex: 1, overflowY: "auto", minHeight: "280px", maxHeight: "340px", paddingRight: "4px" }}>
              {activities.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "rgba(100,116,139,0.6)" }}>
                  <div style={{ fontSize: "48px", marginBottom: "12px", filter: "grayscale(0.3)" }}>📋</div>
                  <p style={{ fontSize: "14px", margin: "0 0 4px" }}>No activities added yet.</p>
                  <p style={{ fontSize: "12px", opacity: 0.7 }}>Add one above or pick a template.</p>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  {/* Timeline vertical line */}
                  <div style={{ position: "absolute", left: "9px", top: "8px", bottom: "8px", width: "2px", background: "linear-gradient(to bottom, rgba(99,102,241,0.4), rgba(6,182,212,0.2))", borderRadius: "2px" }} />
                  {activities.map((act, i) => {
                    const c = ACTIVITY_COLORS[act.activity_name] || ACTIVITY_COLORS["Sitting / rest"];
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "8px" }}
                        onMouseEnter={e => e.currentTarget.querySelector(".row-inner").style.borderColor = "rgba(255,255,255,0.15)"}
                        onMouseLeave={e => e.currentTarget.querySelector(".row-inner").style.borderColor = "rgba(255,255,255,0.07)"}
                      >
                        <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: c.dot, flexShrink: 0, boxShadow: `0 0 10px ${c.dot}80`, zIndex: 1, border: "2px solid rgba(0,0,0,0.5)" }} />
                        <div className="row-inner" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", borderRadius: "12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", transition: "border-color 0.2s" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, padding: "3px 10px 3px 8px", borderRadius: "20px", background: c.badge, color: c.text, border: `1px solid ${c.border}`, display: "flex", alignItems: "center", gap: "5px" }}>
                            <span>{c.icon}</span>{act.activity_name}
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontSize: "11px", fontFamily: "monospace", color: "rgba(100,116,139,0.9)" }}>{act.start_time} — {act.end_time}</span>
                            <button onClick={() => removeActivity(i)}
                              style={{ width: "22px", height: "22px", borderRadius: "50%", background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: "rgba(244,63,94,0.7)", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                              onMouseEnter={e => { e.currentTarget.style.background = "rgba(244,63,94,0.9)"; e.currentTarget.style.color = "#fff"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "rgba(244,63,94,0.1)"; e.currentTarget.style.color = "rgba(244,63,94,0.7)"; }}
                            >✕</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Messages */}
            {error && <div style={{ margin: "12px 0 0", padding: "10px 14px", borderRadius: "10px", background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: "#fb7185", fontSize: "12px", textAlign: "center" }}>{error}</div>}
            {message && <div style={{ margin: "12px 0 0", padding: "10px 14px", borderRadius: "10px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399", fontSize: "12px", textAlign: "center" }}>{message}</div>}

            {/* Action Buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "20px", paddingTop: "18px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button onClick={clearAll} disabled={activities.length === 0 || loading}
                style={{ padding: "13px", borderRadius: "12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(203,213,225,0.85)", fontWeight: 700, fontSize: "14px", cursor: activities.length === 0 ? "not-allowed" : "pointer", opacity: activities.length === 0 ? 0.4 : 1, transition: "all 0.2s" }}>
                Clear All
              </button>
              <button onClick={handleSubmit} disabled={activities.length === 0 || loading}
                style={{ padding: "13px", borderRadius: "12px", background: "linear-gradient(135deg, #2563eb, #4f46e5)", border: "none", color: "#fff", fontWeight: 700, fontSize: "14px", cursor: activities.length === 0 ? "not-allowed" : "pointer", opacity: activities.length === 0 ? 0.4 : 1, boxShadow: "0 4px 20px rgba(79,70,229,0.45)", transition: "all 0.2s" }}>
                {loading ? "Creating..." : "Save Routine"}
              </button>
            </div>
          </div>
        </div>

// schedule-monitoring/frontend/src/pages/RoutineSetup.jsx
import { useState, useEffect } from "react";
import {
  getAllSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from "../services/scheduleApi";

const PATIENT_ID = "patient_001";

const TASK_TYPES = [
  { value: "meal",               label: "Meal / Eating",        icon: "🍽" },
  { value: "medication",         label: "Medication",           icon: "💊" },
  { value: "sleep",              label: "Sleep / Bedtime",      icon: "😴" },
  { value: "rest",               label: "Rest / Nap",           icon: "🛋" },
  { value: "exercise",           label: "Exercise / Walk",      icon: "🚶" },
  { value: "hydration",          label: "Water / Hydration",    icon: "💧" },
  { value: "caregiver_assisted", label: "Caregiver-Assisted",   icon: "🤝" },
  { value: "other",              label: "Other",                icon: "📋" },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PRIORITIES = ["low", "medium", "high", "critical"];

const PRESETS = [
  { task_name: "Breakfast",             task_type: "meal",               start_time: "07:30", end_time: "08:00", caregiver_required: false },
  { task_name: "Morning Medication",    task_type: "medication",         start_time: "08:00", end_time: "08:15", caregiver_required: true  },
  { task_name: "Lunch",                 task_type: "meal",               start_time: "12:30", end_time: "13:00", caregiver_required: false },
  { task_name: "Afternoon Medication",  task_type: "medication",         start_time: "14:00", end_time: "14:15", caregiver_required: true  },
  { task_name: "Afternoon Nap",         task_type: "rest",               start_time: "14:30", end_time: "15:30", caregiver_required: false },
  { task_name: "Evening Walk",          task_type: "exercise",           start_time: "17:00", end_time: "17:30", caregiver_required: false },
  { task_name: "Dinner",                task_type: "meal",               start_time: "19:00", end_time: "19:30", caregiver_required: false },
  { task_name: "Night Medication",      task_type: "medication",         start_time: "21:00", end_time: "21:15", caregiver_required: true  },
  { task_name: "Sleep",                 task_type: "sleep",              start_time: "21:30", end_time: "22:00", caregiver_required: false },
  { task_name: "Feeding Assistance",    task_type: "caregiver_assisted", start_time: "08:00", end_time: "08:30", caregiver_required: true  },
];

const EMPTY_FORM = {
  patient_id: PATIENT_ID,
  task_name: "",
  task_type: "meal",
  start_time: "",
  end_time: "",
  repeat_days: [],
  caregiver_required: false,
  priority: "medium",
  active: true,
};

const PRIORITY_COLORS = {
  low: "text-gray-400",
  medium: "text-sky-400",
  high: "text-amber-400",
  critical: "text-rose-400",
};

const STATUS_BADGE = {
  done:              "badge-done",
  late:              "badge-late",
  missed:            "badge-missed",
  caregiver_missing: "badge-caregiver_missing",
  pending:           "badge-pending",
};

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${checked ? "bg-indigo-600" : "bg-gray-700"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

export default function RoutineSetup({ patientId = PATIENT_ID }) {
  const [form, setForm]         = useState({ ...EMPTY_FORM, patient_id: patientId });
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [editId, setEditId]     = useState(null);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const [deleteId, setDeleteId] = useState(null);

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const r = await getAllSchedules();
      setSchedules(Array.isArray(r.data) ? r.data : []);
    } catch { setSchedules([]); } finally { setLoading(false); }
  };

  useEffect(() => { fetchSchedules(); }, []);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleDay = (day) => {
    setForm((f) => ({
      ...f,
      repeat_days: f.repeat_days.includes(day)
        ? f.repeat_days.filter((d) => d !== day)
        : [...f.repeat_days, day],
    }));
  };

  const applyPreset = (preset) => {
    setForm((f) => ({ ...f, ...preset, patient_id: patientId, repeat_days: [], priority: "medium", active: true }));
  };

  const validate = () => {
    if (!form.task_name.trim()) return "Task name is required.";
    if (!form.start_time)        return "Start time is required.";
    if (!form.end_time)          return "End time is required.";
    if (form.start_time >= form.end_time) return "End time must be after start time.";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setError(""); setSaving(true);
    try {
      if (editId) {
        await updateSchedule(editId, form);
        setSuccess("Schedule updated!");
      } else {
        await createSchedule(form);
        setSuccess("Schedule created!");
      }
      setForm({ ...EMPTY_FORM, patient_id: patientId });
      setEditId(null);
      fetchSchedules();
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to save schedule.");
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(""), 3000);
    }
  };

  const handleEdit = (s) => {
    setForm({ ...s });
    setEditId(s.schedule_id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id) => {
    try {
      await deleteSchedule(id);
      fetchSchedules();
    } catch {}
    setDeleteId(null);
  };

  const cancelEdit = () => {
    setForm({ ...EMPTY_FORM, patient_id: patientId });
    setEditId(null); setError("");
  };

  const taskTypeIcon = (v) => TASK_TYPES.find((t) => t.value === v)?.icon || "📋";

  return (
    <div className="p-8 max-w-5xl mx-auto fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Routine Setup</h1>
        <p className="text-gray-500 text-sm mt-1">Define the patient's daily care timetable. The system will monitor compliance automatically.</p>
      </div>

      {/* Form */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold">{editId ? "✏️ Edit Schedule Item" : "➕ New Schedule Item"}</h2>
          {editId && (
            <button onClick={cancelEdit} className="text-gray-500 hover:text-gray-300 text-sm">Cancel edit</button>
          )}
        </div>

        {/* Quick Presets */}
        {!editId && (
          <div className="mb-6">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-3">Quick Presets</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.task_name}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-indigo-500/50 text-gray-300 text-xs rounded-lg transition-all"
                >
                  {taskTypeIcon(p.task_type)} {p.task_name}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Row 1: Name + Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-2">Task Name *</label>
              <input
                type="text"
                value={form.task_name}
                onChange={(e) => setField("task_name", e.target.value)}
                placeholder="e.g. Breakfast, Morning Medication"
                className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white rounded-xl px-4 py-2.5 text-sm outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-2">Task Type *</label>
              <select
                value={form.task_type}
                onChange={(e) => setField("task_type", e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white rounded-xl px-4 py-2.5 text-sm outline-none transition-colors"
              >
                {TASK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Time */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-2">Start Time *</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setField("start_time", e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white rounded-xl px-4 py-2.5 text-sm outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-2">End Time *</label>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setField("end_time", e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white rounded-xl px-4 py-2.5 text-sm outline-none transition-colors"
              />
            </div>
          </div>

          {/* Row 3: Repeat Days */}
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-2">Repeat Days <span className="text-gray-600">(leave empty = every day)</span></label>
            <div className="flex gap-2 flex-wrap">
              {DAYS.map((day) => (
                <button
                  key={day} type="button" onClick={() => toggleDay(day)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                    form.repeat_days.includes(day)
                      ? "bg-indigo-600 border-indigo-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Row 4: Priority + Toggles */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-2">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setField("priority", e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white rounded-xl px-4 py-2.5 text-sm outline-none capitalize"
              >
                {PRIORITIES.map((p) => <option key={p} value={p} className="capitalize">{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-4 pb-1">
              <div className="flex items-center gap-3">
                <Toggle checked={form.caregiver_required} onChange={(v) => setField("caregiver_required", v)} />
                <div>
                  <p className="text-white text-sm font-medium">Caregiver Required</p>
                  <p className="text-gray-500 text-xs">Verify caregiver presence</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 pb-1">
              <div className="flex items-center gap-3">
                <Toggle checked={form.active} onChange={(v) => setField("active", v)} />
                <div>
                  <p className="text-white text-sm font-medium">Active</p>
                  <p className="text-gray-500 text-xs">Include in monitoring</p>
                </div>
              </div>
            </div>
          </div>

          {/* Error / Success */}
          {error   && <p className="text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-2">{error}</p>}
          {success && <p className="text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2">✓ {success}</p>}

          {/* Submit */}
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors flex items-center gap-2"
          >
            {saving ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : null}
            {editId ? "Update Schedule" : "Save Schedule"}
          </button>
        </form>
      </div>

      {/* Schedule List */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
          <h2 className="text-white font-semibold">All Schedule Items</h2>
          <span className="text-gray-500 text-sm">{schedules.length} items</span>
        </div>

        {loading ? (
          <div className="p-8 flex justify-center"><div className="spinner" /></div>
        ) : schedules.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <p className="text-4xl mb-3">📅</p>
            <p className="font-medium">No schedules yet.</p>
            <p className="text-sm mt-1">Use the form above or a Quick Preset to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {["Task", "Type", "Time", "Days", "Caregiver", "Priority", "Status", "Actions"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.schedule_id} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-white font-medium flex items-center gap-2">
                        {taskTypeIcon(s.task_type)} {s.task_name}
                      </span>
                      {!s.active && <span className="text-gray-600 text-xs">Inactive</span>}
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 capitalize text-xs">{s.task_type?.replace("_"," ")}</td>
                    <td className="px-5 py-3.5 text-gray-300 font-mono text-xs whitespace-nowrap">{s.start_time} – {s.end_time}</td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs">
                      {s.repeat_days?.length ? s.repeat_days.join(", ") : "Daily"}
                    </td>
                    <td className="px-5 py-3.5">
                      {s.caregiver_required
                        ? <span className="badge badge-caregiver_missing">Required</span>
                        : <span className="text-gray-600 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-medium capitalize ${PRIORITY_COLORS[s.priority] || "text-gray-400"}`}>
                        {s.priority}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`badge ${STATUS_BADGE[s.today_status] || "badge-pending"}`}>
                        {s.today_status || "pending"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(s)}
                          className="px-3 py-1.5 bg-gray-800 hover:bg-indigo-600/20 hover:border-indigo-500/50 border border-gray-700 text-gray-400 hover:text-indigo-400 rounded-lg text-xs transition-all"
                        >
                          Edit
                        </button>
                        {deleteId === s.schedule_id ? (
                          <div className="flex gap-1">
                            <button onClick={() => handleDelete(s.schedule_id)} className="px-2 py-1.5 bg-rose-600 text-white rounded-lg text-xs">Confirm</button>
                            <button onClick={() => setDeleteId(null)} className="px-2 py-1.5 bg-gray-800 text-gray-400 rounded-lg text-xs">Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteId(s.schedule_id)}
                            className="px-3 py-1.5 bg-gray-800 hover:bg-rose-500/10 hover:border-rose-500/30 border border-gray-700 text-gray-400 hover:text-rose-400 rounded-lg text-xs transition-all"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}
