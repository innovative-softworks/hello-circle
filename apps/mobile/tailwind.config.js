const { lightColors } = require('@hello-circle/design-tokens/src/colors');
const { space, radius } = require('@hello-circle/design-tokens');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/app/**/*.{js,jsx,ts,tsx}', './src/components/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: lightColors,
      spacing: Object.fromEntries(Object.entries(space).map(([k, v]) => [k, `${v}px`])),
      borderRadius: { control: `${radius.control}px`, card: `${radius.card}px`, pill: `${radius.pill}px` },
    },
  },
  plugins: [],
};
