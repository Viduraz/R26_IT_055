// tracking-geofencing/frontend/src/pages/ZoneManagement.jsx
import { useEffect, useState } from "react";
import { getZones } from "../services/trackingApi";

export default function ZoneManagement() {
  const [zones, setZones] = useState([]);
  useEffect(() => { getZones().then((r) => setZones(r.data)).catch(console.error); }, []);
  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-4">Zone Management</h1>
      {zones.length === 0 ? <p className="text-gray-500">No zones defined. TODO: add zone editor.</p> : (
        <ul className="space-y-2">
          {zones.map((z, i) => <li key={i} className="bg-gray-900 border border-gray-700 rounded-xl p-3">{z.name || "Zone " + i}</li>)}
        </ul>
      )}
    </div>
  );
}
