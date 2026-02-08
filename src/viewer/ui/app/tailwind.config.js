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
        'rail-purple': 'var(--color-rail-purple)',
        'quantum-violet': 'var(--color-quantum-violet)',
        'deep-purple': 'var(--color-deep-purple)',
        'electric-cyan': 'var(--color-electric-cyan)',

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
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          light: '#a78bfa', // Keeping hardcoded for now or map to quantum-violet with opacity/tint?
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-electric-cyan)', // Lighter for hover
        },
        // Semantic Colors
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        info: '#3b82f6',

        // Confidence levels
        confidence: {
          high: 'var(--color-success)',
          medium: 'var(--color-warning)',
          low: '#f97316',
          uncertain: 'var(--color-error)',
        },
        // Entity types (keeping existing palette for distinctness, or could map to theme)
        entity: {
          function: '#3b82f6',
          class: '#a855f7',
          interface: '#06b6d4',
          variable: '#94a3b8',
          file: '#eab308',
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
      },
      boxShadow: {
        'glow': '0 0 20px rgba(129, 52, 206, 0.15)', // Quantum Violet glow
        'glass': '0 4px 30px rgba(0, 0, 0, 0.2)', // Slightly darker glass shadow
        'rail': '0 0 30px rgba(110, 24, 179, 0.2)', // Rail Purple glow
      },
    },
  },
  plugins: [],
}
