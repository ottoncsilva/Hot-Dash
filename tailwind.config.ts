import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta monocromática high-tech (preto → branco).
        ink: {
          950: "#070708",
          900: "#0b0b0d",
          850: "#101012",
          800: "#161618",
          750: "#1c1c1f",
          700: "#242427",
          600: "#2e2e32",
          500: "#3a3a3f",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        widest2: "0.2em",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease both",
      },
    },
  },
  plugins: [],
};

export default config;
