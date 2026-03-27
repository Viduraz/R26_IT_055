// anomaly-detection/frontend/src/pages/DetectionHistory.jsx
import { useEffect, useState } from "react";
import { getAnomalyHistory } from "../services/anomalyApi";

export default function DetectionHistory() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { getAnomalyHistory().then((r) => setLogs(r.data)).catch(console.error); }, []);
  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-4">Detection History</h1>
      {logs.length === 0 ? <p className="text-gray-500">No records.</p> : (
        <div className="space-y-2">
          {logs.map((l, i) => (
            <div key={i} className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm flex justify-between">
              <span className={l.anomaly_detected ? "text-red-400" : "text-green-400"}>
                {l.event_type || (l.anomaly_detected ? "Anomaly" : "Normal")}
              </span>
              <span className="text-gray-500">{l.timestamp}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
