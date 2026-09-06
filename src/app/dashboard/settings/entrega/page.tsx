"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import CampoSecreto from "@/components/CampoSecreto";
import Switch from "@/components/Switch";
import { IconCopy, IconRefresh, IconTrash } from "@/components/icons";
import { useConfirm } from "@/hooks/useConfirm";
import { showToast } from "@/lib/toast";
import { BackToSettings, KeyLabel } from "../_shared";

type DeliveryChat = {
  chatId: string;
  name?: string;
  alert?: boolean;
  authorizedAt: number;
};

type BotState = {
  hasToken: boolean;
  botUsername?: string;
  webhookAt?: number;
  accessCode: string;
  chats: DeliveryChat[];
};

/**
 * ENTREGA DAS POSTAGENS — o bot do Telegram que leva o post pronto ao celular
 * de quem publica, na hora de publicar, e recebe de volta o "postei".
 *
 * Um bot para o painel inteiro, e não um por modelo: quem fala com ele é a
 * OPERAÇÃO. O mesmo celular pode cuidar de duas modelos, e um bot por modelo
 * obrigaria a mesma pessoa a manter várias conversas abertas para a mesma
 * tarefa. Quem escolhe QUAL celular recebe o quê é o cadastro da modelo
 * (Aparelhos de entrega) e o "Entregar em" de cada conta.
 */
