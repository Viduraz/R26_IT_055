import { Link, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useState, useEffect } from "react";

export default function Layout({ children }) {
  const location = useLocation();
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);
  
  const navItems = [
    { name: "Home", path: "/", icon: "🏠" },
    { name: "Dashboard", path: "/dashboard", icon: "📊" },
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

      {/* Theme Toggle Button */}
      <button
        onClick={() => {
          setTheme(theme === "dark" ? "light" : "dark");
        }}
        className="fixed top-6 right-8 z-50 px-4 py-2 rounded-xl border border-gray-800 bg-gray-900/60 hover:bg-gray-800 text-amber-400 hover:text-amber-300 transition duration-300 shadow-lg flex items-center justify-center gap-2 text-xs font-bold hover:scale-105 active:scale-95"
        style={theme === "light" ? { backgroundColor: "#ffffff", borderColor: "#e6dec9", color: "#d97706" } : {}}
        title="Toggle Warm Light Mode"
      >
        {theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode"}
      </button>

      {theme === "light" && (
        <style>{`
          body, .flex.h-screen {
            background-color: #faf6f0 !important;
            color: #3c322a !important;
          }
          aside {
            background-color: #f5efe6 !important;
            border-right-color: #ebdcb9 !important;
          }
          aside h1 {
            background: linear-gradient(to right, #b45309, #d97706) !important;
            -webkit-background-clip: text !important;
            color: transparent !important;
          }
          aside p, aside .text-gray-500, aside .text-gray-400 {
            color: #8c8072 !important;
          }
          aside .hover\\:bg-gray-800\\/50:hover, aside .hover\\:text-gray-200:hover {
            background-color: rgba(217, 119, 6, 0.05) !important;
            color: #b45309 !important;
          }
          aside .bg-blue-600\\/10 {
            background-color: rgba(217, 119, 6, 0.1) !important;
            color: #b45309 !important;
            border-color: rgba(217, 119, 6, 0.2) !important;
          }
          aside .bg-gray-900 {
            background-color: #ffffff !important;
            border-color: #cbd5e1 !important;
            color: #786c5f !important;
          }
          main {
            background-color: #faf6f0 !important;
          }
          /* Card containers across pages */
          .bg-gray-900\\/40, .bg-gray-800\\/20, .bg-gray-800\\/40, .bg-gray-950\\/40, .bg-gray-950\\/30, .border-gray-800, .border-gray-800\\/60, .border-gray-800\\/80, .border-gray-700\\/50, .border-rose-500\\/20, [style*="border"], [style*="background-color: rgba"], [style*="background-color:rgba"] {
            background-color: #ffffff !important;
            border-color: #ebdcb9 !important;
            color: #3c322a !important;
          }
          /* Override hardcoded page backgrounds */
          [style*="#06080f"], [style*="rgb(6, 8, 15)"] {
            background-color: #faf6f0 !important;
            background: #faf6f0 !important;
          }
          /* Neutralize/recolor background glow blobs */
          [style*="radial-gradient"] {
            background: radial-gradient(circle, rgba(217, 119, 6, 0.04) 0%, transparent 70%) !important;
          }
          h1, h2, h3, h4, .text-white, .text-gray-100, .text-gray-200, [style*="color: rgb(255, 255, 255)"], [style*="color: #fff"] {
            color: #2d241e !important;
          }
          p, .text-gray-400 {
            color: #786c5f !important;
          }
          .text-gray-500 {
            color: #8c8072 !important;
          }
          input, select, textarea, [style*="background: rgba"] {
            background-color: #ffffff !important;
            border-color: #cbd5e1 !important;
            color: #3c322a !important;
          }
          .bg-blue-600, .bg-green-600, .bg-indigo-600, [style*="background: rgb(59"] {
            background-color: #d97706 !important;
            color: #ffffff !important;
          }
          .bg-blue-600:hover, .bg-green-600:hover, .bg-indigo-600:hover {
            background-color: #b45309 !important;
          }
          /* Custom overrides for specific metrics cards */
          .text-emerald-400 { color: #16a34a !important; }
          .bg-emerald-500\\/10 { background-color: rgba(22, 163, 74, 0.1) !important; }
          .text-amber-400 { color: #d97706 !important; }
          .bg-amber-500\\/10 { background-color: rgba(217, 119, 6, 0.1) !important; }
          .text-rose-400 { color: #dc2626 !important; }
          .bg-rose-500\\/10 { background-color: rgba(220, 38, 38, 0.1) !important; }
          /* Timeline elements */
          .border-l-2 { border-left-color: #cbd5e1 !important; }
        `}</style>
      )}
    </div>
  );
}
