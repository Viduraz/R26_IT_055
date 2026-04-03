import React from 'react';
import { Navigate } from 'react-router-dom';
import { PATHS } from './paths';

const PublicRoute = ({ children }) => {
  const token = localStorage.getItem('access_token');
  
  if (token) {
    return <Navigate to={PATHS.SYSTEM_OVERVIEW} replace />;
  }

  return children;
};

export default PublicRoute;
