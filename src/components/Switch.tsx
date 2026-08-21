"use client";

/**
 * Interruptor liga/desliga padrão do app (estilo iOS). Visual único para todos
 * os "ativar/desativar": trilho verde quando ligado, cinza quando desligado,
 * botão branco. Acessível (role="switch").
 */
export default function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  // No dedo o alvo cresce para 44px de altura SEM o trilho mudar de tamanho:
  // quem cresce é o botão em volta, com o trilho desenhado num <span> por
  // dentro. Aumentar o próprio trilho deixaria o interruptor desproporcional
  // ao lado do texto; o que faltava era área de toque, não desenho maior.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex h-6 w-11 shrink-0 items-center justify-center focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-11"
    >
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-emerald-500" : "bg-zinc-700"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-[2px]"
          }`}
        />
      </span>
    </button>
  );
}
