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
  IconChevronUp,
  IconChevronDown,
} from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import SectionRow, { resumo } from "@/components/telegram/bot/SectionRow";
import VarChips from "@/components/telegram/bot/VarChips";
import BotPreview from "@/components/telegram/bot/BotPreview";
import FormatToolbar from "@/components/telegram/bot/FormatToolbar";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import DetectChat from "@/components/telegram/bot/DetectChat";

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
  welcomeMediaIds?: string[];
  welcomeMediaMode: "album" | "separate";
  pixSocialProof: boolean;
  pixSocialProofText?: string;
  pixAudioUrl?: string;
  pixBtnCheck?: string;
  pixBtnQr?: string;
  pixBtnCopy?: string;
  pixNotPaidMessage?: string;
  previasWelcomeFunnel?: string;
  vipWelcomeFunnel?: string;
};
type WelcomeStep = {
  delayMinutes: number;
  text: string;
  mediaTags?: string;
  buttons?: "none" | "plans";
};
type SeenChat = { chatId: string; title?: string; type?: string };
type ApprovalMode = "subscribers" | "all" | "manual";
type PixDefaults = {
  generatingMessage: string;
  caption: string;
  btnCheck: string;
  btnQr: string;
  btnCopy: string;
  notPaidMessage: string;
};
type Plan = {
  id: string;
  name: string;
  priceCents: number;
  /** 0 = vitalício. */
  durationDays: number;
  kind: "subscription" | "package";
  deliverable?: string;
  sortOrder?: number;
  active?: boolean;
  highlight?: string;
  deliverableButtons?: { text: string; url: string }[];
  sales?: { count: number; cents: number };
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
  const [pixDefaults, setPixDefaults] = useState<PixDefaults | null>(null);
  const [tab, setTab] = useState<TabKey>("config");

  // A mensagem de boas-vindas e as etiquetas vivem AQUI, e não dentro da linha
  // que as edita: o preview à direita precisa acompanhar a digitação, e ele é
  // irmão do formulário, não filho.
  const [welcome, setWelcome] = useState("");
  const [welcomeTags, setWelcomeTags] = useState("");
  const [welcomeIds, setWelcomeIds] = useState<string[]>([]);
  const [welcomeMode, setWelcomeMode] = useState<"album" | "separate">("album");

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
        pixDefaults: PixDefaults;
      }>(`/api/telegram?profileId=${profileId}`);
      setBot(d.bot);
      setPlans(d.plans || []);
      setButtons(d.customButtons || []);
      setSubs(d.subscriptions || []);
      setTags(d.availableTags || []);
      setMetrics(d.metrics || null);
      setPixDefaults(d.pixDefaults || null);
      setWelcome(d.bot?.welcomeMessage || "");
      setWelcomeTags(d.bot?.welcomeMediaTags || "");
      setWelcomeIds(d.bot?.welcomeMediaIds || []);
      setWelcomeMode(d.bot?.welcomeMediaMode || "album");
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
                    mediaIds={welcomeIds}
                    setMediaIds={setWelcomeIds}
                    mode={welcomeMode}
                    setMode={setWelcomeMode}
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
                <ApprovalCard profileId={profileId} bot={bot} tags={tags} onSaved={load} />
              )}
            </div>

            {mostraPreview && (
              <BotPreview
                profileId={profileId}
                botUsername={bot.botUsername}
                welcomeMessage={welcome}
                welcomeMediaTags={welcomeTags}
                welcomeMediaIds={welcomeIds}
                welcomeMediaMode={welcomeMode}
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
  // Saúde dos grupos: o bot é admin onde precisa ser? Sem isso ele não gera o
  // convite do VIP, e a falha só apareceria depois de alguém pagar.
  const [grupos, setGrupos] = useState<
    { rotulo: string; chatId: string; title?: string; ok: boolean; motivo?: string }[] | null
  >(null);

  const active = bot.operationActive;

  const checkGrupos = useCallback(async () => {
    try {
      const r = await apiSend<{ ok: boolean; grupos?: typeof grupos }>("/api/telegram", "POST", {
        action: "group-health",
        profileId,
      });
      setGrupos(r.grupos || null);
    } catch {
      setGrupos(null);
    }
  }, [profileId]);

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
    checkGrupos();
  }, [checkGrupos]);

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
      {/* Sem ser ADMIN do VIP o bot não gera o convite — e a falha só
          apareceria depois de alguém pagar. Por isso a checagem fica à vista. */}
      {grupos && grupos.some((g) => !g.ok) && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3.5">
          <p className="text-sm font-semibold text-amber-300">
            O bot ainda não consegue operar todos os grupos
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-zinc-300">
            {grupos.map((g) => (
              <li key={g.rotulo} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={g.ok ? "text-emerald-400" : "text-amber-400"}>
                  {g.ok ? "✓" : "✕"}
                </span>
                <b>{g.rotulo}</b>
                {g.title && <span className="text-zinc-500">({g.title})</span>}
                {!g.ok && <span className="text-amber-300">— {g.motivo}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
            Promova o bot a <b>administrador</b> nos grupos, com permissão de{" "}
            <b>convidar por link</b> e <b>remover membros</b>. Sem isso ele não gera o convite do
            VIP depois do pagamento nem aprova entradas.
          </p>
        </div>
      )}

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
  mediaIds,
  setMediaIds,
  mode,
  setMode,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  tags: Tag[];
  welcome: string;
  setWelcome: (v: string) => void;
  welcomeTags: string;
  setWelcomeTags: (v: string) => void;
  mediaIds: string[];
  setMediaIds: (v: string[]) => void;
  mode: "album" | "separate";
  setMode: (v: "album" | "separate") => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-bot-messages",
        profileId,
        welcomeMessage: welcome,
        welcomeMediaTags: welcomeTags,
        welcomeMediaIds: mediaIds,
        welcomeMediaMode: mode,
      });
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
      <div className="mt-1.5">
        <FormatToolbar targetRef={areaRef} onChange={setWelcome} />
      </div>
      <textarea
        ref={areaRef}
        className="input min-h-[140px]"
        value={welcome}
        onChange={(e) => setWelcome(e.target.value)}
      />
      <VarChips
        vars={[["{nome}", "primeiro nome do lead no Telegram"]]}
        targetRef={areaRef}
        onChange={setWelcome}
      />

      <label className="eyebrow mt-4 block">Mídias de abertura · até 10</label>
      <p className="mb-1.5 mt-0.5 text-[11px] text-zinc-500">
        Escolhidas a dedo, enviadas <b>sempre</b> nesta ordem. Deixe vazio para o bot sortear por
        etiqueta (abaixo).
      </p>
      <MediaPicker profileId={profileId} selected={mediaIds} onChange={setMediaIds} />

      {mediaIds.length > 1 && (
        <div className="mt-3">
          <label className="eyebrow block">Como enviar as {mediaIds.length} mídias</label>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {(
              [
                ["album", "Agrupadas", "Um álbum único. Os botões vêm logo abaixo, numa mensagem própria — o Telegram não deixa colar botão em álbum."],
                ["separate", "Separadas", "Uma mensagem por mídia. O texto e os botões vão na última."],
              ] as const
            ).map(([k, titulo, desc]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  mode === k
                    ? "border-emerald-500/40 bg-emerald-500/[0.07]"
                    : "border-white/10 bg-ink-850 hover:border-white/20"
                }`}
              >
                <p className={`text-sm font-semibold ${mode === k ? "text-emerald-300" : "text-zinc-200"}`}>
                  {titulo}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="eyebrow mt-4 block">
        Etiquetas da mídia de abertura {mediaIds.length > 0 && "(ignoradas — há mídias escolhidas acima)"}
      </label>
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
  const [prova, setProva] = useState(Boolean(bot.pixSocialProof));
  const [provaTexto, setProvaTexto] = useState(bot.pixSocialProofText || "");
  const [audio, setAudio] = useState(bot.pixAudioUrl || "");
  const [btnCheck, setBtnCheck] = useState(bot.pixBtnCheck || "");
  const [btnQr, setBtnQr] = useState(bot.pixBtnQr || "");
  const [btnCopy, setBtnCopy] = useState(bot.pixBtnCopy || "");
  const [naoPago, setNaoPago] = useState(bot.pixNotPaidMessage || "");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const provaRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-pix",
        profileId,
        pixGeneratingMessage: gerando,
        pixCaption: legenda,
        pixSocialProof: prova,
        pixSocialProofText: provaTexto,
        pixAudioUrl: audio,
        pixBtnCheck: btnCheck,
        pixBtnQr: btnQr,
        pixBtnCopy: btnCopy,
        pixNotPaidMessage: naoPago,
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

      {/* Prova social — números REAIS, e só isso. Não existe campo para
          inventar quantidade: o cliente está a um toque de pagar, e um número
          falso ali é propaganda enganosa por quem opera, não pelo painel. */}
      <div className="mt-5 rounded-xl border border-white/10 bg-ink-850 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Prova social</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              Uma linha acima do PIX com os números <b>reais</b> desta modelo. Quando o número do
              dia é zero, a linha não é enviada.
            </p>
          </div>
          <Switch checked={prova} onChange={setProva} ariaLabel="Prova social" />
        </div>
        {prova && (
          <>
            <textarea
              ref={provaRef}
              className="input mt-3 min-h-[60px]"
              placeholder={PROVA_PADRAO}
              value={provaTexto}
              onChange={(e) => setProvaTexto(e.target.value)}
            />
            <VarChips
              vars={[
                ["{vendas_hoje}", "vendas pagas hoje, do painel financeiro"],
                ["{assinantes}", "assinantes VIP ativos agora"],
              ]}
              targetRef={provaRef}
              onChange={setProvaTexto}
            />
          </>
        )}
      </div>

      <label className="eyebrow mt-5 block">Botões que acompanham o PIX</label>
      <p className="mb-1.5 mt-0.5 text-[11px] leading-relaxed text-zinc-500">
        A mensagem vai como <b>texto</b>, não como legenda de foto: só assim o Telegram faz
        &quot;toque para copiar&quot; no código, e a legenda de foto cortaria a chave (limite de
        1024 caracteres). O QR fica atrás do botão.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          className="input text-xs"
          placeholder={pixDefaults?.btnCheck}
          value={btnCheck}
          onChange={(e) => setBtnCheck(e.target.value)}
        />
        <input
          className="input text-xs"
          placeholder={pixDefaults?.btnQr}
          value={btnQr}
          onChange={(e) => setBtnQr(e.target.value)}
        />
        <input
          className="input text-xs"
          placeholder={pixDefaults?.btnCopy}
          value={btnCopy}
          onChange={(e) => setBtnCopy(e.target.value)}
        />
      </div>

      <label className="eyebrow mt-4 block">Resposta quando o pagamento ainda não consta</label>
      <textarea
        className="input mt-1.5 min-h-[60px]"
        placeholder={pixDefaults?.notPaidMessage}
        value={naoPago}
        onChange={(e) => setNaoPago(e.target.value)}
      />
      <p className="mt-1 text-[11px] text-zinc-500">
        Enviada quando o cliente toca em <b>Verificar Status</b> e a confirmação do gateway ainda
        não chegou. Se já constar paga, o bot reenvia o acesso.
      </p>

      <label className="eyebrow mt-4 block">Áudio do PIX (URL pública .ogg)</label>
      <input
        className="input mt-1.5 font-mono text-xs"
        placeholder="https://... .ogg"
        value={audio}
        onChange={(e) => setAudio(e.target.value)}
      />
      <p className="mt-1 text-[11px] text-zinc-500">
        Enviado como mensagem de voz <b>depois</b> do PIX — o código copia-e-cola é o que o cliente
        veio buscar e não pode ficar atrás de um áudio. O Telegram baixa o arquivo sozinho, então a
        URL precisa ser alcançável da internet; fora do formato OGG/OPUS ele entrega como arquivo
        comum, sem a bolha de áudio.
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
            setBtnCheck("");
            setBtnQr("");
            setBtnCopy("");
            setNaoPago("");
          }}
          className="btn-ghost"
        >
          <IconUndo size={14} /> Restaurar padrão
        </button>
      </div>
    </SectionRow>
  );
}

const PROVA_PADRAO = "🔥 {vendas_hoje} pessoa(s) garantiram o acesso hoje.";

function ExtrasRow({ profileId, bot, onSaved }: { profileId: string; bot: Bot; onSaved: () => void }) {
  const [previews, setPreviews] = useState(bot.previewsWelcomeMessage || "");
  const [support, setSupport] = useState(bot.supportUsername || "");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    setBusy(true);
    try {
      await salvarMensagens(profileId, {
        previewsWelcomeMessage: previews,
        supportUsername: support,
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
      title="Prévias e suporte"
      summary={
        [
          previews.trim() && "boas-vindas das prévias",
          support.trim() && `suporte ${support}`,
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

      {/* O canal de vendas saiu da tela a pedido — não está em uso por ora. O
          valor eventualmente já salvo continua no banco e a notificação parou
          de ser enviada, então devolver o campo aqui é o bastante para
          reativar. */}
      <div className="mt-4">
        <label className="eyebrow block">Suporte (@usuário ou link)</label>
        <input className="input mt-1.5" value={support} onChange={(e) => setSupport(e.target.value)} />
        <p className="mt-1 text-[11px] text-zinc-500">Vira um botão no fim do /start.</p>
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
const PERIODOS: { label: string; days: number }[] = [
  { label: "Semanal", days: 7 },
  { label: "Mensal", days: 30 },
  { label: "Trimestral", days: 90 },
  { label: "Semestral", days: 180 },
  { label: "Anual", days: 365 },
  { label: "Vitalício", days: 0 },
];

function periodoLabel(days: number): string {
  if (days <= 0) return "Vitalício";
  return PERIODOS.find((p) => p.days === days)?.label || `${days} dias`;
}

const CORES: { key: string; label: string; dot: string; ring: string }[] = [
  { key: "", label: "Padrão", dot: "bg-zinc-500", ring: "border-white/10" },
  { key: "green", label: "Verde", dot: "bg-emerald-400", ring: "border-emerald-500/50" },
  { key: "blue", label: "Azul", dot: "bg-indigo-400", ring: "border-indigo-500/50" },
  { key: "red", label: "Vermelho", dot: "bg-red-400", ring: "border-red-500/50" },
];

type PlanRow = {
  id?: string;
  name: string;
  price: string;
  durationDays: number;
  kind: "subscription" | "package";
  deliverable: string;
  active: boolean;
  highlight: string;
  deliverableButtons: { text: string; url: string }[];
  sales?: { count: number; cents: number };
};

function PlansCard({ profileId, plans, onSaved }: { profileId: string; plans: Plan[]; onSaved: () => void }) {
  const [rows, setRows] = useState<PlanRow[]>(
    plans.map((p) => ({
      id: p.id,
      name: p.name,
      price: (p.priceCents / 100).toFixed(2),
      durationDays: p.durationDays,
      kind: p.kind || "subscription",
      deliverable: p.deliverable || "",
      active: p.active !== false,
      highlight: p.highlight || "",
      deliverableButtons: p.deliverableButtons || [],
      sales: p.sales,
    })),
  );
  const [aberto, setAberto] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  function update(i: number, patch: Partial<PlanRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  /** Move um plano na lista. A POSIÇÃO é a ordem dos botões no /start — é por
   *  isso que ela é salva, e não um campo de número à mostra. */
  function mover(i: number, delta: number) {
    setRows((r) => {
      const j = i + delta;
      if (j < 0 || j >= r.length) return r;
      const copia = [...r];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
    setAberto((a) => (a === i ? i + delta : a === i + delta ? i : a));
  }

  async function save() {
    setBusy(true);
    try {
      const payload = rows
        .map((r) => ({
          id: r.id,
          name: r.name.trim(),
          priceCents: Math.round(parseFloat(r.price.replace(",", ".")) * 100) || 0,
          durationDays: r.durationDays,
          kind: r.kind,
          deliverable: r.deliverable.trim() || undefined,
          active: r.active,
          highlight: r.highlight || undefined,
          deliverableButtons: r.deliverableButtons.filter((b) => b.text.trim() && b.url.trim()),
        }))
        .filter((r) => r.name && r.priceCents > 0);
      const res = await apiSend<{ ok: boolean; plans: Plan[] }>("/api/telegram", "POST", {
        action: "save-plans",
        profileId,
        plans: payload,
      });
      showToast("Ofertas salvas.", "success");
      if (res.plans) {
        setRows(
          res.plans.map((p) => ({
            id: p.id,
            name: p.name,
            price: (p.priceCents / 100).toFixed(2),
            durationDays: p.durationDays,
            kind: p.kind || "subscription",
            deliverable: p.deliverable || "",
            active: p.active !== false,
            highlight: p.highlight || "",
            deliverableButtons: p.deliverableButtons || [],
            sales: p.sales,
          })),
        );
      }
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  const assinaturas = rows.filter((r) => r.kind === "subscription").length;
  const pacotes = rows.filter((r) => r.kind === "package").length;

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <p className="text-xs leading-relaxed text-zinc-400">
          <b className="text-white">Assinaturas</b> dão acesso ao VIP por um período (semanal,
          mensal, anual… ou vitalício). <b className="text-white">Pacotes</b> são produtos avulsos,
          fora do VIP — packs, conteúdo especial, chamada. Os dois aparecem juntos para o cliente no{" "}
          <code>/start</code>, na ordem desta lista.
        </p>
        <div className="mt-2 flex gap-4 text-[11px] text-zinc-500">
          <span>
            <b className="text-zinc-300">{assinaturas}</b> assinatura(s)
          </span>
          <span>
            <b className="text-zinc-300">{pacotes}</b> pacote(s)
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => {
          const cor = CORES.find((c) => c.key === r.highlight) || CORES[0];
          const estaAberto = aberto === i;
          return (
            <div
              key={r.id || `novo-${i}`}
              className={`card overflow-hidden border ${estaAberto ? "border-emerald-500/25" : cor.ring} ${
                r.active ? "" : "opacity-55"
              }`}
            >
              {/* Cabeçalho: o que dá para ler sem abrir. */}
              <div className="flex items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setAberto(estaAberto ? null : i)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                    {r.highlight && <span className={`h-2 w-2 shrink-0 rounded-full ${cor.dot}`} />}
                    {r.name || <span className="text-zinc-500">(sem nome)</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    <span className="text-emerald-400">
                      {money(Math.round(parseFloat(r.price.replace(",", ".")) * 100) || 0)}
                    </span>
                    {" · "}
                    {r.kind === "package" ? "Pacote" : periodoLabel(r.durationDays)}
                    {!r.active && " · desligado"}
                  </p>
                  {r.sales && r.sales.count > 0 && (
                    <span className="mt-1 inline-block rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      {r.sales.count} venda(s) · {money(r.sales.cents)}
                    </span>
                  )}
                </button>

                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => mover(i, -1)}
                    disabled={i === 0}
                    className="grid h-5 w-6 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-white disabled:opacity-25"
                    aria-label="Subir"
                  >
                    <IconChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => mover(i, 1)}
                    disabled={i === rows.length - 1}
                    className="grid h-5 w-6 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-white disabled:opacity-25"
                    aria-label="Descer"
                  >
                    <IconChevronDown size={13} />
                  </button>
                </div>

                {/* Ligar/desligar: some dos botões do bot, mas fica no painel
                    com o histórico de vendas. Antes, tirar do ar era apagar. */}
                <button
                  type="button"
                  onClick={() => update(i, { active: !r.active })}
                  title={r.active ? "Desligar (some do bot)" : "Ligar"}
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                    r.active
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-white/10 text-zinc-600"
                  }`}
                >
                  <IconCheck size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRows((rr) => rr.filter((_, idx) => idx !== i));
                    setAberto(null);
                  }}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-500 hover:border-red-500/40 hover:text-red-400"
                  aria-label="Remover"
                >
                  <IconClose size={15} />
                </button>
              </div>

              {estaAberto && (
                <div className="border-t border-white/10 p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                    <input
                      className="input"
                      placeholder="Nome do plano"
                      value={r.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                    <input
                      className="input"
                      placeholder="0,00"
                      inputMode="decimal"
                      value={r.price}
                      onChange={(e) => update(i, { price: e.target.value })}
                    />
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select
                      className="input"
                      value={r.kind}
                      onChange={(e) => update(i, { kind: e.target.value as PlanRow["kind"] })}
                    >
                      <option value="subscription">Assinatura (acesso ao VIP)</option>
                      <option value="package">Pacote (produto avulso)</option>
                    </select>
                    {r.kind === "subscription" && (
                      <select
                        className="input"
                        value={String(r.durationDays)}
                        onChange={(e) => update(i, { durationDays: Number(e.target.value) })}
                      >
                        {PERIODOS.map((p) => (
                          <option key={p.label} value={p.days}>
                            {p.label}
                            {p.days > 0 ? ` (${p.days} dias)` : " (não expira)"}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <label className="eyebrow mt-3 block">
                    Entregável · enviado ao pagar{" "}
                    {r.kind === "package" ? "(obrigatório no pacote)" : "(opcional)"}
                  </label>
                  <textarea
                    className="input mt-1.5 min-h-[70px]"
                    placeholder={
                      r.kind === "package"
                        ? "Link ou texto do que o cliente comprou."
                        : "Bônus junto do acesso. Vazio usa só a mensagem de aprovação."
                    }
                    value={r.deliverable}
                    onChange={(e) => update(i, { deliverable: e.target.value })}
                  />

                  <label className="eyebrow mt-3 block">Cor de destaque na lista</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {CORES.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => update(i, { highlight: c.key })}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                          r.highlight === c.key
                            ? `${c.ring} bg-white/5 text-white`
                            : "border-white/10 text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                        {c.label}
                      </button>
                    ))}
                  </div>

                  <label className="eyebrow mt-3 block">Botões do entregável</label>
                  <p className="mb-1.5 mt-0.5 text-[11px] text-zinc-500">
                    Vão junto da entrega, clicáveis — em vez do link solto no texto.
                  </p>
                  <div className="space-y-1.5">
                    {r.deliverableButtons.map((b, bi) => (
                      <div key={bi} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          className="input text-xs"
                          placeholder="Texto do botão"
                          value={b.text}
                          onChange={(e) =>
                            update(i, {
                              deliverableButtons: r.deliverableButtons.map((x, xi) =>
                                xi === bi ? { ...x, text: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <input
                          className="input font-mono text-xs"
                          placeholder="https://"
                          value={b.url}
                          onChange={(e) =>
                            update(i, {
                              deliverableButtons: r.deliverableButtons.map((x, xi) =>
                                xi === bi ? { ...x, url: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            update(i, {
                              deliverableButtons: r.deliverableButtons.filter((_, xi) => xi !== bi),
                            })
                          }
                          className="btn-ghost px-2.5"
                          aria-label="Remover botão"
                        >
                          <IconClose size={13} />
                        </button>
                      </div>
                    ))}
                    {r.deliverableButtons.length < 6 && (
                      <button
                        type="button"
                        onClick={() =>
                          update(i, {
                            deliverableButtons: [...r.deliverableButtons, { text: "", url: "" }],
                          })
                        }
                        className="btn-ghost px-2.5 py-1 text-xs"
                      >
                        <IconPlus size={13} /> Botão
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="card p-6 text-center text-sm text-zinc-500">
            Nenhuma oferta ainda. Sem pelo menos uma, o <code>/start</code> sai sem botão de compra.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setRows((r) => [
              ...r,
              {
                name: "",
                price: "",
                durationDays: 30,
                kind: "subscription",
                deliverable: "",
                active: true,
                highlight: "",
                deliverableButtons: [],
              },
            ]);
            setAberto(rows.length);
          }}
          className="btn-ghost"
        >
          <IconPlus size={14} /> Adicionar oferta
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
function parseSteps(json?: string): WelcomeStep[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** O que o bot faz com cada pedido de entrada. Espelha os modos do servidor. */
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

function ApprovalCard({
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
  const [vip, setVip] = useState<ApprovalMode>(bot.vipApprovalMode || "subscribers");
  const [previas, setPrevias] = useState<ApprovalMode>(bot.previasApprovalMode || "all");
  const [seqPrevias, setSeqPrevias] = useState<WelcomeStep[]>(parseSteps(bot.previasWelcomeFunnel));
  const [seqVip, setSeqVip] = useState<WelcomeStep[]>(parseSteps(bot.vipWelcomeFunnel));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-approval",
        profileId,
        vipApprovalMode: vip,
        previasApprovalMode: previas,
        previasWelcomeFunnel: seqPrevias,
        vipWelcomeFunnel: seqVip,
      });
      showToast("Aprovação salva.", "success");
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

      <WelcomeSequence
        titulo="Boas-vindas ao entrar nas Prévias"
        steps={seqPrevias}
        setSteps={setSeqPrevias}
        tags={tags}
      />
      <WelcomeSequence
        titulo="Boas-vindas ao entrar no VIP"
        steps={seqVip}
        setSteps={setSeqVip}
        tags={tags}
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

/** Mostra uma URL com botão de copiar. Links relativos ganham a origem do
 *  navegador na hora de copiar — é o endereço que o operador vai colar fora. */
const ATRASOS = [
  { min: 0, label: "Imediato" },
  { min: 2, label: "2 min depois" },
  { min: 10, label: "10 min depois" },
  { min: 30, label: "30 min depois" },
  { min: 60, label: "1 hora depois" },
  { min: 180, label: "3 horas depois" },
  { min: 1440, label: "1 dia depois" },
];

/**
 * Editor da SEQUÊNCIA de boas-vindas de um grupo.
 *
 * Parecido com o editor de funil, mas sem desconto nem loop: aqui não se está
 * perseguindo quem não comprou, e sim recebendo quem acabou de entrar. Em
 * compensação tem o modo de botão, para decidir se aquele passo já mostra as
 * ofertas ou é só conversa.
 *
 * O atraso é ACUMULADO desde a entrada: passos de 0 e 10 saem na hora e 10
 * minutos depois. Vazio = nada é enviado (a aprovação continua acontecendo).
 */
function WelcomeSequence({
  titulo,
  steps,
  setSteps,
  tags,
}: {
  titulo: string;
  steps: WelcomeStep[];
  setSteps: (s: WelcomeStep[]) => void;
  tags: Tag[];
}) {
  function update(i: number, patch: Partial<WelcomeStep>) {
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <div className="mt-5">
      <p className="text-sm font-semibold text-white">{titulo}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
        Enviadas no <b>privado</b> de quem foi aprovado. Só chegam se a pessoa já tiver dado{" "}
        <code>/start</code> no bot — antes disso o Telegram proíbe a mensagem. Deixe vazio para não
        enviar nada.
      </p>

      <div className="mt-2 space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">Mensagem {i + 1}</span>
              <select
                className="input h-8 w-auto py-0 text-xs"
                value={String(s.delayMinutes ?? 0)}
                onChange={(e) => update(i, { delayMinutes: Number(e.target.value) })}
              >
                {ATRASOS.map((a) => (
                  <option key={a.min} value={a.min}>
                    {a.label}
                  </option>
                ))}
              </select>
              <select
                className="input h-8 w-auto py-0 text-xs"
                value={s.buttons || "none"}
                onChange={(e) => update(i, { buttons: e.target.value as WelcomeStep["buttons"] })}
              >
                <option value="none">Sem botões</option>
                <option value="plans">Com os planos</option>
              </select>
              <button
                onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                className="ml-auto grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
                aria-label="Remover mensagem"
              >
                <IconClose size={14} />
              </button>
            </div>

            <textarea
              className="input mt-2 min-h-[70px]"
              placeholder="Texto da mensagem · use {nome}"
              value={s.text}
              onChange={(e) => update(i, { text: e.target.value })}
            />

            <input
              className="input mt-2 text-xs"
              placeholder="Etiquetas da mídia (opcional) — ex.: previa, quente"
              value={s.mediaTags || ""}
              onChange={(e) => update(i, { mediaTags: e.target.value })}
            />
            {tags.length > 0 && (
              <p className="mt-1 text-[11px] text-zinc-500">
                Disponíveis: {tags.map((t) => t.name).join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => setSteps([...steps, { delayMinutes: steps.length === 0 ? 0 : 10, text: "", buttons: "none" }])}
        className="btn-ghost mt-2 px-2.5 py-1 text-xs"
      >
        <IconPlus size={13} /> Mensagem
      </button>
    </div>
  );
}
