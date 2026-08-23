"use client";

import { useState } from "react";
import { IconClose, IconSend } from "@/components/icons";
import { apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import type { LtvAccount } from "@/lib/ltvDb";

/**
 * Conexão do chip: telefone → código → senha de duas etapas quando a conta
 * tem. É outro fluxo do QR do WhatsApp porque é outra coisa: aqui a modelo
 * entrega o número dela, e o Telegram manda o código para o aparelho.
 *
 * É UM chip por modelo. Não existe "adicionar outro" aqui de propósito — dois
 * chips seriam duas IAs falando pela mesma persona no mesmo lugar.
 */
export default function ChipTelegramBlock({
  profileId,
  conta,
  onConta,
  chipConfigurado,
}: {
  profileId: string;
  conta: LtvAccount | null;
  onConta: (c: LtvAccount | null) => void;
  chipConfigurado: boolean;
}) {
  const [etapa, setEtapa] = useState<"telefone" | "codigo" | "senha">("telefone");
  const [accountId, setAccountId] = useState<string | null>(conta?.id ?? null);
  const [phone, setPhone] = useState(conta?.externalRef || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const conectado = conta?.status === "connected";

  async function pedirCodigo() {
    setOcupado(true);
    try {
      const d = await apiSend<{ accountId: string }>("/api/ltv/telegram/session", "POST", {
        step: "start",
        profileId,
        phone,
      });
      setAccountId(d.accountId);
      setEtapa("codigo");
      showToast("Código enviado no Telegram desse número.");
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    setOcupado(true);
    try {
      const d = await apiSend<{ status: string }>("/api/ltv/telegram/session", "POST", {
        step: "confirm",
        accountId,
        code,
        password: password || undefined,
      });
      if (d.status === "password_needed") {
        setEtapa("senha");
        showToast("Esta conta tem verificação em duas etapas. Informe a senha.");
        return;
      }
      const r = await apiSend<{ account: LtvAccount }>("/api/ltv/accounts", "PATCH", {
        accountId,
        action: "rename",
        label: "Chip",
      });
      onConta(r.account);
      setCode("");
      setPassword("");
      setEtapa("telefone");
      showToast("Chip conectado!", "success");
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar() {
    setOcupado(true);
    try {
      const d = await apiSend<{ account: LtvAccount }>("/api/ltv/accounts", "PATCH", {
        accountId: conta!.id,
        action: "disconnect",
      });
      onConta(d.account);
      setEtapa("telefone");
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setOcupado(false);
    }
  }

  if (!chipConfigurado) {
    return (
      <p className="text-sm leading-relaxed text-zinc-400">
        Falta a credencial de aplicativo do Telegram. Informe o{" "}
        <strong className="text-zinc-200">api_id</strong> e o{" "}
        <strong className="text-zinc-200">api_hash</strong> em{" "}
        <strong className="text-zinc-200">Configurações → Conexões do LTV</strong>. São gratuitos e
        saem em <span className="font-mono text-xs">my.telegram.org</span>. Não há serviço para
        subir: o chip roda dentro do próprio painel.
      </p>
    );
  }

  if (conectado && conta) {
    return (
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
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-zinc-400">
        Use um chip dedicado da modelo. A IA vai falar pela conta real dela, com o histórico e o
        perfil dela — não é um bot.
      </p>

      {etapa === "telefone" && (
        <>
          <label className="block">
            <span className="eyebrow mb-1.5 block">Telefone do chip (com DDI)</span>
            <input
              className="input font-mono"
              placeholder="+5511965665065"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={pedirCodigo}
            disabled={ocupado || !phone.trim()}
            className="inline-flex w-fit items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px]"
          >
            <IconSend size={16} /> {ocupado ? "Enviando..." : "Enviar código"}
          </button>
        </>
      )}

      {(etapa === "codigo" || etapa === "senha") && (
        <>
          <label className="block">
            <span className="eyebrow mb-1.5 block">Código que chegou no Telegram</span>
            <input
              className="input font-mono"
              inputMode="numeric"
              placeholder="12345"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {etapa === "senha" && (
            <label className="block">
              <span className="eyebrow mb-1.5 block">
                Senha da verificação em duas etapas
              </span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirmar}
              disabled={ocupado || !code.trim()}
              className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px]"
            >
              {ocupado ? "Conectando..." : "Conectar"}
            </button>
            <button
              type="button"
              onClick={() => setEtapa("telefone")}
              className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 [@media(pointer:coarse)]:min-h-[44px]"
            >
              Trocar número
            </button>
          </div>
        </>
      )}
    </div>
  );
}
