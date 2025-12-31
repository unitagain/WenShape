/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // Keep class strategy, though we focus on light mode first
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        // "Calm & Focus" Palette
        background: "#FAFAF9", // Stone-50 - Canvas
        surface: "#FFFFFF",    // White - Writing Sheet

        // Text Colors
        ink: {
          900: "#1F2937", // Gray-800 - Primary Text
          500: "#6B7280", // Gray-500 - Secondary/Icons
          400: "#9CA3AF", // Gray-400 - Placeholders
        },

        // Interactive/Accents
        primary: {
          DEFAULT: "#1F2937", // Gray-800 - Standard interactive
          hover: "#000000",
          light: "#F5F5F4",   // Stone-100 - Hover backgrounds
        },

        accent: {
          DEFAULT: "#E0F2FE", // Sky-100 - Subtle highlights
          active: "#7DD3FC",  // Sky-300 - Active indicators
        },

        // Semantic
        border: "#D6D3D1",      // Stone-300 - Visible but subtle borders
        input: "#A8A29E",       // Stone-400 - Inputs need stronger borders
        ring: "#1C1917",        // Stone-900 - Focus rings
      },
      fontFamily: {
        // UI Fonts: Clean, modern sans-serif
        sans: ['"Inter"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        // Writing Fonts: Elegant serif
        serif: ['"Merriweather"', '"Noto Serif SC"', 'serif'],
        // Code
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        // Floating paper effect
        'paper': '0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -1px rgba(0, 0, 0, 0.02)',
        'paper-hover': '0 10px 15px -3px rgba(0, 0, 0, 0.04), 0 4px 6px -2px rgba(0, 0, 0, 0.02)',
        'float': '0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.02)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}
