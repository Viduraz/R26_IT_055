import React from 'react';

const Footer = () => {
  return (
    <footer className="bg-gray-950 border-t border-gray-800 py-10 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center text-sm">
        <div className="mb-4 md:mb-0">
          <span className="font-bold text-white">Secure Eldercare</span>
          <span className="text-gray-500 ml-2">© {new Date().getFullYear()} Monorepo Arch.</span>
        </div>
        <div className="flex space-x-6 text-gray-400">
          <a href="#" className="hover:text-white transition">Support</a>
          <a href="#" className="hover:text-white transition">Privacy Policy</a>
          <a href="#" className="hover:text-white transition">System Logs</a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
