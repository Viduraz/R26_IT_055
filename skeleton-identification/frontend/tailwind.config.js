/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        // Dark base palette
        dark: {
          900: '#080c14',
          800: '#0d1117',
          700: '#111827',
          600: '#1c2333',
          500: '#21283b',
          400: '#2d3748',
          300: '#374151',
        },
        // Accent cyan (AI theme)
        cyan: {
          DEFAULT: '#00d4ff',
          50: '#e0fbff',
          100: '#b3f5ff',
          200: '#80eeff',
          300: '#4de7ff',
          400: '#1ae0ff',
          500: '#00d4ff',
          600: '#00aacf',
          700: '#007f9f',
          800: '#00556f',
          900: '#002a3f',
        },
        // Accent violet
        violet: {
          DEFAULT: '#7c3aed',
          50: '#f5f3ff',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
        },
        // Success green
        emerald: {
          DEFAULT: '#10b981',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
        },
        // Warning amber
        amber: {
          DEFAULT: '#f59e0b',
          400: '#fbbf24',
          500: '#f59e0b',
        },
        // Danger red
        rose: {
          DEFAULT: '#f43f5e',
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'mesh-dark': `
          radial-gradient(at 40% 20%, hsla(210, 100%, 56%, 0.08) 0px, transparent 50%),
          radial-gradient(at 80% 0%, hsla(189, 100%, 56%, 0.06) 0px, transparent 50%),
          radial-gradient(at 0% 50%, hsla(355, 100%, 93%, 0.04) 0px, transparent 50%)
        `,
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0, 212, 255, 0.15)',
        'glow-violet': '0 0 20px rgba(124, 58, 237, 0.2)',
        'glow-emerald': '0 0 20px rgba(16, 185, 129, 0.15)',
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -2px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
}
