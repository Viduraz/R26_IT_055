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
      // Just parse to ensure it's valid, then redirect to root dashboard
      parseJwt(token);
      return <Navigate to={PATHS.HOME} replace />;
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
