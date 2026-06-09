/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        linkedin: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#0a66c2',
          600: '#004182',
          700: '#00294f',
        }
      }
    },
  },
  plugins: [],
}
