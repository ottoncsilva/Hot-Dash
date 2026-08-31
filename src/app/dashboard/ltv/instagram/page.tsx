"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Switch from "@/components/Switch";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import { useProfile } from "@/context/ProfileContext";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { IconCopy, IconInstagram, IconLink, IconSettings, IconTrash } from "@/components/icons";
import type { IgAccount, IgAgentSettings } from "@/lib/instagram/db";
import type { InstagramAppSettingsPublic } from "@/lib/settings";

/**
 * INSTAGRAM — conexões e agente de DM.
 *
 * Mora no menu do LTV porque é ali que ficam as conversas com lead, mas o motor
 * é outro (ver `lib/instagram/agent.ts`) e nada aqui compartilha tabela,
 * produto ou prompt com o WhatsApp e o Telegram. A única coisa em comum é a
 * persona da modelo, puxada do cadastro dela.
 *
 * Uma modelo pode ter VÁRIAS contas — é o normal no canal —, então a tela é uma
 * lista, não um formulário só.
 */

type ContaComAjustes = IgAccount & { settings: IgAgentSettings };
type Cadastrada = { username: string; url?: string };
/** Como está o recebimento de mensagens, perguntado à Meta. */
type Webhook = { ativo: boolean; callbackUrl?: string; campos: string[]; erro?: string };
type Persona = {
  name: string;
  toneTags: string[];
  temPersonalidade: boolean;
  temHistoria: boolean;
  temLimites: boolean;
};

const ROTULO_STATUS: Record<IgAccount["status"], string> = {
  connected: "conectada",
  expired: "login vencido",
  error: "com problema",
  disconnected: "desconectada",
};
const COR_STATUS: Record<IgAccount["status"], string> = {
  connected: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  expired: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  error: "border-red-500/30 bg-red-500/10 text-red-400",
  disconnected: "border-white/10 bg-white/[0.03] text-zinc-400",
};

export default function InstagramPage() {
  const { profileId } = useProfile();
  const [carregando, setCarregando] = useState(true);
  const [app, setApp] = useState<InstagramAppSettingsPublic | null>(null);
  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [contas, setContas] = useState<ContaComAjustes[]>([]);
  const [cadastradas, setCadastradas] = useState<Cadastrada[]>([]);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [conectando, setConectando] = useState(false);

  const carregar = useCallback(async (pid: string) => {
    setCarregando(true);
    try {
      const d = await apiGet<{
        app: InstagramAppSettingsPublic;
        webhook: Webhook | null;
        webhookUrl: string;
        contas: ContaComAjustes[];
        cadastradas: Cadastrada[];
        persona: Persona | null;
      }>(`/api/instagram/accounts?profileId=${pid}`);
      setApp(d.app);
      setWebhook(d.webhook);
      setWebhookUrl(d.webhookUrl || "");
      setContas(d.contas);
      setCadastradas(d.cadastradas);
      setPersona(d.persona);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao carregar.", "error");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (profileId) carregar(profileId);
  }, [profileId, carregar]);

  /**
   * Gera o link de conexão. Ele NÃO é aberto aqui: quem precisa abri-lo é a
   * modelo, logada no Instagram dela — quase sempre no celular dela, não neste
   * navegador. Por isso o link é copiado para mandar, e não seguido.
   */
  async function gerarLink() {
    if (!profileId) return;
    setConectando(true);
    try {
      const r = await apiSend<{ url: string }>("/api/instagram/connect", "POST", { profileId });
      await navigator.clipboard.writeText(r.url).catch(() => {});
      showToast("Link copiado — mande para a modelo abrir no celular dela.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao gerar o link.", "error");
    } finally {
      setConectando(false);
    }
  }

  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Instagram" />
        <PrecisaDeModelo oQue="gerenciar as contas do Instagram" />
      </div>
    );
  }

  const appPronto = Boolean(app?.appId && app?.hasSecret && app?.publicBaseUrl);

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconInstagram size={22} /> Instagram
          </span>
        }
      />

      <AppBlock
        app={app}
        webhook={webhook}
        webhookUrl={webhookUrl}
        onSaved={(a, w) => {
          setApp(a);
          if (w !== undefined) setWebhook(w);
        }}
      />

      {persona && <PersonaBlock persona={persona} />}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">contas conectadas</p>
        <button
          type="button"
          onClick={gerarLink}
          disabled={!appPronto || conectando}
          className="btn-primary text-xs"
          title={appPronto ? "" : "Cadastre o app da Meta antes"}
        >
          {conectando ? "Gerando..." : "+ Conectar conta"}
        </button>
      </div>

      {!appPronto && (
        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-300">
          Preencha o aplicativo da Meta acima antes de conectar qualquer conta.
        </p>
      )}

      {carregando ? (
        <div className="mt-3 card h-24 animate-pulse" />
      ) : contas.length === 0 ? (
        <div className="mt-3 card p-6 text-center text-sm text-zinc-500">
          Nenhuma conta conectada ainda.
          {cadastradas.length > 0 && (
            <span className="mt-1 block text-xs text-zinc-600">
              No cadastro desta modelo já existe: {cadastradas.map((c) => "@" + c.username).join(", ")}.
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {contas.map((c) => (
            <ContaCard key={c.id} conta={c} onChange={() => carregar(profileId)} />
          ))}
        </div>
      )}

      {/* As contas que a modelo TEM mas ainda não conectou. Cadastro é
          anotação; conexão é token — e sem mostrar as duas juntas, ninguém
          percebe que a conta principal ficou de fora. */}
      {!carregando && cadastradas.length > 0 && contas.length > 0 && (
        <p className="mt-3 text-[11px] text-zinc-600">
          Ainda sem conectar, do cadastro da modelo: {cadastradas.map((c) => "@" + c.username).join(", ")}.
        </p>
      )}
    </div>
  );
}