export default function EntregaSettingsPage() {
  const [state, setState] = useState<BotState | null>(null);
  const [originProblem, setOriginProblem] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  function load() {
    apiGet<{ settings: BotState; originProblem: string | null }>("/api/settings/delivery-bot")
      .then((d) => {
        setState(d.settings);
        setOriginProblem(d.originProblem);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      await apiSend("/api/settings/delivery-bot", "PATCH", { token });
      setToken("");
      showToast("Bot de entrega conectado.", "success");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  /** As ações da lista de celulares (POST com `action`, ver a rota). */
  async function acaoChat(body: Record<string, unknown>, sucesso?: string) {
    try {
      const r = await apiSend<{ settings: BotState }>(
        "/api/settings/delivery-bot",
        "POST",
        body,
      );
      setState(r.settings);
      if (sucesso) showToast(sucesso, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha na ação.", "error");
    }
  }

  async function trocarCodigo() {
    const ok = await confirm({
      title: "Gerar um código novo?",
      message:
        "Os celulares já autorizados saem da lista e precisam mandar o código novo para abrir o menu. Os aparelhos que já recebem posts continuam recebendo.",
      confirmLabel: "Gerar novo",
      danger: true,
    });
    if (!ok) return;
    await acaoChat({ action: "regenerate-code" }, "Código novo gerado.");
  }

  async function removerChat(c: DeliveryChat) {
    const ok = await confirm({
      title: `Remover ${c.name || c.chatId}?`,
      message:
        "Este celular deixa de monitorar e de receber os posts dos aparelhos que estavam nele — esses aparelhos voltam a aparecer como pendentes no cadastro da modelo.",
      confirmLabel: "Remover",
      danger: true,
    });
    if (!ok) return;
    await acaoChat({ action: "remove-chat", chatId: c.chatId }, "Celular removido.");
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      showToast("Código copiado.", "success");
    } catch {
      showToast("Não consegui copiar — digite na mão.", "error");
    }
  }

  async function desconectar() {
    setSalvando(true);
    setMsg(null);
    try {
      await apiSend("/api/settings/delivery-bot", "PATCH", { token: "" });
      showToast("Bot removido. Nenhum post será entregue no celular.", "success");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Falha ao remover.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
        Entrega das postagens
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-zinc-500">
        Na hora de cada post do Cronograma, este bot manda a mídia, a legenda e
        três botões — <span className="text-zinc-300">Postei</span>,{" "}
        <span className="text-zinc-300">Adiar 30 min</span> e{" "}
        <span className="text-zinc-300">Não postei</span> — para o celular que
        opera a conta. O “Postei” grava a hora real da publicação no card.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-500">
        Um dos celulares pode ser o{" "}
        <span className="text-zinc-300">aparelho de monitoramento</span>: ele não publica
        nada — recebe tudo de todas as modelos, o aviso de cada post confirmado e a
        cobrança de quem passou de 40 minutos sem confirmar.
      </p>

      <div className="mt-5 card p-4">
        <KeyLabel salva={Boolean(state?.hasToken)}>Token do bot (BotFather)</KeyLabel>
        <CampoSecreto
          value={token}
          onChange={setToken}
          name="delivery-bot-token"
          placeholder={
            state?.hasToken ? "•••••••• em branco = manter o atual" : "123456:ABC-DEF..."
          }
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          Crie um bot novo no <span className="text-zinc-300">@BotFather</span> só para
          isto. Não reaproveite o bot de vendas de uma modelo: aquele fala com o
          público e tem funil de compra, e os dois usam webhooks diferentes.
        </p>

        {originProblem && (
          <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-xs leading-relaxed text-amber-300">
            {originProblem}
          </p>
        )}

        {msg && (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-xs text-red-300">
            {msg}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={salvar} disabled={salvando || !token.trim()} className="btn-primary">
            {salvando ? "Salvando..." : "Salvar e registrar webhook"}
          </button>
          {state?.hasToken && (
            <button onClick={desconectar} disabled={salvando} className="btn-ghost">
              Remover
            </button>
          )}
        </div>

        {state?.hasToken && (
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider">
              <span
                className={`h-2 w-2 rounded-full ${
                  state.webhookAt ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              <span className={state.webhookAt ? "text-emerald-400" : "text-amber-400"}>
                {state.webhookAt ? "Conectado" : "Token salvo, webhook não registrado"}
              </span>
            </p>
            {state.botUsername && (
              <p className="mt-1.5 text-xs text-zinc-500">
                Bot: <span className="text-zinc-300">@{state.botUsername}</span> — é nele
                que cada celular abre o menu.
              </p>
            )}
          </div>
        )}
      </div>

      {/* CELULARES E ALERTA. O código de acesso é o que substituiu o
          `/vincular <código do aparelho>`: um código só, digitado uma vez por
          celular, e daí em diante a escolha da modelo é uma lista de botões
          dentro do próprio Telegram. */}
      {state?.hasToken && (
        <div className="mt-4 card p-4">
          <p className="text-sm font-medium text-white">Celulares autorizados</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Os que publicam e o de <span className="text-zinc-300">monitoramento</span>,
            que acompanha e cobra.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Mande este código no bot, pelo celular. Ele libera o{" "}
            <span className="text-zinc-300">menu</span> — de lá a pessoa escolhe a
            modelo e o aparelho tocando em botões, sem código por aparelho.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded bg-black/40 px-3 py-1.5 font-mono text-lg tracking-[0.2em] text-zinc-100">
              {state.accessCode}
            </code>
            <button
              onClick={() => copiar(state.accessCode)}
              className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
              aria-label="Copiar código"
              title="Copiar código"
            >
              <IconCopy size={15} />
            </button>
            <button
              onClick={trocarCodigo}
              className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
              aria-label="Gerar código novo"
              title="Gerar código novo (tira todos os celulares da lista)"
            >
              <IconRefresh size={15} />
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {state.chats.length === 0 && (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-zinc-500">
                Nenhum celular autorizado ainda.
              </p>
            )}
            {state.chats.map((c) => (
              <div
                key={c.chatId}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-ink-850 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm text-zinc-100">
                    {c.name || "Sem nome"}
                    {c.alert && (
                      <span className="shrink-0 rounded-full border border-emerald-500/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-400">
                        monitoramento
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{c.chatId}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="hidden text-[11px] text-zinc-500 sm:inline">
                    monitoramento
                  </span>
                  <Switch
                    checked={Boolean(c.alert)}
                    ariaLabel="Usar como aparelho de monitoramento"
                    onChange={(v) =>
                      acaoChat(
                        { action: "set-alert", chatId: c.chatId, alert: v },
                        v
                          ? "Aparelho de monitoramento ligado."
                          : "Aparelho de monitoramento desligado.",
                      )
                    }
                  />
                  <button
                    onClick={() => removerChat(c)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-red-400"
                    aria-label="Remover celular"
                    title="Remover celular"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
            <span className="text-zinc-400">Aparelho de monitoramento</span> = o celular
            de quem <span className="text-zinc-400">cobra</span>, não de quem publica.
            Ele recebe uma cópia de{" "}
            <span className="text-zinc-400">todo post de todas as modelos</span> na hora
            marcada — inclusive dos posts cuja conta ainda não tem aparelho —, o aviso de{" "}
            <span className="text-zinc-400">cada post confirmado</span> e a cobrança de
            quem passou de <span className="text-zinc-400">40 minutos</span> sem
            confirmar. Cada aviso chega citando a mensagem do post, então dá para ver de
            qual se trata sem procurar.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
            Vai <span className="text-zinc-400">sem</span> os botões de confirmação: quem
            responde pelo post é o celular que publica. Dois lugares podendo marcar
            “postei” produziriam hora de publicação inventada por quem não publicou nada.
          </p>
        </div>
      )}

      <div className="mt-4 card p-4">
        <p className="text-sm font-medium text-white">Como ligar um celular</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-500">
          <li>Salve o token acima.</li>
          <li>
            No celular, abra o bot no Telegram e mande o{" "}
            <span className="text-zinc-300">código de acesso</span> do cartão acima.
          </li>
          <li>
            No menu que aparece, toque em{" "}
            <span className="text-zinc-300">Receber posts de uma modelo</span>, escolha a
            modelo e o aparelho — ou crie um aparelho ali mesmo, para este celular.
          </li>
          <li>
            No cadastro de cada conta (Instagram, TikTok…), escolha o aparelho no campo{" "}
            <span className="text-zinc-300">Entregar em</span>.
          </li>
        </ol>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
          O passo do código não é burocracia: a API do Telegram não deixa um bot iniciar
          conversa — sem alguém falar com ele primeiro, não existe conversa para onde
          mandar o post. E sem o código qualquer um que descobrisse o @ do bot abriria a
          lista de modelos. O <code className="font-mono">/vincular</code> por aparelho
          continua funcionando para quem já o usava.
        </p>
      </div>

      {ConfirmDialog}
    </div>
  );
}
