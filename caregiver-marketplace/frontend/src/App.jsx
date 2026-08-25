import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MarketplaceLanding from "./pages/MarketplaceLanding";
import CaregiverSearch from "./pages/CaregiverSearch";
import CaregiverProfile from "./pages/CaregiverProfile";
import BookingFlow from "./pages/BookingFlow";
import MyBookings from "./pages/MyBookings";
import PatientMonitor from "./pages/PatientMonitor";
import ReviewPage from "./pages/ReviewPage";

// Route Guard that redirects to the primary Auth Service if no access token exists.
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("access_token");
  if (!token) {
    window.location.href = `${window.location.origin}/auth/login`;
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
        <Route path="/reviews/:id" element={<ReviewPage />} />

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
