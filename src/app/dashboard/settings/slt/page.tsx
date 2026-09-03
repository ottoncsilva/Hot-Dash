"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconTrash, IconPlus } from "@/components/icons";
import { useConfirm } from "@/hooks/useConfirm";
import type { SltNetwork } from "@/lib/sltNetworks";
import { BackToSettings, KeyLabel } from "../_shared";
import CampoSecreto from "@/components/CampoSecreto";
import { showToast } from "@/lib/toast";

type SltState = {
  hasApiKey: boolean;
  lastSyncedAt?: number;
  lastSyncError?: string;
};

/** Ver `sltDiagnosticoSessao` no servidor. */
type SltSessao = { views: number; viewsComSessao: number; sessoesDistintas: number };

/**
 * Links da Bio (integração com o SLT, slt.bio) — só leitura, uma chave pra
 * conta inteira (não é por modelo). Sincroniza sozinho a cada ~3 min (ver
 * instrumentation.ts); o botão aqui é só pra não esperar o próximo tick
 * depois de configurar.
 *
 * Tela própria (fora de Pagamentos): não é um provedor de cobrança, é uma
 * fonte de tráfego/analytics — a atribuição de cada página por modelo mora
 * na tela de Links; aqui fica a chave, a sincronização e o CADASTRO das
 * redes de tráfego que a tela de Links oferece pra classificar cada página.
 */
export default function SltSettingsPage() {
  const [sltState, setSltState] = useState<SltState | null>(null);
  const [sltApiKey, setSltApiKey] = useState("");
  const [sltSaving, setSltSaving] = useState(false);
  const [sltSyncing, setSltSyncing] = useState(false);
  const [sltMsg, setSltMsg] = useState<string | null>(null);
  const [sltSessao, setSltSessao] = useState<SltSessao | null>(null);

  function loadSlt() {
    apiGet<{ settings: SltState; sessao: SltSessao }>("/api/settings/slt")
      .then((d) => {
        setSltState(d.settings);
        setSltSessao(d.sessao);
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadSlt();
  }, []);

  async function salvarChaveSlt() {
    setSltSaving(true);
    setSltMsg(null);
    try {
      await apiSend("/api/settings/slt", "PATCH", { apiKey: sltApiKey });
      setSltApiKey("");
      setSltMsg("Chave salva e validada.");
      loadSlt();
    } catch (e) {
      setSltMsg(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSltSaving(false);
    }
  }

  async function desconectarSlt() {
    setSltSaving(true);
    setSltMsg(null);
    try {
      await apiSend("/api/settings/slt", "PATCH", { apiKey: "" });
      setSltMsg("Chave removida.");
      loadSlt();
    } catch (e) {
      setSltMsg(e instanceof Error ? e.message : "Falha ao remover.");
    } finally {
      setSltSaving(false);
    }
  }

  async function sincronizarSltAgora() {
    setSltSyncing(true);
    setSltMsg(null);
    try {
      const d = await apiSend<{ ok: boolean; synced: number; error?: string }>(
        "/api/settings/slt",
        "POST",
        {},
      );
      setSltMsg(
        d.ok
          ? `Sincronizado: ${d.synced} evento(s) novo(s).`
          : `Falha na sincronização: ${d.error || "erro desconhecido"}`,
      );
      loadSlt();
    } catch (e) {
      setSltMsg(e instanceof Error ? e.message : "Falha ao sincronizar.");
    } finally {
      setSltSyncing(false);
    }
  }

  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Links da Bio</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Integração com o SLT (slt.bio): traz visualização e clique de cada página pro Funil de
        Vendas e pra tela de Links. A chave é guardada criptografada (AES-256) no servidor.
      </p>

      <div className="mt-4 card p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-white">Chave da API</span>
          {sltState?.hasApiKey && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              conectado
            </span>
          )}
        </div>

        <div className="mt-3">
          <KeyLabel salva={Boolean(sltState?.hasApiKey)}>API Key</KeyLabel>
        </div>
        <CampoSecreto
          name="slt-api-key"
          placeholder={sltState?.hasApiKey ? "•••••••• (em branco = manter)" : "slt_live_..."}
          value={sltApiKey}
          onChange={setSltApiKey}
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Gerada em slt.bio → Dashboard → Settings → API Keys (planos Pro/Agency).
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={salvarChaveSlt}
            disabled={sltSaving || !sltApiKey.trim()}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {sltSaving ? "Salvando..." : "Salvar chave"}
          </button>
          {sltState?.hasApiKey && (
            <>
              <button
                type="button"
                onClick={sincronizarSltAgora}
                disabled={sltSyncing}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                {sltSyncing ? "Sincronizando..." : "Sincronizar agora"}
              </button>
              <button
                type="button"
                onClick={desconectarSlt}
                disabled={sltSaving}
                className="btn-ghost px-3 py-1.5 text-xs text-red-400"
              >
                Remover chave
              </button>
            </>
          )}
        </div>

        {sltState?.hasApiKey && (
          <p className="mt-2 text-[11px] text-zinc-500">
            {sltState.lastSyncedAt
              ? `Última sincronização com evento novo: ${new Date(sltState.lastSyncedAt).toLocaleString("pt-BR")}.`
              : "Ainda sem eventos sincronizados — o tick de fundo roda a cada minuto e checa a cada ~3min."}
            {sltState.lastSyncError && (
              <span className="mt-1 block text-amber-400">Último erro: {sltState.lastSyncError}</span>
            )}
          </p>
        )}
        {sltMsg && <p className="mt-2 text-xs text-zinc-300">{sltMsg}</p>}
      </div>

      {sltState?.hasApiKey && sltSessao && sltSessao.views > 0 && (
        <ComoAVisualizacaoEContada dados={sltSessao} />
      )}

      <RedesDeTrafego />
    </div>
  );
}

