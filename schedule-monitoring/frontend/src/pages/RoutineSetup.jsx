import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSchedule } from "../services/scheduleApi";

const ACTIVITY_TYPES = [
  "Eating",
  "Drinking",
  "Sleeping",
  "Walking",
  "Sitting / rest",
];

const START_OFFSET_MINUTES = 5;
const ACTIVITY_WINDOW_MINUTES = 1;

const formatTime = (date) => date.toTimeString().slice(0, 5);

const autoArrangeActivities = (items, anchor = new Date()) => {
  const normalizedAnchor = new Date(anchor);
  normalizedAnchor.setSeconds(0, 0);
  return items.map((activity, index) => {
    const start = new Date(normalizedAnchor);
    start.setMinutes(
      start.getMinutes() + START_OFFSET_MINUTES + index * ACTIVITY_WINDOW_MINUTES
    );
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + ACTIVITY_WINDOW_MINUTES);
    return {
      ...activity,
      start_time: formatTime(start),
      end_time: formatTime(end),
    };
  });
};

const TEMPLATES = {
  morning: [
    { activity_name: "Sleeping", start_time: "06:30", end_time: "07:00" },
    { activity_name: "Walking", start_time: "07:00", end_time: "07:20" },
    { activity_name: "Drinking", start_time: "07:20", end_time: "07:35" },
    { activity_name: "Eating", start_time: "08:00", end_time: "08:15" },
    { activity_name: "Sitting / rest", start_time: "08:15", end_time: "09:00" },
  ],
  daytime: [
    { activity_name: "Eating", start_time: "12:00", end_time: "12:30" },
    { activity_name: "Drinking", start_time: "12:30", end_time: "12:45" },
    { activity_name: "Sitting / rest", start_time: "13:00", end_time: "14:00" },
    { activity_name: "Walking", start_time: "16:00", end_time: "16:30" },
  ],
  evening: [
    { activity_name: "Eating", start_time: "18:00", end_time: "18:30" },
    { activity_name: "Drinking", start_time: "20:00", end_time: "20:15" },
    { activity_name: "Sleeping", start_time: "21:00", end_time: "22:00" },
  ],
};

export default function RoutineSetup() {
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);
  const [description, setDescription] = useState("");
  const [activityName, setActivityName] = useState(ACTIVITY_TYPES[0]);
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("06:30");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const previewActivities = useMemo(
    () => autoArrangeActivities(activities),
    [activities]
  );
  const canSubmit = useMemo(
    () => activities.length > 0 && !loading,
    [activities.length, loading]
  );

  const showMessage = (text) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2500);
  };

  const showError = (text) => {
    setError(text);
    window.setTimeout(() => setError(""), 5000);
  };

  const addActivity = () => {
    if (!activityName || !startTime || !endTime) {
      showError("Please fill in all fields.");
      return;
    }
    if (startTime >= endTime) {
      showError("Start time must be before end time.");
      return;
    }
    setActivities((current) => [
      ...current,
      { activity_name: activityName, start_time: startTime, end_time: endTime },
    ]);
    showMessage("Activity added.");
  };

  const removeActivity = (index) => {
    setActivities((current) => current.filter((_, i) => i !== index));
  };

  const loadTemplate = (key) => {
    setActivities(TEMPLATES[key] || []);
    showMessage(`Loaded ${key} template. Click Save Routine to start monitoring.`);
  };

  const clearAll = () => {
    setActivities([]);
    setDescription("");
    showMessage("Routine cleared.");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (activities.length === 0) {
      showError("Please add at least one activity.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const arranged = autoArrangeActivities(activities);
      const res = await createSchedule(arranged, description);
      const created = res?.data;

      // Build a local schedule object so dashboard can open camera even if GET is slow/empty
      const localSchedule = {
        schedule_id:
          created?.schedule_id ||
          created?.id ||
          created?.schedule?.schedule_id ||
          `local_${Date.now()}`,
        description: description || created?.description || "",
        activities:
          created?.activities ||
          created?.schedule?.activities ||
          arranged,
      };

      // Cache for dashboard fallback
      try {
        sessionStorage.setItem(
          "pendingSchedule",
          JSON.stringify(localSchedule)
        );
      } catch {}

      setMessage("Schedule saved. Opening camera…");
      navigate("/dashboard", {
        state: { fromSetup: true, schedule: localSchedule },
        replace: true,
      });
    } catch (err) {
      console.error("Save routine failed:", err);
      showError(
        err?.response?.data?.detail ||
          err?.message ||
          "Failed to save schedule. Is the backend running?"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto fade-in">
      <div className="mb-8 rounded-3xl border border-gray-800 bg-gray-900/40 backdrop-blur-md p-6 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-56 h-56 bg-blue-500/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col lg:flex-row gap-6 items-center relative z-10">
          <div className="flex-1">
            <div className="inline-block px-3 py-1 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold rounded-full mb-3 uppercase tracking-widest">
              Schedule Builder
            </div>
            <h1 className="text-3xl font-bold text-white">Routine Setup</h1>
            <p className="text-gray-400 mt-2">
              Create a daily routine and open the monitoring camera.
            </p>
            <p className="text-xs text-sky-300/80 mt-2">
              First activity starts 5 minutes after saving; each activity gets a
              1 minute window.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        {["morning", "daytime", "evening"].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => loadTemplate(key)}
            className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 text-left text-white hover:border-sky-500/50 transition-all"
          >
            <div className="text-sm text-gray-400">Template</div>
            <div className="text-lg font-semibold capitalize">{key}</div>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="rounded-3xl border border-gray-800 bg-gray-900/60 p-6">
          <h2 className="text-xl font-semibold text-white mb-5">Add Activity</h2>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Activity
          </label>
          <select
            value={activityName}
            onChange={(e) => setActivityName(e.target.value)}
            className="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-white outline-none mb-4"
          >
            {ACTIVITY_TYPES.map((activity) => (
              <option key={activity} value={activity}>
                {activity}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Start
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-white outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                End
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-white outline-none"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={addActivity}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500"
          >
            Add Activity
          </button>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mt-6 mb-2">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Optional schedule notes"
            className="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-white outline-none"
          />
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={clearAll}
              className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800"
            >
              Clear All
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-emerald-500"
            >
              {loading ? "Saving..." : "Save Routine"}
            </button>
          </div>
          {error && (
            <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {error}
            </p>
          )}
          {message && (
            <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {message}
            </p>
          )}
        </div>

        <div className="rounded-3xl border border-gray-800 bg-gray-900/60 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-semibold text-white">Schedule Preview</h2>
            <span className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-400">
              {activities.length} items
            </span>
          </div>
          {activities.length === 0 ? (
            <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-gray-800 text-gray-500">
              Load a template or add activities, then click Save Routine.
            </div>
          ) : (
            <div className="space-y-3">
              {previewActivities.map((activity, index) => (
                <div
                  key={`${activity.activity_name}-${index}`}
                  className="flex items-center justify-between rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3"
                >
                  <div>
                    <div className="font-semibold text-white">
                      {activity.activity_name}
                    </div>
                    <div className="text-sm text-gray-400">
                      {activity.start_time} - {activity.end_time}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeActivity(index)}
                    className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-400 hover:text-white"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}