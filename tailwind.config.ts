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
        // Paleta monocromática high-tech, com um leve tom frio (grafite).
        //
        // A escala funciona como NÍVEIS DE ELEVAÇÃO, não como tons soltos:
        //   950 → fundo da aplicação (o preto; sidebar e <main>)
        //   900 → contêiner nível 1 — é o `.card`/`.surface` (o grafite)
        //   850 → contêiner nível 2 — painéis DENTRO de um card, modais
        //   800 → nível 3 — miniaturas, placeholders, elementos flutuantes
        //   750+ → bordas fortes, estados hover de superfícies claras
        //
        // O salto de 950 para 900 é grande de propósito: antes o card era
        // `bg-white/[0.02]` sobre um fundo quase preto, ou seja, ficava a 2%
        // do fundo e o sistema inteiro parecia um bloco preto só.
        ink: {
          950: "#08080b",
          900: "#17181d",
          850: "#1e1f25",
          800: "#25262d",
          750: "#2c2d35",
          700: "#34353e",
          600: "#3f4049",
          500: "#4c4d57",
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
        // `backwards` em vez de `both`: com `both` o fill-mode mantinha o
        // `transform: translateY(0)` do último keyframe aplicado PARA SEMPRE.
        // Transform em um ancestral cria um containing block e quebra
        // `position: sticky`/`fixed` de tudo que estiver dentro — o wrapper
        // `animate-fade-in` do layout envolve TODAS as telas, então nenhuma
        // barra fixa funcionava no celular. Como o estado final da animação é
        // igual ao estado natural do elemento, trocar para `backwards` não muda
        // nada visualmente e some com o transform residual.
        "fade-in": "fade-in 0.4s ease backwards",
      },
    },
  },
  plugins: [],
};

export default config;
