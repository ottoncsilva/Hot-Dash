"use client";

import { useState } from "react";
import { IconClose, IconWhatsapp } from "@/components/icons";
import { apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useConfirm } from "@/hooks/useConfirm";
import type { LtvAccount } from "@/lib/ltvDb";

/**
 * Conexão de UM número de WhatsApp, por QR (como no WhatsApp Web).
 *
 * Cada número é uma instância própria da Evolution — é isso que permite a
 * mesma modelo ter Número 1 e Número 2 sem um QR derrubar o outro.
 */
export default function ContaWhatsappBlock({
  conta,
  onConta,
  onRemovida,
}: {
  conta: LtvAccount;
  onConta: (c: LtvAccount) => void;
  onRemovida: () => void;
}) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function conectar() {
    setOcupado(true);
    try {
      const d = await apiSend<{ qrcode: string | null }>("/api/ltv/accounts", "PATCH", {
        accountId: conta.id,
        action: "connect",
      });
      if (d.qrcode) {
        setQr(d.qrcode);
      } else {
        showToast("Nenhum QR devolvido — o número já pode estar conectado.", "warning");
      }
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar() {
    if (!(await confirm("Desconectar este número? Os leads e a conversa continuam guardados."))) {
      return;
    }
    setOcupado(true);
    try {
      const d = await apiSend<{ account: LtvAccount }>("/api/ltv/accounts", "PATCH", {
        accountId: conta.id,
        action: "disconnect",
      });
      setQr(null);
      onConta(d.account);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    // Apagar a conta leva junto conversa, produtos e vendas dela — a diferença
    // para "desconectar" precisa estar dita na pergunta.
    const ok = await confirm(
      "Apagar este número do LTV? Vai junto TODA a conversa, os produtos e o histórico de vendas dele. Para só parar de responder, use Desconectar.",
    );
    if (!ok) return;
    setOcupado(true);
    try {
      await apiSend(`/api/ltv/accounts?accountId=${conta.id}`, "DELETE");
      onRemovida();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-zinc-400">
        Escaneie o QR (como no WhatsApp Web). O lead que comprar o VIP recebe este contato e cai
        aqui.
      </p>

      {conta.status === "connected" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.5)]" />
            <div>
              <p className="font-semibold text-white">Conectado</p>
              <p className="font-mono text-xs text-zinc-500">{conta.externalRef}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={desconectar}
            disabled={ocupado}
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px]"
          >
            <IconClose size={16} /> Desconectar
          </button>
        </div>
      ) : (
        <>
          {qr && (
            <div className="flex flex-col items-center gap-2">
              <div className="rounded-xl bg-white p-3 shadow-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`}
                  alt="QR Code de conexão"
                  className="h-52 w-52 object-contain"
                />
              </div>
              <p className="animate-pulse text-xs text-zinc-400">
                Aguardando a leitura pelo celular...
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={conectar}
            disabled={ocupado}
            className="inline-flex w-fit items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px]"
          >
            <IconWhatsapp size={16} />
            {ocupado ? "Gerando..." : qr ? "Gerar outro QR" : "Conectar WhatsApp"}
          </button>
        </>
      )}

      <button
        type="button"
        onClick={remover}
        disabled={ocupado}
        className="w-fit text-xs text-zinc-600 underline transition-colors hover:text-red-400"
      >
        Apagar este número do LTV
      </button>
      {ConfirmDialog}
    </div>
  );
}
