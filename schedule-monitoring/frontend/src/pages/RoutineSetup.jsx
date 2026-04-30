import { useState } from "react";
import { createSchedule } from "../services/scheduleApi";
import { useNavigate } from "react-router-dom";

const ACTIVITY_TYPES = [
  "Standing up",
  "Eating",
  "Drinking",
  "Talking",
  "Walking",
  "Sitting / rest",
  "Sleep"
];

// Sample schedule templates for quick testing
const SAMPLE_SCHEDULES = {
  morning: {
    name: "Morning Routine",
    time: "6:00 AM - 8:00 AM",
    description: "Quick morning activities for testing",
    icon: "🌅",
    color: "from-amber-500/20 to-orange-600/20",
    border: "border-amber-500/30 hover:border-amber-500/60",
    activities: [
      { activity_name: "Standing up", start_time: "06:00", end_time: "06:15" },
      { activity_name: "Eating", start_time: "06:15", end_time: "06:30" },
      { activity_name: "Walking", start_time: "06:30", end_time: "06:45" },
      { activity_name: "Sitting / rest", start_time: "06:45", end_time: "07:00" }
    ]
  },
  fullday: {
    name: "Full Day Schedule",
    time: "7:00 AM - 9:00 PM",
    description: "Complete daily routine",
    icon: "📅",
    color: "from-blue-500/20 to-indigo-600/20",
    border: "border-blue-500/30 hover:border-blue-500/60",
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
    name: "Quick Test",
    time: "All 8 Activities",
    description: "All 8 Activities - including interaction tasks",
    icon: "🧪",
    color: "from-emerald-500/20 to-teal-600/20",
    border: "border-emerald-500/30 hover:border-emerald-500/60",
    activities: [
      { activity_name: "Standing up",   start_time: "08:00", end_time: "08:10" },
      { activity_name: "Eating",         start_time: "08:10", end_time: "08:20" },
      { activity_name: "Drinking",       start_time: "08:20", end_time: "08:30" },
      { activity_name: "Talking",        start_time: "08:30", end_time: "08:40" },
      { activity_name: "Walking",        start_time: "08:40", end_time: "08:50" },
      { activity_name: "Sitting / rest", start_time: "08:50", end_time: "09:00" },
      { activity_name: "Sleep",          start_time: "09:00", end_time: "09:10" }
    ]
  }
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

  const loadTemplate = (templateKey) => {
    const template = SAMPLE_SCHEDULES[templateKey];
    setActivities(template.activities);
    setDescription(template.description);
    setMessage(`Loaded template: ${template.name}`);
    setTimeout(() => setMessage(""), 3000);
  };

  const clearAll = () => {
    setActivities([]);
    setDescription("");
    setCurrentActivity("");
    setStartTime("06:00");
    setEndTime("06:30");
    setMessage("Cleared all activities");
    setTimeout(() => setMessage(""), 3000);
  };

  const addActivity = () => {
    if (!currentActivity || !startTime || !endTime) {
      setError("Please fill in all fields");
      setTimeout(() => setError(""), 3000);
      return;
    }

    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      setError("Time must be in HH:MM format");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const newStart = new Date(`2000-01-01 ${startTime}`);
    const newEnd = new Date(`2000-01-01 ${endTime}`);

    if (newStart >= newEnd) {
      setError("Start time must be before end time");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const activity = {
      activity_name: currentActivity,
      start_time: startTime,
      end_time: endTime
    };

    setActivities([...activities, activity]);
    setCurrentActivity("");
    setError("");
  };

  const removeActivity = (index) => {
    setActivities(activities.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (activities.length === 0) {
      setError("Please add at least one activity");
      setTimeout(() => setError(""), 3000);
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      await createSchedule(activities, description);
      setMessage("Schedule created successfully!");
      
      setTimeout(() => {
        navigate("/");
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.detail || "Unknown error - check console");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full pb-20 animate-slide-up">
      <div className="mb-10">
        <h1 className="text-4xl font-extrabold text-white tracking-tight">Routine Setup</h1>
        <p className="text-gray-400 mt-2 text-sm">Design a daily schedule or use a pre-built template.</p>
      </div>

      {/* Templates Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {Object.entries(SAMPLE_SCHEDULES).map(([key, template]) => (
          <button
            key={key}
            onClick={() => loadTemplate(key)}
            className={`text-left relative overflow-hidden bg-gradient-to-br ${template.color} border ${template.border} rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl group`}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-3xl filter drop-shadow-md group-hover:scale-110 transition-transform">{template.icon}</span>
              <span className="text-xs font-semibold px-2 py-1 bg-black/20 rounded-full text-white/70 backdrop-blur-sm">
                {template.activities.length} items
              </span>
            </div>
            <h3 className="text-lg font-bold text-white mb-1">{template.name}</h3>
            <p className="text-xs text-white/70 font-mono mb-3">{template.time}</p>
            <p className="text-sm text-white/50">{template.description}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left: Input Form */}
        <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl border border-gray-800/60 p-8 shadow-lg flex flex-col h-full">
          <h2 className="text-lg font-semibold text-gray-100 mb-6 flex items-center gap-2">
            <span className="text-blue-400">➕</span> Add Activity
          </h2>

          <div className="space-y-5 flex-1">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Activity Type</label>
              <select
                value={currentActivity}
                onChange={(e) => setCurrentActivity(e.target.value)}
                className="w-full bg-gray-950/50 border border-gray-700/50 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all appearance-none"
              >
                <option value="">Select activity...</option>
                {ACTIVITY_TYPES.map((activity) => (
                  <option key={activity} value={activity}>{activity}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-gray-950/50 border border-gray-700/50 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-gray-950/50 border border-gray-700/50 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>

            <button
              onClick={addActivity}
              className="w-full bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold rounded-xl py-3 mt-4 transition-all"
            >
              Add to Schedule
            </button>
            
            <div className="pt-6 mt-6 border-t border-gray-800/60">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Routine Description (Optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Weekday routine"
                rows="2"
                className="w-full bg-gray-950/50 border border-gray-700/50 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all resize-none"
              />
            </div>
          </div>
        </div>

        {/* Right: Preview & Submit */}
        <div className="bg-gray-900/40 backdrop-blur-md rounded-2xl border border-gray-800/60 p-8 shadow-lg flex flex-col h-[600px]">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
              <span className="text-emerald-400">📋</span> Preview
            </h2>
            <span className="text-xs font-medium bg-gray-800 text-gray-300 px-3 py-1 rounded-full">
              {activities.length} activities
            </span>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 space-y-3 relative">
            {activities.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                <span className="text-4xl mb-3">📝</span>
                <p className="text-sm">No activities added yet.</p>
              </div>
            ) : (
              activities.map((activity, index) => (
                <div key={index} className="bg-gray-950/40 border border-gray-800 rounded-xl p-4 flex justify-between items-center group hover:border-gray-700 transition-colors">
                  <div>
                    <p className="font-semibold text-gray-200 text-sm">{activity.activity_name}</p>
                    <p className="text-xs text-gray-500 mt-1 font-mono">{activity.start_time} — {activity.end_time}</p>
                  </div>
                  <button
                    onClick={() => removeActivity(index)}
                    className="w-8 h-8 rounded-full bg-rose-500/10 text-rose-400 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all hover:bg-rose-500 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="pt-6 mt-6 border-t border-gray-800/60 space-y-3">
            {/* Status Messages */}
            {error && <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium text-center">{error}</div>}
            {message && <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium text-center">{message}</div>}
            
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={clearAll}
                disabled={activities.length === 0 || loading}
                className="bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl py-3.5 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear All
              </button>
              <button
                onClick={handleSubmit}
                disabled={activities.length === 0 || loading}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl py-3.5 text-sm shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Creating..." : "Save Routine"}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
