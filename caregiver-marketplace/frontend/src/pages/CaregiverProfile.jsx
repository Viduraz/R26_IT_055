import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Shield, MapPin, DollarSign, Languages, Calendar, Heart, Award, ArrowLeft, Star, Quote } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import RatingStars from "../components/RatingStars";
import { getCaregiverById, getCaregiverReviews } from "../services/caregiverApi";

const CaregiverProfile = () => {
  const { id } = useParams();
  const [caregiver, setCaregiver] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileData, reviewsData] = await Promise.all([
          getCaregiverById(id),
          getCaregiverReviews(id),
        ]);
        setCaregiver(profileData);
        setReviews(reviewsData);
      } catch (err) {
        console.error("Error loading caregiver profile:", err);
        setError("Failed to load caregiver details. The caregiver might not exist.");
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Navbar />
        <div className="flex-grow flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400 font-semibold">Loading caregiver profile...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (error || !caregiver) {
    return (
      <div className="flex flex-col min-h-screen">
        <Navbar />
        <div className="flex-grow max-w-xl mx-auto px-6 py-20 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-red-950/20 border border-red-500/10 flex items-center justify-center text-red-400 mb-4">
            <Shield className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-300">Profile Unreachable</h2>
          <p className="text-sm text-slate-500 mt-2">{error || "Caregiver profile not found."}</p>
          <Link
            to="/caregivers"
            className="mt-6 flex items-center gap-1.5 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-xl text-white transition-all"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Caregivers
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  const {
    name,
    profile_photo_url,
    bio,
    specializations,
    hourly_rate,
    languages,
    availability,
    service_area,
    rating = 0.0,
    total_reviews = 0,
    face_verification_status,
    contact_number,
    caregiver_license_or_staff_id,
  } = caregiver;

  const specs = specializations || [];
  const langs = languages || [];
  const avail = availability || {};

  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "CG";

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />

      <main className="flex-grow max-w-7xl w-full mx-auto px-6 py-10">
        
        {/* Back Link */}
        <Link
          to="/caregivers"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 mb-8 transition-colors"
        >
          <ArrowLeft className="w-4.5 h-4.5" /> Back to listings
        </Link>

        {/* Dual Column Layout */}
        <div className="grid lg:grid-cols-3 gap-8">
          
          {/* Left Column: Details */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            
            {/* Main Profile Header Box */}
            <div className="glass-panel rounded-2xl p-6 md:p-8 relative overflow-hidden border border-slate-800">
              <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/5 rounded-full blur-3xl pointer-events-none" />

              <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                {profile_photo_url ? (
                  <img
                    src={profile_photo_url}
                    alt={name}
                    className="w-24 h-24 rounded-2xl object-cover border-2 border-slate-800 shrink-0"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-700 flex items-center justify-center font-extrabold text-3xl text-white shrink-0 border border-primary-500/20">
                    {initials}
                  </div>
                )}

                <div className="flex-grow text-center md:text-left">
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 justify-center md:justify-start">
                    <h1 className="text-2xl md:text-3xl font-extrabold text-slate-100">{name}</h1>
                    {face_verification_status === "verified" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full w-fit mx-auto md:mx-0">
                        <Shield className="w-3.5 h-3.5" /> Verified Caregiver
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full w-fit mx-auto md:mx-0">
                        Verification Pending
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-2 justify-center md:justify-start">
                    <RatingStars rating={rating} size={5} />
                    <span className="text-sm font-semibold text-slate-200 mt-0.5">{rating.toFixed(1)}</span>
                    <span className="text-xs text-slate-500 mt-0.5">({total_reviews} reviews)</span>
                  </div>

                  {caregiver_license_or_staff_id && (
                    <p className="text-xs text-slate-500 mt-2 font-medium">
                      Staff / License ID: <span className="text-slate-400 font-mono">{caregiver_license_or_staff_id}</span>
                    </p>
                  )}

                  {/* Micro attributes */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 border-t border-slate-800/80 pt-6">
                    <div className="flex items-center gap-2.5 text-xs text-slate-400">
                      <MapPin className="w-4 h-4 text-primary-400 shrink-0" />
                      <div>
                        <p className="font-bold text-slate-300">Service Area</p>
                        <p className="text-[11px] truncate mt-0.5">{service_area || "Not Specified"}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 text-xs text-slate-400">
                      <DollarSign className="w-4 h-4 text-primary-400 shrink-0" />
                      <div>
                        <p className="font-bold text-slate-300">Hourly Rate</p>
                        <p className="text-[11px] mt-0.5 text-slate-200">${hourly_rate || 0}/hour</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 text-xs text-slate-400 col-span-2 md:col-span-1">
                      <Languages className="w-4 h-4 text-primary-400 shrink-0" />
                      <div>
                        <p className="font-bold text-slate-300">Languages</p>
                        <p className="text-[11px] mt-0.5">{langs.join(", ") || "English"}</p>
                      </div>
                    </div>
                  </div>


                </div>
              </div>
            </div>

            {/* Biography */}
            <div className="glass-panel rounded-2xl p-6 md:p-8 border border-slate-800">
              <h2 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
                <Heart className="w-5 h-5 text-primary-400" /> Biography & Philosophy
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                {bio || `Hi, I am ${name}. I am a dedicated care professional focused on providing secure, compassionate, and attentive assistance to seniors. I work closely with family members to maintain a safe, welcoming home environment, and ensure any specific routine needs are carefully met.`}
              </p>
            </div>

            {/* Qualifications & Specializations */}
            <div className="glass-panel rounded-2xl p-6 md:p-8 border border-slate-800">
              <h2 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
                <Award className="w-5 h-5 text-primary-400" /> Specializations & Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {specs.map((spec, i) => (
                  <span
                    key={i}
                    className="text-xs font-semibold text-primary-300 bg-primary-950/40 border border-primary-800/40 px-3 py-1.5 rounded-lg"
                  >
                    {spec}
                  </span>
                ))}
                {specs.length === 0 && (
                  <p className="text-sm text-slate-500 italic">No specializations explicitly listed.</p>
                )}
              </div>
            </div>

            {/* Client Reviews */}
            <div className="glass-panel rounded-2xl p-6 md:p-8 border border-slate-800">
              <h2 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
                <Star className="w-5 h-5 text-primary-400 fill-primary-400/10" /> Client Reviews ({reviews.length})
              </h2>

              <div className="flex flex-col gap-6">
                {reviews.map((rev, i) => (
                  <div
                    key={i}
                    className="bg-[#0b0f19]/80 border border-slate-800/60 rounded-xl p-5 relative overflow-hidden"
                  >
                    <div className="absolute top-4 right-4 text-slate-800">
                      <Quote className="w-8 h-8 opacity-25" />
                    </div>

                    <div className="flex items-center justify-between gap-4 mb-2">
                      <span className="font-semibold text-sm text-slate-200">{rev.family_name}</span>
                      <RatingStars rating={rev.rating} size={3.5} />
                    </div>

                    <p className="text-xs text-slate-500 mb-3">
                      Posted on {new Date(rev.created_at).toLocaleDateString()}
                    </p>

                    <p className="text-sm text-slate-300 leading-relaxed italic">
                      "{rev.review_text || "Excellent, professional care service provided."}"
                    </p>
                  </div>
                ))}

                {reviews.length === 0 && (
                  <div className="text-center py-8 text-slate-500 italic text-sm">
                    No reviews submitted yet for this caregiver.
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Right Column: Availability & Booking Panel */}
          <div className="lg:col-span-1 flex flex-col gap-8 h-fit lg:sticky lg:top-24">
            
            {/* Booking Card */}
            <div className="glass-panel rounded-2xl p-6 border border-slate-800 relative overflow-hidden">
              <div className="absolute -top-12 -left-12 w-24 h-24 bg-primary-500/10 rounded-full blur-2xl pointer-events-none" />

              <h3 className="font-bold text-lg text-slate-200 mb-4">Book {name}</h3>
              
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-3xl font-extrabold text-white">${hourly_rate || 0}</span>
                <span className="text-xs text-slate-500 font-semibold uppercase">/ hour</span>
              </div>

              <Link
                to={`/book/${id}`}
                className="w-full inline-block text-center py-3 px-4 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-white rounded-xl font-bold text-sm transition-all duration-300 shadow-lg shadow-primary-500/10 mb-4"
              >
                Request Care Booking
              </Link>
              
              <p className="text-[11px] text-center text-slate-500 leading-relaxed">
                Confirming a booking automatically provisions active computer vision camera verification with your unique Patient ID.
              </p>
            </div>

            {/* Weekly Availability Card */}
            <div className="glass-panel rounded-2xl p-6 border border-slate-800">
              <h3 className="font-bold text-sm uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                <Calendar className="w-4.5 h-4.5 text-primary-400" /> Standard Schedule
              </h3>

              <div className="flex flex-col gap-3">
                {Object.entries(avail).map(([day, slot], i) => (
                  <div key={i} className="flex justify-between items-center text-xs py-1.5 border-b border-slate-800/50 last:border-b-0">
                    <span className="capitalize font-semibold text-slate-300">{day}</span>
                    <span className="text-slate-400">
                      {slot.start} - {slot.end}
                    </span>
                  </div>
                ))}

                {Object.keys(avail).length === 0 && (
                  <div className="flex flex-col gap-2 text-xs text-slate-400">
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                      <span className="font-semibold text-slate-300">Mon - Fri</span>
                      <span>08:00 - 17:00</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                      <span className="font-semibold text-slate-300">Saturday</span>
                      <span>09:00 - 15:00</span>
                    </div>
                    <div className="flex justify-between items-center py-1 text-slate-500 italic">
                      <span>Sunday</span>
                      <span>Unavailable</span>
                    </div>
                  </div>
                )}

              </div>
            </div>

          </div>

        </div>

      </main>

      <Footer />
    </div>
  );
};

export default CaregiverProfile;
