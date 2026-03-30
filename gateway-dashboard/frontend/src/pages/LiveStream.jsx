import React, { useState, useEffect } from 'react';
import CameraPreview from '../components/CameraPreview';

const LiveStream = () => {
  const [stream, setStream] = useState(null);
  const [status, setStatus] = useState('offline'); // offline | loading | active | denied
  const [errorMsg, setErrorMsg] = useState('');

  const startCamera = async () => {
    setStatus('loading');
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setStream(mediaStream);
      setStatus('active');
      setErrorMsg('');
    } catch (err) {
      setStatus('denied');
      setErrorMsg(err.message || 'Camera permission was denied.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setStatus('offline');
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return stopCamera;
  }, [stream]);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 relative max-w-5xl mx-auto">
      <div className="w-full bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-xl">
        
        {/* Header Bar */}
        <div className="bg-gray-800/80 px-6 py-4 flex items-center justify-between border-b border-gray-700">
          <div className="flex items-center space-x-3">
            <span className={`w-3 h-3 rounded-full ${status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-gray-500'}`}></span>
            <span className="font-medium text-sm text-gray-300">
              {status === 'active' ? 'Camera Active' : status === 'loading' ? 'Requesting Hardware...' : 'Camera Offline'}
            </span>
          </div>

          <div className="text-xs bg-indigo-500/20 text-indigo-400 px-3 py-1 rounded border border-indigo-500/30 font-mono">
            STREAMING_NODE
          </div>
        </div>

        {/* Video Area */}
        <div className="p-4 bg-gray-950">
          {status === 'offline' && (
            <div className="flex flex-col items-center justify-center text-gray-500 py-24">
              <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p>Camera is currently offline.</p>
            </div>
          )}
          {status === 'loading' && (
            <div className="text-center text-gray-400 py-24">
              <div className="w-8 h-8 mx-auto border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p>Connecting to secure hardware...</p>
            </div>
          )}
          {status === 'denied' && (
            <div className="text-center text-red-500 py-24">
              <p className="font-bold text-lg mb-2">Camera Access Denied</p>
              <p className="text-sm opacity-80">{errorMsg}</p>
            </div>
          )}
          {status === 'active' && <CameraPreview stream={stream} />}
        </div>

        {/* Controls */}
        <div className="bg-gray-900 border-t border-gray-800 px-6 py-4 flex justify-end space-x-4">
          {status === 'active' ? (
            <button 
              onClick={stopCamera}
              className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors"
            >
              Stop Camera
            </button>
          ) : (
            <button 
              onClick={startCamera}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-emerald-600/20"
            >
              Start Camera
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveStream;
