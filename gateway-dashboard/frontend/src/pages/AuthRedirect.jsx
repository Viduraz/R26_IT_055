import React, { useEffect } from 'react';
import { EXTERNAL_AUTH_URL } from '../routes/paths';

// Cleanly handles Option B cross-microservice auth redirection
const AuthRedirect = ({ type }) => {
  useEffect(() => {
    // Replaces browser history so the "Back" button functions natively 
    // without trapping the user in a redirect loop
    window.location.replace(`${EXTERNAL_AUTH_URL}/${type}`);
  }, [type]);

  return (
    <div className="flex flex-col items-center justify-center h-48">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
      <p className="text-gray-400 font-medium">Redirecting to secure authentication...</p>
    </div>
  );
};

export default AuthRedirect;
