// gateway-dashboard/frontend/src/pages/SystemOverview.jsx
import { useEffect, useState } from "react";
import gatewayApi from "../services/gatewayApi";

export default function SystemOverview() {
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    gatewayApi.get("/overview")
      .then((r) => setOverview(r.data))
      .catch(console.error);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">System Overview</h1>
      {!overview ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(overview.services).map(([name, status]) => (
            <div key={name} className="bg-gray-900 border border-gray-700 rounded-xl p-6 text-center">
              <div className={`text-3xl ${status === "ok" ? "text-green-400" : "text-red-400"}`}>
                {status === "ok" ? "✓" : "✗"}
              </div>
              <p className="capitalize font-medium mt-2">{name}</p>
              <p className={`text-xs mt-1 ${status === "ok" ? "text-green-400" : "text-red-400"}`}>{status}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
