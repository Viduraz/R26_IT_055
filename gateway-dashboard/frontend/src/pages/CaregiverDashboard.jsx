// gateway-dashboard/frontend/src/pages/CaregiverDashboard.jsx
import { useEffect, useState } from "react";
import { getCaregiverProfile } from "../services/dashboardApi";
import { useAuth } from "../../../../shared/frontend/hooks/useAuth";

export default function CaregiverDashboard() {
  const { token, logout } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (token) {
      getCaregiverProfile(token).then(setData).catch(console.error);
    }
  }, [token]);

  if (!data) return <div className="text-white p-10">Loading profile...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center bg-gray-900 border border-gray-700 p-6 rounded-2xl shadow-lg">
        <div>
          <h1 className="text-3xl font-bold text-white">Caregiver Portal</h1>
          <p className="text-gray-400">Welcome back, {data.profile.name}</p>
        </div>
        <button onClick={logout} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg">Sign Out</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-md">
          <h3 className="text-gray-400 text-sm">Face Auth Status</h3>
          <p className="text-lg font-bold text-green-400 mt-1 capitalize">{data.profile.face_status}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-md">
          <h3 className="text-gray-400 text-sm">Current Shift</h3>
          <p className="text-lg font-bold text-indigo-400 mt-1">{data.profile.shift}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-md">
          <h3 className="text-gray-400 text-sm">Assigned Elder</h3>
          <p className="text-lg font-bold text-blue-400 mt-1">{data.profile.assigned_elder}</p>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold text-white mb-4">Face Verification Access Logs</h2>
        <div className="space-y-3">
          {data.recent_verifications.map((v, i) => (
            <div key={i} className="flex justify-between items-center p-4 bg-gray-800 border border-gray-700 rounded-lg">
              <div>
                <span className="bg-green-500/20 text-green-400 px-3 py-1 rounded-full text-xs font-bold mr-3">{v.status}</span>
                <span className="text-gray-300 text-sm">{v.date}</span>
              </div>
              <span className="text-indigo-400 text-sm font-medium">Confidence: {v.confidence}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
