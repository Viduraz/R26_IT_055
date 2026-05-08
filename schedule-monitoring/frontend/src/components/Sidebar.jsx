// schedule-monitoring/frontend/src/components/Sidebar.jsx
import { NavLink, useLocation } from "react-router-dom";

const NAV = [
  {
    to: "/",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    to: "/routine-setup",
    label: "Routine Setup",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/notifications",
    label: "Notifications",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
    badge: true,
  },
  {
    to: "/activity-log",
    label: "Activity Log",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 12h6M9 16h4" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Sidebar({ unread = 0 }) {
  return (
    <aside className="fixed left-0 top-0 h-full w-60 bg-gray-900 border-r border-gray-800 flex flex-col z-30">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-5 h-5">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Care Monitor</p>
            <p className="text-gray-500 text-xs">Elder Care System</p>
          </div>
        </div>
      </div>

      {/* Patient chip */}
      <div className="mx-4 mt-4 px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
        <p className="text-indigo-300 text-xs font-medium">Monitoring Patient</p>
        <p className="text-white text-sm font-semibold mt-0.5">Patient 001</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 mt-5 space-y-1">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group ${
                isActive
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`
            }
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {item.badge && unread > 0 && (
              <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-xs flex items-center justify-center font-bold">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-800">
        <p className="text-gray-600 text-xs text-center">Schedule Monitoring v2.0</p>
      </div>
    </aside>
  );
}
