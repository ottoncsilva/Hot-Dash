"use client";

import { useEffect, useState } from "react";
import { showToast } from "@/lib/toast";

/** Converte a chave VAPID (base64url) no formato que o navegador exige. */
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

/** iPhone/iPad: o push só existe se o app foi ADICIONADO À TELA DE INÍCIO. */
function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPad moderno se identifica como Mac com toque.
    (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

/**
 * Liga/desliga os alertas de venda neste aparelho e permite disparar um teste.
 * Cada celular precisa ser ativado uma vez (a inscrição é por aparelho).
 */
export default function PushToggle() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window;
    // No iOS o PushManager só aparece quando aberto pela tela de início.
    setNeedsInstall(isIos() && !isStandalone());
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {});
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        showToast("Permissão negada. Libere as notificações nos ajustes do navegador.", "error");
        return;
      }
      const { publicKey } = await fetch("/api/push/vapid-public-key").then((r) => r.json());
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub),
      });
      setSubscribed(true);
      showToast("Alertas ativados neste aparelho.", "success");
    } catch (e) {
      console.error(e);
      showToast("Não foi possível ativar os alertas aqui.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      showToast("Alertas desativados neste aparelho.", "success");
    } catch (e) {
      showToast("Falha ao desativar.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Falha no teste.");
      showToast(`Teste enviado para ${d.devices} aparelho(s).`, "success");
    } catch (e: any) {
      showToast(e.message || "Falha ao enviar o teste.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (supported === null) return null;

  if (needsInstall) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm text-amber-200">
        <p className="font-semibold">Falta instalar o app no iPhone</p>
        <p className="mt-1 text-xs text-amber-200/80">
          No iPhone/iPad a Apple só entrega notificações quando o Hot Dash está na tela de
          início. No Safari, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>,
          abra o app por lá e volte aqui para ativar.
        </p>
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-black/20 p-4 text-sm text-zinc-400">
        Este navegador não suporta notificações. Abra o Hot Dash no Chrome (Android) ou
        instale na tela de início do iPhone.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`h-2 w-2 rounded-full ${subscribed ? "bg-emerald-400" : "bg-zinc-600"}`}
        />
        <span className={subscribed ? "text-emerald-300" : "text-zinc-400"}>
          {subscribed ? "Alertas ativos neste aparelho" : "Alertas desligados neste aparelho"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {subscribed ? (
          <>
            <button onClick={test} disabled={busy} className="btn-ghost text-xs">
              Enviar teste
            </button>
            <button onClick={disable} disabled={busy} className="btn-ghost text-xs">
              Desativar aqui
            </button>
          </>
        ) : (
          <button onClick={enable} disabled={busy} className="btn-primary text-xs">
            {busy ? "Ativando..." : "Ativar alertas neste aparelho"}
          </button>
        )}
      </div>
    </div>
  );
}
