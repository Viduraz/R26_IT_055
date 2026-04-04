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
