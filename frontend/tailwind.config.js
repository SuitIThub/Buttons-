/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#4f8cff",
          dark: "#2f6bdc",
        },
      },
    },
  },
  plugins: [],
};
