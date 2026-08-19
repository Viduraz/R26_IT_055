/**
 * anomaly-detection/frontend/src/components/Navbar.jsx
 * Shared navigation bar for all anomaly-detection pages.
 */
import { Link, useLocation } from "react-router-dom";

const NAV_LINKS = [
    { to: "/", label: "🖥️ Dashboard" },
    { to: "/history", label: "📋 History" },
    { to: "/model-status", label: "🧠 Model Status" },
];

export default function Navbar() {
    const { pathname } = useLocation();

    return (
        <nav className="sticky top-0 z-40 bg-gray-950/90 backdrop-blur-md border-b border-gray-800">
            <div className="max-w-screen-2xl mx-auto px-5 py-3 flex items-center justify-between">
                {/* Brand */}
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-sm">
                        🛡️
                    </div>
                    <div>
                        <p className="text-sm font-black text-white tracking-tight leading-none">SecureElderCare</p>
                        <p className="text-xs text-gray-500 leading-none mt-0.5">Anomaly Detection</p>
                    </div>
                </div>

                {/* Nav links */}
                <div className="flex items-center gap-1">
                    {NAV_LINKS.map(({ to, label }) => {
                        const isActive = pathname === to || (to !== "/" && pathname.startsWith(to));
                        return (
                            <Link
                                key={to}
                                to={to}
                                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-150 ${isActive
                                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/30"
                                        : "text-gray-400 hover:text-white hover:bg-gray-800"
                                    }`}
                            >
                                {label}
                            </Link>
                        );
                    })}
                </div>

                {/* Status pill */}
                <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Port 8003</span>
                </div>
            </div>
        </nav>
    );
}
