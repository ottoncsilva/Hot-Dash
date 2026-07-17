import { type ReactNode } from "react";

/**
 * Cabeçalho padrão das telas: eyebrow + título + descrição, com uma área de
 * ações à direita. Extraído para manter todas as páginas consistentes (antes
 * cada tela repetia esse bloco à mão).
 */
export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = "md",
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** "md" = telas de conteúdo (2xl); "lg" = dashboard (3xl). */
  size?: "md" | "lg";
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1
          className={`mt-2 font-display font-semibold tracking-tight ${
            size === "lg" ? "text-3xl" : "text-2xl"
          }`}
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
