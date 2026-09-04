"use client";

import { useEffect } from "react";

/** Registra o service worker para habilitar o modo PWA (instalável no iPhone). */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* falha silenciosa: app continua funcionando sem offline */
      });
    };

    // O `load` do navegador acontece ANTES da hidratação do React — quando
    // este efeito roda, na esmagadora maioria das visitas o evento já passou,
    // e um ouvinte registrado agora nunca dispara. Era o que impedia o service
    // worker de existir: sem ele não há notificação de venda entregue com o
    // app fechado, e o Chrome não oferece instalar o painel. Esperar o `load`
    // continua valendo para a visita rara em que ele ainda não veio (recarga
    // lenta, primeira pintura demorada) — daí os dois caminhos.
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
