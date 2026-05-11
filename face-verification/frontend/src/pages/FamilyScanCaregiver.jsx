import { useState, useRef, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import axios from "axios";

const FACE_API = "http://localhost:8001/api/face";
const SNAPSHOT_INTERVAL_MS = 1200; // IP camera preview refresh rate

export default function FamilyScanCaregiver() {
  const webcamRef = useRef(null);

  // "webcam" | "ip_camera"
  const [cameraSource, setCameraSource] = useState("webcam");

  // IP camera preview state
  const [ipFrame, setIpFrame]       = useState(null);   // base64 data URL
  const [ipError, setIpError]       = useState(null);   // connection error message
  const [ipLoading, setIpLoading]   = useState(false);  // initial connect spinner

  const [verifying, setVerifying] = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);

  // ── IP Camera preview polling ──────────────────────────────────────────────
  useEffect(() => {
    if (cameraSource !== "ip_camera") return;

    let active = true;
    setIpLoading(true);
    setIpError(null);
    setIpFrame(null);

    const fetchFrame = async () => {
      try {
        const { data } = await axios.get(`${FACE_API}/camera-snapshot`, { timeout: 10000 });
        if (active) {
          setIpFrame(data.frame);
          setIpError(null);
          setIpLoading(false);
        }
      } catch (err) {
        if (active) {
          const msg = err.response?.data?.detail || "IP camera unreachable";
          setIpError(msg);
          setIpLoading(false);
        }
      }
    };

    // Immediate first fetch, then interval
    fetchFrame();
    const timer = setInterval(fetchFrame, SNAPSHOT_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [cameraSource]);

  // ── Capture & Verify ────────────────────────────────────────────────────────
  const captureAndVerify = useCallback(async () => {
    setVerifying(true);
    setError(null);
    setResult(null);

    try {
      if (cameraSource === "ip_camera") {
        // Server fetches the frame from the IP camera and runs verification
        const { data } = await axios.post(`${FACE_API}/camera-verify`, {}, { timeout: 15000 });
        setResult(data);
      } else {
        // Webcam path — unchanged
        if (!webcamRef.current) return;
        const imageSrc = webcamRef.current.getScreenshot();
        if (!imageSrc) return;
        const { data } = await axios.post(`${FACE_API}/verify-caregiver`, { live_sample: imageSrc });
        setResult(data);
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Verification request failed.");
    } finally {
      setVerifying(false);
    }
  }, [cameraSource, webcamRef]);

  // ── Camera source toggle ────────────────────────────────────────────────────
  const SourceToggle = () => (
    <div className="flex items-center gap-2 mb-5 p-1 bg-gray-800 rounded-xl border border-gray-700">
      {[
        { id: "webcam",    label: "🖥️ Webcam"    },
        { id: "ip_camera", label: "📡 IP Camera" },
      ].map(({ id, label }) => (
        <button
          key={id}
          id={`camera-source-${id}`}
          onClick={() => { setCameraSource(id); setResult(null); setError(null); }}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all ${
            cameraSource === id
              ? "bg-indigo-600 text-white shadow"
              : "text-gray-400 hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="bg-gray-900 border border-gray-700 p-6 rounded-2xl shadow-lg text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Caregiver Verification</h1>
        <p className="text-gray-400 mb-6">
          Family Member Portal: Point the camera at the arriving caregiver to verify their identity.
        </p>

        <SourceToggle />

        {/* ── Video Feed ── */}
        <div className="relative mx-auto w-full max-w-sm rounded-xl overflow-hidden shadow-2xl border-4 border-gray-800 bg-gray-950 min-h-[240px] flex items-center justify-center">
          {cameraSource === "webcam" ? (
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              className="w-full h-auto object-cover"
            />
          ) : (
            <>
              {ipLoading && (
                <div className="flex flex-col items-center gap-3 text-gray-500 py-10 px-4">
                  <div className="w-10 h-10 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
                  <p className="text-sm font-mono">Connecting to IP camera…</p>
                  <p className="text-xs text-gray-600">169.254.110.15</p>
                </div>
              )}
              {ipError && !ipLoading && (
                <div className="flex flex-col items-center gap-3 text-red-400 py-10 px-4">
                  <span className="text-4xl">📡</span>
                  <p className="text-sm font-semibold">Camera Unreachable</p>
                  <p className="text-xs text-red-500 break-words text-center max-w-[220px]">{ipError}</p>
                  <p className="text-xs text-gray-600 mt-1">Check .env → IP_CAMERA_SNAPSHOT_URL</p>
                </div>
              )}
              {ipFrame && !ipLoading && !ipError && (
                <>
                  <img
                    src={ipFrame}
                    alt="IP Camera feed"
                    className="w-full h-auto object-cover"
                  />
                  {/* LIVE badge */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-red-600/90 text-white text-xs font-black px-3 py-1 rounded-full animate-pulse tracking-widest">
                    <span className="w-2 h-2 bg-white rounded-full" />
                    LIVE
                  </div>
                  {/* camera ip badge */}
                  <div className="absolute bottom-2 right-2 bg-black/60 text-gray-300 text-xs font-mono px-2 py-0.5 rounded">
                    169.254.110.15
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <button
          id="verify-identity-btn"
          onClick={captureAndVerify}
          disabled={verifying || (cameraSource === "ip_camera" && (ipLoading || !!ipError))}
          className="mt-6 px-10 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-full transition-all shadow-lg"
        >
          {verifying
            ? "Scanning Facial Biometrics…"
            : cameraSource === "ip_camera"
            ? "📡 Capture & Verify from IP Camera"
            : "Verify Identity"}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-100 p-4 rounded-xl text-center">
          {error}
        </div>
      )}

      {result && result.verified && (
        <div className="bg-green-900/40 border border-green-500 p-6 rounded-2xl shadow-lg">
          <h2 className="text-2xl font-bold text-green-400 mb-2">✔ {result.message}</h2>
          <div className="grid grid-cols-2 gap-4 text-left mt-4">
            <div>
              <p className="text-gray-400 text-sm">Caregiver Name</p>
              <p className="text-white font-medium">{result.caregiver_details.name}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Target Confidence</p>
              <p className="text-green-300 font-medium">{result.confidence}% Match</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Handoff Status</p>
              <p className="text-indigo-400 font-medium font-mono text-xs mt-1">
                SESSION ID: {result.session?.session_id.split("-")[0]}...
              </p>
            </div>
          </div>
          <p className="text-gray-300 text-sm mt-4 bg-gray-800 p-3 rounded-lg border border-gray-700">
            A tracking session has been securely handed off to the Geofencing tracker. The camera will now monitor for their continuous presence.
          </p>
        </div>
      )}

      {result && !result.verified && (
        <div className="bg-red-900/40 border border-red-500 p-6 rounded-2xl shadow-lg text-center">
          <h2 className="text-2xl font-bold text-red-500 mb-2">❌ {result.message}</h2>
          <p className="text-red-300">This individual is not registered as an authorized caregiver in our tracking database. Do not grant them access to the premises.</p>
        </div>
      )}
    </div>
  );
}
