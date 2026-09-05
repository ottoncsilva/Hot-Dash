"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import CampoSecreto from "@/components/CampoSecreto";
import { showToast } from "@/lib/toast";
import { BackToSettings, KeyLabel } from "../_shared";

type BotState = {
  hasToken: boolean;
  botUsername?: string;
  webhookAt?: number;
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
                que cada aparelho manda <code className="font-mono">/vincular</code>.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 card p-4">
        <p className="text-sm font-medium text-white">Como ligar um celular</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-500">
          <li>Salve o token acima.</li>
          <li>
            Em <span className="text-zinc-300">Modelos → a modelo → Aparelhos de entrega</span>,
            cadastre o celular e copie o comando.
          </li>
          <li>No celular, abra o bot no Telegram e mande o comando copiado.</li>
          <li>
            No cadastro de cada conta (Instagram, TikTok…), escolha o aparelho no campo{" "}
            <span className="text-zinc-300">Entregar em</span>.
          </li>
        </ol>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
          O passo do <code className="font-mono">/vincular</code> não é burocracia: a API do
          Telegram não deixa um bot iniciar conversa. Sem alguém falar com ele primeiro,
          não existe conversa para onde mandar o post.
        </p>
      </div>
    </div>
  );
}
