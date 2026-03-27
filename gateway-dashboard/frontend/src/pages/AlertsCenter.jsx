// gateway-dashboard/frontend/src/pages/AlertsCenter.jsx
import { useEffect, useState } from "react";
import gatewayApi from "../services/gatewayApi";

export default function AlertsCenter() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    gatewayApi.get("/alerts")
      .then((r) => setAlerts(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Alerts Center</h1>
      {loading ? <p className="text-gray-500">Loading alerts…</p> : null}
      {alerts.length === 0 && !loading ? (
        <p className="text-gray-500">No alerts to display.</p>
      ) : (
        <div className="space-y-3">
          {alerts.map((a, i) => (
            <div key={i} className="bg-gray-900 border border-gray-700 rounded-xl p-4">
              <p className="font-medium text-red-400">{a.source}</p>
              <p className="text-sm text-gray-300">{a.event_type || a.type || "Event"}</p>
              <p className="text-xs text-gray-500">{a.timestamp ? new Date(a.timestamp).toLocaleString() : ""}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
