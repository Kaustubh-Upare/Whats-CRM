/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
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
        ink: {
          DEFAULT: '#0f172a',
          muted:   '#475569',
          subtle:  '#64748b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
