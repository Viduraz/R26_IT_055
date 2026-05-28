export default function LoadingSpinner({ size = 'md', label }) {
  const sizes = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-2',
    lg: 'w-12 h-12 border-3',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className={`
        ${sizes[size]} rounded-full
        border-dark-400 border-t-cyan-400
        animate-spin
      `} />
      {label && <p className="text-sm text-slate-400">{label}</p>}
    </div>
  );
}
