import { type ReactNode } from "react";

/**
 * Cabeçalho padrão das telas: eyebrow + título, com uma área de ações à
 * direita. Extraído para manter todas as páginas consistentes (antes cada tela
 * repetia esse bloco à mão).
 *
 * SEM LEGENDA. Toda tela tinha, abaixo do título, uma frase explicando o que
 * ela era ("Resumo financeiro e operacional das suas personagens"). No celular
 * isso custava uma ou duas linhas antes do primeiro número — e explicava para
 * quem já sabe, porque quem abre o painel todo dia lê o título e o conteúdo,
 * não a legenda. O `eyebrow` continua opcional pelo mesmo motivo: sem ele, o
 * título e as ações ficam na MESMA linha.
 *
 * NO CELULAR O TÍTULO SOBE PARA O LADO DO MENU. O botão de menu é flutuante
 * (`fixed`, canto superior esquerdo), e o <main> reservava 3,5rem de padding
 * para não passar por baixo dele — o que jogava o título de toda tela uma
 * linha inteira abaixo, com a faixa ao lado do menu vazia. Aqui esse padding é
 * descontado (`-mt-11`) e devolvido como recuo à esquerda (`pl-14`, o menu
 * ocupa de 0,75rem a 3,5rem): o título encosta no menu em vez de ficar sob ele
 * e a tela ganha uma linha de altura. No desktop não há menu flutuante, então
 * nada disso se aplica.
 */
export default function PageHeader({
  eyebrow,
  title,
  actions,
  size = "md",
}: {
  eyebrow?: string;
  title: ReactNode;
  actions?: ReactNode;
  /** "md" = telas de conteúdo (2xl); "lg" = dashboard (3xl). */
  size?: "md" | "lg";
}) {
  // Sem eyebrow o bloco vira uma linha só, e alinhar pelo centro fica melhor
  // que pela base (que existe para casar o título com a última linha do
  // eyebrow quando ele está lá).
  const umaLinha = !eyebrow;
  return (
    <div
      className={`-mt-11 flex flex-wrap justify-between gap-3 lg:mt-0 ${
        umaLinha ? "items-center" : "items-end"
      }`}
    >
      <div className="min-w-0">
        {/* As duas linhas desviam do menu flutuante, cada uma com o mesmo
            recuo — desalinhar uma da outra deixaria o bloco torto no celular. */}
        {eyebrow && <p className="eyebrow pl-14 lg:pl-0">{eyebrow}</p>}
        <h1
          className={`pl-14 font-display font-semibold tracking-tight lg:pl-0 ${
            eyebrow ? "mt-2" : ""
          } ${size === "lg" ? "text-3xl" : "text-2xl"}`}
        >
          {title}
        </h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
