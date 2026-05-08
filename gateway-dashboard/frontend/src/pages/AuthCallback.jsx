import React, { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { PATHS, EXTERNAL_AUTH_URL } from '../routes/paths';
import { parseJwt } from '@shared/utils/helpers';

const AuthCallback = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  if (token) {
    localStorage.setItem('access_token', token);
    
    try {
      const payload = parseJwt(token);
      const role = payload?.role?.toLowerCase();
      
      if (role === 'admin') return <Navigate to={PATHS.ADMIN_DASHBOARD} replace />;
      if (role === 'caregiver') return <Navigate to={PATHS.CAREGIVER_DASHBOARD} replace />;
      
      // Default fallback
      return <Navigate to={PATHS.FAMILY_DASHBOARD} replace />;
    } catch (e) {
      console.error("JWT parse error", e);
      return <Navigate to={PATHS.HOME} replace />;
    }
  }

  // If no token, bounce back to login
  window.location.replace(`${EXTERNAL_AUTH_URL}/login`);
  return null;
};

export default AuthCallback;