/**
 * Diz, em português, o que a coluna "visualizações" do Funil de Vendas
 * realmente está contando.
 *
 * O SLT manda (ou não) um identificador de sessão junto de cada
 * visualização. Com ele, a mesma pessoa recarregando a página conta UMA vez
 * — é gente. Sem ele, cada carregamento conta — e o navegador embutido do
 * Instagram/TikTok recarrega sozinho, então o número infla. Como esse campo
 * não está na documentação pública do SLT, a única resposta honesta vem de
 * olhar o que de fato chegou. É o que este bloco mostra.
 */
function ComoAVisualizacaoEContada({ dados }: { dados: SltSessao }) {
  const { views, viewsComSessao, sessoesDistintas } = dados;
  const pct = Math.round((viewsComSessao / views) * 100);
  const temSessao = viewsComSessao > 0;
  const parcial = temSessao && viewsComSessao < views;

  return (
    <div className="mt-4 card p-4">
      <span className="font-medium text-white">Como a visualização é contada</span>

      <p className="mt-2 text-sm text-zinc-400">
        {!temSessao ? (
          <>
            O SLT <strong className="text-amber-400">não está mandando sessão</strong> nas
            visualizações — nenhuma das {views.toLocaleString("pt-BR")} registradas. Sem
            sessão, cada CARREGAMENTO de página conta como uma visualização, e não cada
            pessoa. Como o navegador embutido do Instagram e do TikTok recarrega a página
            sozinho, o número de visualizações do Funil de Vendas fica{" "}
            <strong className="text-amber-400">acima</strong> do de gente de verdade — e a
            taxa de conversão, abaixo. Cliques e vendas não são afetados.
          </>
        ) : parcial ? (
          <>
            {pct}% das {views.toLocaleString("pt-BR")} visualizações vêm com sessão (
            {sessoesDistintas.toLocaleString("pt-BR")} sessões distintas). Essas contam por
            PESSOA. Os {(100 - pct)}% restantes contam por carregamento, então o total ainda
            fica um pouco acima do número real de visitantes.
          </>
        ) : (
          <>
            Todas as {views.toLocaleString("pt-BR")} visualizações vêm com sessão —{" "}
            {sessoesDistintas.toLocaleString("pt-BR")} sessões distintas. A contagem do Funil
            de Vendas é por <strong className="text-emerald-400">pessoa</strong>, não por
            carregamento: recarregar a página não infla o número.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Cadastro das redes de tráfego (Instagram, TikTok...) que a tela de Links
 * oferece pra classificar cada página do SLT. Nasce semeado com as opções
 * de sempre — o operador adiciona o resto por aqui (ex.: Facebook).
 */
function RedesDeTrafego() {
  const [redes, setRedes] = useState<SltNetwork[]>([]);
  const [nome, setNome] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  function load() {
    apiGet<{ networks: SltNetwork[] }>("/api/settings/slt-networks")
      .then((d) => setRedes(d.networks))
      .catch(() => {});
  }
  useEffect(load, []);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSaving(true);
    setErro(null);
    try {
      const { network } = await apiSend<{ network: SltNetwork }>("/api/settings/slt-networks", "POST", {
        label: nome.trim(),
      });
      setRedes((prev) => [...prev, network]);
      setNome("");
      showToast("Salvo!");
    } catch (e2) {
      setErro(e2 instanceof Error ? e2.message : "Falha ao criar.");
    } finally {
      setSaving(false);
    }
  }

  async function remover(r: SltNetwork) {
    if (
      !(await confirm(
        `Excluir a rede "${r.label}"? Páginas já classificadas com ela mantêm o valor salvo, mas ele some das opções da tela de Links.`,
      ))
    )
      return;
    await apiSend(`/api/settings/slt-networks/${r.id}`, "DELETE");
    setRedes((prev) => prev.filter((x) => x.id !== r.id));
    showToast("Rede excluída.");
  }

  return (
    <div className="mt-4 card p-4">
      <p className="font-medium text-white">Redes de tráfego</p>
      <p className="mt-1 text-xs text-zinc-500">
        As opções que aparecem na tela de Links para classificar de qual rede vem cada página.
      </p>

      {redes.length > 0 && (
        <div className="mt-3 divide-y divide-white/[0.06] rounded-lg border border-white/10">
          {redes.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1 text-sm text-zinc-200">{r.label}</span>
              <span className="font-mono text-[10px] text-zinc-600">{r.key}</span>
              <button
                onClick={() => remover(r)}
                className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-red-400"
                aria-label={`Excluir ${r.label}`}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {erro && <p className="mt-2 text-xs text-red-400">{erro}</p>}

      <form onSubmit={criar} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 py-1.5 text-sm"
          placeholder="Ex.: Facebook, YouTube, Kwai..."
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <button type="submit" disabled={saving || !nome.trim()} className="btn-primary px-3 py-1.5 text-xs">
          <IconPlus size={14} /> Adicionar
        </button>
      </form>

      {ConfirmDialog}
    </div>
  );
}
