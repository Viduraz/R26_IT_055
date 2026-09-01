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
              Schedule Monitoring
            </div>
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

    </div>
  );
}