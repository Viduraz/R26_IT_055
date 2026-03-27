// face-verification/frontend/src/pages/FaceLogs.jsx
import { useEffect, useState } from "react";
import { getFaceLogs } from "../services/faceApi";

export default function FaceLogs() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { getFaceLogs().then((r) => setLogs(r.data)).catch(console.error); }, []);
  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-4">Face Verification Logs</h1>
      {logs.length === 0 ? <p className="text-gray-500">No logs yet.</p> : (
        <div className="space-y-2">
          {logs.map((l, i) => (
            <div key={i} className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm">
              <span className={l.match ? "text-green-400" : "text-red-400"}>{l.match ? "Match" : "No Match"}</span>
              <span className="text-gray-400 ml-4">{l.timestamp}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
