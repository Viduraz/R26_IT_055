import React from "react";

const Footer = () => {
  return (
    <footer className="border-t border-slate-900 bg-[#080b13] py-8 px-6 mt-auto">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <span className="text-lg font-bold bg-gradient-to-r from-primary-400 to-indigo-400 bg-clip-text text-transparent">
            🛡️ SecureElderCare
          </span>
          <p className="text-xs text-slate-500 mt-1">
            Production-ready monorepo AI-powered elder care monitoring and marketplace platform.
          </p>
        </div>
        
        <div className="flex gap-6 text-xs text-slate-400">
          <a href="#" className="hover:text-primary-400 transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-primary-400 transition-colors">Terms of Service</a>
          <a href="#" className="hover:text-primary-400 transition-colors">Support Contact</a>
        </div>

        <p className="text-[11px] text-slate-600">
          &copy; {new Date().getFullYear()} SecureElderCare. All rights reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
