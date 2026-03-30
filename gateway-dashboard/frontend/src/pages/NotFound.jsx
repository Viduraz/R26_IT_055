import React from 'react';
import { Link } from 'react-router-dom';
import { PATHS } from '../routes/paths';

const NotFound = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#030712] text-gray-100 p-4">
      <h1 className="text-6xl font-bold text-indigo-500 mb-4">404</h1>
      <h2 className="text-2xl font-semibold mb-6">Page Not Found</h2>
      <p className="text-gray-400 mb-8 max-w-md text-center">
        The section of the Secure Eldercare platform you are looking for does not exist or has been moved.
      </p>
      <Link to={PATHS.HOME} className="px-6 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-white font-medium transition-colors">
        Return to Home Node
      </Link>
    </div>
  );
};

export default NotFound;
