import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Shield, MapPin, DollarSign, CheckCircle2, XCircle } from "lucide-react";
import RatingStars from "./RatingStars";
import { verifyCaregiver } from "../services/caregiverApi";

const CaregiverCard = ({ caregiver, isAdmin = false, onVerify }) => {
  const {
    id,
    name,
    profile_photo_url,
    specializations,
    hourly_rate,
    rating = 0.0,
    total_reviews = 0,
    service_area,
    face_verification_status,
  } = caregiver;

  // Optimistic local state so the badge flips instantly after admin action
  const [localStatus, setLocalStatus] = useState(face_verification_status);
  const [actionLoading, setActionLoading] = useState(null); // 'approved' | 'rejected' | null

  const specs = specializations || [];

  const initials = name
    ? name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "CG";

  const isVerified = localStatus === "verified";
  const isRejected = localStatus === "rejected";
  const isPending = !isVerified && !isRejected;

  const handleVerify = async (action) => {
    setActionLoading(action);
    try {
      await verifyCaregiver(id, action);
      const newFaceStatus = action === "approved" ? "verified" : "rejected";
      setLocalStatus(newFaceStatus);
      onVerify && onVerify(id, action);
    } catch (err) {
      console.error("Verify failed:", err);
      alert(err?.response?.data?.detail || "Failed to update caregiver status.");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="glass-panel glass-panel-hover rounded-2xl p-6 flex flex-col justify-between h-full relative overflow-hidden">
      {/* Glow overlay */}
      <div className="absolute -top-12 -right-12 w-24 h-24 bg-primary-500/10 rounded-full blur-2xl pointer-events-none" />

      <div>
        {/* Header: Photo and Verification Status */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            {profile_photo_url ? (
              <img
                src={profile_photo_url}
                alt={name}
                className="w-14 h-14 rounded-xl object-cover border border-slate-700/50"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary-600 to-indigo-700 flex items-center justify-center font-bold text-lg text-white border border-primary-500/30">
                {initials}
              </div>
            )}
            <div>
              <h3 className="font-semibold text-lg text-slate-100 hover:text-primary-400 transition-colors">
                {name}
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <RatingStars rating={rating} size={4} />
                <span className="text-xs text-slate-400 font-medium">
                  ({total_reviews})
                </span>
              </div>
            </div>
          </div>

          {/* Verification Badge */}
          {isVerified ? (
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
              <Shield className="w-3.5 h-3.5" /> Verified
            </span>
          ) : isRejected ? (
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 rounded-full">
              Rejected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
              Pending
            </span>
          )}
        </div>

        {/* Location & Rate Info */}
        <div className="flex flex-col gap-1.5 mb-4 text-sm text-slate-300">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">{service_area || "Not Specified"}</span>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="font-semibold text-slate-100">${hourly_rate || 0}/hr</span>
          </div>
        </div>

        {/* Specializations Badges */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {specs.slice(0, 3).map((spec, i) => (
            <span
              key={i}
              className="text-xs font-medium text-primary-300 bg-primary-950/40 border border-primary-800/30 px-2.5 py-1 rounded-md"
            >
              {spec}
            </span>
          ))}
          {specs.length > 3 && (
            <span className="text-xs font-semibold text-slate-400 bg-slate-800/50 border border-slate-700/30 px-2 py-1 rounded-md">
              +{specs.length - 3} more
            </span>
          )}
          {specs.length === 0 && (
            <span className="text-xs font-medium text-slate-500 italic">
              General Care
            </span>
          )}
        </div>
      </div>

      {/* Admin Approve / Reject buttons (only shown to admins for pending caregivers) */}
      {isAdmin && isPending && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => handleVerify("approved")}
            disabled={!!actionLoading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 transition-all disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {actionLoading === "approved" ? "Approving..." : "Approve"}
          </button>
          <button
            onClick={() => handleVerify("rejected")}
            disabled={!!actionLoading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 transition-all disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" />
            {actionLoading === "rejected" ? "Rejecting..." : "Reject"}
          </button>
        </div>
      )}

      {/* View Profile Button */}
      <Link
        to={`/caregivers/${id}`}
        className="w-full text-center py-2.5 px-4 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-white rounded-xl font-semibold text-sm transition-all duration-300 shadow-md shadow-primary-950/20"
      >
        View Profile
      </Link>
    </div>
  );
};

export default CaregiverCard;
