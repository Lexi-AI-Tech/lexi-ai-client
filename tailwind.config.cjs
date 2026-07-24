/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scoped to the pill overlay only — its own CSS entry (pill.css) is the
  // only place Tailwind's output gets injected, so the main app is unaffected.
  content: ["./pill.html", "./src/pill.tsx"],
  theme: {
    extend: {},
  },
  plugins: [],
};
