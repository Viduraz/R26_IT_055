import React from "react";
import { Link } from "react-router-dom";
import { Shield, Search, Calendar, Heart, Eye, ArrowRight } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

const MarketplaceLanding = () => {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />

      <main className="flex-grow max-w-7xl w-full mx-auto px-6 py-12 md:py-20 flex flex-col justify-center">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-400 text-xs font-semibold uppercase tracking-wider mb-6">
            <Heart className="w-4 h-4 text-primary-400" /> Human Care Meets AI Security
          </div>
          
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent leading-tight">
            Find the Perfect Caregiver, Monitored by AI.
          </h1>
          
          <p className="text-lg text-slate-400 mb-8 leading-relaxed">
            SecureElderCare merges dedicated, professional caregiving with active computer vision safety. Book certified care providers and view real-time safety feeds directly in your portal.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/caregivers"
              className="w-full sm:w-auto flex items-center justify-center gap-2 py-3 px-8 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-primary-500/20"
            >
              <Search className="w-5 h-5" /> Find Caregivers <ArrowRight className="w-4 h-4" />
            </Link>
            
            <Link
              to="/monitor"
              className="w-full sm:w-auto flex items-center justify-center gap-2 py-3 px-8 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl border border-slate-700/60 transition-all"
            >
              <Eye className="w-5 h-5 text-slate-300" /> Monitor with Patient ID
            </Link>
          </div>
        </div>

        {/* How It Works Section */}
        <div className="mb-20">
          <h2 className="text-2xl md:text-3xl font-bold text-center text-slate-100 mb-12">
            How SecureElderCare Works
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="glass-panel rounded-2xl p-6 relative">
              <div className="w-12 h-12 rounded-xl bg-primary-500/10 border border-primary-500/30 flex items-center justify-center text-primary-400 font-bold mb-4">
                1
              </div>
              <h3 className="font-semibold text-lg text-slate-200 mb-2">Search & Match</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Filter verified caregivers by availability, services, hourly rates, and customer ratings. Review deep credentials and certifications.
              </p>
            </div>

            {/* Step 2 */}
            <div className="glass-panel rounded-2xl p-6 relative">
              <div className="w-12 h-12 rounded-xl bg-primary-500/10 border border-primary-500/30 flex items-center justify-center text-primary-400 font-bold mb-4">
                2
              </div>
              <h3 className="font-semibold text-lg text-slate-200 mb-2">Book with Patient ID</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Provide essential medical context and schedules. Confirm the booking to automatically generate a unique Patient ID, delivered to you instantly.
              </p>
            </div>

            {/* Step 3 */}
            <div className="glass-panel rounded-2xl p-6 relative">
              <div className="w-12 h-12 rounded-xl bg-primary-500/10 border border-primary-500/30 flex items-center justify-center text-primary-400 font-bold mb-4">
                3
              </div>
              <h3 className="font-semibold text-lg text-slate-200 mb-2">24/7 AI-Backed Care</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Our active ML monitoring models verify patient safety, identify falls or pose anomalies, and alert you immediately when deviations happen.
              </p>
            </div>
          </div>
        </div>

        {/* Feature Highlights */}
        <div className="glass-panel rounded-3xl p-8 md:p-12 grid md:grid-cols-2 gap-8 items-center border border-slate-800">
          <div>
            <h2 className="text-3xl font-extrabold text-slate-100 mb-6 leading-tight">
              Safety Redefined: Active Monitoring Ecosystem
            </h2>
            
            <p className="text-slate-400 text-sm md:text-base leading-relaxed mb-8">
              We do not just find you a helper; we build a digital safety net. When a caregiver is booked, you gain access to our computer vision framework.
            </p>

            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg shrink-0 border border-emerald-500/20 text-emerald-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">Identity & Face Verification</h4>
                  <p className="text-xs text-slate-400 mt-1">Caregivers check-in using facial verification endpoints, securing session integrity.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="p-2 bg-primary-500/10 rounded-lg shrink-0 border border-primary-500/20 text-primary-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">Pose Anomaly & Fall Detection</h4>
                  <p className="text-xs text-slate-400 mt-1">Camera frames are parsed locally to track postures and raise instant alerts for falls.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="p-2 bg-indigo-500/10 rounded-lg shrink-0 border border-indigo-500/20 text-indigo-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">GPS Geofencing & Schedule Auditing</h4>
                  <p className="text-xs text-slate-400 mt-1">Alerts trigger if patient zones are breached or caregiver shifts deviate from schedule.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-center">
            {/* Visual indicator mockup */}
            <div className="relative w-full max-w-sm h-80 rounded-2xl bg-gradient-to-br from-indigo-950 to-slate-950 border border-slate-800 p-6 flex flex-col justify-between overflow-hidden shadow-2xl">
              <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
              
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Stream</span>
                <span className="flex items-center gap-1.5 text-xs text-red-500 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" /> LIVE
                </span>
              </div>

              <div className="my-auto py-8 text-center">
                <p className="text-4xl font-extrabold text-white tracking-widest font-mono">PT-2026-X7</p>
                <p className="text-xs text-slate-400 mt-2">Active Session Connected</p>
              </div>

              <div className="glass-panel rounded-xl p-3 border border-slate-700/30 flex items-center justify-between text-xs">
                <span className="text-slate-300">Posture Status</span>
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/20 font-semibold uppercase">
                  Normal (Standing)
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default MarketplaceLanding;
