import { useState, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import axios from "axios";

export default function FamilyScanCaregiver() {
  const webcamRef = useRef(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const captureAndVerify = useCallback(async () => {
    if (!webcamRef.current) return;
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;

    setVerifying(true);
    setError(null);
    setResult(null);

    try {
      const { data } = await axios.post("http://localhost:8001/api/face/verify-caregiver", {
        live_sample: imageSrc
      });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Verification request failed.");
    } finally {
      setVerifying(false);
    }
  }, [webcamRef]);

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="bg-gray-900 border border-gray-700 p-6 rounded-2xl shadow-lg text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Caregiver Verification</h1>
        <p className="text-gray-400 mb-6">Family Member Portal: Point the camera at the arriving caregiver to verify their identity and start the security session.</p>

        <div className="relative mx-auto w-full max-w-sm rounded-xl overflow-hidden shadow-2xl border-4 border-gray-800">
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            className="w-full h-auto object-cover"
          />
        </div>

        <button 
          onClick={captureAndVerify}
          disabled={verifying}
          className="mt-6 px-10 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-full transition-all shadow-lg"
        >
          {verifying ? "Scanning Facial Biometrics..." : "Verify Identity"}
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
