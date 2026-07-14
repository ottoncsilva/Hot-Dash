"use client";

export default function ToolButton({
  icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-[10px] font-medium uppercase tracking-wider transition-all disabled:opacity-30 ${
        active ? "bg-white text-ink-950" : "text-zinc-300 hover:bg-white/10"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
