"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useConfirm } from "@/hooks/useConfirm";
import Switch from "@/components/Switch";
import {
  IconTelegram,
  IconClose,
  IconRefresh,
  IconMail,
  IconCheck,
  IconPayments,
  IconSend,
  IconPlus,
  IconTrash,
  IconCopy,
  IconUndo,
} from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import SectionRow, { resumo } from "@/components/telegram/bot/SectionRow";
import VarChips from "@/components/telegram/bot/VarChips";
import BotPreview from "@/components/telegram/bot/BotPreview";

// ---- Tipos (espelham telegramDb.ts) ----
type Bot = {
  id: string;
  /** A API nunca devolve o token — só se existe um salvo. */
  hasToken?: boolean;
  botUsername?: string;
  idVip: string;
  idAquecimento: string;
  idRegistro?: string;
  supportUsername?: string;
  welcomeMessage: string;
  welcomeMediaTags?: string;
  successMessage: string;
  downsellFunnel?: string;
  upsellFunnel?: string;
  previewsWelcomeMessage?: string;
  operationActive: boolean;
  vipApprovalMode: ApprovalMode;
  previasApprovalMode: ApprovalMode;
  pixGeneratingMessage?: string;
  pixCaption?: string;
  successButtonText?: string;
};
type ApprovalMode = "subscribers" | "all" | "manual";
type PixDefaults = { generatingMessage: string; caption: string };
type LinkStats = { starts: number; pixGenerated: number; pixPaid: number; paidCents: number };
type SourceLink = {
  id: string;
  code: string;
  name: string;
  slug?: string;
  createdAt: number;
  stats: LinkStats;
};
type OrphanCode = { code: string; stats: LinkStats };
type Plan = {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
  kind: "subscription" | "package";
  deliverable?: string;
};
type PeriodStats = { paidCents: number; paidCount: number; pendingCents: number; pendingCount: number; avgTicketCents: number };
type Metrics = { today: PeriodStats; month: PeriodStats; total: PeriodStats };
type CustomButton = { id: string; text: string; url: string; sortOrder: number };
type Sub = {
  id: string;
  telegramUserId: number;
  telegramUsername?: string;
  status: "pending" | "active" | "expired" | "blocked";
  expiresAt: number;
  createdAt: number;
};
type Tag = { id: string; name: string; color: string };
type FunnelStep = {
  delayMinutes: number;
  text: string;
  discountPercent?: number;
  mediaTags?: string;
  isLoop?: boolean;
};

