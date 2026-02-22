/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // AutoRail Primitives (exposed as utilities)
        'void-black': 'var(--color-void-black)',
        'slate-grey': 'var(--color-slate-grey)',
        'cloud-white': 'var(--color-cloud-white)',
        'pure-white': 'var(--color-pure-white)',
        'rail-purple': '#6E18B3',
        'quantum-violet': '#8134CE',
        'deep-purple': '#5B0B96',
        'electric-cyan': '#00E5FF',

        // Main Backgrounds - Mapped to CSS Variables
        bg: {
          main: 'var(--color-bg-main)',
          surface: 'var(--color-bg-surface)',
          card: 'var(--color-bg-card)',
        },
        // Semantic Text
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'rgba(250, 250, 250, 0.4)',
        },
        // Accents
        primary: {
          DEFAULT: '#6E18B3',
          hover: '#5B0B96',
        },
        accent: {
          DEFAULT: '#00E5FF',
          hover: '#00E5FF',
        },
        // Semantic Colors
        success: '#00FF88',
        warning: '#FFB800',
        error: '#FF3366',

        // Confidence levels
        confidence: {
          high: '#00FF88',
          medium: '#FFB800',
          low: '#f97316',
          uncertain: '#FF3366',
        },
        // Entity types (keeping existing palette for distinctness, or could map to theme)
        entity: {
          function: 'var(--color-electric-cyan)',
          class: 'var(--color-rail-purple)',
          interface: 'var(--color-electric-cyan)',
          variable: 'rgba(250, 250, 250, 0.6)',
          file: 'var(--color-electric-cyan)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        grotesk: ['Space Grotesk', 'sans-serif'], // Added for headings
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-in-right': 'slideInRight 0.25s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'breathing-glow': 'breathingGlow 4s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(110, 24, 179, 0.2)' },
          '50%': { boxShadow: '0 0 25px rgba(110, 24, 179, 0.4)' },
        },
        breathingGlow: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
      boxShadow: {
        'glow': '0 0 20px rgba(110, 24, 179, 0.15)',
        'glass': '0 4px 30px rgba(0, 0, 0, 0.2)',
        'rail': '0 0 30px rgba(110, 24, 179, 0.2)',
      },
    },
  },
  plugins: [],
}
