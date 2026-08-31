import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LogOut, Home, Calendar, Monitor, Search, User } from "lucide-react";

const Navbar = () => {
  const location = useLocation();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        setUser({
          id: payload.sub || payload.id,
          email: payload.email,
          role: payload.role || "user",
          name: payload.name || payload.email?.split("@")[0],
        });
      } catch (err) {
        console.error("Failed to parse JWT token in Navbar", err);
      }
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    const isProxied = window.location.port === "8080" || window.location.port === "";
    const authUrl = import.meta.env.VITE_AUTH_FRONTEND_URL || "http://localhost:5173";
    const loginUrl = isProxied
      ? "/auth/login"
      : (authUrl.endsWith("/auth") ? `${authUrl}/login` : `${authUrl}/auth/login`);
    window.location.href = loginUrl;
  };

  const gatewayUrl = import.meta.env.VITE_GATEWAY_FRONTEND_URL || "http://localhost:5178";

  const isActive = (path) => location.pathname === path;

  return (
    <nav className="glass-panel border-b border-slate-800 sticky top-0 z-50 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-2">
          <span className="text-2xl font-extrabold bg-gradient-to-r from-primary-400 to-indigo-400 bg-clip-text text-transparent">
            🛡️ SecureElderCare
          </span>
          <span className="text-[10px] tracking-widest font-bold uppercase text-primary-400 bg-primary-950/80 px-2 py-0.5 rounded border border-primary-800/30">
            Marketplace
          </span>
        </Link>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center gap-6">
          <Link
            to="/caregivers"
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
              isActive("/caregivers") ? "text-primary-400" : "text-slate-300 hover:text-white"
            }`}
          >
            <Search className="w-4 h-4" /> Find Caregivers
          </Link>
          <Link
            to="/bookings"
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
              isActive("/bookings") ? "text-primary-400" : "text-slate-300 hover:text-white"
            }`}
          >
            <Calendar className="w-4 h-4" /> Bookings
          </Link>
          <Link
            to="/monitor"
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
              isActive("/monitor") ? "text-primary-400" : "text-slate-300 hover:text-white"
            }`}
          >
            <Monitor className="w-4 h-4" /> Live Monitoring
          </Link>
        </div>

        {/* User Options */}
        <div className="flex items-center gap-4">
          <a
            href={gatewayUrl}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700/50 hover:bg-slate-800/50 transition-all text-slate-300 hover:text-white"
          >
            <Home className="w-3.5 h-3.5" /> Back to Dashboard
          </a>

          {user ? (
            <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
              <div className="hidden lg:block text-right">
                <p className="text-xs font-semibold text-slate-200">{user.name}</p>
                <p className="text-[10px] uppercase font-bold text-primary-400 tracking-wider">
                  {user.role}
                </p>
              </div>
              
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg bg-red-950/20 hover:bg-red-950/40 text-red-400 border border-red-500/10 hover:border-red-500/20 transition-all"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <a
              href={
                (window.location.port === "8080" || window.location.port === "")
                  ? "/auth/login"
                  : `${import.meta.env.VITE_AUTH_FRONTEND_URL || "http://localhost:5173"}${
                      (import.meta.env.VITE_AUTH_FRONTEND_URL || "http://localhost:5173").endsWith("/auth") ? "" : "/auth"
                    }/login`
              }
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-primary-600 hover:bg-primary-500 rounded-lg text-white transition-all"
            >

              <User className="w-3.5 h-3.5" /> Login
            </a>
          )}

        </div>
      </div>
    </nav>
  );
};

export default Navbar;
