import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PATHS } from '../routes/paths';

const Navbar = () => {
  const location = useLocation();
  const isActive = (path) => location.pathname === path;

  const navLinkStyle = (path) => 
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive(path) ? 'text-white bg-gray-800' : 'text-gray-300 hover:text-white hover:bg-gray-800/50'
    }`;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900/90 backdrop-blur-md border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          <div className="flex items-center">
            <Link to={PATHS.HOME} className="flex items-center space-x-2">
              <span className="text-2xl">🛡️</span>
              <span className="text-xl font-bold text-white tracking-tight">Secure Eldercare</span>
            </Link>
          </div>
          
          <div className="hidden md:flex items-center space-x-2 bg-gray-950/50 p-1.5 rounded-lg border border-gray-800">
            <Link to={PATHS.HOME} className={navLinkStyle(PATHS.HOME)}>Home</Link>
            <Link to={PATHS.SYSTEM_OVERVIEW} className={navLinkStyle(PATHS.SYSTEM_OVERVIEW)}>Overview</Link>
            <Link to={PATHS.ALERTS} className={navLinkStyle(PATHS.ALERTS)}>Alerts</Link>
            <Link to={PATHS.LIVE_STREAM} className={navLinkStyle(PATHS.LIVE_STREAM)}>Live Stream</Link>
          </div>

          <div className="hidden md:flex items-center space-x-4">
            <Link to={PATHS.LOGIN} className="text-gray-300 hover:text-white px-4 py-2 text-sm font-medium transition">
              Login
            </Link>
            <Link to={PATHS.SIGNUP} className="bg-white text-gray-900 hover:bg-gray-200 px-5 py-2.5 rounded-full text-sm font-bold shadow-lg transition-transform hover:-translate-y-0.5">
              Sign Up
            </Link>
          </div>
          
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
