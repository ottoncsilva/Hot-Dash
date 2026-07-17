/**
 * Utilitário de Toasts/Notificações do Hot Dash — cards flutuantes no lugar
 * dos alertas nativos. O container é uma região `aria-live` para leitores de
 * tela anunciarem sucessos/erros; cada toast tem botão de fechar e respeita
 * `prefers-reduced-motion`.
 */
export function showToast(message: string, type: "success" | "error" | "warning" = "success") {
  if (typeof document === "undefined") return;

  // Container único, anunciado por tecnologia assistiva.
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none";
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "false");
    document.body.appendChild(container);
  }

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const colors = {
    success: "bg-emerald-600/90 border-emerald-500",
    error: "bg-rose-600/90 border-rose-500",
    warning: "bg-amber-600/90 border-amber-500",
  };
  const icons = { success: "✅", error: "❌", warning: "⚠️" };

  const toast = document.createElement("div");
  toast.className =
    "px-4 py-3 rounded-lg shadow-xl text-white font-medium text-sm transition-all duration-300 transform pointer-events-auto flex items-center gap-2 max-w-sm border backdrop-blur-md " +
    colors[type] +
    (reduceMotion ? "" : " translate-y-2 opacity-0");

  // Texto (via textContent — nunca interpreta HTML da mensagem).
  const label = document.createElement("span");
  label.className = "flex-1";
  label.textContent = `${icons[type]} ${message}`;
  toast.appendChild(label);

  // Botão de fechar.
  const close = document.createElement("button");
  close.setAttribute("aria-label", "Fechar");
  close.className = "shrink-0 opacity-70 hover:opacity-100 transition-opacity";
  close.textContent = "✕";
  const dismiss = () => {
    if (reduceMotion) {
      remove();
      return;
    }
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(remove, 300);
  };
  function remove() {
    toast.remove();
    if (container && container.childElementCount === 0) container.remove();
  }
  close.addEventListener("click", dismiss);
  toast.appendChild(close);

  container.appendChild(toast);

  if (!reduceMotion) {
    setTimeout(() => toast.classList.remove("translate-y-2", "opacity-0"), 10);
  }
  // Some sozinho depois de 3.5s (erros ficam um pouco mais).
  setTimeout(dismiss, type === "error" ? 5000 : 3500);
}
