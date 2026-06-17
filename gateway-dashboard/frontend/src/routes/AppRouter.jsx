import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PATHS } from './paths';

import MainLayout from '../layouts/MainLayout';
import AuthLayout from '../layouts/AuthLayout';

import ProtectedRoute from './ProtectedRoute';
import PublicRoute from './PublicRoute';

import Home from '../pages/Home';
import LiveStream from '../pages/LiveStream';
import SystemOverview from '../pages/SystemOverview';
import AlertsCenter from '../pages/AlertsCenter';
import AuthRedirect from '../pages/AuthRedirect';
import AuthCallback from '../pages/AuthCallback';
import AdminDashboard from '../pages/AdminDashboard';
import AdminUsers from '../pages/AdminUsers';
import CaregiverDashboard from '../pages/CaregiverDashboard';
import FamilyDashboard from '../pages/FamilyDashboard';
import NotFound from '../pages/NotFound';

const AppRouter = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path={PATHS.HOME} element={<Home />} />
          <Route path={PATHS.LIVE_STREAM} element={<LiveStream />} />
          <Route path={PATHS.SYSTEM_OVERVIEW} element={<ProtectedRoute><SystemOverview /></ProtectedRoute>} />
          <Route path={PATHS.ALERTS} element={<ProtectedRoute><AlertsCenter /></ProtectedRoute>} />
          
          {/* Role Based Dashboards */}
          <Route path={PATHS.ADMIN_DASHBOARD} element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
          <Route path={PATHS.ADMIN_USERS} element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
          <Route path={PATHS.CAREGIVER_DASHBOARD} element={<ProtectedRoute><CaregiverDashboard /></ProtectedRoute>} />
          <Route path={PATHS.FAMILY_DASHBOARD} element={<ProtectedRoute><FamilyDashboard /></ProtectedRoute>} />
        </Route>

        {/* Headless Auth Callback route catching SSO redirects */}
        <Route path={PATHS.AUTH_CALLBACK} element={<AuthCallback />} />

        <Route element={<AuthLayout />}>
          <Route path={PATHS.LOGIN} element={<PublicRoute><AuthRedirect type="login" /></PublicRoute>} />
          <Route path={PATHS.SIGNUP} element={<PublicRoute><AuthRedirect type="signup" /></PublicRoute>} />
        </Route>

        <Route path={PATHS.NOT_FOUND} element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

export default AppRouter;
