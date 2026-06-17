import { useApp } from '../context/AppContext';

const TAB_TITLES = {
  live:     'Live Identification',
  enroll:   'User Enrollment',
  users:    'Enrolled Users',
  training: 'Model Training',
  stats:    'System Statistics',
};

export default function Navbar({ fps }) {
  const { activeTab, systemOnline } = useApp();

  return (
    <header className="
      h-16 flex items-center justify-between
      px-6 border-b border-white/5
      bg-dark-800/40 backdrop-blur-md
      sticky top-0 z-10
    ">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">
          {TAB_TITLES[activeTab]}
        </h1>
        {activeTab === 'live' && fps > 0 && (
          <span className="
            px-2 py-0.5 rounded-md text-xs font-mono font-medium
            bg-cyan-500/15 text-cyan-400 border border-cyan-500/20
          ">
            {fps} FPS
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* API Docs link */}
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-cyan-400 transition-colors"
        >
          API Docs ↗
        </a>

        {/* System health badge */}
        <div className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border
          ${systemOnline
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
          }
        `}>
          <span className={`w-1.5 h-1.5 rounded-full ${systemOnline ? 'bg-emerald-400 status-dot-online' : 'bg-rose-400'}`} />
          {systemOnline ? 'System Online' : 'Disconnected'}
        </div>
      </div>
    </header>
  );
}
