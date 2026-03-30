import React, { useRef, useEffect } from 'react';

const CameraPreview = ({ stream }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative aspect-video w-full bg-black rounded-lg overflow-hidden border border-gray-700 shadow-2xl">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover transform scale-x-[-1]" 
      />
    </div>
  );
};

export default CameraPreview;
