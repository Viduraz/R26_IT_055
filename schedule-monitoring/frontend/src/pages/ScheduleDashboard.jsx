// schedule-monitoring/frontend/src/pages/ScheduleDashboard.jsx
import { useEffect, useState } from "react";
import { getDeviations } from "../services/scheduleApi";

export default function ScheduleDashboard() {
  const [deviations, setDeviations] = useState([]);
  useEffect(() => { getDeviations().then((r) => setDeviations(r.data)).catch(console.error); }, []);
  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-4">Schedule Monitoring Dashboard</h1>
      <h2 className="text-lg font-semibold mb-3 text-yellow-400">Recent Deviations</h2>
      {deviations.length === 0 ? <p className="text-gray-500">No deviations detected.</p> : (
        <div className="space-y-2">
          {deviations.map((d, i) => (
            <div key={i} className="bg-gray-900 border border-yellow-800 rounded-xl p-3 text-sm">
              <p className="text-yellow-300">Expected: {d.expected_activity} → Got: {d.observed_activity}</p>
              <p className="text-gray-500 text-xs mt-1">{d.detected_at}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
