import type { Config } from "tailwindcss";

/**
 * Tutti i colori brand e le ombre leggono i token CSS definiti in
 * globals.css (:root / [data-theme]): cambiare tema o colori personalizzati
 * aggiorna automaticamente OGNI utility esistente (bg-brand-600/90,
 * text-brand-700, shadow-glass…). I tripletti rgb + <alpha-value> fanno
 * funzionare le opacità Tailwind (es. bg-brand-600/90).
 */
const brandFromTokens = (n: number) => `rgb(var(--brand-${n}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: brandFromTokens(50),
          100: brandFromTokens(100),
          200: brandFromTokens(200),
          300: brandFromTokens(300),
          400: brandFromTokens(400),
          500: brandFromTokens(500),
          600: brandFromTokens(600),
          700: brandFromTokens(700),
          800: brandFromTokens(800),
          900: brandFromTokens(900),
          950: brandFromTokens(950),
        },
        // Slate e white leggono i token: la dark mode è solo override di
        // variabili, i componenti non cambiano (motore temi, Fase dark).
        slate: {
          50: "rgb(var(--slate-50) / <alpha-value>)",
          100: "rgb(var(--slate-100) / <alpha-value>)",
          200: "rgb(var(--slate-200) / <alpha-value>)",
          300: "rgb(var(--slate-300) / <alpha-value>)",
          400: "rgb(var(--slate-400) / <alpha-value>)",
          500: "rgb(var(--slate-500) / <alpha-value>)",
          600: "rgb(var(--slate-600) / <alpha-value>)",
          700: "rgb(var(--slate-700) / <alpha-value>)",
          800: "rgb(var(--slate-800) / <alpha-value>)",
          900: "rgb(var(--slate-900) / <alpha-value>)",
          950: "rgb(var(--slate-950) / <alpha-value>)",
        },
        white: "rgb(var(--surface-white) / <alpha-value>)",
        black: "rgb(var(--ink) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "var(--radius-card)",
        pill: "var(--radius-pill)",
        btn: "var(--radius-btn)",
      },
      boxShadow: {
        glow: "var(--shadow-glow)",
        "glass-btn": "var(--shadow-glass-btn)",
        glass: "var(--shadow-glass)",
        "glass-hover": "var(--shadow-glass-hover)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
export default config;
