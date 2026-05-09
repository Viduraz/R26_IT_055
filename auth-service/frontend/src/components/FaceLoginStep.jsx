import React, { useRef, useState, useCallback } from "react";
import Webcam from "react-webcam";
import { Camera } from "lucide-react";

const videoConstraints = {
  width: 640,
  height: 480,
  facingMode: "user"
};

const FaceLoginStep = ({ onVerify, onCancel, loading }) => {
  const webcamRef = useRef(null);

  const handleCapture = useCallback(() => {
    const imageSrc = webcamRef.current.getScreenshot();
    if (imageSrc) {
      // Send the same high-res frame for both face and skeleton verification
      onVerify(imageSrc, imageSrc);
    }
  }, [webcamRef, onVerify]);

  return (
    <div className="flex flex-col items-center justify-center space-y-5 animate-fade-in">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-bold text-white">Dual Biometric Verification</h3>
        <p className="text-sm text-gray-400 max-w-sm">
          Caregiver security: We are now scanning your <b>Face</b> and <b>Skeletal Structure</b>. 
          Please ensure your full upper body is visible in the frame.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-2xl w-full aspect-video border-4 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.3)] bg-black">
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          videoConstraints={videoConstraints}
          className="w-full h-full object-cover"
        />
        {/* Scanning animation overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500/50 shadow-[0_0_15px_#6366f1] animate-scan" />
        </div>
      </div>

      <div className="flex w-full gap-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg transition-colors border border-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCapture}
          disabled={loading}
          className="flex-2 flex-grow flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          <Camera className="w-5 h-5" />
          {loading ? "Verifying Identity..." : "Scan & Login"}
        </button>
      </div>
    </div>
  );
};

export default FaceLoginStep;
