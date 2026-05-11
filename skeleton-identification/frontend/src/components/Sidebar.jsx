import { useApp } from '../context/AppContext';
import { useState, useEffect } from 'react';

const NAV_ITEMS = [
  {
    id: 'live',
    label: 'Live Feed',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="23 7 16 12 23 17 23 7"/>
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
      </svg>
    ),
  },
  {
    id: 'enroll',
    label: 'Enroll',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="8.5" cy="7" r="4"/>
        <line x1="20" y1="8" x2="20" y2="14"/>
        <line x1="23" y1="11" x2="17" y2="11"/>
      </svg>
    ),
  },
  {
    id: 'users',
    label: 'Users',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    id: 'training',
    label: 'Training',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    id: 'stats',
    label: 'Statistics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
  },
];

export default function Sidebar() {
  const { activeTab, setActiveTab, systemOnline, wsConnected } = useApp();
  const [isLightMode, setIsLightMode] = useState(false);

  useEffect(() => {
    const savedMode = localStorage.getItem('theme-mode');
    if (savedMode === 'light') {
      setIsLightMode(true);
      document.body.classList.add('light-mode');
    }
  }, []);

  const toggleTheme = () => {
    setIsLightMode((prev) => {
      const next = !prev;
      if (next) {
        document.body.classList.add('light-mode');
        localStorage.setItem('theme-mode', 'light');
      } else {
        document.body.classList.remove('light-mode');
        localStorage.setItem('theme-mode', 'dark');
      }
      return next;
    });
  };

  return (
    <aside className="
      w-64 flex-shrink-0 h-screen sticky top-0
      bg-dark-800/80 backdrop-blur-xl
      border-r border-white/5
      flex flex-col
    ">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-white/5">
        <div className="
          w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-600
          flex items-center justify-center shadow-glow-cyan flex-shrink-0
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <circle cx="12" cy="5" r="2"/>
            <line x1="12" y1="7" x2="12" y2="15"/>
            <line x1="12" y1="10" x2="8" y2="14"/>
            <line x1="12" y1="10" x2="16" y2="14"/>
            <line x1="12" y1="15" x2="9" y2="21"/>
            <line x1="12" y1="15" x2="15" y2="21"/>
          </svg>
        </div>
        <div>
          <div className="text-sm font-bold text-gradient-cyan tracking-wide">SkeletonID</div>
          <div className="text-xs text-slate-500">Person Identification</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`nav-item ${activeTab === item.id ? 'nav-item-active' : ''}`}
          >
            <span className={activeTab === item.id ? 'text-cyan-400' : 'text-slate-500'}>
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Theme Toggle */}
      <div className="px-4 py-2 mt-auto">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 px-4 py-2 w-full rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all text-sm font-medium"
        >
          {isLightMode ? (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
              Dark Mode
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
              Light Mode
            </>
          )}
        </button>
      </div>

      {/* Footer — connection status */}
      <div className="px-4 py-4 border-t border-white/5 space-y-2">
        <StatusRow
          label="System"
          online={systemOnline}
        />
        <StatusRow
          label="WebSocket"
          online={wsConnected}
          connectingLabel="Streaming"
        />
      </div>
    </aside>
  );
}

function StatusRow({ label, online, connectingLabel }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`flex items-center gap-1.5 font-medium ${online ? 'text-emerald-400' : 'text-slate-500'}`}>
        <span className={`status-dot ${online ? 'status-dot-online' : 'status-dot-offline'}`} />
        {online ? (connectingLabel || 'Connected') : 'Offline'}
      </span>
    </div>
  );
}
