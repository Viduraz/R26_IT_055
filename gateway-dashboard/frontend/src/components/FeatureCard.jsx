import React from 'react';

const FeatureCard = ({ title, description, icon, href, badge }) => {
  const cardContent = (
    <div className="bg-gray-900 border border-gray-800 hover:border-indigo-500/50 rounded-2xl p-6 transition-all group hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-1 h-full flex flex-col relative">
      {badge && (
        <span className="absolute top-4 right-4 text-xs font-semibold bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      <div className="text-4xl mb-4 group-hover:scale-110 transition-transform origin-bottom-left">
        {icon}
      </div>
      <h3 className="font-semibold text-white text-xl mb-2 group-hover:text-indigo-400 transition">
        {title}
      </h3>
      <p className="text-gray-400 text-sm leading-relaxed flex-grow">
        {description}
      </p>
      {href && (
        <div className="mt-4 flex items-center text-indigo-400 text-sm font-medium group-hover:gap-2 gap-1 transition-all">
          Open Service <span className="group-hover:translate-x-1 transition-transform">→</span>
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block">
        {cardContent}
      </a>
    );
  }

  return cardContent;
};

export default FeatureCard;