export default function BotVendasPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  // Modelo escolhida no menu — vale para o painel inteiro.
  const { profileId } = useProfile();
  const [loading, setLoading] = useState(false);

  const [bot, setBot] = useState<Bot | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [buttons, setButtons] = useState<CustomButton[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [sourceLinks, setSourceLinks] = useState<SourceLink[]>([]);
  const [orphanCodes, setOrphanCodes] = useState<OrphanCode[]>([]);
  const [pixDefaults, setPixDefaults] = useState<PixDefaults | null>(null);
  const [tab, setTab] = useState<TabKey>("config");

  // A mensagem de boas-vindas e as etiquetas vivem AQUI, e não dentro da linha
  // que as edita: o preview à direita precisa acompanhar a digitação, e ele é
  // irmão do formulário, não filho.
  const [welcome, setWelcome] = useState("");
  const [welcomeTags, setWelcomeTags] = useState("");

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      const d = await apiGet<{
        bot: Bot | null;
        plans: Plan[];
        customButtons: CustomButton[];
        subscriptions: Sub[];
        availableTags: Tag[];
        metrics: Metrics;
        sourceLinks: SourceLink[];
        orphanCodes: OrphanCode[];
        pixDefaults: PixDefaults;
      }>(`/api/telegram?profileId=${profileId}`);
      setBot(d.bot);
      setPlans(d.plans || []);
      setButtons(d.customButtons || []);
      setSubs(d.subscriptions || []);
      setTags(d.availableTags || []);
      setMetrics(d.metrics || null);
      setSourceLinks(d.sourceLinks || []);
      setOrphanCodes(d.orphanCodes || []);
      setPixDefaults(d.pixDefaults || null);
      setWelcome(d.bot?.welcomeMessage || "");
      setWelcomeTags(d.bot?.welcomeMediaTags || "");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  // O preview só faz sentido nas abas que mudam o que o lead vê no /start.
  const mostraPreview = tab === "config" || tab === "planos";
  const previewButtons = [
    ...plans.map((p) => ({
      text: `${p.name} - ${(p.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      kind: "plan" as const,
    })),
    ...buttons.map((b) => ({ text: b.text, kind: "custom" as const })),
    ...(bot?.supportUsername ? [{ text: "💬 Suporte / Dúvidas", kind: "support" as const }] : []),
  ];

  useEffect(() => {
    load();
  }, [load]);

  // Sem modelo escolhida no menu ("Todas"), esta tela não tem o que
  // mostrar: bot, mailing e usuários são sempre de UMA modelo. Antes a tela
  // escolhia a primeira sozinha; com o seletor no menu isso viraria mentira.
  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Bot de vendas" />
        <PrecisaDeModelo oQue="configurar o bot de vendas" />
      </div>
    );
  }

  return (
    <div className="page px-1 py-2">
      {ConfirmDialog}
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconTelegram size={22} /> Bot de vendas
          </span>
        }
        description="Ofertas, funis, mensagens e assinantes do bot — o mesmo bot da automação de postagens."
      />
      <div className="mb-5" />

      {loading && (
        <div className="grid place-items-center py-10">
          <div className="h-7 w-7 animate-spin rounded-full border border-white/15 border-t-white" />
        </div>
      )}

      {!loading && !bot && (
        <div className="card p-6 text-center text-sm text-zinc-400">
          Este modelo ainda não tem o bot configurado. Vá em <b>Modelos → editar a modelo →
          Bot do Telegram</b>, informe o <b>Token do Bot</b> e os <b>IDs dos grupos VIP e
          Prévias</b> e salve. Depois volte aqui para configurar as vendas.
        </div>
      )}

      {!loading && bot && (
        <div className="space-y-5">
          <MetricsCard metrics={metrics} activeSubs={subs.filter((s) => s.status === "active" && s.expiresAt > 0).length} pendingSubs={subs.filter((s) => s.status === "pending").length} />

          {/* Abas em vez de uma rolagem com tudo aberto: cada assunto do bot
              ocupa a tela sozinho, e o preview do /start acompanha à direita. */}
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  tab === t.key
                    ? "bg-white/10 font-semibold text-white"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={mostraPreview ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]" : ""}>
            <div className="min-w-0 space-y-3">
              {tab === "config" && (
                <>
                  <WebhookCard profileId={profileId} bot={bot} onSaved={load} />
                  <WelcomeRow
                    profileId={profileId}
                    bot={bot}
                    tags={tags}
                    welcome={welcome}
                    setWelcome={setWelcome}
                    welcomeTags={welcomeTags}
                    setWelcomeTags={setWelcomeTags}
                    onSaved={load}
                  />
                  <SuccessRow profileId={profileId} bot={bot} onSaved={load} />
                  <PixRow profileId={profileId} bot={bot} pixDefaults={pixDefaults} onSaved={load} />
                  <ExtrasRow profileId={profileId} bot={bot} onSaved={load} />
                  <ButtonsCard profileId={profileId} buttons={buttons} onSaved={load} />
                </>
              )}
              {tab === "planos" && <PlansCard profileId={profileId} plans={plans} onSaved={load} />}
              {tab === "recuperacao" && (
                <FunnelCard profileId={profileId} bot={bot} tags={tags} onSaved={load} />
              )}
              {tab === "aprovacao" && (
                <ApprovalCard profileId={profileId} bot={bot} onSaved={load} />
              )}
              {tab === "trackeamento" && (
                <TrackingCard
                  profileId={profileId}
                  bot={bot}
                  links={sourceLinks}
                  orphans={orphanCodes}
                  onSaved={load}
                />
              )}
              {tab === "assinantes" && (
                <SubscribersCard subs={subs} onAction={load} confirm={confirm} />
              )}
            </div>

            {mostraPreview && (
              <BotPreview
                profileId={profileId}
                botUsername={bot.botUsername}
                welcomeMessage={welcome}
                welcomeMediaTags={welcomeTags}
                buttons={previewButtons}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { key: "config", label: "Configuração" },
  { key: "planos", label: "Planos" },
  { key: "recuperacao", label: "Recuperação" },
  { key: "aprovacao", label: "Aprovação Automática" },
  { key: "trackeamento", label: "Trackeamento" },
  { key: "assinantes", label: "Assinantes" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ---------------------------------------------------------------------------
// Métricas de venda (reaproveita o overview financeiro)
// ---------------------------------------------------------------------------
const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function MetricsCard({
  metrics,
  activeSubs,
  pendingSubs,
}: {
  metrics: Metrics | null;
  activeSubs: number;
  pendingSubs: number;
}) {
  const cards = [
    { label: "Vendas hoje", value: metrics ? money(metrics.today.paidCents) : "—", sub: metrics ? `${metrics.today.paidCount} venda(s)` : "" },
    { label: "Vendas no mês", value: metrics ? money(metrics.month.paidCents) : "—", sub: metrics ? `${metrics.month.paidCount} venda(s)` : "" },
    { label: "Ticket médio", value: metrics ? money(metrics.month.avgTicketCents) : "—", sub: "no mês" },
    { label: "Assinantes VIP", value: String(activeSubs), sub: `${pendingSubs} PIX pendente(s)` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="card p-4">
          <p className="eyebrow">{c.label}</p>
          <p className="mt-1 font-display text-2xl font-semibold text-white">{c.value}</p>
          {c.sub && <p className="mt-0.5 text-[11px] text-zinc-500">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conexão + Webhook
// ---------------------------------------------------------------------------
function WebhookCard({ profileId, bot, onSaved }: { profileId: string; bot: Bot; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [status, setStatus] = useState<{ matches?: boolean; url?: string; error?: string } | null>(null);
  // Endereço público que este app usaria para receber os updates. Vale a
  // consulta MESMO COM A OPERAÇÃO DESLIGADA: é o que deixa o operador ver que
  // a base está errada antes de tentar ligar e tomar o erro cru do Telegram.
  const [origin, setOrigin] = useState<{ url?: string; problem?: string | null } | null>(null);

  const active = bot.operationActive;

  const checkOrigin = useCallback(async () => {
    try {
      const r = await apiSend<{ ok: boolean; url?: string; problem?: string | null }>(
        "/api/telegram",
        "POST",
        { action: "webhook-origin", profileId },
      );
      setOrigin({ url: r.url, problem: r.problem });
    } catch {
      setOrigin(null);
    }
  }, [profileId]);

  const checkStatus = useCallback(async () => {
    try {
      const r = await apiSend<{ ok: boolean; info?: { url?: string; last_error_message?: string }; matches?: boolean; message?: string }>(
        "/api/telegram",
        "POST",
        { action: "webhook-status", profileId },
      );
      if (r.ok) setStatus({ matches: r.matches, url: r.info?.url, error: r.info?.last_error_message });
      else setStatus({ error: r.message });
    } catch (e) {
      setStatus({ error: e instanceof Error ? e.message : "falha" });
    }
  }, [profileId]);

  useEffect(() => {
    checkOrigin();
  }, [checkOrigin]);

  useEffect(() => {
    if (active) checkStatus();
    else setStatus(null);
  }, [checkStatus, active]);

  async function setOperation(next: boolean) {
    setToggling(true);
    try {
      const r = await apiSend<{ ok: boolean; message?: string }>("/api/telegram", "POST", {
        action: "set-operation",
        profileId,
        active: next,
      });
      if (r.ok) {
        showToast(next ? "Operação LIGADA — o Hot-Dash assumiu o bot." : "Operação DESLIGADA — bot liberado.", "success");
        onSaved();
      } else {
        showToast(r.message || "Falha ao alterar a operação.", "error");
        // Falhou ao ligar → o motivo quase sempre é a base pública. Recarrega
        // o diagnóstico para o card explicar o que fazer (o toast some).
        await checkOrigin();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setToggling(false);
    }
  }

  async function register() {
    setBusy(true);
    try {
      const r = await apiSend<{ webhook: { ok: boolean; message?: string } }>("/api/telegram", "POST", {
        action: "register-webhook",
        profileId,
      });
      if (r.webhook.ok) showToast("Webhook reenviado ao Telegram.", "success");
      else showToast(r.webhook.message || "Falha ao registrar webhook.", "error");
      await Promise.all([checkStatus(), checkOrigin()]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Operação do bot</h2>

      {/* Base pública quebrada: o Telegram não tem como alcançar este app, e
          ligar a operação vai falhar. Avisa ANTES, com o que fazer. */}
      {origin?.problem && (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3.5">
          <p className="text-sm font-semibold text-red-300">
            Endereço público não configurado — o webhook não pode ser registrado
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-300">{origin.problem}</p>
        </div>
      )}

      {/* Liga/desliga da operação (cutover do sistema atual → Hot-Dash) */}
      <div
        className={`mt-3 flex items-center justify-between gap-3 rounded-xl border p-3.5 ${
          active ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-white/10 bg-ink-850"
        }`}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {active ? "Ligada — o Hot-Dash controla o bot" : "Desligada — outro sistema controla o bot"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {active
              ? "O bot recebe leads, gera PIX e aprova entradas pelo Hot-Dash."
              : "Ligue para fazer o cutover: o Hot-Dash assume o webhook do bot na hora."}
          </p>
        </div>
        <Switch checked={active} onChange={setOperation} disabled={toggling} ariaLabel="Operação do bot" />
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <Info label="Bot" value={bot.botUsername ? `@${bot.botUsername}` : "—"} />
        <Info label="Grupo VIP" value={bot.idVip || "—"} />
        <Info label="Grupo Prévias" value={bot.idAquecimento || "—"} />
      </div>
      {origin?.url && (
        <div className="mt-2 panel px-3 py-2">
          <p className="eyebrow">URL do webhook (o Telegram chama este endereço)</p>
          <p
            className={`mt-0.5 break-all font-mono text-xs ${
              origin.problem ? "text-red-300" : "text-zinc-200"
            }`}
          >
            {origin.url}
          </p>
        </div>
      )}

      <p className="mt-2 text-xs text-zinc-500">
        Token e IDs dos grupos VIP/Prévias vêm do <b>cadastro da modelo</b> (Modelos → editar). A
        postagem automática funciona independentemente deste liga/desliga.
      </p>

      {active && (
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`chip ${status?.matches ? "text-emerald-400" : "text-amber-400"}`}
            title={status?.error || status?.url || ""}
          >
            {status == null ? "verificando…" : status.matches ? "webhook ativo" : "webhook pendente"}
          </span>
          <button onClick={register} disabled={busy} className="btn-ghost px-2.5 py-1.5 text-xs">
            <IconRefresh size={14} /> {busy ? "Reenviando..." : "Reenviar webhook"}
          </button>
        </div>
      )}
      {active && status?.error && (
        <p className="mt-2 text-xs text-amber-400">Último erro do Telegram: {status.error}</p>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel px-3 py-2">
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 truncate font-mono text-xs text-zinc-200">{value}</p>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Mensagens — uma linha colapsada por assunto, no lugar do formulário único
// ---------------------------------------------------------------------------

/** Salva um pedaço das mensagens. A rota preserva o que não for enviado, então
 *  cada linha manda só os seus campos. */
async function salvarMensagens(profileId: string, patch: Record<string, string>) {
  await apiSend("/api/telegram", "POST", { action: "save-bot-messages", profileId, ...patch });
}

function WelcomeRow({
  profileId,
  bot,
  tags,
  welcome,
  setWelcome,
  welcomeTags,
  setWelcomeTags,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  tags: Tag[];
  welcome: string;
  setWelcome: (v: string) => void;
  welcomeTags: string;
  setWelcomeTags: (v: string) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    setBusy(true);
    try {
      await salvarMensagens(profileId, { welcomeMessage: welcome, welcomeMediaTags: welcomeTags });
      showToast("Boas-vindas salvas.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionRow
      icon={<IconMail size={16} />}
      title="Mensagem de boas-vindas"
      summary={resumo(bot.welcomeMessage) || "(vazia)"}
      status={bot.welcomeMessage?.trim() ? undefined : { label: "vazia", tone: "warn" }}
    >
      <label className="eyebrow block">Texto enviado no /start</label>
      <textarea
        ref={areaRef}
        className="input mt-1.5 min-h-[140px]"
        value={welcome}
        onChange={(e) => setWelcome(e.target.value)}
      />
      <VarChips
        vars={[["{nome}", "primeiro nome do lead no Telegram"]]}
        targetRef={areaRef}
        onChange={setWelcome}
      />

      <label className="eyebrow mt-4 block">Etiquetas da mídia de abertura (opcional)</label>
      <input
        className="input mt-1.5"
        placeholder="ex.: previa, quente"
        value={welcomeTags}
        onChange={(e) => setWelcomeTags(e.target.value)}
      />
      <p className="mt-1 text-[11px] text-zinc-500">
        O bot sorteia <b>uma</b> mídia com essas etiquetas a cada /start. O preview ao lado mostra
        de quais ele vai sortear.
      </p>
      {tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                const atuais = welcomeTags.split(",").map((s) => s.trim()).filter(Boolean);
                const ja = atuais.some((a) => a.toLowerCase() === t.name.toLowerCase());
                setWelcomeTags(
                  ja
                    ? atuais.filter((a) => a.toLowerCase() !== t.name.toLowerCase()).join(", ")
                    : [...atuais, t.name].join(", "),
                );
              }}
              className={`rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
                welcomeTags.toLowerCase().includes(t.name.toLowerCase())
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-white/10 bg-ink-850 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar mensagem"}
      </button>
    </SectionRow>
  );
}

function SuccessRow({ profileId, bot, onSaved }: { profileId: string; bot: Bot; onSaved: () => void }) {
  const [texto, setTexto] = useState(bot.successMessage || "");
  const [botao, setBotao] = useState(bot.successButtonText || "");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Sem {link_vip} no texto E sem botão, o cliente paga e não recebe caminho
  // nenhum para o grupo. É o pior defeito silencioso do fluxo — vira aviso.
  const semAcesso = !/{link_vip}/i.test(texto) && !botao.trim();

  async function save() {
    setBusy(true);
    try {
      await salvarMensagens(profileId, { successMessage: texto, successButtonText: botao });
      showToast("Mensagem de aprovação salva.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionRow
      icon={<IconCheck size={16} />}
      title="Mensagem de pagamento aprovado"
      summary={resumo(bot.successMessage) || "(vazia)"}
      status={semAcesso ? { label: "sem link do VIP", tone: "error" } : undefined}
    >
      <label className="eyebrow block">Enviada assim que o PIX é confirmado</label>
      <textarea
        ref={areaRef}
        className="input mt-1.5 min-h-[110px]"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <VarChips
        vars={[["{link_vip}", "link de convite do grupo VIP, gerado na hora"]]}
        targetRef={areaRef}
        onChange={setTexto}
      />

      <label className="eyebrow mt-4 block">Texto do botão de acesso (opcional)</label>
      <input
        className="input mt-1.5"
        placeholder="🔒 Acessar o VIP"
        value={botao}
        onChange={(e) => setBotao(e.target.value)}
      />
      <p className="mt-1 text-[11px] text-zinc-500">
        Preenchido, o convite vira um botão clicável. Vazio, o link só aparece no texto — e aí{" "}
        <b>{"{link_vip}"}</b> precisa estar escrito acima.
      </p>

      {semAcesso && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/[0.07] p-2.5 text-xs text-red-300">
          Do jeito que está, quem pagar não recebe o link nem o botão do VIP.
        </p>
      )}

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar mensagem"}
      </button>
    </SectionRow>
  );
}

function PixRow({
  profileId,
  bot,
  pixDefaults,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  pixDefaults: PixDefaults | null;
  onSaved: () => void;
}) {
  const [gerando, setGerando] = useState(bot.pixGeneratingMessage || "");
  const [legenda, setLegenda] = useState(bot.pixCaption || "");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-pix",
        profileId,
        pixGeneratingMessage: gerando,
        pixCaption: legenda,
      });
      showToast("Tela de pagamento salva.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionRow
      icon={<IconPayments size={16} />}
      title="Tela de pagamento (PIX)"
      summary={
        bot.pixCaption || bot.pixGeneratingMessage
          ? resumo(bot.pixCaption || bot.pixGeneratingMessage)
          : "Usando os textos padrão"
      }
    >
      <p className="text-xs text-zinc-500">
        O que o lead vê entre clicar no plano e pagar. Deixe em branco para usar o texto padrão.
      </p>

      <label className="eyebrow mt-4 block">Aviso enquanto a cobrança é criada</label>
      <input
        className="input mt-1.5"
        placeholder={pixDefaults?.generatingMessage}
        value={gerando}
        onChange={(e) => setGerando(e.target.value)}
      />

      <label className="eyebrow mt-4 block">Legenda do PIX (vai junto do QR Code)</label>
      <textarea
        ref={areaRef}
        className="input mt-1.5 min-h-[140px] font-mono text-xs"
        placeholder={pixDefaults?.caption}
        value={legenda}
        onChange={(e) => setLegenda(e.target.value)}
      />
      <VarChips
        vars={[
          ["{pix_code}", "o código copia-e-cola — sem ele o cliente não tem o que copiar"],
          ["{plano}", "nome do plano ou da oferta comprada"],
          ["{valor}", "valor já com o desconto aplicado"],
        ]}
        targetRef={areaRef}
        onChange={setLegenda}
      />
      <p className="mt-1 text-[11px] text-zinc-500">
        Aceita as marcações do Telegram (<code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>,{" "}
        <code>&lt;code&gt;</code>). Se você remover <b>{"{pix_code}"}</b>, o código é acrescentado no
        fim mesmo assim.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setGerando("");
            setLegenda("");
          }}
          className="btn-ghost"
        >
          <IconUndo size={14} /> Restaurar padrão
        </button>
      </div>
    </SectionRow>
  );
}

