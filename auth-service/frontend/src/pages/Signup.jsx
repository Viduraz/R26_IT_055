import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { registerUser } from "../services/authApi";
import FaceEnrollmentStep from "../components/FaceEnrollmentStep";

export default function Signup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", email: "", password: "", role: "family_member",
    id_number: "", contact_number: "", date_of_birth: "", gender: "Male",
    permanent_address: "", office_address: "",
    relationship_to_elder: "", emergency_contact_name: "", emergency_contact_number: "",
    caregiver_license_or_staff_id: ""
  });

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleNextStep = (e) => {
    e.preventDefault();
    if (form.role === "caregiver") {
      setStep(2);
    } else {
      submitRegistration(form);
    }
  };

  const handleFaceEnrollmentComplete = (faceSamples) => {
    const finalPayload = { ...form, face_samples: faceSamples };
    submitRegistration(finalPayload);
  };

  const submitRegistration = async (payload) => {
    setError("");
    setLoading(true);
    try {
      await registerUser(payload);
      navigate("/login");
    } catch (err) {
      setError(err.response?.data?.detail || "Registration failed. Please try again.");
      setStep(1); // Go back to form if error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 py-12 px-4 sm:px-6 lg:px-8">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-8 w-full max-w-2xl">
        <h1 className="text-3xl font-bold text-white mb-2 text-center">Create Account</h1>
        <p className="text-gray-400 text-center mb-8">Join Secure Elder Care</p>

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-400 rounded-lg p-3 mb-6 text-sm text-center">
            {error}
          </div>
        )}

        {step === 1 && (
          <form onSubmit={handleNextStep} className="space-y-6">
            {/* Split Grid for dense forms */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Role</label>
                <select name="role" value={form.role} onChange={handleChange} className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500">
                  <option value="family_member">Family Member</option>
                  <option value="caregiver">Caregiver</option>
                  <option value="admin">System Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Full Name</label>
                <input type="text" name="name" value={form.name} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input type="email" name="email" value={form.email} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input type="password" name="password" value={form.password} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
              </div>

              {/* Dynamic Role Fields */}
              {(form.role === "family_member" || form.role === "caregiver") && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">ID / Passport Number</label>
                    <input type="text" name="id_number" value={form.id_number} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Contact Number</label>
                    <input type="tel" name="contact_number" value={form.contact_number} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Date of Birth</label>
                    <input type="date" name="date_of_birth" value={form.date_of_birth} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500 [color-scheme:dark]"/>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Gender</label>
                    <select name="gender" value={form.gender} onChange={handleChange} className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500">
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-400 mb-1">Permanent Address</label>
                    <input type="text" name="permanent_address" value={form.permanent_address} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Relationship to Elder</label>
                    <input type="text" name="relationship_to_elder" value={form.relationship_to_elder} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Emergency Contact Number</label>
                    <input type="tel" name="emergency_contact_number" value={form.emergency_contact_number} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                </>
              )}

              {form.role === "caregiver" && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Emergency Contact Name</label>
                    <input type="text" name="emergency_contact_name" value={form.emergency_contact_name} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Caregiver License / Staff ID</label>
                    <input type="text" name="caregiver_license_or_staff_id" value={form.caregiver_license_or_staff_id} onChange={handleChange} className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                </>
              )}

              {form.role === "admin" && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Admin ID</label>
                    <input type="text" name="id_number" value={form.id_number} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Contact Number</label>
                    <input type="tel" name="contact_number" value={form.contact_number} onChange={handleChange} required className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-400 mb-1">Office Address</label>
                    <input type="text" name="office_address" value={form.office_address} onChange={handleChange} className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500"/>
                  </div>
                </>
              )}

            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold rounded-lg py-3 mt-4 transition"
            >
              {loading ? "Creating account…" : form.role === "caregiver" ? "Proceed to Face Enrollment" : "Create Account"}
            </button>
          </form>
        )}

        {step === 2 && form.role === "caregiver" && (
          <FaceEnrollmentStep onComplete={handleFaceEnrollmentComplete} />
        )}

        {step === 1 && (
          <p className="mt-6 text-center text-sm text-gray-500">
            Already have an account?{" "}
            <Link to="/login" className="text-indigo-400 hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
