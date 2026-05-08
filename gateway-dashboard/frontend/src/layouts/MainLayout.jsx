import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const MainLayout = () => {
  return (
    <div className="min-h-screen bg-[#030712] text-gray-100 selection:bg-indigo-500/30 font-sans flex flex-col">
      <Navbar />
      <main className="flex-grow pt-20"> 
        {/* pt-20 offsets the fixed Navbar */}
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};

export default MainLayout;
