import { Link, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";

export default function Layout({ children }) {
  const location = useLocation();
  
  const navItems = [
    { name: "Dashboard", path: "/", icon: "📊" },
    { name: "Routine Setup", path: "/routine-setup", icon: "⚙️" },
    { name: "Reports", path: "/reports", icon: "📑" },
  ];

  return (
    <div className="flex h-screen bg-[#030712] text-gray-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0a0f1c] border-r border-gray-800 flex flex-col hidden md:flex z-10 shadow-2xl">
        <div className="p-6">
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500 tracking-tight">
            SecureElderCare
          </h1>
          <p className="text-xs text-gray-500 font-medium mt-1">Schedule Monitoring</p>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 mt-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  isActive 
                    ? "bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-inner" 
                    : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium text-sm">{item.name}</span>
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 m-4 bg-gray-900 rounded-xl border border-gray-800 text-xs text-gray-500 text-center">
          <p>Phase 1 Active</p>
          <p className="mt-1">Real-time ML Detection</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative overflow-y-auto">
        <Toaster position="top-right" toastOptions={{ 
          style: { background: '#1e293b', color: '#fff', border: '1px solid #334155' } 
        }} />
        <div className="absolute top-0 left-0 right-0 h-96 bg-gradient-to-b from-blue-900/10 to-transparent pointer-events-none" />
        <div className="p-8 md:p-12 w-full max-w-7xl mx-auto z-10 animate-fade-in relative">
          {children}
        </div>
      </main>
    </div>
  );
}
