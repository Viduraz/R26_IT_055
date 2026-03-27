// gateway-dashboard/frontend/src/pages/Home.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import gatewayApi from "../services/gatewayApi";

const MODULE_CARDS = [
  { title: "Face Verification", desc: "Real-time identity recognition", icon: "🧑‍💼", port: 5174 },
  { title: "Tracking & Geofencing", desc: "Person tracking and zone alerts", icon: "📍", port: 5175 },
  { title: "Anomaly Detection", desc: "Pose-based fall and anomaly alerts", icon: "⚠️", port: 5176 },
  { title: "Schedule Monitoring", desc: "Routine tracking and deviations", icon: "📅", port: 5177 },
];

export default function Home() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [ovRes, alRes] = await Promise.all([
          gatewayApi.get("/overview"),
          gatewayApi.get("/alerts"),
        ]);
        setOverview(ovRes.data);
        setAlerts(alRes.data.slice(0, 5));
      } catch (err) {
        console.error("Gateway fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛡️</span>
          <h1 className="text-xl font-bold">Secure Elder Care</h1>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-400 hover:text-white transition"
        >
          Sign Out →
        </button>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-10">
        {/* System Overview */}
        <div className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">System Overview</h2>
          {loading ? (
            <p className="text-gray-500">Loading service status…</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {overview?.services &&
                Object.entries(overview.services).map(([name, status]) => (
                  <div key={name} className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-center">
                    <div className={`text-2xl mb-2 ${status === "ok" ? "text-green-400" : "text-red-400"}`}>
                      {status === "ok" ? "✓" : "✗"}
                    </div>
                    <p className="text-sm font-medium capitalize">{name}</p>
                    <p className={`text-xs mt-1 ${status === "ok" ? "text-green-400" : "text-red-400"}`}>
                      {status}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Module Cards */}
        <div className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">Modules</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {MODULE_CARDS.map((mod) => (
              <a
                key={mod.title}
                href={`http://localhost:${mod.port}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gray-900 border border-gray-700 hover:border-blue-500 rounded-2xl p-6 transition group"
              >
                <div className="text-4xl mb-3">{mod.icon}</div>
                <h3 className="font-semibold text-white group-hover:text-blue-400 transition">{mod.title}</h3>
                <p className="text-sm text-gray-400 mt-1">{mod.desc}</p>
              </a>
            ))}
          </div>
        </div>

        {/* Recent Alerts */}
        <div>
          <h2 className="text-2xl font-semibold mb-4">Recent Alerts</h2>
          {alerts.length === 0 ? (
            <p className="text-gray-500">No alerts found.</p>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert, i) => (
                <div key={i} className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-sm text-red-400">{alert.source || "Unknown"}</p>
                    <p className="text-gray-300 text-sm mt-1">
                      {alert.event_type || alert.type || "Alert"}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">
                    {alert.timestamp ? new Date(alert.timestamp).toLocaleString() : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
