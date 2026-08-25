"use client";

import Link from "next/link";
import { useState, useEffect as import_react_useEffect } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconArrowLeft } from "@/components/icons";

/** Botão "Testar conexão" + luz de status (usado por SyncPay e por cada provedor de IA). */
export function ConnectionBadge({
  testUrl,
  buildBody,
  autoTest,
  enabled,
}: {
  testUrl: string;
  buildBody: () => Record<string, unknown>;
  autoTest?: boolean;
  enabled?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "testing" | "connected" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  import_react_useEffect(() => {
    if (autoTest && enabled && status === "idle") {
      test();
    }
  }, [autoTest, enabled]);

  async function test() {
    setStatus("testing");
    setMessage(null);
    try {
      const res = await apiSend<{ connected: boolean; message?: string }>(testUrl, "POST", buildBody());
      if (res.connected) {
        setStatus("connected");
      } else {
        setStatus("error");
        setMessage(res.message || "Não foi possível conectar.");
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Falha ao testar.");
    }
  }

  const dotClass =
    status === "connected" ? "bg-emerald-400" : status === "error" ? "bg-red-400" : "bg-zinc-600";
  const textClass =
    status === "connected" ? "text-emerald-400" : status === "error" ? "text-red-400" : "text-zinc-500";
  const label =
    status === "connected"
      ? "Conectado"
      : status === "error"
        ? message || "Falha na conexão"
        : status === "testing"
          ? "Testando..."
          : "Não testado";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">

      <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span className={textClass}>{label}</span>
      </span>
    </div>
  );
}

/**
 * Rótulo de um campo de segredo (chave de API, token, secret) — junto com um
 * selo "salva" quando já existe algo guardado no servidor.
 *
 * O placeholder sozinho ("•••••••• em branco = manter") é cinza-claro, igual
 * a qualquer outro texto de exemplo — de relance, um campo preenchido assim
 * lia como vazio. O selo é um sinal que não depende de ninguém reparar na
 * cor do placeholder: fica lá, verde, o tempo todo que existir algo salvo.
 */
export function KeyLabel({ children, salva }: { children: React.ReactNode; salva: boolean }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-2">
      <label className="eyebrow block">{children}</label>
      {salva && (
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400">
          🔒 salva
        </span>
      )}
    </div>
  );
}

type WebhookEventoUi = { id: string; receivedAt: number; providerRef?: string; decision: string; body: string };

/**
 * Diário de webhooks recebidos de UM provedor — o que ele mandou e o que o
 * sistema fez com cada evento. "Só relevantes" esconde os "ignorado · ..."
 * (evento que chegou mas nenhum código trata hoje); "Todos" mostra tudo.
 *
 * O filtro não é uma lista fixa de tipos de evento — é derivado do próprio
 * `decision` que cada webhook grava (`logWebhookEvent`, em
 * syncpayWebhook.ts/stripeWebhook.ts): todo evento que o código realmente
 * processa registra uma decisão que NÃO começa com "ignorado". Então quando
 * um evento novo ganha tratamento no código, ele PASSA A APARECER em "Só
 * relevantes" sozinho — não tem lista pra atualizar aqui na tela.
 */
export function WebhookDiaryPanel({ provider, descricao }: { provider: string; descricao: React.ReactNode }) {
  const [eventos, setEventos] = useState<WebhookEventoUi[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [soRelevantes, setSoRelevantes] = useState(true);

  async function carregar() {
    try {
      const d = await apiGet<{ events: WebhookEventoUi[] }>(`/api/payments/webhook-events?provider=${provider}`);
      setEventos(d.events || []);
    } catch {
      setEventos([]);
    }
  }

  const visiveis = eventos?.filter((ev) => !soRelevantes || !ev.decision.startsWith("ignorado")) ?? null;

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Webhooks recebidos</p>
          <p className="mt-0.5 text-xs text-zinc-500">{descricao}</p>
        </div>
        <button type="button" onClick={carregar} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">
          {eventos === null ? "Ver eventos" : "Atualizar"}
        </button>
      </div>

      {eventos !== null && (
        <>
          <div className="mt-2 inline-flex items-center gap-1 rounded-lg bg-white/5 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setSoRelevantes(true)}
              className={`rounded-md px-2 py-1 transition-colors ${
                soRelevantes ? "bg-white/10 font-semibold text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Só relevantes
            </button>
            <button
              type="button"
              onClick={() => setSoRelevantes(false)}
              className={`rounded-md px-2 py-1 transition-colors ${
                !soRelevantes ? "bg-white/10 font-semibold text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Todos
            </button>
          </div>

          {visiveis!.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-600">
              {eventos.length === 0
                ? "Nenhum evento recebido ainda (só aparecem os que chegarem daqui pra frente)."
                : 'Nenhum evento relevante ainda — troque para "Todos" pra ver os que chegaram, mas o sistema ignorou.'}
            </p>
          ) : (
            <div className="mt-2 divide-y divide-white/[0.06] rounded-lg border border-white/10">
              {visiveis!.map((ev) => (
                <div key={ev.id} className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setAberto(aberto === ev.id ? null : ev.id)}
                    className="flex w-full items-center justify-between gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-[10px] text-zinc-500">
                        {new Date(ev.receivedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}
                      </span>
                      <span
                        className={`ml-2 text-[11px] ${
                          ev.decision.startsWith("ignorado") ? "text-amber-400/80" : "text-emerald-400/80"
                        }`}
                      >
                        {ev.decision}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                      {aberto === ev.id ? "fechar" : "ver json"}
                    </span>
                  </button>
                  {aberto === ev.id && (
                    <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                      {ev.body}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Link de volta para a lista de Configurações, usado no topo de cada sub-rota. */
/**
 * Volta para o índice das Configurações. É sempre o PRIMEIRO elemento da tela,
 * então é ele que leva o desvio do menu flutuante no celular: `-mt-11` desconta
 * o padding que o <main> reserva para o menu e `pl-14` recua o link para depois
 * dele. Sem isso o bloco inteiro (link + título + descrição) nascia uma linha
 * abaixo, com a faixa ao lado do menu vazia. Mesmo tratamento do PageHeader.
 */
export function BackToSettings() {
  // O desvio vai num contêiner de BLOCO, não no próprio link: margem vertical
  // não desloca caixa inline (o link é `inline-flex`), então com o `-mt-11`
  // direto nele o bloco continuava nascendo abaixo do menu.
  return (
    <div className="-mt-11 pl-14 lg:mt-0 lg:pl-0">
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white [@media(pointer:coarse)]:min-h-[44px]"
      >
        <IconArrowLeft size={14} /> Configurações
      </Link>
    </div>
  );
}
