/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Confidence levels
        confidence: {
          high: '#22c55e',      // green-500
          medium: '#eab308',    // yellow-500
          low: '#f97316',       // orange-500
          uncertain: '#ef4444', // red-500
        },
        // Entity types
        entity: {
          function: '#3b82f6',  // blue-500
          class: '#a855f7',     // purple-500
          interface: '#06b6d4', // cyan-500
          variable: '#6b7280',  // gray-500
          file: '#eab308',      // yellow-500
        },
        // Domain/Infrastructure
        domain: '#3b82f6',      // blue-500
        infrastructure: '#6b7280', // gray-500
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
