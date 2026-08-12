import { type ReactNode } from "react";

/**
 * Cabeçalho padrão das telas: eyebrow + título + descrição, com uma área de
 * ações à direita. Extraído para manter todas as páginas consistentes (antes
 * cada tela repetia esse bloco à mão).
 *
 * `eyebrow` e `description` são opcionais: em telas de trabalho pesado, como a
 * Galeria, as três linhas de texto empurravam o conteúdo para fora da primeira
 * tela do celular. Sem elas o título e as ações ficam na MESMA linha.
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
      className={`flex flex-wrap justify-between gap-3 ${
        umaLinha ? "items-center" : "items-end"
      }`}
    >
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1
          className={`font-display font-semibold tracking-tight ${
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
