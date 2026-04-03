import React from 'react';

const FeatureCard = ({ title, description, icon }) => {
  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-indigo-500/50 rounded-2xl p-6 transition-all group hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-1 h-full flex flex-col">
      <div className="text-4xl mb-4 group-hover:scale-110 transition-transform origin-bottom-left">
        {icon}
      </div>
      <h3 className="font-semibold text-white text-xl mb-2 group-hover:text-indigo-400 transition">
        {title}
      </h3>
      <p className="text-gray-400 text-sm leading-relaxed flex-grow">
        {description}
      </p>
    </div>
  );
};

export default FeatureCard;
