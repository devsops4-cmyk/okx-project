/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sable: {
          bg: "#0b0d12",
          panel: "#151922",
          border: "#232936",
          accent: "#5b8cff",
          good: "#3ecf8e",
          bad: "#ff6b6b",
          muted: "#8a93a6",
        },
      },
    },
  },
  plugins: [],
};
