// schedule-monitoring/frontend/src/pages/RoutineSetup.jsx
import { useState } from "react";
import { createSchedule } from "../services/scheduleApi";

const ACTIVITY_TYPES = [
  "Wake up",
  "Morning walk",
  "Breakfast",
  "Medication",
  "Sitting / rest",
  "Lunch",
  "Evening walk",
  "Dinner",
  "Sleep"
];

export default function RoutineSetup() {
  const [activities, setActivities] = useState([]);
  const [description, setDescription] = useState("");
  const [currentActivity, setCurrentActivity] = useState("");
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("06:30");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
      setMessage("✓ Schedule created successfully!");
      setActivities([]);
      setDescription("");
      setStartTime("06:00");
      setEndTime("06:30");
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create schedule");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-2">Routine Setup</h1>
      <p className="text-gray-400 mb-8">Create a daily schedule with activities and time ranges for the elder.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={loading || activities.length === 0}
              className={`w-full font-semibold rounded py-3 transition ${
                loading || activities.length === 0
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-700 text-white"
              }`}
            >
              {loading ? "Creating schedule..." : "✓ Create Schedule"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
