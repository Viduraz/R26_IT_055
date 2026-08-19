/**
 * caregiver-marketplace/frontend/src/pages/ReviewPage.jsx
 * Standalone reviews page for a caregiver — displays submitted reviews
 * and provides an inline form to submit a new one.
 * Route: /reviews/:id
 */
import React, { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { Star, ArrowLeft, MessageSquare, CheckCircle, Loader } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import RatingStars from "../components/RatingStars";
import { getCaregiverById, getCaregiverReviews, submitCaregiverReview } from "../services/caregiverApi";

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
    });
}

function AverageRating({ reviews }) {
    if (!reviews.length) return null;
    const avg = reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length;
    return (
        <div className="flex items-center gap-2">
            <span className="text-4xl font-extrabold text-white font-mono">{avg.toFixed(1)}</span>
            <div className="flex flex-col gap-1">
                <RatingStars rating={avg} size={4} />
                <span className="text-xs text-slate-400">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</span>
            </div>
        </div>
    );
}

// ── Review Card ────────────────────────────────────────────────────────────────
function ReviewCard({ review }) {
    return (
        <div className="glass-panel rounded-2xl p-5 border border-slate-800/80">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <p className="font-semibold text-slate-200 text-sm">
                        {review.family_name || "Anonymous"}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{formatDate(review.created_at)}</p>
                </div>
                <RatingStars rating={review.rating || 0} size={4} />
            </div>
            {review.comment && (
                <p className="text-sm text-slate-400 leading-relaxed">{review.comment}</p>
            )}
        </div>
    );
}

// ── Submit Form ────────────────────────────────────────────────────────────────
function ReviewForm({ caregiverId, onSuccess }) {
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    const hasToken = !!localStorage.getItem("access_token");

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (rating === 0) { setError("Please select a rating."); return; }
        if (!hasToken) {
            const authUrl = import.meta.env.VITE_AUTH_FRONTEND_URL || "http://localhost:5173";
            window.location.href = `${authUrl}/auth/login`;
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            await submitCaregiverReview({ caregiver_user_id: caregiverId, rating, comment });
            onSuccess();
            setRating(0);
            setComment("");
        } catch (err) {
            setError(err?.response?.data?.detail || "Failed to submit review. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="glass-panel rounded-2xl p-6 border border-slate-800/80">
            <h3 className="font-bold text-slate-200 mb-4 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary-400" />
                Write a Review
            </h3>

            <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Your Rating</p>
                <RatingStars rating={rating} size={7} interactive onChange={setRating} />
            </div>

            <div className="mb-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Comments (optional)
                </label>
                <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                    maxLength={600}
                    placeholder="Share your experience with this caregiver..."
                    className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:border-primary-500/50 placeholder:text-slate-600 resize-none"
                />
                <p className="text-xs text-slate-600 mt-1 text-right">{comment.length}/600</p>
            </div>

            {error && (
                <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/20 rounded-xl px-4 py-2 mb-4">
                    {error}
                </p>
            )}

            {!hasToken && (
                <p className="text-xs text-slate-400 mb-3">
                    You need to <Link to="/login" className="text-primary-400 underline">sign in</Link> to submit a review.
                </p>
            )}

            <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-6 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all text-sm"
            >
                {submitting ? (
                    <><Loader className="w-4 h-4 animate-spin" /> Submitting...</>
                ) : (
                    <><Star className="w-4 h-4 fill-current" /> Submit Review</>
                )}
            </button>
        </form>
    );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
const ReviewPage = () => {
    const { id } = useParams();
    const [caregiver, setCaregiver] = useState(null);
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [submitted, setSubmitted] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [cgData, rvData] = await Promise.all([
                getCaregiverById(id),
                getCaregiverReviews(id),
            ]);
            setCaregiver(cgData);
            setReviews(Array.isArray(rvData) ? rvData : []);
        } catch (err) {
            setError("Could not load reviews. The caregiver may not exist.");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleReviewSuccess = () => {
        setSubmitted(true);
        fetchData(); // reload reviews
        setTimeout(() => setSubmitted(false), 4000);
    };

    return (
        <div className="flex flex-col min-h-screen">
            <Navbar />

            <main className="flex-grow max-w-5xl w-full mx-auto px-6 py-10">

                {/* Back link */}
                <Link
                    to={`/caregivers/${id}`}
                    className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-8 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" /> Back to Profile
                </Link>

                {loading ? (
                    <div className="flex items-center justify-center py-24 gap-3">
                        <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-slate-400 text-sm font-semibold">Loading reviews...</p>
                    </div>
                ) : error ? (
                    <div className="glass-panel border border-red-500/20 text-red-400 p-8 rounded-2xl text-center">
                        <p>{error}</p>
                    </div>
                ) : (
                    <div className="grid lg:grid-cols-3 gap-8">

                        {/* Left — summary + form */}
                        <div className="lg:col-span-1 flex flex-col gap-6">
                            {/* Caregiver mini-card */}
                            {caregiver && (
                                <div className="glass-panel rounded-2xl p-5 border border-slate-800/80">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                                        Reviews for
                                    </p>
                                    <p className="font-extrabold text-lg text-white">{caregiver.name || "Caregiver"}</p>
                                    {caregiver.specialization && (
                                        <p className="text-xs text-primary-400 mt-1">{caregiver.specialization}</p>
                                    )}
                                    <div className="mt-4">
                                        <AverageRating reviews={reviews} />
                                    </div>
                                </div>
                            )}

                            {/* Submit-success banner */}
                            {submitted && (
                                <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-sm px-4 py-3 rounded-xl">
                                    <CheckCircle className="w-4 h-4 shrink-0" />
                                    <span>Your review was submitted!</span>
                                </div>
                            )}

                            <ReviewForm caregiverId={id} onSuccess={handleReviewSuccess} />
                        </div>

                        {/* Right — review list */}
                        <div className="lg:col-span-2">
                            <h2 className="text-xl font-bold text-slate-100 mb-5">
                                {reviews.length === 0 ? "No Reviews Yet" : `${reviews.length} Review${reviews.length !== 1 ? "s" : ""}`}
                            </h2>

                            {reviews.length === 0 ? (
                                <div className="glass-panel rounded-2xl p-12 border border-slate-800/60 text-center">
                                    <Star className="w-10 h-10 text-slate-700 mx-auto mb-4" />
                                    <p className="text-slate-500 text-sm">
                                        No reviews have been submitted yet. Be the first!
                                    </p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-4">
                                    {reviews.map((review, i) => (
                                        <ReviewCard key={review._id || i} review={review} />
                                    ))}
                                </div>
                            )}
                        </div>

                    </div>
                )}
            </main>

            <Footer />
        </div>
    );
};

export default ReviewPage;
