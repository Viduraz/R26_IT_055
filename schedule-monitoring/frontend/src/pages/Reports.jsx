// schedule-monitoring/frontend/src/pages/Reports.jsx
import { useEffect, useState } from "react";
import { getReports } from "../services/scheduleApi";

export default function Reports() {
  const [reports, setReports] = useState([]);
  useEffect(() => { getReports().then((r) => setReports(r.data)).catch(console.error); }, []);
  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-4">Activity Reports</h1>
      {reports.length === 0 ? <p className="text-gray-500">No reports yet.</p> : (
        <div className="space-y-2">
          {reports.map((r, i) => <div key={i} className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm">{JSON.stringify(r)}</div>)}
        </div>
      )}
    </div>
  );
}