function ExtrasRow({ profileId, bot, onSaved }: { profileId: string; bot: Bot; onSaved: () => void }) {
  const [previews, setPreviews] = useState(bot.previewsWelcomeMessage || "");
  const [support, setSupport] = useState(bot.supportUsername || "");
  const [registro, setRegistro] = useState(bot.idRegistro || "");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    setBusy(true);
    try {
      await salvarMensagens(profileId, {
        previewsWelcomeMessage: previews,
        supportUsername: support,
        idRegistro: registro,
      });
      showToast("Salvo.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionRow
      icon={<IconSend size={16} />}
      title="Prévias, suporte e canal de vendas"
      summary={
        [
          previews.trim() && "boas-vindas das prévias",
          support.trim() && `suporte ${support}`,
          registro.trim() && "canal de vendas",
        ]
          .filter(Boolean)
          .join(" · ") || "nada configurado"
      }
    >
      <label className="eyebrow block">Boas-vindas nas prévias (grupo grátis)</label>
      <textarea
        ref={areaRef}
        className="input mt-1.5 min-h-[80px]"
        placeholder="Opcional. Enviada no privado do lead quando ele é aprovado nas prévias."
        value={previews}
        onChange={(e) => setPreviews(e.target.value)}
      />
      <VarChips
        vars={[["{nome}", "primeiro nome do lead"]]}
        targetRef={areaRef}
        onChange={setPreviews}
      />
      <p className="mt-1 text-[11px] text-zinc-500">
        Só chega se o lead já tiver dado /start no bot — antes disso o Telegram proíbe a mensagem.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="eyebrow block">Suporte (@usuário ou link)</label>
          <input className="input mt-1.5" value={support} onChange={(e) => setSupport(e.target.value)} />
          <p className="mt-1 text-[11px] text-zinc-500">Vira um botão no fim do /start.</p>
        </div>
        <div>
          <label className="eyebrow block">Canal de vendas (ID)</label>
          <input
            className="input mt-1.5 font-mono"
            placeholder="-100..."
            value={registro}
            onChange={(e) => setRegistro(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-zinc-500">
            Um canal só seu onde o bot anota cada venda. Ele precisa ser membro.
          </p>
        </div>
      </div>

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar"}
      </button>
    </SectionRow>
  );
}

// ---------------------------------------------------------------------------
// Planos / Ofertas
// ---------------------------------------------------------------------------
function PlansCard({ profileId, plans, onSaved }: { profileId: string; plans: Plan[]; onSaved: () => void }) {
  type Row = {
    id?: string;
    name: string;
    price: string;
    durationDays: string;
    kind: "subscription" | "package";
    deliverable: string;
  };
  const [rows, setRows] = useState<Row[]>(
    plans.map((p) => ({
      id: p.id,
      name: p.name,
      price: (p.priceCents / 100).toFixed(2),
      durationDays: String(p.durationDays),
      kind: p.kind || "subscription",
      deliverable: p.deliverable || "",
    })),
  );
  const [busy, setBusy] = useState(false);

  function update(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setBusy(true);
    try {
      const payload = rows
        .map((r) => ({
          id: r.id,
          name: r.name.trim(),
          priceCents: Math.round(parseFloat(r.price.replace(",", ".")) * 100) || 0,
          durationDays: parseInt(r.durationDays) || 30,
          kind: r.kind,
          deliverable: r.deliverable.trim() || undefined,
        }))
        .filter((r) => r.name && r.priceCents > 0);
      await apiSend("/api/telegram", "POST", { action: "save-plans", profileId, plans: payload });
      showToast("Ofertas salvas.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Ofertas / Planos</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Os botões que o bot mostra no /start e nos funis. <b>Assinatura</b> dá acesso VIP por N dias;{" "}
        <b>Pacote</b> é compra única (entrega um conteúdo/link).
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="panel p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={r.kind}
                onChange={(e) => update(i, { kind: e.target.value as Row["kind"] })}
                className="input w-32 shrink-0"
              >
                <option value="subscription">Assinatura</option>
                <option value="package">Pacote</option>
              </select>
              <input
                className="input min-w-[120px] flex-1"
                placeholder="Nome da oferta"
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <div className="flex items-center gap-1">
                <span className="text-xs text-zinc-500">R$</span>
                <input
                  className="input w-24"
                  placeholder="0,00"
                  value={r.price}
                  onChange={(e) => update(i, { price: e.target.value })}
                />
              </div>
              {r.kind === "subscription" && (
                <div className="flex items-center gap-1">
                  <input
                    className="input w-16"
                    value={r.durationDays}
                    onChange={(e) => update(i, { durationDays: e.target.value })}
                  />
                  <span className="text-xs text-zinc-500">dias</span>
                </div>
              )}
              <button
                onClick={() => setRows((rr) => rr.filter((_, idx) => idx !== i))}
                className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
                aria-label="Remover"
              >
                <IconClose size={15} />
              </button>
            </div>
            <input
              className="input mt-2 w-full"
              placeholder={
                r.kind === "package"
                  ? "Entregável: link/texto enviado ao pagar (obrigatório no pacote)"
                  : "Bônus ao pagar (opcional): ex. link do WhatsApp"
              }
              value={r.deliverable}
              onChange={(e) => update(i, { deliverable: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() =>
            setRows((r) => [...r, { name: "", price: "", durationDays: "30", kind: "subscription", deliverable: "" }])
          }
          className="btn-ghost"
        >
          + Adicionar oferta
        </button>
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Salvando..." : "Salvar ofertas"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funis (downsell / upsell)
// ---------------------------------------------------------------------------
function parseFunnel(json?: string): FunnelStep[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function FunnelCard({
  profileId,
  bot,
  tags,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  tags: Tag[];
  onSaved: () => void;
}) {
  const [downsell, setDownsell] = useState<FunnelStep[]>(parseFunnel(bot.downsellFunnel));
  const [upsell, setUpsell] = useState<FunnelStep[]>(parseFunnel(bot.upsellFunnel));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-funnels",
        profileId,
        downsellFunnel: JSON.stringify(downsell),
        upsellFunnel: JSON.stringify(upsell),
      });
      showToast("Funis salvos.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Funis de venda</h2>
      <p className="mt-1 text-xs text-zinc-500">
        <b>Downsell</b>: mensagens para quem deu /start e não pagou. <b>Upsell</b>: pós-venda para
        quem já é assinante. Cada etapa dispara após o tempo indicado.
      </p>

      <FunnelEditor title="Downsell (remarketing)" steps={downsell} setSteps={setDownsell} tags={tags} />
      <FunnelEditor title="Upsell (pós-venda)" steps={upsell} setSteps={setUpsell} tags={tags} />

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar funis"}
      </button>
    </div>
  );
}

function FunnelEditor({
  title,
  steps,
  setSteps,
  tags,
}: {
  title: string;
  steps: FunnelStep[];
  setSteps: (s: FunnelStep[]) => void;
  tags: Tag[];
}) {
  function update(i: number, patch: Partial<FunnelStep>) {
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <p className="eyebrow">{title}</p>
      <div className="mt-2 space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="panel p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="chip">Etapa {i + 1}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  className="input w-20"
                  value={s.delayMinutes}
                  onChange={(e) => update(i, { delayMinutes: Number(e.target.value) })}
                />
                <span className="text-xs text-zinc-500">min de espera</span>
              </div>
              <label className="ml-auto flex items-center gap-1 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  className="accent-white"
                  checked={Boolean(s.isLoop)}
                  onChange={(e) => update(i, { isLoop: e.target.checked })}
                />
                repetir (loop)
              </label>
              <button
                onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
                aria-label="Remover etapa"
              >
                <IconClose size={14} />
              </button>
            </div>
            <textarea
              className="input min-h-[64px]"
              placeholder="Texto da mensagem"
              value={s.text}
              onChange={(e) => update(i, { text: e.target.value })}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-zinc-500">Desconto</span>
                <input
                  type="number"
                  className="input w-16"
                  value={s.discountPercent ?? 0}
                  onChange={(e) => update(i, { discountPercent: Number(e.target.value) })}
                />
                <span className="text-[11px] text-zinc-500">%</span>
              </div>
              <input
                className="input min-w-[140px] flex-1"
                placeholder="Etiquetas da mídia (opcional)"
                value={s.mediaTags ?? ""}
                onChange={(e) => update(i, { mediaTags: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={() => setSteps([...steps, { delayMinutes: 60, text: "", discountPercent: 0 }])}
        className="btn-ghost mt-2 text-sm"
      >
        + Adicionar etapa
      </button>
      {tags.length > 0 && (
        <p className="mt-1 text-[11px] text-zinc-500">Etiquetas: {tags.map((t) => t.name).join(", ")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Botões personalizados
// ---------------------------------------------------------------------------
function ButtonsCard({
  profileId,
  buttons,
  onSaved,
}: {
  profileId: string;
  buttons: CustomButton[];
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<{ id?: string; text: string; url: string }[]>(
    buttons.map((b) => ({ id: b.id, text: b.text, url: b.url })),
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const payload = rows.filter((r) => r.text.trim() && r.url.trim());
      await apiSend("/api/telegram", "POST", { action: "save-buttons", profileId, buttons: payload });
      showToast("Botões salvos.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Botões personalizados</h2>
      <p className="mt-1 text-xs text-zinc-500">Links extras que aparecem no /start (ex.: redes, prévias).</p>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 panel p-2">
            <input
              className="input min-w-[120px] flex-1"
              placeholder="Texto do botão"
              value={r.text}
              onChange={(e) => setRows((rr) => rr.map((x, idx) => (idx === i ? { ...x, text: e.target.value } : x)))}
            />
            <input
              className="input min-w-[160px] flex-[2] font-mono"
              placeholder="https://..."
              value={r.url}
              onChange={(e) => setRows((rr) => rr.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))}
            />
            <button
              onClick={() => setRows((rr) => rr.filter((_, idx) => idx !== i))}
              className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
              aria-label="Remover"
            >
              <IconClose size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => setRows((r) => [...r, { text: "", url: "" }])} className="btn-ghost">
          + Adicionar botão
        </button>
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Salvando..." : "Salvar botões"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assinantes
// ---------------------------------------------------------------------------
function SubscribersCard({
  subs,
  onAction,
  confirm,
}: {
  subs: Sub[];
  onAction: () => void;
  confirm: (opts: { title: string; message: string }) => Promise<boolean>;
}) {
  const [busyId, setBusyId] = useState<string>("");

  async function act(sub: Sub, action: "sub-resend-link" | "sub-extend" | "sub-kick", extra?: Record<string, unknown>) {
    setBusyId(sub.id + action);
    try {
      await apiSend("/api/telegram", "POST", { action, subscriptionId: sub.id, ...extra });
      showToast("Feito.", "success");
      onAction();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusyId("");
    }
  }

  const label = (s: Sub["status"]) =>
    ({ pending: "pendente", active: "ativo", expired: "expirado", blocked: "bloqueado" }[s]);
  const color = (s: Sub["status"]) =>
    ({ pending: "text-amber-400", active: "text-emerald-400", expired: "text-zinc-500", blocked: "text-red-400" }[s]);

  const active = subs.filter((s) => s.status === "active").length;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Assinantes</h2>
        <span className="chip">{active} ativo(s) · {subs.length} total</span>
      </div>
      {subs.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Nenhum assinante ainda.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {subs.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 panel p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-200">
                  {s.telegramUsername ? `@${s.telegramUsername}` : `ID ${s.telegramUserId}`}
                </p>
                <p className="font-mono text-[11px] text-zinc-500">
                  <span className={color(s.status)}>{label(s.status)}</span>
                  {s.status === "active" && s.expiresAt > 0
                    ? ` · vence ${new Date(s.expiresAt).toLocaleDateString("pt-BR")}`
                    : ""}
                </p>
              </div>
              <button
                onClick={() => act(s, "sub-resend-link")}
                disabled={Boolean(busyId)}
                className="btn-ghost px-2.5 py-1.5 text-xs"
              >
                Reenviar link
              </button>
              <button
                onClick={() => act(s, "sub-extend", { days: 30 })}
                disabled={Boolean(busyId)}
                className="btn-ghost px-2.5 py-1.5 text-xs"
              >
                +30 dias
              </button>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: "Expulsar do VIP",
                    message: `Remover ${s.telegramUsername ? "@" + s.telegramUsername : s.telegramUserId} do grupo VIP agora?`,
                  });
                  if (ok) act(s, "sub-kick");
                }}
                disabled={Boolean(busyId)}
                className="rounded-lg px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
              >
                Expulsar
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-zinc-600">
        A expiração é automática (o VIP vencido é removido e reconduzido às prévias). Use as ações
        acima para casos manuais.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aprovação Automática — a regra de quem entra em cada grupo
// ---------------------------------------------------------------------------
const MODOS: { key: ApprovalMode; label: string; desc: string }[] = [
  {
    key: "subscribers",
    label: "Só assinantes",
    desc: "Aprova quem tem assinatura ativa e RECUSA o resto. É o normal do VIP.",
  },
  {
    key: "all",
    label: "Aprovar todos",
    desc: "Aceita qualquer pedido. É o normal do grupo de prévias, que é gratuito.",
  },
  {
    key: "manual",
    label: "Deixar na fila",
    desc: "O bot não decide: o pedido espera na fila do Telegram para você aprovar na mão.",
  },
];

function ApprovalCard({ profileId, bot, onSaved }: { profileId: string; bot: Bot; onSaved: () => void }) {
  const [vip, setVip] = useState<ApprovalMode>(bot.vipApprovalMode || "subscribers");
  const [previas, setPrevias] = useState<ApprovalMode>(bot.previasApprovalMode || "all");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-approval",
        profileId,
        vipApprovalMode: vip,
        previasApprovalMode: previas,
      });
      showToast("Regras de aprovação salvas.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Aprovação automática</h2>
      <p className="mt-1 text-xs text-zinc-500">
        O que o bot faz quando alguém pede para entrar em cada grupo. Vale só para grupos com{" "}
        <b>&quot;aprovar novos membros&quot;</b> ligado nas configurações do Telegram — sem isso o
        Telegram nem avisa o bot, e nenhuma regra aqui tem efeito.
      </p>

      <GrupoAprovacao
        titulo="Grupo VIP"
        subtitulo={bot.idVip || "sem ID configurado"}
        valor={vip}
        onChange={setVip}
      />
      <GrupoAprovacao
        titulo="Grupo de Prévias"
        subtitulo={bot.idAquecimento || "sem ID configurado"}
        valor={previas}
        onChange={setPrevias}
      />

      <p className="mt-4 rounded-lg border border-white/10 bg-ink-850 p-3 text-xs text-zinc-400">
        Em qualquer modo o bot precisa ser <b>administrador</b> do grupo, com permissão de convidar
        por link — é assim que ele aprova a entrada e gera o convite de quem pagou.
      </p>

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar regras"}
      </button>
    </div>
  );
}

function GrupoAprovacao({
  titulo,
  subtitulo,
  valor,
  onChange,
}: {
  titulo: string;
  subtitulo: string;
  valor: ApprovalMode;
  onChange: (v: ApprovalMode) => void;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-semibold text-white">{titulo}</p>
        <p className="truncate font-mono text-[11px] text-zinc-500">{subtitulo}</p>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {MODOS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              valor === m.key
                ? "border-emerald-500/40 bg-emerald-500/[0.07]"
                : "border-white/10 bg-ink-850 hover:border-white/20"
            }`}
          >
            <p
              className={`text-sm font-semibold ${
                valor === m.key ? "text-emerald-300" : "text-zinc-200"
              }`}
            >
              {m.label}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{m.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trackeamento — links de divulgação e o que cada um trouxe
// ---------------------------------------------------------------------------
function TrackingCard({
  profileId,
  bot,
  links,
  orphans,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  links: SourceLink[];
  orphans: OrphanCode[];
  onSaved: () => void;
}) {
  type Row = { id?: string; name: string; code: string; slug: string; createdAt?: number; stats?: LinkStats };
  const [rows, setRows] = useState<Row[]>(
    links.map((l) => ({
      id: l.id,
      name: l.name,
      code: l.code,
      slug: l.slug || "",
      createdAt: l.createdAt,
      stats: l.stats,
    })),
  );
  const [busy, setBusy] = useState(false);

  function update(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setBusy(true);
    try {
      const r = await apiSend<{ ok: boolean; sourceLinks: SourceLink[] }>(
        "/api/telegram",
        "POST",
        { action: "save-source-links", profileId, links: rows },
      );
      setRows(
        (r.sourceLinks || []).map((l) => ({
          id: l.id,
          name: l.name,
          code: l.code,
          slug: l.slug || "",
          createdAt: l.createdAt,
          stats: l.stats,
        })),
      );
      showToast("Links salvos.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h2 className="font-display text-lg font-semibold">Trackeamento</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Um link por origem de tráfego. O <b>código</b> viaja no deep-link do bot e fica gravado no
          lead e na venda — é o que responde qual divulgação trouxe o dinheiro. O{" "}
          <b>redirecionador</b> é a URL curta que você publica: o destino continua sob seu controle,
          então trocar o bot depois não invalida o que já foi divulgado.
        </p>

        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={r.id || i} className="panel p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_150px_150px_auto]">
                <input
                  className="input"
                  placeholder="Nome (ex.: bio do Instagram)"
                  value={r.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <input
                  className="input font-mono text-xs"
                  placeholder="codigo"
                  value={r.code}
                  onChange={(e) => update(i, { code: e.target.value.replace(/[^\w-]/g, "") })}
                />
                <input
                  className="input font-mono text-xs"
                  placeholder="url-curta"
                  value={r.slug}
                  onChange={(e) =>
                    update(i, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
                  }
                />
                <button
                  onClick={() => setRows((rr) => rr.filter((_, idx) => idx !== i))}
                  className="btn-ghost px-2.5"
                  aria-label="Remover link"
                >
                  <IconTrash size={14} />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                {bot.botUsername && r.code && (
                  <CopiavelLink texto={`https://t.me/${bot.botUsername}?start=${r.code}`} />
                )}
                {r.slug && <CopiavelLink texto={`/r/${r.slug}`} relativo />}
              </div>

              {r.stats && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  <span className="text-zinc-400">
                    <b className="text-white">{r.stats.starts}</b> /start
                  </span>
                  <span className="text-zinc-400">
                    <b className="text-white">{r.stats.pixGenerated}</b> PIX gerado(s)
                  </span>
                  <span className="text-zinc-400">
                    <b className="text-white">{r.stats.pixPaid}</b> pago(s)
                  </span>
                  <span className="text-emerald-400">{money(r.stats.paidCents)}</span>
                </div>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <p className="py-6 text-center text-sm text-zinc-500">
              Nenhum link ainda. Crie um para cada lugar onde você divulga o bot.
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setRows((r) => [...r, { name: "", code: "", slug: "" }])}
            className="btn-ghost"
          >
            <IconPlus size={14} /> Novo link
          </button>
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? "Salvando..." : "Salvar links"}
          </button>
        </div>

        {!bot.botUsername && (
          <p className="mt-3 text-xs text-amber-400">
            O @username do bot ainda não foi resolvido — ligue a operação uma vez para o Hot-Dash
            descobri-lo, e os links completos aparecem aqui.
          </p>
        )}
      </div>

      {orphans.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-white">Códigos já usados, sem cadastro</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Apareceram em leads ou vendas mas não estão na lista acima — links criados à mão antes
            desta tela existir. Cadastre para dar um nome a eles.
          </p>
          <div className="mt-3 space-y-1.5">
            {orphans.map((o) => (
              <div
                key={o.code}
                className="flex flex-wrap items-center justify-between gap-2 panel px-3 py-2"
              >
                <code className="text-xs text-zinc-200">{o.code}</code>
                <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-zinc-500">
                  <span>{o.stats.starts} /start</span>
                  <span>{o.stats.pixPaid} pago(s)</span>
                  <span className="text-emerald-400">{money(o.stats.paidCents)}</span>
                  <button
                    onClick={() =>
                      setRows((r) => [...r, { name: o.code, code: o.code, slug: "" }])
                    }
                    className="btn-ghost px-2 py-1 text-[11px]"
                  >
                    Cadastrar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Mostra uma URL com botão de copiar. Links relativos ganham a origem do
 *  navegador na hora de copiar — é o endereço que o operador vai colar fora. */
function CopiavelLink({ texto, relativo }: { texto: string; relativo?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        const url = relativo ? `${window.location.origin}${texto}` : texto;
        try {
          await navigator.clipboard.writeText(url);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        } catch {
          showToast("Não foi possível copiar.", "error");
        }
      }}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-sky-400 transition-colors hover:text-sky-300"
    >
      <IconCopy size={12} /> {copiado ? "copiado!" : texto}
    </button>
  );
}
