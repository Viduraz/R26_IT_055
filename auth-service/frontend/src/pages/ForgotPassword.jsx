// auth-service/frontend/src/pages/ForgotPassword.jsx
import { useState } from "react";
import { Link } from "react-router-dom";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // TODO: call password reset API
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-10 w-full max-w-md">
        <h1 className="text-3xl font-bold text-white mb-2 text-center">Reset Password</h1>
        <p className="text-gray-400 text-center mb-8">Enter your email to receive a reset link</p>
        {sent ? (
          <p className="text-green-400 text-center">Reset link sent! Check your inbox.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 transition"
              placeholder="you@example.com"
            />
            <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg py-3 transition">
              Send Reset Link
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-gray-500">
          <Link to="/login" className="text-blue-400 hover:underline">← Back to Login</Link>
        </p>
      </div>
    </div>
  );
}
