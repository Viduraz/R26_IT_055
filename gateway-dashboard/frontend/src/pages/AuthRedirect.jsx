import React, { useEffect } from 'react';

// Routes auth requests through the reverse proxy path /auth/<type>
// This works both locally (proxy on :8080) and over the Cloudflare tunnel.
const AuthRedirect = ({ type }) => {
  useEffect(() => {
    // Use relative path so it resolves correctly under any domain (local or tunnel)
    // The reverse proxy routes /auth/* -> http://localhost:5173
    window.location.replace(`/auth/${type}`);
  }, [type]);

  return (
    <div className="flex flex-col items-center justify-center h-48">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
      <p className="text-gray-400 font-medium">Redirecting to secure authentication...</p>
    </div>
  );
};

export default AuthRedirect;
