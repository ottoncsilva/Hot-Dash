"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import { showToast } from "@/lib/toast";
import {
  IconCheck,
  IconCopy,
  IconPlus,
  IconRefresh,
  IconSend,
  IconTrash,
} from "@/components/icons";
import type { DeliveryTarget } from "@/lib/types";

/**
 * APARELHOS DE ENTREGA — os celulares que recebem o post pronto na hora de
 * publicar (mídia, legenda e os botões de confirmação).
 *
 * O bloco vive no cadastro da modelo porque é ela quem opera os celulares; o
 * dropdown de cada conta de rede social é que escolhe qual deles recebe o quê.
 *
 * O PAREAMENTO é o passo que mais gera dúvida, então a tela o explica na
 * frente em vez de esconder num tooltip: a API do Telegram não deixa um bot
 * iniciar conversa, então enquanto ninguém mandar `/vincular <código>` no
 * celular não existe chat nenhum para onde mandar o post.
 */
export default function AparelhosBlock({
  profileId,
  onChanged,
}: {
  profileId: string;
  /** Avisa a página: o dropdown das contas lista estes mesmos aparelhos. */
  onChanged?: (targets: DeliveryTarget[]) => void;
}) {
  const [targets, setTargets] = useState<DeliveryTarget[]>([]);
  const [botUsername, setBotUsername] = useState<string | undefined>();
  const [botConfigurado, setBotConfigurado] = useState(true);
  const [label, setLabel] = useState("");
  const [criando, setCriando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const { confirm, ConfirmDialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{
        targets: DeliveryTarget[];
        botUsername?: string;
        botConfigurado: boolean;
      }>(`/api/profiles/${profileId}/delivery-targets`);
      setTargets(r.targets);
      setBotUsername(r.botUsername);
      setBotConfigurado(r.botConfigurado);
      onChanged?.(r.targets);
    } catch {
      /* bloco secundário: não derruba o cadastro inteiro */
    } finally {
      setCarregando(false);
    }
  }, [profileId, onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  async function criar() {
    if (!label.trim()) return;
    setCriando(true);
    try {
      await apiSend(`/api/profiles/${profileId}/delivery-targets`, "POST", { label });
      setLabel("");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao criar.", "error");
    } finally {
      setCriando(false);
    }
  }

  async function acao(id: string, body: Record<string, unknown>, sucesso?: string) {
    try {
      await apiSend(`/api/profiles/${profileId}/delivery-targets/${id}`, "PATCH", body);
      if (sucesso) showToast(sucesso, "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha na ação.", "error");
    }
  }

  async function remover(t: DeliveryTarget) {
    const ok = await confirm({
      title: `Remover “${t.label}”?`,
      message:
        "As contas que entregavam neste aparelho ficam sem entrega — os posts delas continuam no Cronograma, só param de chegar no celular.",
      confirmLabel: "Remover",
      danger: true,
    });
    if (!ok) return;
    try {
      await apiSend(`/api/profiles/${profileId}/delivery-targets/${t.id}`, "DELETE");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao remover.", "error");
    }
  }

  async function copiarComando(code: string) {
    try {
      await navigator.clipboard.writeText(`/vincular ${code}`);
      showToast("Comando copiado. Cole no bot, no celular.", "success");
    } catch {
      showToast("Não consegui copiar — digite o código na mão.", "error");
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">
          Aparelhos de entrega{" "}
          <span className="font-mono text-sm text-zinc-600">({targets.length})</span>
        </h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        O celular que recebe o post pronto — foto/vídeo, legenda e os botões de
        “Postei / Adiar / Não postei” — na hora de publicar. Cada conta de rede
        social escolhe o seu no cadastro da conta.
      </p>

      {!botConfigurado && (
        <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-300">
          O bot de entrega ainda não foi configurado. Cadastre o token dele em{" "}
          <span className="font-medium">Configurações → Entrega das postagens</span> —
          sem ele os aparelhos ficam cadastrados, mas nada é enviado.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Nome do aparelho (ex.: iPhone da Bruna)"
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void criar();
            }
          }}
        />
        <button onClick={criar} disabled={criando || !label.trim()} className="btn-ghost">
          <IconPlus size={16} /> Adicionar
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        {!carregando && targets.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
            Nenhum aparelho. Sem um deles, os posts desta modelo continuam só no
            Cronograma.
          </div>
        )}
        {targets.map((t) => (
          <div key={t.id} className={`card p-4 ${t.active ? "" : "opacity-55"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-100">{t.label}</span>
                  <button
                    onClick={() => acao(t.id, { active: !t.active })}
                    title={
                      t.active
                        ? "Desativar: para de receber, sem perder o vínculo."
                        : "Ativar: volta a receber os posts."
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      t.active
                        ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                        : "border-white/15 text-zinc-500 hover:bg-white/5"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        t.active ? "bg-emerald-400" : "bg-zinc-600"
                      }`}
                    />
                    {t.active ? "ativo" : "inativo"}
                  </button>
                </div>

                {t.chatId ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-400">
                    <IconCheck size={13} /> vinculado
                    {t.chatName ? (
                      <span className="text-zinc-500">· {t.chatName}</span>
                    ) : null}
                  </p>
                ) : (
                  <div className="mt-2 rounded-lg border border-white/10 bg-ink-850 p-3">
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                      Falta vincular. No celular, abra{" "}
                      <span className="font-medium text-zinc-200">
                        {botUsername ? `@${botUsername}` : "o bot de entrega"}
                      </span>{" "}
                      no Telegram e mande:
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="rounded bg-black/40 px-2 py-1 font-mono text-sm text-zinc-100">
                        /vincular {t.pairCode}
                      </code>
                      <button
                        onClick={() => copiarComando(t.pairCode || "")}
                        className="text-zinc-500 hover:text-white"
                        aria-label="Copiar comando"
                        title="Copiar comando"
                      >
                        <IconCopy size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 gap-1">
                {t.chatId && (
                  <button
                    onClick={() => acao(t.id, { action: "test" }, "Mensagem de teste enviada.")}
                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
                    aria-label="Testar envio"
                    title="Testar envio"
                  >
                    <IconSend size={16} />
                  </button>
                )}
                {t.chatId && (
                  <button
                    onClick={() =>
                      acao(t.id, { action: "reset" }, "Vínculo desfeito. Use o código novo.")
                    }
                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
                    aria-label="Trocar de celular"
                    title="Trocar de celular: desfaz o vínculo e gera um código novo"
                  >
                    <IconRefresh size={16} />
                  </button>
                )}
                <button
                  onClick={() => remover(t)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-red-400"
                  aria-label="Remover"
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {ConfirmDialog}
    </div>
  );
}
