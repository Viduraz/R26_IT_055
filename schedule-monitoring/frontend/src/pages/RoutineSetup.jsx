// schedule-monitoring/frontend/src/pages/RoutineSetup.jsx
import { useState } from "react";
import { createSchedule } from "../services/scheduleApi";
import { useNavigate } from "react-router-dom";

const ACTIVITY_TYPES = [
  "Wake up",
  "Eating",
  "Walking",
  "Sitting / rest",
  "Sleep"
];

// Sample schedule templates for quick testing
const SAMPLE_SCHEDULES = {
  morning: {
    name: "📅 Morning Routine (6:00 AM - 8:00 AM)",
    description: "Quick morning activities for testing",
    activities: [
      { activity_name: "Wake up", start_time: "06:00", end_time: "06:15" },
      { activity_name: "Eating", start_time: "06:15", end_time: "06:30" },
      { activity_name: "Walking", start_time: "06:30", end_time: "06:45" },
      { activity_name: "Sitting / rest", start_time: "06:45", end_time: "07:00" }
    ]
  },
  fullday: {
    name: "🌅 Full Day Schedule (7:00 AM - 9:00 PM)",
    description: "Complete daily routine",
    activities: [
      { activity_name: "Wake up", start_time: "07:00", end_time: "07:30" },
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
    name: "🧪 Quick Test Schedule (All 5 Activities)",
    description: "15-minute activities for quick testing",
    activities: [
      { activity_name: "Wake up", start_time: "08:00", end_time: "08:15" },
      { activity_name: "Eating", start_time: "08:15", end_time: "08:30" },
      { activity_name: "Walking", start_time: "08:30", end_time: "08:45" },
      { activity_name: "Sitting / rest", start_time: "08:45", end_time: "09:00" },
      { activity_name: "Sleep", start_time: "09:00", end_time: "09:15" }
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
  const [showTemplates, setShowTemplates] = useState(true);

  const loadTemplate = (templateKey) => {
    const template = SAMPLE_SCHEDULES[templateKey];
    setActivities(template.activities);
    setDescription(template.description);
    setShowTemplates(false);
    setMessage(`✓ Loaded: ${template.name}`);
    setTimeout(() => setMessage(""), 3000);
  };

  const clearAll = () => {
    setActivities([]);
    setDescription("");
    setCurrentActivity("");
    setStartTime("06:00");
    setEndTime("06:30");
    setMessage("✓ Cleared all activities");
    setTimeout(() => setMessage(""), 3000);
  };

  const addActivity = () => {
    if (!currentActivity || !startTime || !endTime) {
      setError("Please fill in all fields");
      return;
    }

    // Validate time format
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      setError("Time must be in HH:MM format");
      return;
    }

    // Check for time conflicts
    const newStart = new Date(`2000-01-01 ${startTime}`);
    const newEnd = new Date(`2000-01-01 ${endTime}`);

    if (newStart >= newEnd) {
      setError("Start time must be before end time");
      return;
    }

    const activity = {
      activity_name: currentActivity,
      start_time: startTime,
      end_time: endTime
    };

    setActivities([...activities, activity]);
    setCurrentActivity("");
    setStartTime("06:00");
    setEndTime("06:30");
    setError("");
    setMessage(`✓ Added "${currentActivity}"`);
    setTimeout(() => setMessage(""), 3000);
  };

  const removeActivity = (index) => {
    const removed = activities[index];
    setActivities(activities.filter((_, i) => i !== index));
    setMessage(`✗ Removed "${removed.activity_name}"`);
    setTimeout(() => setMessage(""), 3000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (activities.length === 0) {
      setError("Please add at least one activity");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await createSchedule(activities, description);
      setMessage("✓ Schedule created successfully! Redirecting...");
      setActivities([]);
      setDescription("");
      setStartTime("06:00");
      setEndTime("06:30");
      
      // Redirect to dashboard after 1.5 seconds
      setTimeout(() => {
        navigate("/", { state: { message: "Schedule created! Ready to test activity detection." } });
      }, 1500);
    } catch (err) {
      console.error("=== CREATE SCHEDULE ERROR ===");
      console.error("Response data:", err.response?.data);
      console.error("Error message:", err.message);
      console.error("Full error:", err);
      setError(err.response?.data?.detail || "Unknown error - check console");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-2">Routine Setup</h1>
      <p className="text-gray-400 mb-8">Create a daily schedule with activities and time ranges for the elder. Use templates for quick testing!</p>

      {/* Sample Templates Section */}
      {showTemplates && (
        <div className="mb-8 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-700/50 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-semibold text-blue-300 mb-2">⚡ Quick Start Templates</h2>
              <p className="text-gray-400">Load a pre-built schedule in seconds for testing</p>
            </div>
            <button
              onClick={() => setShowTemplates(false)}
              className="text-gray-400 hover:text-white text-xl"
            >
              ✕
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(SAMPLE_SCHEDULES).map(([key, template]) => (
              <button
                key={key}
                onClick={() => loadTemplate(key)}
                className="bg-gray-900 hover:bg-gray-800 border border-gray-700 hover:border-blue-500 rounded-lg p-4 text-left transition"
              >
                <p className="font-semibold text-white mb-2">{template.name}</p>
                <p className="text-sm text-gray-400">{template.activities.length} activities</p>
                <p className="text-xs text-gray-500 mt-2">{template.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}
        {/* Form Section */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 className="text-xl font-semibold mb-6 text-blue-400">Activity Input</h2>

          <div className="space-y-4">
            {/* Activity Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Activity</label>
              <select
                value={currentActivity}
                onChange={(e) => setCurrentActivity(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select an activity...</option>
                {ACTIVITY_TYPES.map((activity) => (
                  <option key={activity} value={activity}>
                    {activity}
                  </option>
                ))}
              </select>
            </div>

            {/* Start Time */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Start Time (HH:MM)</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* End Time */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">End Time (HH:MM)</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Messages */}
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {message && <p className="text-green-400 text-sm">{message}</p>}

            {/* Add Button */}
            <button
              onClick={addActivity}
              className="w-full bg-blue-600 hover:bg-blue-700 font-semibold rounded py-2 mt-4"
            >
              + Add Activity
            </button>
          </div>

          {/* Schedule Description */}
          <div className="mt-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">Description (Optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Mary's daily routine for weekdays"
              rows="3"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Preview Section */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 className="text-xl font-semibold mb-6 text-green-400">Schedule Preview</h2>

          {activities.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No activities added yet</p>
          ) : (
            <div className="space-y-3">
              {activities.map((activity, index) => (
                <div
                  key={index}
                  className="bg-gray-800 rounded-lg p-3 border border-gray-700 flex justify-between items-center"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-white">{activity.activity_name}</p>
                    <p className="text-sm text-gray-400">
                      {activity.start_time} – {activity.end_time}
                    </p>
                  </div>
                  <button
                    onClick={() => removeActivity(index)}
                    className="ml-4 text-red-400 hover:text-red-300 font-semibold"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Statistics */}
          <div className="mt-6 pt-6 border-t border-gray-700">
            <p className="text-sm text-gray-400 mb-4">
              <strong className="text-white">{activities.length}</strong> activities scheduled
            </p>

            <div className="grid grid-cols-2 gap-3">
              {/* Submit Button */}
              <button
                onClick={handleSubmit}
                disabled={loading || activities.length === 0}
                className={`font-semibold rounded py-3 transition ${
                  loading || activities.length === 0
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-green-600 hover:bg-green-700 text-white"
                }`}
              >
                {loading ? "Creating..." : "✓ Create Schedule"}
              </button>

              {/* Clear Button */}
              <button
                onClick={clearAll}
                disabled={activities.length === 0}
                className={`font-semibold rounded py-3 transition ${
                  activities.length === 0
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-gray-700 hover:bg-gray-600 text-white"
                }`}
              >
                ✕ Clear All
              </button>
            </div>

            {/* Info Note */}
            <div className="mt-4 p-3 bg-blue-900/20 border border-blue-700/30 rounded text-xs text-blue-300">
              💡 After creating a schedule, go to the Dashboard and click "📷 Show Detector" to test activity detection!
            </div>
          </div>
        </div>
    </div>
  );
}
