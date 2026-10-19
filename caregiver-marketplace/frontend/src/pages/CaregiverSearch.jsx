import React, { useState, useEffect } from "react";
import { Search, SlidersHorizontal, UserCheck, Star, Sparkles } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import CaregiverCard from "../components/CaregiverCard";
import { searchCaregivers } from "../services/caregiverApi";

// Decode the JWT stored in localStorage to check if the current user is admin.
function getJwtRole() {
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload?.role || null;
  } catch {
    return null;
  }
}

const CaregiverSearch = () => {
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const isAdmin = getJwtRole() === "admin";

  // Filter States
  const [specialization, setSpecialization] = useState("");
  const [minRating, setMinRating] = useState("");
  const [maxRate, setMaxRate] = useState("");
  const [serviceArea, setServiceArea] = useState("");

  const specializationsList = [
    "Dementia Care",
    "Alzheimer's Care",
    "Mobility Assistance",
    "Stroke Recovery",
    "Medication Management",
    "Palliative Care",
    "Meal Preparation",
    "Physical Therapy",
  ];

  const fetchCaregivers = async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {};
      if (specialization) filters.specialization = specialization;
      if (minRating) filters.min_rating = parseFloat(minRating);
      if (maxRate) filters.max_hourly_rate = parseFloat(maxRate);
      if (serviceArea) filters.service_area = serviceArea;

      const data = await searchCaregivers(filters);
      setCaregivers(data);
    } catch (err) {
      console.error("Error fetching caregivers:", err);
      setError("Failed to load caregivers. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCaregivers();
  }, [specialization, minRating, maxRate, serviceArea]);

  const handleClearFilters = () => {
    setSpecialization("");
    setMinRating("");
    setMaxRate("");
    setServiceArea("");
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />

      <main className="flex-grow max-w-7xl w-full mx-auto px-6 py-10">

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              Verified Caregivers
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Select qualifications and book expert assistance integrated with camera verification.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-primary-400 bg-primary-950/40 border border-primary-800/30 px-3 py-1.5 rounded-lg w-fit">
            <Sparkles className="w-3.5 h-3.5 text-primary-400" />
            <span>Real-time availability loaded</span>
          </div>
        </div>

        {/* Search Panel & Grid */}
        <div className="grid lg:grid-cols-4 gap-8">

          {/* Filters Panel */}
          <div className="lg:col-span-1 glass-panel rounded-2xl p-6 h-fit shrink-0 border border-slate-800">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-4 mb-6">
              <span className="font-semibold text-slate-200 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary-400" /> Filter Criteria
              </span>
              {(specialization || minRating || maxRate || serviceArea) && (
                <button
                  onClick={handleClearFilters}
                  className="text-xs text-primary-400 hover:text-primary-300 font-semibold"
                >
                  Clear All
                </button>
              )}
            </div>

            <div className="flex flex-col gap-5">

              {/* Specialization Filter */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Specialization
                </label>
                <select
                  value={specialization}
                  onChange={(e) => setSpecialization(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50"
                >
                  <option value="">All Specialities</option>
                  {specializationsList.map((spec, i) => (
                    <option key={i} value={spec}>
                      {spec}
                    </option>
                  ))}
                </select>
              </div>

              {/* Service Area Filter */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Location / Area
                </label>
                <input
                  type="text"
                  placeholder="e.g. Downtown, Uptown"
                  value={serviceArea}
                  onChange={(e) => setServiceArea(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50 placeholder:text-slate-600"
                />
              </div>

              {/* Hourly Rate Filter */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Max Hourly Rate ($)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 50"
                  value={maxRate}
                  onChange={(e) => setMaxRate(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50 placeholder:text-slate-600"
                />
              </div>

              {/* Rating Filter */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Minimum Rating
                </label>
                <select
                  value={minRating}
                  onChange={(e) => setMinRating(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50"
                >
                  <option value="">Any Rating</option>
                  <option value="4.5">4.5★ & up</option>
                  <option value="4.0">4.0★ & up</option>
                  <option value="3.5">3.5★ & up</option>
                </select>
              </div>

            </div>
          </div>

          {/* Caregivers Grid */}
          <div className="lg:col-span-3">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-400 font-semibold">Searching available caregivers...</p>
              </div>
            ) : error ? (
              <div className="glass-panel border border-red-500/20 text-red-400 p-6 rounded-2xl text-center">
                {error}
              </div>
            ) : caregivers.length === 0 ? (
              <div className="glass-panel border border-slate-800/80 p-12 rounded-2xl text-center flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-4 text-slate-500">
                  <UserCheck className="w-8 h-8" />
                </div>
                <h3 className="font-bold text-lg text-slate-300">No Caregivers Match Filters</h3>
                <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
                  Try clearing or adjusting your search filters to view profiles.
                </p>
                <button
                  onClick={handleClearFilters}
                  className="mt-6 px-5 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-xl text-white transition-all"
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
                {caregivers.map((caregiver) => (
                  <div key={caregiver.id} className="h-full">
                    <CaregiverCard
                      caregiver={caregiver}
                      isAdmin={isAdmin}
                      onVerify={() => fetchCaregivers()}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </main>

      <Footer />
    </div>
  );
};

export default CaregiverSearch;