/**
 * O aplicativo da Meta — um só, para TODAS as modelos.
 *
 * Fica nesta tela e não em Configurações porque é aqui que ele é usado: quem
 * vem conectar uma conta e esbarra na falta do App ID precisa resolver no
 * lugar onde tropeçou, não dois cliques adiante.
 */
function AppBlock({
  app,
  webhook,
  webhookUrl,
  onSaved,
}: {
  app: InstagramAppSettingsPublic | null;
  webhook: Webhook | null;
  webhookUrl: string;
  onSaved: (a: InstagramAppSettingsPublic, w?: Webhook | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [base, setBase] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [ligando, setLigando] = useState(false);
  const [erroWebhook, setErroWebhook] = useState<string | null>(null);

  useEffect(() => {
    if (!app) return;
    setAppId(app.appId);
    setBase(app.publicBaseUrl);
    // O segredo nunca volta do servidor: o campo nasce vazio e só é enviado
    // quando alguém digita algo novo.
    setSecret("");
  }, [app]);

  const pronto = Boolean(app?.appId && app?.hasSecret && app?.publicBaseUrl);

  async function salvar() {
    setSalvando(true);
    setErroWebhook(null);
    try {
      const r = await apiSend<{
        app: InstagramAppSettingsPublic;
        webhook: Webhook | null;
        webhookErro?: string;
      }>("/api/instagram/accounts", "POST", {
        action: "save-app",
        appId,
        publicBaseUrl: base,
        ...(secret ? { appSecret: secret } : {}),
      });
      onSaved(r.app, r.webhook);
      setSecret("");
      setErroWebhook(r.webhookErro || null);
      showToast(
        r.webhook?.ativo ? "Salvo — e o recebimento de mensagens já está ligado." : "Salvo!",
        r.webhookErro ? "error" : "success",
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
    } finally {
      setSalvando(false);
    }
  }

  /** Tentar de novo sem reeditar nada — o motivo mais comum de falha é o painel
   *  ainda não estar no ar no endereço informado, e isso se resolve esperando. */
  async function ligarWebhook() {
    setLigando(true);
    setErroWebhook(null);
    try {
      const r = await apiSend<{ ok: boolean; erro?: string; webhook: Webhook }>(
        "/api/instagram/accounts",
        "POST",
        { action: "configurar-webhook" },
      );
      if (app) onSaved(app, r.webhook);
      setErroWebhook(r.erro || null);
      showToast(r.ok ? "Recebimento ligado." : r.erro || "A Meta recusou.", r.ok ? "success" : "error");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setLigando(false);
    }
  }

  const callback = base ? `${base.replace(/\/+$/, "")}/api/instagram/callback` : "";

  return (
    <div className="mt-5 card p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400">
            <IconSettings size={16} />
          </span>
          <span>
            <span className="block text-sm font-medium text-zinc-100">Aplicativo da Meta</span>
            <span className="block text-[11px] text-zinc-500">
              Um só para todas as modelos.{" "}
              {!pronto
                ? "Ainda falta preencher."
                : webhook?.ativo
                  ? "Configurado, recebendo mensagens."
                  : "Configurado — falta ligar o recebimento."}
            </span>
          </span>
        </span>
        <span
          className={`shrink-0 text-[11px] ${
            pronto && webhook?.ativo ? "text-emerald-400" : "text-amber-400"
          }`}
        >
          {aberto ? "fechar" : pronto ? "ver" : "preencher"}
        </span>
      </button>

      {aberto && (
        <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4">
          <div>
            <label className="eyebrow mb-1.5 block">Endereço público do painel</label>
            <input
              className="input"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="https://painel.seudominio.com"
            />
            <p className="mt-1 text-[11px] text-zinc-600">
              Sem barra no fim. É daqui que saem as duas URLs abaixo, e a Meta compara letra por
              letra com o que está cadastrado no app.
            </p>
          </div>

          {base && (
            <div className="grid gap-2">
              {/* A ÚNICA URL que ainda precisa ser colada à mão. As configurações
                  de login do app não são expostas pela API da Meta — o
                  recebimento de mensagens é, e por isso ele se resolve sozinho
                  logo abaixo. */}
              <UrlParaCopiar label="OAuth Redirect URI (colar na Meta)" url={callback} />
            </div>
          )}

          <div>
            <label className="eyebrow mb-1.5 block">Instagram App ID</label>
            <input className="input" value={appId} onChange={(e) => setAppId(e.target.value)} />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">
              Instagram App Secret {app?.hasSecret && <span className="text-emerald-400">· salvo</span>}
            </label>
            <input
              className="input"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={app?.hasSecret ? "•••••••• (deixe vazio para manter)" : ""}
            />
            <p className="mt-1 text-[11px] text-zinc-600">
              Também é ele que assina o webhook — sem o segredo certo, nenhuma mensagem é aceita.
            </p>
          </div>
          <button type="button" onClick={salvar} disabled={salvando} className="btn-primary">
            {salvando ? "Salvando e ligando..." : "Salvar aplicativo"}
          </button>

          <RecebimentoBlock
            webhook={webhook}
            webhookUrl={webhookUrl}
            erro={erroWebhook}
            ocupado={ligando}
            pronto={pronto}
            onLigar={ligarWebhook}
          />
        </div>
      )}
    </div>
  );
}

/**
 * O RECEBIMENTO DE MENSAGENS, e se ele está mesmo de pé.
 *
 * Este era o passo que o operador fazia à mão no console da Meta e o único que
 * errava em silêncio: esquecer de assinar o campo `messages` deixa tudo com
 * cara de certo e nada chega. Agora o painel se cadastra sozinho ao salvar as
 * credenciais — e o que se vê aqui não é o que ACHAMOS que configuramos, é o
 * que a Meta respondeu quando a tela perguntou.
 *
 * Quando falha, a mensagem de erro dela vale mais que qualquer instrução
 * genérica: é ela que diz se o endereço está fora do ar, se veio http em vez
 * de https, ou se o aperto de mão não bateu. Por isso ela aparece inteira, e
 * a URL fica à mão para o caminho manual, que continua existindo.
 */
function RecebimentoBlock({
  webhook,
  webhookUrl,
  erro,
  ocupado,
  pronto,
  onLigar,
}: {
  webhook: Webhook | null;
  webhookUrl: string;
  erro: string | null;
  ocupado: boolean;
  pronto: boolean;
  onLigar: () => void;
}) {
  if (!pronto) return null;

  const ativo = Boolean(webhook?.ativo);
  // Cadastrado, mas entregando em OUTRO lugar. Acontece ao trocar o domínio do
  // painel: a Meta continua mandando para o endereço velho, e sem dizer isso a
  // tela mostraria "não configurado" sem explicar por quê.
  const outroDestino =
    webhook && !webhook.ativo && webhook.callbackUrl && webhook.callbackUrl !== webhookUrl;

  return (
    <div
      className={`rounded-xl border p-3 ${
        ativo ? "border-emerald-500/25 bg-emerald-500/[0.05]" : "border-amber-500/25 bg-amber-500/[0.06]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-xs font-medium ${ativo ? "text-emerald-300" : "text-amber-300"}`}>
            {ativo ? "Recebendo mensagens" : "Recebimento não está de pé"}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {ativo
              ? "A Meta confirmou que entrega as mensagens neste painel. Nada a fazer no site dela."
              : "O painel tenta ligar sozinho ao salvar. Se não deu, tente de novo aqui."}
          </p>
        </div>
        {!ativo && (
          <button
            type="button"
            onClick={onLigar}
            disabled={ocupado}
            className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
          >
            {ocupado ? "Ligando..." : "Ligar agora"}
          </button>
        )}
      </div>

      {erro && (
        <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-2.5 py-1.5 text-[11px] leading-relaxed text-red-300">
          A Meta respondeu: {erro}
        </p>
      )}

      {outroDestino && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">
          O aplicativo está cadastrado, mas entregando em <code>{webhook!.callbackUrl}</code> — não
          neste painel. Trocou o endereço? Clique em Ligar agora para apontar para cá.
        </p>
      )}

      {webhook?.erro && !erro && (
        <p className="mt-2 text-[11px] text-zinc-500">Não deu para conferir com a Meta: {webhook.erro}</p>
      )}

      {!ativo && webhookUrl && (
        <div className="mt-2.5 border-t border-white/[0.06] pt-2.5">
          <p className="mb-1.5 text-[11px] text-zinc-600">
            Se preferir fazer à mão no site da Meta, o endereço é este — e o campo a assinar é{" "}
            <code>messages</code>. A palavra de verificação o painel guarda sozinho.
          </p>
          <UrlParaCopiar label="URL do Webhook" url={webhookUrl} />
        </div>
      )}
    </div>
  );
}

function UrlParaCopiar({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{url}</span>
      <button
        type="button"
        title="Copiar"
        onClick={() => {
          navigator.clipboard.writeText(url).catch(() => {});
          showToast("Copiado!", "success");
        }}
        className="shrink-0 text-zinc-600 transition-colors hover:text-white"
      >
        <IconCopy size={13} />
      </button>
    </div>
  );
}

/** De onde vem o jeito de falar da IA neste canal — e o que NÃO vem. */
function PersonaBlock({ persona }: { persona: Persona }) {
  const faltando = [
    !persona.temPersonalidade && "personalidade",
    !persona.temHistoria && "história",
    !persona.temLimites && "limites",
  ].filter(Boolean) as string[];

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <p className="text-xs text-zinc-300">
        A IA fala como <b>{persona.name}</b>
        {persona.toneTags.length > 0 && <> ({persona.toneTags.join(" + ")})</>}, puxando a persona do
        cadastro da modelo.
      </p>
      <p className="mt-1 text-[11px] text-zinc-600">
        As regras de conversa são as mesmas para todas as modelos e não são editáveis: nada de
        preço, VIP, link ou conteúdo explícito — é o que mantém a conta de pé.
        {faltando.length > 0 && (
          <span className="text-amber-400/80">
            {" "}
            Falta preencher no cadastro: {faltando.join(", ")}.
          </span>
        )}
      </p>
    </div>
  );
}

function ContaCard({ conta, onChange }: { conta: ContaComAjustes; onChange: () => void }) {
  const [s, setS] = useState<IgAgentSettings>(conta.settings);
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);

  useEffect(() => setS(conta.settings), [conta.settings]);

  async function salvar(patch: Partial<IgAgentSettings>) {
    const novo = { ...s, ...patch };
    setS(novo);
    setSalvando(true);
    try {
      await apiSend("/api/instagram/accounts", "POST", {
        action: "save-settings",
        accountId: conta.id,
        settings: novo,
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
      setS(conta.settings);
    } finally {
      setSalvando(false);
    }
  }

  async function desconectar() {
    if (
      !confirm(
        `Desconectar @${conta.username || "esta conta"}? As conversas guardadas dela também somem. A modelo pode reconectar depois.`,
      )
    )
      return;
    try {
      await apiSend("/api/instagram/accounts", "POST", { action: "disconnect", accountId: conta.id });
      showToast("Conta desconectada.", "success");
      onChange();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    }
  }

  const vence = conta.tokenExpiresAt
    ? Math.ceil((conta.tokenExpiresAt - Date.now()) / 86400000)
    : null;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-sm font-semibold text-zinc-100">
            <IconInstagram size={15} />
            {conta.username ? `@${conta.username}` : "conta sem @"}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${COR_STATUS[conta.status]}`}
            >
              {ROTULO_STATUS[conta.status]}
            </span>
            {vence !== null && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  vence <= 7
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-white/10 bg-white/[0.03] text-zinc-500"
                }`}
                title="O login do Instagram dura 60 dias e é renovado sozinho — isto só acende se a renovação estiver falhando."
              >
                login vence em {vence}d
              </span>
            )}
          </div>
          {conta.statusDetail && (
            <p className="mt-1.5 text-[11px] text-amber-400/80">{conta.statusDetail}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <Switch checked={s.enabled} onChange={(v) => salvar({ enabled: v })} />
            responder
          </label>
          <button
            type="button"
            onClick={desconectar}
            title="Desconectar"
            className="text-zinc-700 transition-colors hover:text-red-400"
          >
            <IconTrash size={14} />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="mt-3 text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
      >
        {aberto ? "esconder ajustes" : "ajustes desta conta"}
      </button>

      {aberto && (
        <div className="mt-3 grid gap-3 border-t border-white/[0.06] pt-3">
          <div>
            <label className="eyebrow mb-1.5 block">Para onde mandar o lead</label>
            <select
              className="input"
              value={s.ctaTarget}
              onChange={(e) => salvar({ ctaTarget: e.target.value as IgAgentSettings["ctaTarget"] })}
            >
              <option value="bio">Link da bio</option>
              <option value="stories">Link dos stories</option>
              <option value="ambos">Os dois</option>
            </select>
            <p className="mt-1 flex items-start gap-1.5 text-[11px] text-zinc-600">
              <IconLink size={11} className="mt-0.5 shrink-0" />
              A IA só DIZ onde o link está — ela nunca escreve o endereço. É o que o Instagram
              proíbe, e o que uma checagem própria barra antes de qualquer envio.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow mb-1.5 block">Respostas por conversa</label>
              <input
                className="input"
                type="number"
                min={1}
                max={20}
                value={s.maxTurns}
                onChange={(e) => setS({ ...s, maxTurns: Number(e.target.value) })}
                onBlur={() => salvar({ maxTurns: s.maxTurns })}
              />
              <p className="mt-1 text-[11px] text-zinc-600">
                Passou disso, a conversa encerra. Não é para aquecer.
              </p>
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Limite diário</label>
              <input
                className="input"
                type="number"
                min={0}
                max={1000}
                value={s.dailyLimit}
                onChange={(e) => setS({ ...s, dailyLimit: Number(e.target.value) })}
                onBlur={() => salvar({ dailyLimit: s.dailyLimit })}
              />
              <p className="mt-1 text-[11px] text-zinc-600">Mensagens enviadas por dia, nesta conta.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow mb-1.5 block">Espera mínima (s)</label>
              <input
                className="input"
                type="number"
                min={0}
                value={s.delayMinS}
                onChange={(e) => setS({ ...s, delayMinS: Number(e.target.value) })}
                onBlur={() => salvar({ delayMinS: s.delayMinS })}
              />
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Espera máxima (s)</label>
              <input
                className="input"
                type="number"
                min={0}
                value={s.delayMaxS}
                onChange={(e) => setS({ ...s, delayMaxS: Number(e.target.value) })}
                onBlur={() => salvar({ delayMaxS: s.delayMaxS })}
              />
            </div>
          </div>

          <div>
            <label className="eyebrow mb-1.5 block">Observações desta conta</label>
            <textarea
              className="input min-h-[70px]"
              value={s.extraNotes}
              onChange={(e) => setS({ ...s, extraNotes: e.target.value })}
              onBlur={() => salvar({ extraNotes: s.extraNotes })}
              placeholder="Opcional. Ex.: essa conta é de conteúdo fitness, fale mais de treino."
            />
            <p className="mt-1 text-[11px] text-zinc-600">
              Entra no fim do prompt e nunca sobrepõe as proibições — nada aqui destrava preço,
              VIP ou link.
            </p>
          </div>
          {salvando && <p className="text-[11px] text-zinc-600">salvando...</p>}
        </div>
      )}
    </div>
  );
}
