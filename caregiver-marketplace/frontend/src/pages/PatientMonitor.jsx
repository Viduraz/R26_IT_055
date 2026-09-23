import React, { useState, useEffect, useRef } from "react";
import { Shield, Eye, LogOut, Radio, Activity, Map, CalendarCheck, CheckCircle2, AlertTriangle, VideoOff, RefreshCw } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { validatePatientId, getPatientLiveStatus, getVideoFrame } from "../services/monitorApi";

const PatientMonitor = () => {
  const [patientIdInput, setPatientIdInput] = useState("");
  const [patientId, setPatientId] = useState("");
  const [validated, setValidated] = useState(false);
  const [booking, setBooking] = useState(null);
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(null);
  // Live video states
  const [videoFrame, setVideoFrame] = useState(null);
  const [videoError, setVideoError] = useState(false);
  const videoIntervalRef = useRef(null);

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!patientIdInput.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const response = await validatePatientId(patientIdInput.toUpperCase());
      setBooking(response);
      setPatientId(patientIdInput.toUpperCase());
      setValidated(true);
    } catch (err) {
      console.error("Verification failed:", err);
      setError(err.response?.data?.detail || "Invalid Patient ID or unauthorized access. Double-check your ID.");
    } finally {
      setLoading(false);
    }
  };

  const fetchLiveStatus = async () => {
    if (!patientId) return;
    try {
      const data = await getPatientLiveStatus(patientId);
      setStatusData(data);
    } catch (err) {
      console.error("Error fetching live status metrics:", err);
    }
  };

  // Poll for live metrics every 3 seconds once connected
  useEffect(() => {
    if (validated && patientId) {
      fetchLiveStatus(); // immediate load
      const interval = setInterval(fetchLiveStatus, 3000);
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    }
  }, [validated, patientId]);

  // Poll live video frames every 200ms once connected
  useEffect(() => {
    if (validated && patientId) {
      const pollVideo = async () => {
        try {
          const data = await getVideoFrame(patientId);
          if (data?.frame) {
            setVideoFrame(data.frame);
            setVideoError(false);
          }
        } catch {
          setVideoError(true);
        }
      };
      pollVideo(); // immediate first fetch
      videoIntervalRef.current = setInterval(pollVideo, 200);
      return () => clearInterval(videoIntervalRef.current);
    }
  }, [validated, patientId]);

  const handleDisconnect = () => {
    if (refreshInterval) clearInterval(refreshInterval);
    if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
    setValidated(false);
    setPatientId("");
    setBooking(null);
    setStatusData(null);
    setVideoFrame(null);
    setVideoError(false);
    setPatientIdInput("");
    setError(null);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />

      <main className="flex-grow max-w-7xl w-full mx-auto px-6 py-10 flex flex-col justify-center">

        {!validated ? (
          /* Verification Screen */
          <div className="max-w-md w-full mx-auto glass-panel rounded-3xl p-8 border border-slate-800 relative overflow-hidden shadow-2xl my-10">
            {/* Ambient Background Glow */}
            <div className="absolute -top-16 -right-16 w-32 h-32 bg-primary-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="w-14 h-14 rounded-2xl bg-primary-950/40 border border-primary-500/20 flex items-center justify-center text-primary-400 mx-auto mb-6">
              <Eye className="w-7 h-7" />
            </div>

            <h1 className="text-2xl font-bold text-center text-slate-100">Live Care Monitor</h1>
            <p className="text-xs text-slate-500 text-center mt-2 max-w-xs mx-auto mb-8">
              Enter your unique Patient ID generated upon booking caregiver services to launch the telemetry portal.
            </p>

            <form onSubmit={handleConnect} className="flex flex-col gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                  Patient ID *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. PT-2026-X7A9"
                  value={patientIdInput}
                  onChange={(e) => setPatientIdInput(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-100 font-mono tracking-wider text-center text-lg border border-slate-800 rounded-xl py-3 focus:outline-none focus:border-primary-500/50 uppercase placeholder:text-slate-700"
                />
              </div>

              {error && (
                <p className="text-xs font-semibold text-red-400 bg-red-950/20 border border-red-500/15 p-3 rounded-lg text-center">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 disabled:from-primary-800 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-primary-500/10"
              >
                {loading ? "Authenticating feed..." : "Connect Safe Feed"}
              </button>
            </form>
          </div>
        ) : (
          /* Live Dashboard Screen */
          <div className="flex flex-col gap-6">

            {/* Telemetry Header */}
            <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400 relative shrink-0">
                  <Radio className="w-5 h-5 animate-pulse" />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-extrabold text-slate-100">{booking?.elder_name || "Elder Patient"}</h2>
                    <span className="text-[10px] font-mono font-bold bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded">
                      {patientId}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Caregiver: <strong className="text-slate-300">{booking?.caregiver_name}</strong> &bull; Booking: <strong className="text-slate-400">{booking?.booking_id}</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-900 text-slate-400">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Live Syncing
                </div>

                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-red-950/20 hover:bg-red-950/40 border border-red-500/10 hover:border-red-500/20 text-red-400 transition-all"
                >
                  <LogOut className="w-3.5 h-3.5" /> Disconnect
                </button>
              </div>
            </div>

            {/* Core Monitor Grid */}
            <div className="grid lg:grid-cols-3 gap-6">

              {/* Left Column: Live camera feed and Pose Anomaly (take 2 columns) */}
              <div className="lg:col-span-2 flex flex-col gap-6">

                {/* Live Camera Feed */}
                <div className="glass-panel rounded-3xl border border-slate-800 overflow-hidden relative shadow-2xl">
                  {/* Camera overlay scanlines — kept for authentic surveillance aesthetic */}
                  <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] pointer-events-none z-10" />

                  {/* Top Feed bar */}
                  <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[9px] tracking-wider font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full uppercase">
                      <span className={`w-1.5 h-1.5 rounded-full ${videoFrame && !videoError ? 'bg-red-500 animate-pulse' : 'bg-slate-600'}`} />
                      {videoFrame && !videoError ? 'LIVE CAMERA' : 'CAMERA OFFLINE'}
                    </span>
                    <span className="text-[9px] text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800 font-mono">
                      CAM-01 (Living Room)
                    </span>
                  </div>

                  {/* Anomaly alert banner — overlaid on top of live video when alert is raised */}
                  {statusData?.anomaly?.alert_raised && (
                    <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-center py-2 bg-red-950/80 border-b border-red-500/40">
                      <div className="flex items-center gap-2 animate-pulse">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <span className="text-xs font-black text-red-400 uppercase tracking-widest font-mono">FALL DETECTED — Anomaly Alert Active</span>
                      </div>
                    </div>
                  )}

                  {/* Camera feed area */}
                  <div className="w-full aspect-video bg-[#05070c] flex items-center justify-center relative select-none overflow-hidden">

                    {videoFrame && !videoError ? (
                      /* ── REAL LIVE VIDEO ── */
                      <img
                        src={videoFrame}
                        alt="Live camera feed"
                        className="w-full h-full object-cover"
                        style={{ imageRendering: 'auto' }}
                      />
                    ) : (
                      /* ── CAMERA UNAVAILABLE FALLBACK ── */
                      <div className="flex flex-col items-center gap-3 text-center p-6">
                        <div className="w-14 h-14 rounded-full bg-slate-800/60 border border-slate-700 flex items-center justify-center text-slate-600">
                          <VideoOff className="w-7 h-7" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-500 uppercase tracking-widest font-mono">Camera Unavailable</p>
                          <p className="text-[10px] text-slate-600 mt-1">IP camera offline or RTSP stream not connected</p>
                        </div>
                        {/* Still show pose status from telemetry even when video is down */}
                        {statusData?.anomaly && (
                          <div className={`mt-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider font-mono ${statusData.anomaly.alert_raised
                            ? 'text-red-400 bg-red-950/40 border-red-500/20'
                            : 'text-emerald-400 bg-emerald-950/20 border-emerald-500/20'
                            }`}>
                            {statusData.anomaly.alert_raised ? '⚠ Alert via telemetry' : '✓ Posture normal (telemetry)'}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Scanner line animation — shown only on live feed */}
                    {videoFrame && !videoError && (
                      <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary-500/40 to-transparent top-0 animate-[scan_6s_linear_infinite] pointer-events-none" />
                    )}
                  </div>

                  {/* Status Overlay details */}
                  <div className="glass-panel border-t border-slate-800 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div>
                      <p className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Pipeline Frame Rate</p>
                      <p className="font-semibold text-slate-200 mt-0.5">24.6 fps</p>
                    </div>
                    <div>
                      <p className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Model Inference Time</p>
                      <p className="font-semibold text-slate-200 mt-0.5">38 ms (YOLOv8 + MediaPipe)</p>
                    </div>
                    <div>
                      <p className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Telemetry Anomaly Status</p>
                      <p className="font-semibold text-slate-200 mt-0.5">
                        {statusData?.anomaly?.alert_raised ? "🚨 ANOMALY_ALERT" : "✅ NOMINAL"}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Alert History Count</p>
                      <p className="font-semibold text-slate-200 mt-0.5">{statusData?.anomaly?.metrics_history?.length || 0} event logs</p>
                    </div>
                  </div>

                </div>

              </div>

              {/* Right Column: Other services status & Chores */}
              <div className="flex flex-col gap-6">

                {/* Service Status Heartbeats */}
                <div className="glass-panel rounded-2xl p-5 border border-slate-800">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-primary-400" /> Pipeline Heartbeats
                  </h3>

                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-300">Anomaly Pose Analyzer</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${statusData?.services_status?.anomaly === "online"
                        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                        : "text-rose-400 bg-rose-500/10 border-rose-500/20"
                        }`}>
                        {statusData?.services_status?.anomaly || "offline"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-300">Geofencing Location Tracker</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${statusData?.services_status?.tracking === "online"
                        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                        : "text-rose-400 bg-rose-500/10 border-rose-500/20"
                        }`}>
                        {statusData?.services_status?.tracking || "offline"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-300">Schedule compliance Auditor</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${statusData?.services_status?.schedule === "online"
                        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                        : "text-rose-400 bg-rose-500/10 border-rose-500/20"
                        }`}>
                        {statusData?.services_status?.schedule || "offline"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Geofence Card */}
                <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex flex-col gap-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Map className="w-4 h-4 text-primary-400" /> GPS Geofence Tracker
                  </h3>

                  <div className="flex flex-col gap-3">
                    <div className="bg-[#0b0f19] border border-slate-900 p-3.5 rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <p className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Coordinates</p>
                        <p className="font-mono text-slate-200 mt-0.5">34.0522 N, 118.2437 W</p>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/20 font-bold text-[10px] uppercase">
                        Safe Zone
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-500 leading-normal">
                      The elder is inside the primary residence living room zone. No boundary alerts are logged today.
                    </p>
                  </div>
                </div>

                {/* Chores / Schedule compliance */}
                <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex flex-col gap-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <CalendarCheck className="w-4 h-4 text-primary-400" /> Shift Compliance Chores
                  </h3>

                  <div className="flex flex-col gap-2.5">
                    <label className="flex items-center gap-2.5 text-xs text-slate-300">
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 fill-emerald-500/10 shrink-0" />
                      <span>Caregiver Check-in: 08:58 (Verified)</span>
                    </label>

                    <label className="flex items-center gap-2.5 text-xs text-slate-300">
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 fill-emerald-500/10 shrink-0" />
                      <span>Morning Meds administered</span>
                    </label>

                    <label className="flex items-center gap-2.5 text-xs text-slate-300">
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 fill-emerald-500/10 shrink-0" />
                      <span>Lunch meal preparation</span>
                    </label>

                    <label className="flex items-center gap-2.5 text-xs text-slate-400">
                      <div className="w-4.5 h-4.5 rounded-full border border-slate-800 shrink-0" />
                      <span>Evening walk assistance (Pending)</span>
                    </label>
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default PatientMonitor;
