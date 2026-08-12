import { type ReactNode } from "react";

/**
 * Cabeçalho padrão das telas: eyebrow + título + descrição, com uma área de
 * ações à direita. Extraído para manter todas as páginas consistentes (antes
 * cada tela repetia esse bloco à mão).
 *
 * `eyebrow` e `description` são opcionais: em telas de trabalho pesado, como a
 * Galeria, as três linhas de texto empurravam o conteúdo para fora da primeira
 * tela do celular. Sem elas o título e as ações ficam na MESMA linha.
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
  description,
  actions,
  size = "md",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** "md" = telas de conteúdo (2xl); "lg" = dashboard (3xl). */
  size?: "md" | "lg";
}) {
  // Sem eyebrow nem descrição o bloco vira uma linha só, então alinhar pelo
  // centro fica melhor que pela base (que existe para casar o título com a
  // última linha da descrição).
  const umaLinha = !eyebrow && !description;
  return (
    <div
      className={`-mt-11 flex flex-wrap justify-between gap-3 lg:mt-0 ${
        umaLinha ? "items-center" : "items-end"
      }`}
    >
      <div className="min-w-0">
        {/* Só a PRIMEIRA linha desvia do menu. A descrição já cai abaixo dele,
            então recuá-la também deixaria um bloco de texto torto no celular. */}
        {eyebrow && <p className="eyebrow pl-14 lg:pl-0">{eyebrow}</p>}
        <h1
          className={`pl-14 font-display font-semibold tracking-tight lg:pl-0 ${
            eyebrow ? "mt-2" : ""
          } ${size === "lg" ? "text-3xl" : "text-2xl"}`}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-xl text-sm text-zinc-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
