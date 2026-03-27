// gateway-dashboard/frontend/src/pages/AdminDashboard.jsx
import { useEffect, useState } from "react";
import { getAdminSummary } from "../services/dashboardApi";
import { useAuth } from "../../../../shared/frontend/hooks/useAuth";

export default function AdminDashboard() {
  const { token, logout } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (token) {
      getAdminSummary(token).then(setData).catch(console.error);
    }
  }, [token]);

  if (!data) return <div className="text-white p-10">Loading admin analytics...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center bg-gray-900 border border-gray-700 p-6 rounded-2xl shadow-lg">
        <div>
          <h1 className="text-3xl font-bold text-white">System Administration</h1>
          <p className="text-gray-400">Manage all Elder Care users and alerts</p>
        </div>
        <button onClick={logout} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg">Sign Out</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-md">
          <h3 className="text-gray-400 text-sm">Total Users</h3>
          <p className="text-4xl font-bold text-white mt-2">{data.stats.total_users}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-md">
          <h3 className="text-gray-400 text-sm">Caregivers</h3>
          <p className="text-4xl font-bold text-indigo-400 mt-2">{data.stats.caregivers}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-md">
          <h3 className="text-gray-400 text-sm">Verified Enrolled</h3>
          <p className="text-4xl font-bold text-green-400 mt-2">{data.stats.verified_caregivers}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-md">
          <h3 className="text-gray-400 text-sm">Family Members</h3>
          <p className="text-4xl font-bold text-blue-400 mt-2">{data.stats.families}</p>
        </div>
      </div>

      <div className="bg-gray-900 border border-red-900/50 rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold text-white mb-4">Critical System Alerts</h2>
        <div className="space-y-3">
          {data.recent_alerts.map((a) => (
            <div key={a.id} className="flex justify-between items-center p-4 bg-gray-800 border border-red-500/30 rounded-lg">
              <div>
                <span className="bg-red-500/20 text-red-400 px-3 py-1 rounded-full text-xs font-bold mr-3">{a.type}</span>
                <span className="text-gray-300 text-sm">{a.time}</span>
              </div>
              <button className="text-sm text-indigo-400 hover:text-indigo-300">Acknowledge</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
