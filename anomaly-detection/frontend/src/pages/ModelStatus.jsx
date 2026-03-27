// anomaly-detection/frontend/src/pages/ModelStatus.jsx
import { useEffect, useState } from "react";
import { getModelStatus } from "../services/anomalyApi";

export default function ModelStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => { getModelStatus().then((r) => setStatus(r.data)).catch(console.error); }, []);
  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-4">Model Status</h1>
      {!status ? <p className="text-gray-500">Loading…</p> : (
        <div className="space-y-3">
          {Object.entries(status).map(([model, state]) => (
            <div key={model} className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex justify-between">
              <span className="font-medium capitalize">{model}</span>
              <span className={state === "loaded" ? "text-green-400" : "text-yellow-400"}>{state}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
