// gateway-dashboard/frontend/src/pages/FamilyDashboard.jsx
import { useEffect, useState } from "react";
import { getFamilyAlerts } from "../services/dashboardApi";
import { useAuth } from "../../../../shared/frontend/hooks/useAuth";

export default function FamilyDashboard() {
  const { token, logout } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (token) {
      getFamilyAlerts(token).then(setData).catch(console.error);
    }
  }, [token]);

  if (!data) return <div className="text-white p-10">Loading family data...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center bg-gray-900 border border-gray-700 p-6 rounded-2xl shadow-lg">
        <div>
          <h1 className="text-3xl font-bold text-white">Elder Monitoring</h1>
          <p className="text-gray-400">Keep track of your loved ones remotely</p>
        </div>
        <button onClick={logout} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg">Sign Out</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-md">
          <h3 className="text-gray-400 text-sm">Overall Status</h3>
          <p className="text-2xl font-bold text-green-400 mt-2">{data.elder_status}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-md">
          <h3 className="text-gray-400 text-sm">Last Seen Location</h3>
          <p className="text-2xl font-bold text-blue-400 mt-2">{data.last_seen}</p>
        </div>
      </div>

      <div className="bg-gray-900 border border-indigo-900/50 rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold text-white mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {data.alerts.map((a, i) => (
            <div key={i} className="flex justify-between items-center p-4 bg-gray-800 border border-gray-700 rounded-lg">
              <span className="text-gray-300 text-sm">{a.message}</span>
              <span className="text-gray-500 text-xs">{a.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
