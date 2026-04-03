import React from 'react';
import { Outlet } from 'react-router-dom';

const AuthLayout = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#030712] text-gray-100 font-sans">
      <div className="w-full max-w-md p-8 bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl relative z-10">
        <Outlet />
      </div>
    </div>
  );
};

export default AuthLayout;
