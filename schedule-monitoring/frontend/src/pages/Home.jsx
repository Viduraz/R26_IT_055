import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();
  return (
    <div className="w-full pb-20">
      {/* Hero Section */}
      <div className="mb-10 animate-slide-up">
        <div className="flex flex-col lg:flex-row gap-8 items-center bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="flex-1 relative z-10">
            <div className="inline-block px-3 py-1 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold rounded-full mb-4 uppercase tracking-widest">
              AI-Powered Monitoring
            </div>
            <h1 className="text-4xl lg:text-5xl font-extrabold text-white tracking-tight mb-4">
              SecureElder<span className="text-blue-500">Care</span>
            </h1>
            <p className="text-gray-400 text-sm lg:text-base leading-relaxed mb-8 max-w-xl">
              A professional schedule monitoring system designed to seamlessly track daily routines without compromising comfort. 
              Using advanced computer vision, the system monitors activities in real-time, alerts caregivers of deviations or missed activities, 
              and ensures the ongoing well-being of the elderly.
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => navigate("/dashboard")}
                className="px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-300 shadow-lg flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30 hover:shadow-blue-900/50"
              >
                Go to Dashboard →
              </button>
            </div>
          </div>
          <div className="w-full lg:w-5/12 relative z-10 flex justify-center">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
              <img 
                src={`${import.meta.env.BASE_URL}system-overview.png`} 
                alt="System Overview" 
                className="relative rounded-2xl shadow-2xl border border-gray-700/50 w-full max-w-sm lg:max-w-md transform transition duration-500 hover:scale-[1.02]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* System Capabilities Section */}
      <div className="mb-12 animate-slide-up" style={{ animationDelay: "0.1s" }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white tracking-tight">System Capabilities</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl overflow-hidden hover:-translate-y-1 transition duration-300 hover:shadow-xl hover:shadow-blue-900/20 group">
            <div className="h-48 overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 to-transparent z-10"></div>
              <img src={`${import.meta.env.BASE_URL}feature1.png`} alt="Activity Detection" className="w-full h-full object-cover object-top group-hover:scale-105 transition duration-500" />
            </div>
            <div className="p-6 relative z-20 -mt-8">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400 shadow-lg border border-blue-500/30 backdrop-blur-md">👁️</span>
                <h3 className="text-lg font-bold text-white">Live Detection</h3>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                Uses advanced computer vision to monitor activities like eating, walking, and reading in real-time, ensuring routines are followed safely.
              </p>
            </div>
          </div>
          <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl overflow-hidden hover:-translate-y-1 transition duration-300 hover:shadow-xl hover:shadow-rose-900/20 group">
            <div className="h-48 overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 to-transparent z-10"></div>
              <img src={`${import.meta.env.BASE_URL}feature2.png`} alt="Smart Alerts" className="w-full h-full object-cover object-top group-hover:scale-105 transition duration-500" />
            </div>
            <div className="p-6 relative z-20 -mt-8">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-400 shadow-lg border border-rose-500/30 backdrop-blur-md">🔔</span>
                <h3 className="text-lg font-bold text-white">Smart Alerts</h3>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                Instantly notifies caregivers if a scheduled activity is missed or delayed, providing peace of mind and allowing for a rapid response.
              </p>
            </div>
          </div>
          <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-2xl overflow-hidden hover:-translate-y-1 transition duration-300 hover:shadow-xl hover:shadow-purple-900/20 group">
            <div className="h-48 overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 to-transparent z-10"></div>
              <img src={`${import.meta.env.BASE_URL}feature3.png`} alt="Routine Setup" className="w-full h-full object-cover object-top group-hover:scale-105 transition duration-500" />
            </div>
            <div className="p-6 relative z-20 -mt-8">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400 shadow-lg border border-purple-500/30 backdrop-blur-md">📅</span>
                <h3 className="text-lg font-bold text-white">Routine Planner</h3>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                Easily plan out daily schedules, therapies, and medication times to ensure elderly individuals maintain a healthy, structured lifestyle.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}