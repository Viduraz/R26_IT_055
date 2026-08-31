/**
 * anomaly-detection/frontend/src/pages/ModelStatus.jsx
 * ML pipeline health dashboard — model weights, thresholds, engine status.
 */
import { useEffect, useState } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";

const ANOMALY_API = import.meta.env.VITE_ANOMALY_BACKEND_URL || "http://localhost:8003/api/anomaly";

export default function ModelStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    const token = localStorage.getItem("access_token");
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const { data } = await axios.get(`${ANOMALY_API}/model-status`, { headers: authHeaders });
      setStatus(data);
      setError("");
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const StatusDot = ({ value }) => (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full border ${value === "loaded"
        ? "bg-emerald-900/40 border-emerald-500/50 text-emerald-300"
        : "bg-red-900/30 border-red-500/40 text-red-400"
      }`}>
      <span className={`w-2 h-2 rounded-full ${value === "loaded" ? "bg-emerald-500" : "bg-red-500"}`} />
      {value === "loaded" ? "Loaded" : "Not Found"}
    </span>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto p-6">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Model Status</h1>
            <p className="text-gray-400 text-sm mt-1">ML pipeline health and configuration</p>
          </div>
          <button onClick={load}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl">
            ↻ Refresh
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-500/50 text-red-300 text-sm p-4 rounded-2xl mb-5">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-20 text-gray-500 gap-3">
            <span className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            Loading status…
          </div>
        ) : status && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* MediaPipe */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Pose Extraction</h3>
              <div className="flex items-center justify-between">
                <span className="text-white font-bold">MediaPipe Pose</span>
                <StatusDot value={status.mediapipe_pose} />
              </div>
              <p className="text-gray-600 text-xs mt-2">33 landmarks · body-relative normalisation · visibility filtering</p>
            </div>

            {/* LSTM */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">LSTM Classifier</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-bold">Weights</span>
                <StatusDot value={status.lstm_weights} />
              </div>
              {status.lstm_weights !== "loaded" && (
                <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-xl p-3 mt-2">
                  <p className="text-yellow-300 text-xs font-bold mb-1">⚠ Training Required</p>
                  <p className="text-yellow-500/80 text-xs">Place trained weights at:</p>
                  <p className="text-yellow-400 font-mono text-xs mt-1 break-all">{status.lstm_path}</p>
                </div>
              )}
              <p className="text-gray-600 text-xs mt-2">4 classes: normal · fall · aggression · inactivity</p>
            </div>

            {/* Autoencoder */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Autoencoder</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-bold">Weights</span>
                <StatusDot value={status.autoencoder_weights} />
              </div>
              {status.autoencoder_weights !== "loaded" && (
                <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-xl p-3 mt-2">
                  <p className="text-yellow-300 text-xs font-bold mb-1">⚠ Training Required</p>
                  <p className="text-yellow-400 font-mono text-xs mt-1 break-all">{status.ae_path}</p>
                </div>
              )}
              <p className="text-gray-600 text-xs mt-2">Reconstruction error · trained on normal sequences only</p>
            </div>

            {/* Rule Engine */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Rule Engine</h3>
              <div className="flex items-center justify-between">
                <span className="text-white font-bold">Status</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full border bg-emerald-900/40 border-emerald-500/50 text-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />Always Active
                </span>
              </div>
              <div className="mt-3 space-y-1.5 font-mono text-xs text-gray-500">
                <p>Fall · Aggression · Inactivity</p>
                <p>No training required</p>
              </div>
            </div>

            {/* Config */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 md:col-span-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Pipeline Configuration</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono text-sm">
                {[
                  ["Feature dimensions", status.feature_dimensions],
                  ["Sequence window", `${status.sequence_window} frames`],
                  ["Anomaly route", "POST /api/anomaly/process"],
                  ["Decision mode", status.lstm_weights === "loaded" && status.autoencoder_weights === "loaded"
                    ? "Hybrid (Rule+LSTM+AE)" : status.lstm_weights === "loaded"
                      ? "Rule + LSTM" : "Rule Engine Only"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-gray-800 rounded-xl p-3">
                    <p className="text-gray-500 text-xs mb-1">{k}</p>
                    <p className="text-indigo-300 font-bold">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
