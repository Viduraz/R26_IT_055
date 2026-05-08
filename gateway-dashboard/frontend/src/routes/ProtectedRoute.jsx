import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PATHS } from './paths';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('access_token');
  const location = useLocation();

  if (!token) {
    return <Navigate to={PATHS.LOGIN} state={{ from: location }} replace />;
  }

  return children;
};

export default ProtectedRoute;
