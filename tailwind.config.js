// CommonJS: this package is not "type":"module".
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm-dark, Claude-style surface ramp (high = light text, low = dark bg).
        ink: {
          50: '#f7f1e7',
          100: '#ece4d8',
          200: '#d9cfc1',
          300: '#c4b8a8',
          400: '#a99c8d',
          500: '#8a7d70',
          600: '#5c5046',
          700: '#382f27',
          750: '#312a23',
          800: '#2a241e',
          850: '#221d18',
          900: '#1b1713',
          950: '#14110d'
        },
        // Status accents (muted, professional). `needs` is an amber alias of `input`.
        status: {
          busy: '#6a9fc4',
          input: '#e0a23f',
          needs: '#e0a23f',
          idle: '#8a7d70',
          done: '#6f9e72',
          failed: '#d2674d'
        },
        // Claude clay-coral — the single saturated brand accent.
        accent: {
          DEFAULT: '#d97757',
          hover: '#e08a6d',
          press: '#c15f3c',
          soft: 'rgba(217,119,87,0.12)',
          ring: 'rgba(217,119,87,0.45)'
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif'
        ],
        mono: [
          'JetBrains Mono',
          'Cascadia Mono',
          'Cascadia Code',
          'Consolas',
          'ui-monospace',
          'monospace'
        ]
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '14px'
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.25)',
        rail: 'inset 1px 0 0 rgba(255,255,255,0.04)',
        float: '0 8px 30px rgba(0,0,0,0.45)',
        pop: '0 4px 16px rgba(0,0,0,0.4)'
      }
    }
  },
  plugins: []
};
