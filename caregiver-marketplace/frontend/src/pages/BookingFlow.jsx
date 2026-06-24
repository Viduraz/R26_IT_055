import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Calendar, User, Heart, Shield, CheckCircle, Copy, Check, DollarSign } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { getCaregiverById } from "../services/caregiverApi";
import { createBooking } from "../services/bookingApi";

const BookingFlow = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [caregiver, setCaregiver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Flow Step: 1 (Elder Profile), 2 (Schedule), 3 (Confirm & Summary), 4 (Success Screen)
  const [step, setStep] = useState(1);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Success response placeholder
  const [bookingResult, setBookingResult] = useState(null);

  // Form Fields
  // Step 1: Elder Profile
  const [elderName, setElderName] = useState("");
  const [elderAge, setElderAge] = useState("");
  const [elderGender, setElderGender] = useState("male");
  const [elderAddress, setElderAddress] = useState("");
  const [mobility, setMobility] = useState("Needs Assistance");
  const [conditions, setConditions] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactNumber, setEmergencyContactNumber] = useState("");

  // Step 2: Schedule
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedDays, setSelectedDays] = useState([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [notes, setNotes] = useState("");

  // Step 3: Notification Options
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [familyPhone, setFamilyPhone] = useState("");

  const daysOfWeek = [
    { label: "Mon", value: "monday" },
    { label: "Tue", value: "tuesday" },
    { label: "Wed", value: "wednesday" },
    { label: "Thu", value: "thursday" },
    { label: "Fri", value: "friday" },
    { label: "Sat", value: "saturday" },
    { label: "Sun", value: "sunday" },
  ];

  useEffect(() => {
    const loadCaregiver = async () => {
      setLoading(true);
      try {
        const data = await getCaregiverById(id);
        setCaregiver(data);
      } catch (err) {
        console.error("Error loading caregiver for booking:", err);
        setError("Caregiver profile could not be retrieved.");
      } finally {
        setLoading(false);
      }
    };
    loadCaregiver();
  }, [id]);

  // Calculate Estimations
  const getEstimation = () => {
    if (!caregiver) return { hours: 0, cost: 0 };
    
    // Days per week
    const daysCount = selectedDays.length || 1;
    
    // Hours per day
    let hoursPerDay = 8;
    try {
      const [startH, startM] = startTime.split(":").map(Number);
      const [endH, endM] = endTime.split(":").map(Number);
      hoursPerDay = (endH + endM / 60) - (startH + startM / 60);
      if (hoursPerDay <= 0) hoursPerDay = 8;
    } catch (e) {}

    const totalHours = hoursPerDay * daysCount * 4; // 4 weeks estimate
    const totalCost = totalHours * (caregiver.hourly_rate || 0);
    return {
      hours: Math.round(totalHours * 10) / 10,
      cost: Math.round(totalCost * 100) / 100,
    };
  };

  const { hours: estimatedHours, cost: estimatedCost } = getEstimation();

  const handleDayToggle = (day) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter((d) => d !== day));
    } else {
      setSelectedDays([...selectedDays, day]);
    }
  };

  const handleNext = () => {
    if (step === 1) {
      if (!elderName || !elderAge || !elderAddress || !emergencyContactName || !emergencyContactNumber) {
        alert("Please fill in all required elder details.");
        return;
      }
    } else if (step === 2) {
      if (!startDate || !endDate || selectedDays.length === 0) {
        alert("Please specify start/end dates and select at least one care day.");
        return;
      }
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload = {
      caregiver_user_id: id,
      elder: {
        name: elderName,
        age: parseInt(elderAge),
        gender: elderGender,
        address: elderAddress,
        mobility: mobility,
        medical_conditions: conditions.split(",").map((c) => c.trim()).filter(Boolean),
        care_needs: [],
        emergency_contact_name: emergencyContactName,
        emergency_contact_number: emergencyContactNumber,
      },
      schedule: {
        start_date: startDate,
        end_date: endDate,
        days: selectedDays,
        start_time: startTime,
        end_time: endTime,
      },
      notes: notes,
      notify_email: notifyEmail,
      notify_sms: notifySms,
      family_phone: notifySms ? familyPhone : undefined,
    };

    try {
      const response = await createBooking(payload);
      setBookingResult(response);
      setStep(4); // Show success screen
    } catch (err) {
      console.error("Booking failed:", err);
      setError(err.response?.data?.detail || "Failed to submit booking. Check backend settings.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (bookingResult?.patient_id) {
      navigator.clipboard.writeText(bookingResult.patient_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Navbar />
        <div className="flex-grow flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400 font-semibold">Configuring care provider booking details...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (error && step !== 4) {
    return (
      <div className="flex flex-col min-h-screen">
        <Navbar />
        <div className="flex-grow max-w-xl mx-auto px-6 py-20 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-red-950/20 border border-red-500/10 flex items-center justify-center text-red-400 mb-4">
            <Shield className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-300">Booking Blocked</h2>
          <p className="text-sm text-slate-500 mt-2">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-6 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-xl text-white transition-all"
          >
            Retry Form
          </button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />

      <main className="flex-grow max-w-3xl w-full mx-auto px-6 py-10">
        {step < 4 && (
          <button
            onClick={() => step === 1 ? navigate(`/caregivers/${id}`) : handleBack()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> {step === 1 ? "Back to profile" : "Back to previous step"}
          </button>
        )}

        {/* Form Steps Header */}
        {step < 4 && (
          <div className="mb-10">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">
              <span className={step >= 1 ? "text-primary-400" : ""}>1. Elder Profile</span>
              <span className={step >= 2 ? "text-primary-400" : ""}>2. Schedule</span>
              <span className={step >= 3 ? "text-primary-400" : ""}>3. Summary & Options</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden flex">
              <div className={`h-full bg-primary-600 transition-all duration-300 ${
                step === 1 ? "w-1/3" : step === 2 ? "w-2/3" : "w-full"
              }`} />
            </div>
          </div>
        )}

        {/* Step 1: Elder Profile */}
        {step === 1 && (
          <div className="glass-panel rounded-2xl p-6 md:p-8 border border-slate-800 flex flex-col gap-6">
            <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-3">
              <User className="w-5 h-5 text-primary-400" /> Elder Recipient Profile
            </h2>

            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={elderName}
                  onChange={(e) => setElderName(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50 placeholder:text-slate-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Age *
                  </label>
                  <input
                    type="number"
                    required
                    placeholder="e.g. 78"
                    value={elderAge}
                    onChange={(e) => setElderAge(e.target.value)}
                    className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50 placeholder:text-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Gender *
                  </label>
                  <select
                    value={elderGender}
                    onChange={(e) => setElderGender(e.target.value)}
                    className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Home Address *
              </label>
              <input
                type="text"
                required
                placeholder="Street address where care will take place"
                value={elderAddress}
                onChange={(e) => setElderAddress(e.target.value)}
                className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50 placeholder:text-slate-600"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Mobility Level *
                </label>
                <select
                  value={mobility}
                  onChange={(e) => setMobility(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50"
                >
                  <option value="Independent">Independent</option>
                  <option value="Needs Assistance">Needs Assistance</option>
                  <option value="Wheelchair Bound">Wheelchair Bound</option>
                  <option value="Bedridden">Bedridden</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Medical Conditions (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Hypertension, Dementia, Diabetes"
                  value={conditions}
                  onChange={(e) => setConditions(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50 placeholder:text-slate-600"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Emergency Contact Person *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Emergency contact name"
                  value={emergencyContactName}
                  onChange={(e) => setEmergencyContactName(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50 placeholder:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Emergency Phone Number *
                </label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. +1 555-0199"
                  value={emergencyContactNumber}
                  onChange={(e) => setEmergencyContactNumber(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary-500/50 placeholder:text-slate-600"
                />
              </div>
            </div>

            <button
              onClick={handleNext}
              className="mt-4 py-3 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-xl text-sm transition-all"
            >
              Continue to Schedule Selection
            </button>
          </div>
        )}

        {/* Step 2: Schedule */}
        {step === 2 && (
          <div className="glass-panel rounded-2xl p-6 md:p-8 border border-slate-800 flex flex-col gap-6">
            <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Calendar className="w-5 h-5 text-primary-400" /> Care Schedule & Shift Times
            </h2>

            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Start Date *
                </label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-primary-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  End Date *
                </label>
                <input
                  type="date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-primary-500/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Days Required * (select all that apply)
              </label>
              <div className="flex flex-wrap gap-2">
                {daysOfWeek.map((day) => {
                  const isChecked = selectedDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => handleDayToggle(day.value)}
                      className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all ${
                        isChecked
                          ? "bg-primary-600/30 text-primary-300 border-primary-500/50"
                          : "bg-[#0d121f] text-slate-400 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Shift Start Time *
                </label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-primary-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Shift End Time *
                </label>
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-primary-500/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Special Care Notes & Instructions
              </label>
              <textarea
                placeholder="Provide notes on diet, mobility preferences, habits, or emergency guidance..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-[#0d121f] text-slate-200 text-sm border border-slate-800 rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-primary-500/50 h-28 resize-none placeholder:text-slate-600"
              />
            </div>

            <button
              onClick={handleNext}
              className="mt-4 py-3 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-xl text-sm transition-all"
            >
              Continue to Booking Summary
            </button>
          </div>
        )}

        {/* Step 3: Summary & Preferences */}
        {step === 3 && (
          <form onSubmit={handleSubmit} className="glass-panel rounded-2xl p-6 md:p-8 border border-slate-800 flex flex-col gap-6">
            <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Heart className="w-5 h-5 text-primary-400" /> Confirm Booking details
            </h2>

            {/* Provider brief */}
            <div className="bg-[#0b0f19]/80 border border-slate-800/80 p-4 rounded-xl flex items-center justify-between text-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-primary-600 to-indigo-700 flex items-center justify-center text-white font-bold">
                  {caregiver?.name[0]}
                </div>
                <div>
                  <p className="font-bold text-slate-200">{caregiver?.name}</p>
                  <p className="text-xs text-slate-500">Professional Care Provider</p>
                </div>
              </div>
              <p className="font-bold text-primary-400">${caregiver?.hourly_rate || 0}/hr</p>
            </div>

            {/* Calculation summary */}
            <div className="border border-slate-800 bg-[#0d121f]/50 rounded-xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Cost breakdown estimate</h3>
              <div className="flex justify-between text-sm py-1">
                <span className="text-slate-400">Total estimated care hours (monthly)</span>
                <span className="font-semibold text-slate-200">{estimatedHours} hrs</span>
              </div>
              <div className="flex justify-between text-sm py-1 border-b border-slate-800/50 pb-3">
                <span className="text-slate-400">Caregiver rate</span>
                <span className="font-semibold text-slate-200">${caregiver?.hourly_rate}/hr</span>
              </div>
              <div className="flex justify-between items-baseline pt-4">
                <span className="text-sm font-bold text-slate-300">Total Estimated Cost (4 weeks)</span>
                <span className="text-2xl font-extrabold text-primary-400">${estimatedCost}</span>
              </div>
            </div>

            {/* Notification Delivery Preferences */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Patient ID Delivery Channels</h3>
              
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 cursor-pointer p-3 border border-slate-800 rounded-xl hover:bg-[#0d121f]/30">
                  <input
                    type="checkbox"
                    checked={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.checked)}
                    className="w-4.5 h-4.5 rounded border-slate-800 text-primary-600 focus:ring-primary-500 bg-[#0b0f19]"
                  />
                  <div>
                    <p className="text-xs font-bold text-slate-200">Email Notification</p>
                    <p className="text-[10px] text-slate-500">Delivers booking summary and Patient ID to your registered email.</p>
                  </div>
                </label>

                <label className="flex flex-col gap-2 p-3 border border-slate-800 rounded-xl hover:bg-[#0d121f]/30 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={notifySms}
                      onChange={(e) => setNotifySms(e.target.checked)}
                      className="w-4.5 h-4.5 rounded border-slate-800 text-primary-600 focus:ring-primary-500 bg-[#0b0f19]"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-200">SMS Notification (Twilio)</p>
                      <p className="text-[10px] text-slate-500">Delivers Patient ID to your mobile phone number.</p>
                    </div>
                  </div>
                  
                  {notifySms && (
                    <input
                      type="tel"
                      required={notifySms}
                      placeholder="e.g. +15551234567"
                      value={familyPhone}
                      onChange={(e) => setFamilyPhone(e.target.value)}
                      className="w-full mt-2 bg-[#0b0f19] text-slate-200 text-xs border border-slate-800 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary-500"
                    />
                  )}
                </label>
              </div>
            </div>

            {error && (
              <p className="text-xs font-semibold text-red-400 bg-red-950/20 border border-red-500/15 p-3 rounded-lg">
                Error: {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="py-3 px-4 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 disabled:from-primary-800 disabled:to-indigo-800 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-primary-500/10"
            >
              {submitting ? "Booking care provider..." : "Confirm & Book Caregiver"}
            </button>
          </form>
        )}

        {/* Step 4: Success View (Provisioned Patient ID) */}
        {step === 4 && bookingResult && (
          <div className="glass-panel rounded-3xl p-8 md:p-12 border border-slate-800 text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

            <div className="w-16 h-16 rounded-full bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-6">
              <CheckCircle className="w-10 h-10" />
            </div>

            <h1 className="text-3xl font-extrabold text-slate-100">Care Booking Confirmed!</h1>
            <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
              Your session with <strong>{bookingResult.caregiver_name}</strong> is scheduled. 
              We have provisioned your active monitoring ID.
            </p>

            {/* Patient ID Code Block */}
            <div className="my-10 max-w-md mx-auto border border-slate-800/80 bg-[#0d121f] rounded-2xl p-6 relative overflow-hidden">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Your Patient ID</span>
              
              <div className="flex items-center justify-center gap-4 mt-3">
                <span className="text-3xl md:text-4xl font-black text-primary-400 tracking-wider font-mono select-all">
                  {bookingResult.patient_id}
                </span>
                
                <button
                  onClick={handleCopy}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all border border-slate-700/60"
                  title="Copy Patient ID"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              {copied && <span className="text-[10px] text-emerald-400 font-bold block mt-2 animate-pulse">Copied to clipboard!</span>}
            </div>

            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed mb-10">
              {bookingResult.message || "Your Patient ID has been sent. Connect this ID inside the Live Monitoring page to audit camera feeds."}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-sm mx-auto">
              <Link
                to="/monitor"
                className="w-full py-3 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-white font-semibold rounded-xl text-sm transition-all"
              >
                Go to Live Monitor
              </Link>
              <Link
                to="/bookings"
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-sm border border-slate-700/60 transition-all"
              >
                View My Bookings
              </Link>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default BookingFlow;
