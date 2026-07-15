/**
 * Utilitário de Toasts/Notificações personalizadas para o Hot Dash.
 * Substitui os alertas nativos do navegador por cards flutuantes modernos e animados.
 */
export function showToast(message: string, type: "success" | "error" | "warning" = "success") {
  if (typeof document === "undefined") return;

  // Busca ou cria o container de toasts
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none";
    document.body.appendChild(container);
  }

  // Cria o elemento do toast
  const toast = document.createElement("div");
  toast.className = "px-4 py-3 rounded-lg shadow-xl text-white font-medium text-sm transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto flex items-center gap-2 max-w-sm border backdrop-blur-md ";
  
  const colors = {
    success: "bg-emerald-600/90 border-emerald-500",
    error: "bg-rose-600/90 border-rose-500",
    warning: "bg-amber-600/90 border-amber-500"
  };
  
  const icons = {
    success: "✅",
    error: "❌",
    warning: "⚠️"
  };
  
  toast.className += colors[type];
  toast.innerText = `${icons[type]} ${message}`;
  
  container.appendChild(toast);
  
  // Ativa a animação de entrada
  setTimeout(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  }, 10);
  
  // Remove automaticamente após 3.5 segundos
  setTimeout(() => {
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(() => {
      toast.remove();
      // Remove o container se estiver vazio
      if (container && container.childElementCount === 0) {
        container.remove();
      }
    }, 300);
  }, 3500);
}
