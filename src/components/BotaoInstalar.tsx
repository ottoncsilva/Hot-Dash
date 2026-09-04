"use client";

import { useEffect, useState } from "react";
import { IconDownload } from "@/components/icons";

/**
 * O evento que o Chrome dispara quando o painel PODE ser instalado. Não está
 * na tipagem padrão do DOM porque só existe nos navegadores baseados em
 * Chromium — no Safari e no Firefox ele simplesmente nunca acontece, e o
 * botão nunca aparece.
 */
type EventoDeInstalar = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Instalar app" — o Hot Dash numa janela própria, com ícone na área de
 * trabalho (ou na tela do celular), sem barra de endereço e aparecendo no
 * Alt+Tab como qualquer outro programa.
 *
 * O botão SÓ EXISTE quando o navegador oferece: quem decide é o Chrome, que
 * dispara `beforeinstallprompt` depois de conferir manifesto, service worker
 * e HTTPS. Já instalado, o evento não vem e o botão não aparece — ele se
 * apaga sozinho, sem precisar guardar nada.
 *
 * Antes disto, instalar dependia de saber caçar a opção no menu do Chrome.
 *
 * O prompt do navegador só pode ser aberto DENTRO de um clique, e uma vez por
 * evento guardado. Daí o `guardado` ser descartado depois de usado: pedir de
 * novo com o mesmo evento não faz nada, e um botão que não responde é pior
 * que um botão que sumiu.
 */
export default function BotaoInstalar({ className = "" }: { className?: string }) {
  const [guardado, setGuardado] = useState<EventoDeInstalar | null>(null);

  useEffect(() => {
    const aoPoderInstalar = (e: Event) => {
      // Sem isto o Chrome do celular mostra a própria barrinha de instalar por
      // cima do painel — duas ofertas para a mesma coisa.
      e.preventDefault();
      setGuardado(e as EventoDeInstalar);
    };
    const aoInstalar = () => setGuardado(null);

    window.addEventListener("beforeinstallprompt", aoPoderInstalar);
    window.addEventListener("appinstalled", aoInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", aoPoderInstalar);
      window.removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  if (!guardado) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        const evento = guardado;
        setGuardado(null);
        try {
          await evento.prompt();
          await evento.userChoice;
        } catch {
          // Prompt recusado pelo navegador (já respondido, aba sem foco). Não
          // há o que fazer nem o que dizer: o menu do Chrome continua lá.
        }
      }}
      className={`flex w-full items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-300 transition-all hover:bg-emerald-500/15 [@media(pointer:coarse)]:min-h-[44px] ${className}`}
    >
      <IconDownload size={16} />
      Instalar app
    </button>
  );
}
