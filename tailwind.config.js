const { fontFamily } = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        raised: 'var(--raised)',
        accent: { DEFAULT: 'var(--accent)', ink: 'var(--accent-ink)' },
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)' },
        line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' },
        hover: 'var(--hover)',
        selected: 'var(--selected)',
        tint: 'var(--tint)',
        pos: { DEFAULT: 'var(--pos)', soft: 'var(--pos-soft)' },
        neg: { DEFAULT: 'var(--neg)', soft: 'var(--neg-soft)' },
        warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)' },
      },
      fontFamily: {
        sans: ['Figtree', ...fontFamily.sans],
      },
      boxShadow: {
        float: 'var(--shadow-float)',
      },
      borderRadius: {
        card: '16px',
      },
    },
  },
  plugins: [],
};
