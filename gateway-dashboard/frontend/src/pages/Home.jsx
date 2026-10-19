import React from 'react';
import { Link } from 'react-router-dom';
import { PATHS } from '../routes/paths';
import FeatureCard from '../components/FeatureCard';

// Derive base URL dynamically so it works on localhost AND the Cloudflare tunnel
const BASE = typeof window !== 'undefined' ? window.location.origin : '';

const MODULE_CARDS = [
  { title: "Face Verification", description: "Real-time identity recognition and secure admission control.", icon: "🧑‍💼" },
  { title: "Tracking & Geofencing", description: "Person tracking and designated safe-zone boundary alerts.", icon: "📍" },
  { title: "Anomaly Detection", description: "Pose-based fall and distress anomaly alerts.", icon: "⚠️" },
  { title: "Schedule Monitoring", description: "Daily routine tracking and medication deviations.", icon: "📅" },
  { title: "Gateway Dashboard", description: "Centralized analytical command center for administrators.", icon: "📊" },
];

// Quick-access shortcuts — link directly to sub-service frontends via reverse proxy paths
const SHORTCUT_CARDS = [
  {
    title: "Anomaly Detection",
    description: "Open the live anomaly detection dashboard to monitor falls, distress events, and pose alerts.",
    icon: "⚠️",
    href: `${BASE}/anomaly/`,
    badge: "Live",
  },
  {
    title: "Schedule Monitoring",
    description: "View daily routine tracking, medication schedules, and deviation alerts for residents.",
    icon: "📅",
    href: `${BASE}/schedule/`,
    badge: "Live",
  },
  {
    title: "Tracking & Geofencing",
    description: "Monitor resident locations, geofence boundaries, and safe-zone breach notifications.",
    icon: "📍",
    href: `${BASE}/tracking/`,
    badge: "Live",
  },
  {
    title: "Caregiver Marketplace",
    description: "Browse, book, and manage professional caregivers for elderly residents.",
    icon: "🛍️",
    href: `${BASE}/marketplace/`,
    badge: "New",
  },
  {
    title: "Skeleton Identification",
    description: "Monitor real-time skeleton tracking and biometric identification status.",
    icon: "🦴",
    href: `${BASE}/skeleton/`,
    badge: "Live",
  },
];

const Home = () => {
  return (
    <div className="flex flex-col items-center">
      {/* Hero Section */}
      <section className="w-full relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden border-b border-gray-800">
        {/* Animated Ambient Background */}
        <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[60%] rounded-full bg-indigo-600/30 blur-[120px] animate-pulse" style={{ animationDuration: '6s' }} />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[50%] rounded-full bg-purple-600/30 blur-[140px] animate-pulse" style={{ animationDuration: '8s', animationDelay: '1s' }} />
          <div className="absolute top-[30%] right-[30%] w-[40%] h-[40%] rounded-full bg-blue-500/20 blur-[100px] animate-pulse" style={{ animationDuration: '10s' }} />

          {/* Grid overlay for tech feel */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_70%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-80" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-white mb-6">
            AI-Powered <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
              Elder Care Monitoring Platform
            </span>
          </h1>

          <p className="mt-4 max-w-2xl mx-auto text-xl text-gray-400 mb-10">
            Real-time face verification, seamless tracking, anomaly detection, and
            caregiver safety monitoring.
          </p>

          <div className="flex justify-center gap-4">
            <Link
              to={PATHS.LIVE_STREAM}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-full font-bold shadow-[0_0_20px_rgba(79,70,229,0.4)] transition-all hover:scale-105"
            >
              Open Live Stream
            </Link>
            <Link
              to={PATHS.SIGNUP}
              className="bg-gray-800 hover:bg-gray-700 text-white px-8 py-4 rounded-full font-bold transition-all border border-gray-700 hover:border-gray-600"
            >
              Sign Up First
            </Link>
            <Link
              to={PATHS.LOGIN}
              className="flex items-center text-gray-400 hover:text-white px-6 py-4 font-medium transition-colors"
            >
              Login →
            </Link>
          </div>
        </div>
      </section>

      {/* Quick Access Shortcuts */}
      <section className="w-full max-w-7xl mx-auto py-10 px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">Quick Access</h2>
          <p className="text-gray-400 text-sm">Jump directly to any active service module</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {SHORTCUT_CARDS.map((card, idx) => (
            <FeatureCard key={idx} {...card} />
          ))}
        </div>
      </section>

      {/* Core Platform Services */}
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
