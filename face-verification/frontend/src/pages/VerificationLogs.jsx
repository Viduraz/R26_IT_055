import { useState, useEffect } from "react";
import axios from "axios";

export default function VerificationLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLogs() {
      try {
        const faceBase = import.meta.env.VITE_FACE_BACKEND_URL || "http://localhost:8001/api/face";
        const { data } = await axios.get(`${faceBase}/verification-logs`);
        setLogs(data);
      } catch (err) {
        console.error("Failed to load logs:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLogs();
  }, []);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-gray-800 mb-6 flex items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 9V5a1 1 0 112 0v4h2a1 1 0 110 2h-3a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
        Biometric Verification Audit Trail
      </h1>

      <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-sm uppercase tracking-wider">
                <th className="p-4 font-semibold border-b">Timestamp</th>
                <th className="p-4 font-semibold border-b">Action</th>
                <th className="p-4 font-semibold border-b">Result</th>
                <th className="p-4 font-semibold border-b">Caregiver Profile</th>
                <th className="p-4 font-semibold border-b">Similarity Distance</th>
                <th className="p-4 font-semibold border-b text-right">Confidence Metrics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <tr key={log._id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="p-4">
                    <span className="bg-blue-100 text-blue-800 text-xs px-3 py-1 rounded-full font-medium">
                      Camera Match
                    </span>
                  </td>
                  <td className="p-4">
                    {log.matched ? (
                      <span className="flex items-center gap-1.5 text-green-600 text-sm font-semibold">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        Verified
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-red-500 text-sm font-semibold">
                        <span className="w-2 h-2 rounded-full bg-red-400"></span>
                        Rejected
                      </span>
                    )}
                  </td>
                  <td className="p-4 font-medium text-gray-800">
                    {log.matched_caregiver_name || <span className="text-gray-400 italic">Unidentified Cohort</span>}
                  </td>
                  <td className="p-4 text-sm font-mono text-gray-500">
                    Cosine: {log.similarity.toFixed(4)}
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className={`text-sm font-bold ${log.confidence > 80 ? 'text-green-600' : 'text-orange-500'}`}>
                        {log.confidence.toFixed(2)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan="6" className="p-12 text-center text-gray-400">
                    No biometric verification logs found.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="6" className="p-12 text-center">
                    <span className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
