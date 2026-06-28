// CommonJS: this package is not "type":"module".
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep neutral, Claude-style dark surface ramp (high = light text, low = dark bg).
        ink: {
          100: '#e9ecf1',
          200: '#c7ccd5',
          300: '#a4abb8',
          400: '#828b9b',
          500: '#5b6573',
          600: '#3a414c',
          700: '#2a2f37',
          750: '#21252b',
          800: '#1b1e23',
          850: '#16181c',
          900: '#101114',
          950: '#0b0c0e'
        },
        // Status accents.
        status: {
          busy: '#5b9dff',
          input: '#f5b545',
          done: '#4ec98a',
          failed: '#f06a6a',
          idle: '#7c8694'
        },
        accent: {
          DEFAULT: '#c96442',
          soft: '#d98a6f'
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
          'ui-monospace',
          'SFMono-Regular',
          'Cascadia Code',
          'Consolas',
          'monospace'
        ]
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.25)',
        rail: 'inset 1px 0 0 rgba(255,255,255,0.04)'
      }
    }
  },
  plugins: []
};
