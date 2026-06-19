/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eefaf3',
          100: '#d6f3e1',
          200: '#aee7c5',
          300: '#7cd5a3',
          400: '#4cbe80',
          500: '#25a25f',
          600: '#198148',
          700: '#15673a',
          800: '#135230',
          900: '#0f4328',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
