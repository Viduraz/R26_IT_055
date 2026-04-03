import React from 'react';
import { Link } from 'react-router-dom';
import { PATHS } from '../routes/paths';
import FeatureCard from '../components/FeatureCard';

const MODULE_CARDS = [
  { title: "Face Verification", description: "Real-time identity recognition and secure admission control.", icon: "🧑‍💼" },
  { title: "Tracking & Geofencing", description: "Person tracking and designated safe-zone boundary alerts.", icon: "📍" },
  { title: "Anomaly Detection", description: "Pose-based fall and distress anomaly alerts.", icon: "⚠️" },
  { title: "Schedule Monitoring", description: "Daily routine tracking and medication deviations.", icon: "📅" },
  { title: "Gateway Dashboard", description: "Centralized analytical command center for administrators.", icon: "📊" },
];

const Home = () => {
  return (
    <div className="flex flex-col items-center">
      {/* Hero Section embedded cleanly */}
      <section className="w-full text-center py-20 md:py-32 px-4 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-indigo-900/30 to-transparent blur-[80px] rounded-full pointer-events-none" />
        
        <div className="relative z-10 max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tight mb-6">
            AI-Powered <br className="hidden md:block" />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">
              Elder Care Monitoring Platform
            </span>
          </h1>
          <p className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Real-time face verification, seamless tracking, anomaly detection, and caregiver safety monitoring.
          </p>
          
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link to={PATHS.LIVE_STREAM} className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-semibold transition-all shadow-[0_0_20px_rgba(79,70,229,0.3)]">
              Open Live Stream
            </Link>
            <Link to={PATHS.SIGNUP} className="px-8 py-3.5 bg-gray-800 hover:bg-gray-700 text-white border border-gray-700 rounded-full font-semibold transition-colors">
              Sign Up First
            </Link>
            <Link to={PATHS.LOGIN} className="px-8 py-3.5 text-gray-300 hover:text-white transition-colors flex items-center justify-center font-medium">
              Login →
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="w-full max-w-7xl mx-auto py-16 px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-4">Core Platform Services</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {MODULE_CARDS.map((mod, idx) => (
            <FeatureCard key={idx} {...mod} />
          ))}
        </div>
      </section>
    </div>
  );
};

export default Home;
