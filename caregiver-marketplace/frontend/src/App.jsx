import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MarketplaceLanding from "./pages/MarketplaceLanding";
import CaregiverSearch from "./pages/CaregiverSearch";
import CaregiverProfile from "./pages/CaregiverProfile";
import BookingFlow from "./pages/BookingFlow";
import MyBookings from "./pages/MyBookings";
import PatientMonitor from "./pages/PatientMonitor";

// Route Guard that redirects to the primary Auth Service (port 5173) if no access token exists.
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) {
    const isProxied = window.location.port === "8080" || window.location.port === "";
    const authUrl = import.meta.env.VITE_AUTH_FRONTEND_URL || "http://localhost:5173";
    const loginUrl = isProxied
      ? "/auth/login"
      : (authUrl.endsWith("/auth") ? `${authUrl}/login` : `${authUrl}/auth/login`);
    window.location.href = loginUrl;
    return null;
  }
  return children;
};



function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<MarketplaceLanding />} />
        <Route path="/caregivers" element={<CaregiverSearch />} />
        <Route path="/caregivers/:id" element={<CaregiverProfile />} />

        {/* Protected Routes */}
        <Route
          path="/book/:id"
          element={
            <ProtectedRoute>
              <BookingFlow />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bookings"
          element={
            <ProtectedRoute>
              <MyBookings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/monitor"
          element={
            <ProtectedRoute>
              <PatientMonitor />
            </ProtectedRoute>
          }
        />

        {/* Fallback Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
