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
        /* CINZAS DO TEXTO, subidos para passar em contraste.
           Os originais do Tailwind foram desenhados para fundo CLARO. Sobre o
           quase-preto do painel eles reprovavam: zinc-500 dava 3,40:1 (mínimo
           para texto é 4,5), zinc-600 dava 2,13 e zinc-700, 1,57 — e zinc-500 é
           a cor mais usada do sistema, 465 vezes, incluindo a classe .eyebrow
           em 11px.

           Os valores abaixo mantêm a mesma relação entre canais (a família
           continua levemente azulada) e sobem só o brilho, medidos contra os
           três fundos reais: ink-950, ink-900 e ink-850.

               500  3,40:1 → 5,95:1    texto secundário
               600  2,13:1 → 4,60:1    notas e legendas
               700  1,57:1 → 3,01:1    só decorativo (o "zero" apagado)

           OBSERVAÇÃO: sobre fundo escuro a faixa entre 4,5:1 e 7:1 é estreita,
           então 500 e 600 ficaram perto. O painel tem quatro tons discretos
           (400/500/600/700) onde dois resolveriam — reduzir a escala é a
           correção de fundo, esta aqui é a que cabia sem tocar em 98 arquivos. */
        zinc: {
          500: "#9b9ba2",
          600: "#87878d",
          700: "#69696f",
        },
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
