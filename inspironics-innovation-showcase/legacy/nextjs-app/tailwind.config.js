/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#050816",
        bg2: "#0a0f24",
        cyan: "#00E5FF",
        emer: "#00FFB2",
        mut: "#9fb2d4",
        dim: "#5d6f95",
      },
      boxShadow: {
        glow: "0 0 38px -8px rgba(0,229,255,.4)",
      },
      backdropBlur: { xs: "2px" },
    },
  },
  plugins: [],
};
