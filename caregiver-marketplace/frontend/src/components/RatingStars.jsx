import React from "react";

const RatingStars = ({ rating = 0, max = 5, size = 5, interactive = false, onChange }) => {
  const stars = [];

  for (let i = 1; i <= max; i++) {
    const isFilled = i <= rating;
    const isHalf = !isFilled && i - 0.5 <= rating;

    stars.push(
      <button
        key={i}
        type="button"
        disabled={!interactive}
        onClick={() => interactive && onChange && onChange(i)}
        className={`${interactive ? "cursor-pointer transform hover:scale-110 transition duration-150 active:scale-95" : "cursor-default"} focus:outline-none`}
      >
        <svg
          className={`w-${size} h-${size} ${
            isFilled
              ? "text-yellow-400 fill-current"
              : isHalf
              ? "text-yellow-400"
              : "text-gray-600 fill-none"
          }`}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          {isHalf ? (
            <>
              <defs>
                <linearGradient id={`half-${i}`}>
                  <stop offset="50%" stopColor="#facc15" />
                  <stop offset="50%" stopColor="transparent" />
                </linearGradient>
              </defs>
              <path
                fill={`url(#half-${i})`}
                d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
              />
            </>
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
            />
          )}
        </svg>
      </button>
    );
  }

  return <div className="flex items-center gap-1">{stars}</div>;
};

export default RatingStars;
