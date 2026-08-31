import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PATHS } from '../routes/paths';

const Navbar = () => {
  const location = useLocation();
  const isActive = (path) => location.pathname === path;
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        setUser({
          email: payload.email || "",
          role: payload.role || "admin",
          name: payload.name || payload.email?.split("@")[0] || "User",
        });
      } catch (err) {
        console.error("Failed to parse JWT token in Navbar", err);
      }
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    window.location.href = `${window.location.origin}/auth/login`;
  };

  const navLinkStyle = (path) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive(path) ? 'text-white bg-gray-800' : 'text-gray-300 hover:text-white hover:bg-gray-800/50'
    }`;

  const getProfileLink = () => {
    if (!user) return PATHS.HOME;
    const r = user.role.toLowerCase();
    if (r === 'admin') return PATHS.ADMIN_DASHBOARD;
    if (r === 'caregiver') return PATHS.CAREGIVER_DASHBOARD;
    return PATHS.FAMILY_DASHBOARD;
  };

  // First letter avatar colour based on name
  const avatarLetter = user?.name?.[0]?.toUpperCase() || "?";

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
            {user ? (
              <div className="flex items-center gap-4">
                <Link to={getProfileLink()} className="flex items-center gap-3 pr-4 border-r border-gray-800 group hover:opacity-80 transition cursor-pointer">
                  <div className="w-8 h-8 rounded-full bg-indigo-600 group-hover:bg-indigo-500 transition-colors flex items-center justify-center text-white text-sm font-bold shadow-lg">
                    {avatarLetter}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors leading-tight">{user.name}</span>
                    <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider leading-tight">{user.role}</span>
                  </div>
                </Link>
                <button
                  onClick={handleLogout}
                  className="text-gray-400 hover:text-white text-sm font-medium transition flex items-center gap-1.5 bg-gray-800/50 hover:bg-gray-800 px-3 py-1.5 rounded-md border border-gray-700/50 hover:border-gray-600/50"
                  title="Logout"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                  <span>Logout</span>
                </button>
              </div>
            ) : (
              <>
                <Link to={PATHS.LOGIN} className="text-gray-300 hover:text-white px-4 py-2 text-sm font-medium transition">
                  Login
                </Link>
                <Link to={PATHS.SIGNUP} className="bg-white text-gray-900 hover:bg-gray-200 px-5 py-2.5 rounded-full text-sm font-bold shadow-lg transition-transform hover:-translate-y-0.5">
                  Sign Up
                </Link>
              </>
            )}
          </div>

        </div>
      </div>
    </nav>
  );
};

export default Navbar;
