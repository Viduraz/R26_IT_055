import { useState, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import axios from "axios";

export default function ScanCaregiverModal({ isOpen, onClose }) {
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

  const handleClose = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 p-8 rounded-3xl shadow-2xl w-full max-w-2xl relative">
        <button 
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white bg-gray-800 hover:bg-red-600 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
        >
          ✕
        </button>

        <div className="text-center mb-6">
          <h2 className="text-3xl font-bold text-white mb-2">Gate Verification</h2>
          <p className="text-gray-400">Scan the arriving caregiver to authorize their tracking session securely.</p>
        </div>

        <div className="relative mx-auto w-full max-w-md rounded-2xl overflow-hidden shadow-2xl border-4 border-gray-800 mb-6 bg-black">
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            className="w-full h-auto object-cover"
          />
        </div>

        {!result && (
          <div className="flex justify-center">
            <button 
              onClick={captureAndVerify}
              disabled={verifying}
              className="px-10 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg text-lg flex items-center gap-2"
            >
              {verifying ? (
                <>
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  Processing ML Biometrics...
                </>
              ) : "Authenticate Face"}
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-100 p-4 rounded-xl text-center mt-4">
            {error}
          </div>
        )}

        {result && result.verified && (
          <div className="bg-green-900/40 border border-green-500 p-6 rounded-2xl shadow-lg mt-4 animate-fade-in-up">
            <h3 className="text-2xl font-bold text-green-400 mb-2 whitespace-pre-wrap">✔ {result.message}</h3>
            <div className="grid grid-cols-2 gap-4 text-left mt-4">
              <div>
                <p className="text-gray-400 text-sm">Identity</p>
                <p className="text-white font-medium">{result.caregiver_details.name}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">Cosine Distance</p>
                <p className="text-green-300 font-medium">{result.confidence}% Match</p>
              </div>
            </div>
            <p className="text-green-200/80 text-sm mt-4">Tracking geofence session successfully linked to camera ID.</p>
          </div>
        )}

        {result && !result.verified && (
          <div className="bg-red-900/40 border border-red-500 p-6 rounded-2xl shadow-lg text-center mt-4 animate-fade-in-up">
            <h3 className="text-2xl font-bold text-red-500 mb-2">❌ {result.message}</h3>
            <p className="text-red-300">Identity denied. Please alert administration if unauthorized entry is attempted.</p>
          </div>
        )}
      </div>
    </div>
  );
}
