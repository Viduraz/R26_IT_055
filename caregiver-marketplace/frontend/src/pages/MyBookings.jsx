import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Calendar, User, Phone, Mail, Clock, ShieldAlert, Check, Copy, RefreshCw, Star, Trash2, HelpCircle } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import RatingStars from "../components/RatingStars";
import { listBookings, cancelBooking, resendPatientId } from "../services/bookingApi";
import { submitCaregiverReview } from "../services/caregiverApi";

const MyBookings = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userRole, setUserRole] = useState("user");

  // Review Modal States
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState(null);

  // Resend ID states
  const [resendingId, setResendingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const fetchBookings = async () => {
    setLoading(true);
    setError(null);
    try {
      // Decode user role from access token
      const token = localStorage.getItem("access_token");
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          setUserRole(payload.role || "user");
        } catch (e) {}
      }

      const data = await listBookings();
      setBookings(data);
    } catch (err) {
      console.error("Error loading bookings:", err);
      setError("Failed to fetch bookings list. Make sure the backend service is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const handleCancel = async (bookingId) => {
    if (!window.confirm("Are you sure you want to cancel this caregiver booking? This will revoke the Patient ID.")) {
      return;
    }

    try {
      await cancelBooking(bookingId);
      alert("Booking cancelled successfully.");
      fetchBookings();
    } catch (err) {
      console.error("Cancellation failed:", err);
      alert(err.response?.data?.detail || "Could not cancel booking.");
    }
  };

  const handleResendId = async (bookingId, notify_sms = false) => {
    setResendingId(bookingId);
    try {
      await resendPatientId(bookingId, { via_email: true, via_sms: notify_sms });
      alert("Patient ID delivery re-triggered successfully.");
    } catch (err) {
      console.error("Resending Patient ID failed:", err);
      alert("Failed to resend Patient ID notification.");
    } finally {
      setResendingId(null);
    }
  };

  const openReviewModal = (booking) => {
    setSelectedBooking(booking);
    setRating(5);
    setReviewText("");
    setReviewError(null);
    setShowReviewModal(true);
  };

  const closeReviewModal = () => {
    setShowReviewModal(false);
    setSelectedBooking(null);
  };

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    setReviewSubmitting(true);
    setReviewError(null);

    try {
      await submitCaregiverReview({
        booking_id: selectedBooking.booking_id,
        rating: rating,
        review_text: reviewText,
      });
      alert("Thank you for your feedback! Review submitted successfully.");
      closeReviewModal();
      fetchBookings();
    } catch (err) {
      console.error("Review submission failed:", err);
      setReviewError(err.response?.data?.detail || "Could not save review.");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleCopy = (patientId, bId) => {
    navigator.clipboard.writeText(patientId);
    setCopiedId(bId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />

      <main className="flex-grow max-w-5xl w-full mx-auto px-6 py-10">
        
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
            {userRole === "caregiver" ? "My Care Shifts" : "My Caregiver Bookings"}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {userRole === "caregiver"
              ? "View schedules, patient IDs, and details of your booked elder care placements."
              : "Track booking statuses, fetch Patient IDs, trigger email reminders, and rate caregiver sessions."}
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400 font-semibold font-mono">Querying caregiver transactions...</p>
          </div>
        ) : error ? (
          <div className="glass-panel border border-red-500/20 text-red-400 p-6 rounded-2xl text-center">
            {error}
          </div>
        ) : bookings.length === 0 ? (
          <div className="glass-panel border border-slate-800/80 p-12 rounded-2xl text-center flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-4 text-slate-500">
              <Calendar className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-lg text-slate-300">No Bookings Found</h3>
            <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
              {userRole === "caregiver"
                ? "You haven't been booked by any family member yet."
                : "You don't have any caregiver schedules confirmed."}
            </p>
            {userRole !== "caregiver" && (
              <Link
                to="/caregivers"
                className="mt-6 px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-sm font-semibold rounded-xl text-white transition-all"
              >
                Find & Book Caregiver
              </Link>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {bookings.map((booking) => {
              const {
                booking_id,
                patient_id,
                status,
                caregiver_name,
                family_name,
                family_phone,
                family_email,
                elder = {},
                schedule = {},
                hourly_rate,
                total_amount,
                notes,
                created_at,
              } = booking;

              const isConfirmed = status === "confirmed";

              return (
                <div
                  key={booking_id}
                  className="glass-panel rounded-2xl p-6 border border-slate-800/80 flex flex-col gap-5 relative overflow-hidden"
                >
                  {/* Status Badge */}
                  <div className="absolute top-6 right-6">
                    <span
                      className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full border ${
                        isConfirmed
                          ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                          : "text-red-400 bg-red-500/10 border-red-500/20"
                      }`}
                    >
                      {status}
                    </span>
                  </div>

                  {/* Booking ID & Date */}
                  <div className="border-b border-slate-800 pb-3">
                    <p className="text-xs text-slate-500 font-medium">
                      Booking: <span className="text-slate-300 font-mono font-semibold">{booking_id}</span>
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Created on {new Date(created_at).toLocaleDateString()}
                    </p>
                  </div>

                  {/* Main Details */}
                  <div className="grid md:grid-cols-3 gap-6">
                    {/* Column 1: People */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Placement info
                      </h4>
                      {userRole === "caregiver" ? (
                        <div className="text-sm text-slate-300 flex flex-col gap-1">
                          <p className="font-semibold text-slate-200">Booked by: {family_name}</p>
                          <p className="text-xs flex items-center gap-1.5 text-slate-400">
                            <Phone className="w-3.5 h-3.5" /> {family_phone || "No phone listed"}
                          </p>
                          <p className="text-xs flex items-center gap-1.5 text-slate-400">
                            <Mail className="w-3.5 h-3.5" /> {family_email || "No email listed"}
                          </p>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-300 flex flex-col gap-1">
                          <p className="font-semibold text-slate-200">👩‍⚕️ Caregiver: {caregiver_name}</p>
                          <p className="text-xs text-slate-400 mt-1">Rate: ${hourly_rate}/hr</p>
                          <p className="text-xs font-bold text-primary-400">Total Est: ${total_amount}</p>
                        </div>
                      )}
                    </div>

                    {/* Column 2: Elder & Health context */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                        👴 Elder Patient
                      </h4>
                      <div className="text-sm text-slate-300">
                        <p className="font-semibold text-slate-200">
                          {elder.name} ({elder.age} yrs, {elder.gender})
                        </p>
                        <p className="text-xs text-slate-400 mt-1">Mobility: {elder.mobility}</p>
                        {elder.medical_conditions?.length > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5 truncate">
                            Conditions: {elder.medical_conditions.join(", ")}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Column 3: Schedule */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                        📅 Schedule & Hours
                      </h4>
                      <div className="text-sm text-slate-300 flex flex-col gap-1">
                        <p className="font-semibold flex items-center gap-1.5 text-slate-200">
                          <Clock className="w-3.5 h-3.5 text-slate-400" /> {schedule.start_time} - {schedule.end_time}
                        </p>
                        <p className="text-xs text-slate-400">
                          Days: <span className="capitalize">{schedule.days?.slice(0, 3).join(", ")}</span>
                          {schedule.days?.length > 3 && "..."}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {schedule.start_date} to {schedule.end_date}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Notes & Patient ID banner */}
                  <div className="bg-[#0d121f]/50 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 mt-2">
                    <div className="flex-grow">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Patient ID</p>
                      {isConfirmed ? (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-lg font-bold font-mono text-primary-400 tracking-wider">
                            {patient_id}
                          </span>
                          <button
                            onClick={() => handleCopy(patient_id, booking_id)}
                            className="p-1 rounded bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50"
                            title="Copy ID"
                          >
                            {copiedId === booking_id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {copiedId === booking_id && (
                            <span className="text-[9px] text-emerald-400 font-bold ml-1">Copied!</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-red-400 font-semibold block mt-1.5 flex items-center gap-1">
                          <ShieldAlert className="w-3.5 h-3.5" /> Patient ID Revoked (Cancelled)
                        </span>
                      )}
                    </div>

                    {/* Actions Panel */}
                    {userRole !== "caregiver" && isConfirmed && (
                      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        {/* Resend ID Button */}
                        <button
                          onClick={() => handleResendId(booking_id)}
                          disabled={resendingId === booking_id}
                          className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-slate-300 border border-slate-700/50 flex items-center gap-1.5 transition-all"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${resendingId === booking_id && "animate-spin"}`} /> Resend ID
                        </button>

                        {/* Review Button */}
                        <button
                          onClick={() => openReviewModal(booking)}
                          className="px-3.5 py-1.5 bg-primary-650 hover:bg-primary-600 text-xs font-semibold rounded-lg text-white border border-primary-500/20 flex items-center gap-1.5 transition-all"
                        >
                          <Star className="w-3.5 h-3.5 fill-white/10" /> Rate Provider
                        </button>

                        {/* Cancel Button */}
                        <button
                          onClick={() => handleCancel(booking_id)}
                          className="px-3.5 py-1.5 bg-red-950/20 hover:bg-red-950/40 text-xs font-semibold rounded-lg text-red-400 border border-red-500/10 hover:border-red-500/20 flex items-center gap-1.5 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Cancel Booking
                        </button>
                      </div>
                    )}

                    {/* Caregiver Actions view */}
                    {userRole === "caregiver" && isConfirmed && (
                      <Link
                        to="/monitor"
                        className="px-4 py-2 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-xs font-semibold rounded-xl text-white flex items-center gap-1.5 transition-all w-fit"
                      >
                        Launch Monitor
                      </Link>
                    )}
                  </div>

                  {notes && (
                    <div className="text-xs border-l-2 border-primary-500/30 pl-3 py-1 text-slate-400 italic">
                      Special instruction: {notes}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}

      </main>

      {/* Review Modal */}
      {showReviewModal && selectedBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/75 backdrop-blur-sm">
          <div className="glass-panel border border-slate-800 rounded-3xl p-6 md:p-8 max-w-md w-full relative">
            <h2 className="text-xl font-bold text-slate-200 mb-2">Rate {selectedBooking.caregiver_name}</h2>
            <p className="text-xs text-slate-400 mb-6">
              Share your feedback regarding booking {selectedBooking.booking_id}. Your rating will affect their public reputation profile.
            </p>

            <form onSubmit={handleReviewSubmit} className="flex flex-col gap-5">
              {/* Star selector */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Overall Rating
                </label>
                <RatingStars rating={rating} size={8} interactive onChange={(val) => setRating(val)} />
              </div>

              {/* Review Text */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Review comments
                </label>
                <textarea
                  required
                  placeholder="e.g. Caregiver was exceptionally attentive, arrived right on schedule, and kept us fully updated throughout."
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50 h-28 resize-none placeholder:text-slate-600"
                />
              </div>

              {reviewError && (
                <p className="text-xs font-semibold text-red-400 bg-red-950/20 border border-red-500/15 p-3 rounded-lg">
                  Error: {reviewError}
                </p>
              )}

              <div className="flex gap-3 justify-end mt-4">
                <button
                  type="button"
                  onClick={closeReviewModal}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reviewSubmitting}
                  className="px-4 py-2 bg-primary-650 hover:bg-primary-600 disabled:bg-primary-800 text-xs font-semibold rounded-lg text-white"
                >
                  {reviewSubmitting ? "Submitting review..." : "Submit Review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
};

export default MyBookings;
