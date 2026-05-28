// auth-service/frontend/src/pages/Login.jsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { loginUser, loginWithFace } from "../services/authApi";
import FaceLoginStep from "../components/FaceLoginStep";

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requiresFaceAuth, setRequiresFaceAuth] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleInitialLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await loginUser(form.email, form.password);
      // Validated instantly (admin or family)
      localStorage.setItem("access_token", data.access_token);
      window.location.href = `http://localhost:5178/auth-callback?token=${data.access_token}`;
    } catch (err) {
      const errorMsg = err.response?.data?.detail;
      if (errorMsg === "Caregivers must use the face verification login endpoint.") {
        // Valid email/password for Caregiver. Transition to webcam step.
        setRequiresFaceAuth(true);
      } else {
        setError(errorMsg || "Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFaceVerify = async (liveFaceSample, liveSkeletonSample) => {
    setError("");
    setLoading(true);
    try {
      const data = await loginWithFace(form.email, form.password, liveFaceSample, liveSkeletonSample);
      localStorage.setItem("access_token", data.access_token);
      window.location.href = `http://localhost:5178/auth-callback?token=${data.access_token}`;
    } catch (err) {
      setError(err.response?.data?.detail || "Biometric verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] p-10 w-full max-w-md">
        
        {!requiresFaceAuth ? (
          <>
            <h1 className="text-3xl font-bold text-white mb-2 text-center">Welcome Back</h1>
            <p className="text-gray-400 text-center mb-8">Sign in to Secure Elder Care</p>
          </>
        ) : (
          <h1 className="text-2xl font-bold text-indigo-400 mb-8 text-center flex items-center justify-center gap-2">
            Biometric Security
          </h1>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-400 rounded-lg p-3 mb-6 text-sm text-center">
            {error}
          </div>
        )}

        {!requiresFaceAuth ? (
          <form onSubmit={handleInitialLogin} className="space-y-5 animate-fade-in">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                required
                className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 transition"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Password</label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                required
                className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 transition"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold rounded-lg py-3 transition mt-2 shadow-lg shadow-indigo-500/20"
            >
              {loading ? "Verifying Credentials…" : "Sign In"}
            </button>
            <div className="mt-6 text-center space-y-2">
              <Link to="/forgot-password" className="text-sm text-gray-500 hover:text-indigo-400 hover:underline block transition">
                Forgot password?
              </Link>
              <p className="text-sm text-gray-500">
                Don't have an account?{" "}
                <Link to="/signup" className="text-indigo-400 hover:underline transition">
                  Sign up
                </Link>
              </p>
            </div>
          </form>
        ) : (
          <FaceLoginStep 
            onVerify={handleFaceVerify} 
            loading={loading}
            onCancel={() => setRequiresFaceAuth(false)} 
          />
        )}

      </div>
    </div>
  );
}
