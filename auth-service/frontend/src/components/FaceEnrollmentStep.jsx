import React, { useRef, useState, useCallback } from "react";
import Webcam from "react-webcam";
import { Camera, CheckCircle, RefreshCcw } from "lucide-react";

const videoConstraints = {
  width: 400,
  height: 400,
  facingMode: "user"
};

const FaceEnrollmentStep = ({ onComplete }) => {
  const webcamRef = useRef(null);
  const [samples, setSamples] = useState([]);
  const [isCapturing, setIsCapturing] = useState(false);

  const REQUIRED_SAMPLES = 5;

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current.getScreenshot();
    if (imageSrc) {
      setSamples((prev) => [...prev, imageSrc]);
    }
  }, [webcamRef]);

  const handleStartCapture = () => {
    setIsCapturing(true);
    // Automatically capture frames every 800ms to get varying angles
    const interval = setInterval(() => {
      setSamples((currentSamples) => {
        if (currentSamples.length >= REQUIRED_SAMPLES - 1) {
          clearInterval(interval);
          setIsCapturing(false);
          return [...currentSamples, webcamRef.current.getScreenshot()];
        }
        return [...currentSamples, webcamRef.current.getScreenshot()];
      });
    }, 800);
  };

  const reset = () => {
    setSamples([]);
    setIsCapturing(false);
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      <h3 className="text-xl font-semibold text-white">Face Enrollment</h3>
      <p className="text-sm text-gray-400 text-center max-w-sm">
        Caregivers must enroll their face for secure login. Please look directly into the camera and move your head slightly when capturing starts.
      </p>

      {samples.length < REQUIRED_SAMPLES ? (
        <div className="relative overflow-hidden rounded-xl border-2 border-indigo-500 shadow-lg shadow-indigo-500/20">
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            videoConstraints={videoConstraints}
            className="w-full max-w-[300px] h-auto object-cover"
          />
          {isCapturing && (
            <div className="absolute top-2 right-2 bg-black/60 px-3 py-1 rounded-full text-indigo-400 font-bold text-sm animate-pulse">
              {samples.length} / {REQUIRED_SAMPLES}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center p-6 bg-green-500/10 border border-green-500/50 rounded-xl space-y-2">
          <CheckCircle className="w-12 h-12 text-green-400" />
          <h4 className="text-green-400 font-medium">Enrollment Successful</h4>
          <p className="text-sm text-gray-300">Captured {samples.length} reference images.</p>
        </div>
      )}

      {samples.length < REQUIRED_SAMPLES ? (
        <button
          type="button"
          onClick={handleStartCapture}
          disabled={isCapturing}
          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          <Camera className="w-5 h-5" />
          {isCapturing ? "Scanning..." : "Start Head Scan"}
        </button>
      ) : (
        <div className="flex gap-4">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            <RefreshCcw className="w-4 h-4" />
            Retake
          </button>
          <button
            type="button"
            onClick={() => onComplete(samples)}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
          >
            Confirm & Complete Signup
          </button>
        </div>
      )}
    </div>
  );
};

export default FaceEnrollmentStep;
