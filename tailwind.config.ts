import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    // `src/lib` também monta classes (o toast de `lib/toast.ts` é criado no
    // DOM na mão). Sem esta linha o Tailwind não via essas classes e as
    // removia da build: o toast aparecia sem fundo, sem z-index e fora da
    // tela — ou seja, salvar não dava retorno nenhum.
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      screens: {
        // Monitores widescreen (1920 e acima). Existe porque o `2xl` do Tailwind
        // pára em 1536px e, daí para cima, grades como a da galeria de mídia
        // continuavam esticando os itens em vez de caber mais por linha.
        // 1800 (e não 1920) para pegar a janela mesmo com a barra de rolagem
        // ocupando alguns pixels da largura.
        "3xl": "1800px",
      },
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
