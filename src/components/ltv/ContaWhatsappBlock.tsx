"use client";

import { useState } from "react";
import { IconClose, IconWhatsapp } from "@/components/icons";
import { apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useConfirm } from "@/hooks/useConfirm";
import type { LtvAccount } from "@/lib/ltvDb";

/**
 * Conexão de UM número de WhatsApp pela uazapi.
 *
 * Dois caminhos, e o de código costuma ser o melhor: quem está com o celular
 * na mão digita 8 caracteres, enquanto o QR exige uma segunda tela para
 * apontar a câmera.
 *
 * Cada número é uma instância própria — é isso que permite a mesma modelo ter
 * Número 1 e Número 2 sem um derrubar o outro.
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
  const [paircode, setPaircode] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function conectar(comTelefone: boolean) {
    setOcupado(true);
    setQr(null);
    setPaircode(null);
    try {
      const d = await apiSend<{ qrcode: string | null; paircode: string | null }>(
        "/api/ltv/accounts",
        "PATCH",
        {
          accountId: conta.id,
          action: "connect",
          ...(comTelefone ? { phone } : {}),
        },
      );
      if (d.paircode) setPaircode(d.paircode);
      else if (d.qrcode) setQr(d.qrcode);
      else showToast("Nada devolvido — o número já pode estar conectado.", "warning");
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
      setPaircode(null);
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
        Conecte o WhatsApp da modelo. Pelo código é mais fácil: você digita ele no próprio
        aparelho, sem precisar de outra tela para apontar a câmera.
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
          {paircode && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
              <p className="eyebrow">Digite este código no WhatsApp da modelo</p>
              <p className="mt-2 select-all font-mono text-3xl font-bold tracking-[0.3em] text-emerald-400">
                {paircode}
              </p>
              <p className="mt-2 text-xs text-zinc-400">
                No celular: Aparelhos conectados → Conectar aparelho → Conectar com número.
              </p>
            </div>
          )}

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

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="eyebrow mb-1 block">Telefone da modelo (com DDI)</span>
              <input
                className="input w-52 font-mono"
                placeholder="5511965665065"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => conectar(true)}
              disabled={ocupado || phone.replace(/\D/g, "").length < 10}
              className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px]"
            >
              {ocupado ? "Gerando..." : "Gerar código"}
            </button>
            <button
              type="button"
              onClick={() => conectar(false)}
              disabled={ocupado}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px]"
            >
              <IconWhatsapp size={16} /> Usar QR Code
            </button>
          </div>
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
