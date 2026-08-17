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
  IconSparkle,
} from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import SectionRow, { resumo } from "@/components/telegram/bot/SectionRow";
import VarChips from "@/components/telegram/bot/VarChips";
import BotPreview, { PreviewBalao, type PreviewStyle } from "@/components/telegram/bot/BotPreview";
import FormatToolbar from "@/components/telegram/bot/FormatToolbar";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import MessageEditor, { VARS_PADRAO } from "@/components/telegram/bot/MessageEditor";
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
  pixDownsellFunnel?: string;
  downsellEnabled?: boolean;
  pixDownsellEnabled?: boolean;
  upsellEnabled?: boolean;
  effectWelcome?: string;
  effectPix?: string;
  effectSuccess?: string;
  previasUseWelcome?: boolean;
  vipUseWelcome?: boolean;
  dynamicPrice?: DynamicPrice;
  buttonStyles?: ButtonStyles;
};
/** Cores dos botões DESTA modelo (não do painel). O preview usa as mesmas. */
type ButtonStyles = Record<string, "" | "primary" | "success" | "danger">;
type DynamicPrice = { enabled: boolean; cents: number; direction: "up" | "down" | "random" };
type ButtonRoleInfo = { key: string; label: string; hint: string };
type WelcomeStep = {
  delayMinutes: number;
  text: string;
  /** Mídias escolhidas a dedo, na ordem de envio. */
  mediaIds?: string[];
  mediaMode?: "album" | "separate";
  /** Etiquetas — legado. Saiu da tela, o envio ainda lê (lib/telegramSend.ts). */
  mediaTags?: string;
  /** none = sem botão · plans = lista de planos · custom = os daqui de baixo. */
  buttons?: "none" | "plans" | "custom";
  customButtons?: { text: string; url: string }[];
};

/**
 * Botão padrão de quem acabou de entrar nas Prévias.
 *
 * O destino é o PRÓPRIO BOT com deep-link de /start: a mensagem no grupo de
 * prévias não vende, ela puxa a pessoa para a conversa onde a oferta acontece.
 * A URL é montada com o @ da modelo, então cada bot aponta para si mesmo.
 */
const BOTAO_APROVACAO_PADRAO = "😈 VER MEUS CONTEÚDOS";
function linkDoBot(botUsername?: string): string {
  const u = (botUsername || "").replace(/^@/, "").trim();
  return u ? `https://t.me/${u}?start=start` : "";
}
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
  bump?: Bump;
};
type Bump = {
  enabled: boolean;
  name: string;
  priceCents: number;
  text: string;
  acceptText?: string;
  declineText?: string;
  mediaIds?: string[];
  audioUrl?: string;
  deliverable?: string;
  deliverableButtons?: { text: string; url: string }[];
};
const BUMP_VAZIO: Bump = { enabled: false, name: "", priceCents: 0, text: "" };
type CustomButton = { id: string; text: string; url: string; sortOrder: number };
type Sub = {
  id: string;
  telegramUserId: number;
  telegramUsername?: string;
  status: "pending" | "active" | "expired" | "blocked";
  expiresAt: number;
  createdAt: number;
};
type FunnelStep = {
  delayMinutes: number;
  text: string;
  discountPercent?: number;
  /** Quais planos entram no teclado. */
  planMode?: "all" | "subs" | "packages" | "none";
  /** Para quem, dentro do público do funil. */
  audience?: "leads" | "expirados" | "todos";
  /** Mídias escolhidas a dedo, na ordem de envio. */
  mediaIds?: string[];
  mediaMode?: "album" | "separate";
  /** Etiquetas — legado. Saiu da tela, o envio ainda lê (lib/telegramSend.ts). */
  mediaTags?: string;
  isLoop?: boolean;
};

/** Um botão como o preview desenha. Mesmo formato do BotPreview. */
type Btn = { text: string; kind: "plan" | "custom" | "support"; style?: PreviewStyle };

export default function BotVendasPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  // Modelo escolhida no menu — vale para o painel inteiro.
  const { profileId } = useProfile();
  const [loading, setLoading] = useState(false);

  const [bot, setBot] = useState<Bot | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [buttons, setButtons] = useState<CustomButton[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [pixDefaults, setPixDefaults] = useState<PixDefaults | null>(null);
  const [tab, setTab] = useState<TabKey>("config");

  // A mensagem de boas-vindas e as etiquetas vivem AQUI, e não dentro da linha
  // que as edita: o preview à direita precisa acompanhar a digitação, e ele é
  // irmão do formulário, não filho.
  const [welcome, setWelcome] = useState("");
  const [welcomeIds, setWelcomeIds] = useState<string[]>([]);
  const [welcomeMode, setWelcomeMode] = useState<"album" | "separate">("album");
  // Efeitos de mensagem — editados aqui porque o preview precisa acompanhar.
  const [efeitoWelcome, setEfeitoWelcome] = useState("");
  const [efeitoPix, setEfeitoPix] = useState("");
  const [efeitoSuccess, setEfeitoSuccess] = useState("");
  // Os papéis de botão são fixos do produto; as CORES vêm do bot da modelo.
  const [buttonRoles, setButtonRoles] = useState<ButtonRoleInfo[]>([]);

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      const d = await apiGet<{
        bot: Bot | null;
        plans: Plan[];
        customButtons: CustomButton[];
        subscriptions: Sub[];
        pixDefaults: PixDefaults;
        buttonRoles: ButtonRoleInfo[];
      }>(`/api/telegram?profileId=${profileId}`);
      setBot(d.bot);
      setPlans(d.plans || []);
      setButtons(d.customButtons || []);
      setSubs(d.subscriptions || []);
      setPixDefaults(d.pixDefaults || null);
      setWelcome(d.bot?.welcomeMessage || "");
      setWelcomeIds(d.bot?.welcomeMediaIds || []);
      setWelcomeMode(d.bot?.welcomeMediaMode || "album");
      setEfeitoWelcome(d.bot?.effectWelcome || "");
      setEfeitoPix(d.bot?.effectPix || "");
      setEfeitoSuccess(d.bot?.effectSuccess || "");
      setButtonRoles(d.buttonRoles || []);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  // O preview só faz sentido nas abas que mudam o que o lead vê no /start.
  const mostraPreview = tab === "config" || tab === "planos";
  // A cor de cada botão segue a MESMA regra do envio (planButtonStyleProps):
  // a cor do plano manda; sem ela, vale o estilo do papel "plans".
  const CORES_DO_PLANO: ButtonStyles = { green: "success", blue: "primary", red: "danger" };
  const corDo = (v: string | undefined): PreviewStyle => (v as PreviewStyle) || "";
  const previewButtons = [
    ...plans
      .filter((p) => p.active !== false)
      .map((p) => ({
        text: `${p.name} - ${(p.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        kind: "plan" as const,
        style: corDo((p.highlight && CORES_DO_PLANO[p.highlight]) || bot?.buttonStyles?.plans),
      })),
    ...buttons.map((b) => ({ text: b.text, kind: "custom" as const, style: corDo(bot?.buttonStyles?.redirect) })),
    ...(bot?.supportUsername
      ? [{ text: "💬 Suporte / Dúvidas", kind: "support" as const, style: corDo(bot?.buttonStyles?.redirect) }]
      : []),
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
                    welcome={welcome}
                    setWelcome={setWelcome}
                    mediaIds={welcomeIds}
                    setMediaIds={setWelcomeIds}
                    mode={welcomeMode}
                    setMode={setWelcomeMode}
                    efeito={efeitoWelcome}
                    setEfeito={setEfeitoWelcome}
                    onSaved={load}
                  />
                  <SuccessRow profileId={profileId} bot={bot} onSaved={load} />
                  <PixRow profileId={profileId} bot={bot} pixDefaults={pixDefaults} onSaved={load} />
                  <ExtrasRow profileId={profileId} bot={bot} onSaved={load} />
                  <ButtonsCard profileId={profileId} buttons={buttons} onSaved={load} />
                  {/* Estas duas valem para TODAS as modelos, e mesmo assim
                      moram aqui: é nesta tela que se configura o bot, e mandar
                      o operador para outra página só para escolher uma cor era
                      o motivo de ninguém achá-las. O aviso dentro de cada uma
                      diz o alcance. */}
                  <PrecoDinamicoRow profileId={profileId} bot={bot} onSaved={load} />
                  <CoresBotoesRow
                    profileId={profileId}
                    bot={bot}
                    roles={buttonRoles}
                    onSaved={load}
                  />
                </>
              )}
              {tab === "planos" && <PlansCard profileId={profileId} plans={plans} onSaved={load} />}
              {tab === "recuperacao" && (
                <FunnelCard profileId={profileId} bot={bot} planos={plans} onSaved={load} />
              )}
              {tab === "aprovacao" && (
                <ApprovalCard profileId={profileId} bot={bot} planos={previewButtons} onSaved={load} />
              )}
            </div>

            {mostraPreview && (
              <BotPreview
                botUsername={bot.botUsername}
                welcomeMessage={welcome}
                welcomeMediaIds={welcomeIds}
                welcomeMediaMode={welcomeMode}
                buttons={previewButtons}
                effect={efeitoWelcome}
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

/**
 * EFEITO DE MENSAGEM: a animação nativa que o Telegram roda quando a mensagem
 * chega. É do aplicativo, então aqui só dá para escolher qual — o preview
 * marca a escolha com o emoji, mas quem anima é o Telegram.
 *
 * Vale só em CONVERSA PRIVADA, que é onde o bot de vendas fala com o lead o
 * tempo todo. Num grupo o Telegram recusaria a mensagem inteira, por isso o
 * envio reenvia sem o efeito se ele for barrado.
 */
const EFEITOS: { key: string; label: string; emoji: string }[] = [
  { key: "", label: "Sem efeito", emoji: "—" },
  { key: "fire", label: "Fogo", emoji: "🔥" },
  { key: "party", label: "Comemoração", emoji: "🎉" },
  { key: "heart", label: "Coração", emoji: "❤️" },
  { key: "like", label: "Joinha", emoji: "👍" },
  { key: "dislike", label: "Negativo", emoji: "👎" },
  { key: "poop", label: "Cocô", emoji: "💩" },
];

function EfeitoPicker({
  valor,
  onChange,
  hint,
}: {
  valor: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="mt-4">
      <label className="eyebrow block">Efeito de mensagem</label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {EFEITOS.map((e) => (
          <button
            key={e.key}
            type="button"
            onClick={() => onChange(e.key)}
            title={e.label}
            className={`rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
              valor === e.key
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-ink-850 text-zinc-400 hover:border-white/20"
            }`}
          >
            {e.emoji} <span className="text-[11px]">{e.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        {hint || "A animação roda quando a mensagem chega. Só funciona no privado."}
      </p>
    </div>
  );
}

function WelcomeRow({
  profileId,
  bot,
  welcome,
  setWelcome,
  mediaIds,
  setMediaIds,
  mode,
  setMode,
  efeito,
  setEfeito,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  welcome: string;
  setWelcome: (v: string) => void;
  mediaIds: string[];
  setMediaIds: (v: string[]) => void;
  mode: "album" | "separate";
  setMode: (v: "album" | "separate") => void;
  efeito: string;
  setEfeito: (v: string) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-bot-messages",
        profileId,
        welcomeMessage: welcome,
        welcomeMediaIds: mediaIds,
        welcomeMediaMode: mode,
        effectWelcome: efeito,
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
        <MessageEditor
          profileId={profileId}
          text={welcome}
          onText={setWelcome}
          mediaIds={mediaIds}
          onMediaIds={setMediaIds}
          mode={mode}
          onMode={setMode}
          vars={VARS_PADRAO}
          placeholder="Oi meu amor... use {nome}"
          minHeight={140}
        />
      </div>
      {/* As ETIQUETAS saíram: a mídia da abertura é escolhida a dedo, sempre.
          Sortear significava não saber o que o lead ia ver na primeira tela da
          conversa. O sorteio continua funcionando para quem já tinha etiquetas
          salvas (ver lib/telegramSend.ts), mas não se configura mais aqui. */}

      <EfeitoPicker valor={efeito} onChange={setEfeito} />

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar mensagem"}
      </button>
    </SectionRow>
  );
}

function SuccessRow({ profileId, bot, onSaved }: { profileId: string; bot: Bot; onSaved: () => void }) {
  const [texto, setTexto] = useState(bot.successMessage || "");
  const [botao, setBotao] = useState(bot.successButtonText || "");
  const [efeito, setEfeito] = useState(bot.effectSuccess || "");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Sem {link_vip} escrito no texto, o envio ANEXA o link no fim e sempre põe o
  // botão de acesso — o cliente nunca fica sem caminho para o grupo. Ainda
  // assim o aviso continua, porque o texto sai diferente do que está escrito
  // aqui, e é melhor o operador saber disso antes da primeira venda.
  const semMarcador = !/{link_vip}/i.test(texto);

  async function save() {
    setBusy(true);
    try {
      await salvarMensagens(profileId, {
        successMessage: texto,
        successButtonText: botao,
        effectSuccess: efeito,
      });
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
      status={semMarcador ? { label: "link anexado no fim", tone: "warn" } : undefined}
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
        O botão de acesso vai <b>sempre</b>. Vazio, ele sai com o texto padrão
        (&quot;{"🔒 Acessar Conteúdo"}&quot;).
      </p>

      {semMarcador && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-xs text-amber-300">
          Sem <b>{"{link_vip}"}</b> no texto, o link do VIP é anexado no fim da mensagem. Escreva a
          variável onde você quiser que ele apareça para mandar no lugar dele.
        </p>
      )}

      <EfeitoPicker
        valor={efeito}
        onChange={setEfeito}
        hint="É a única mensagem que o cliente recebe DEPOIS de pagar — vale comemorar."
      />

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
  const [efeito, setEfeito] = useState(bot.effectPix || "");
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
        effectPix: efeito,
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

      <EfeitoPicker
        valor={efeito}
        onChange={setEfeito}
        hint="Marca a chegada da cobrança em vez de ela passar como mais uma mensagem."
      />

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
            setEfeito("");
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
        vars={VARS_PADRAO}
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
  bump: Bump;
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
      bump: p.bump || { ...BUMP_VAZIO },
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
          bump: {
            ...r.bump,
            deliverableButtons: (r.bump.deliverableButtons || []).filter(
              (b) => b.text.trim() && b.url.trim(),
            ),
          },
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
            bump: p.bump || { ...BUMP_VAZIO },
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
                    {r.bump.enabled && (
                      <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                        + bump
                      </span>
                    )}
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

                  <BumpEditor
                    profileId={profileId}
                    plano={r.name || "este plano"}
                    precoPlano={Math.round(parseFloat(r.price.replace(",", ".")) * 100) || 0}
                    bump={r.bump}
                    setBump={(b) => update(i, { bump: b })}
                  />
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
                bump: { ...BUMP_VAZIO },
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
  planos,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  /** Os planos ativos, para cada passo mostrar o preço já com o desconto. */
  planos: Plan[];
  onSaved: () => void;
}) {
  const [downsell, setDownsell] = useState<FunnelStep[]>(parseFunnel(bot.downsellFunnel));
  const [pixDownsell, setPixDownsell] = useState<FunnelStep[]>(parseFunnel(bot.pixDownsellFunnel));
  const [upsell, setUpsell] = useState<FunnelStep[]>(parseFunnel(bot.upsellFunnel));
  const [onDownsell, setOnDownsell] = useState(bot.downsellEnabled !== false);
  const [onPix, setOnPix] = useState(bot.pixDownsellEnabled !== false);
  const [onUpsell, setOnUpsell] = useState(bot.upsellEnabled !== false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-funnels",
        profileId,
        downsellFunnel: JSON.stringify(downsell),
        pixDownsellFunnel: JSON.stringify(pixDownsell),
        upsellFunnel: JSON.stringify(upsell),
        downsellEnabled: onDownsell,
        pixDownsellEnabled: onPix,
        upsellEnabled: onUpsell,
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
    <div className="space-y-3">
      <div className="card p-4">
        <h2 className="font-display text-lg font-semibold">Recuperação</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Três gatilhos diferentes, com sequências separadas. Cada etapa dispara depois do tempo
          indicado, contado a partir da anterior — e a sequência <b>para sozinha</b> assim que a
          pessoa muda de estado (pagou, no caso dos downsells).
        </p>
      </div>

      <FunilRetratil
        titulo="Downsell geral"
        resumo="Quem deu /start e ainda não comprou"
        aviso="Começa a contar do último contato do lead com o bot. Para de vez quando o pagamento é confirmado."
        ativo={onDownsell}
        setAtivo={setOnDownsell}
        steps={downsell}
        setSteps={setDownsell}
        profileId={profileId}
        planos={planos}
      />

      <FunilRetratil
        titulo="Downsell de PIX gerado"
        resumo="Quem chegou a gerar o PIX e não pagou"
        aviso="Público diferente do geral: essa pessoa já escolheu o plano e viu a tela de pagamento — falta menos, então costuma valer outra conversa e outro desconto. Conta a partir da criação da cobrança e para quando ela é paga."
        ativo={onPix}
        setAtivo={setOnPix}
        steps={pixDownsell}
        setSteps={setPixDownsell}
        profileId={profileId}
        planos={planos}
      />

      <FunilRetratil
        titulo="Upsell"
        resumo="Pós-venda para quem já é assinante"
        aviso="Conta a partir da confirmação do pagamento. Serve para oferecer o plano maior, um pacote ou a renovação."
        ativo={onUpsell}
        setAtivo={setOnUpsell}
        steps={upsell}
        setSteps={setUpsell}
        profileId={profileId}
        planos={planos}
      />

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar funis"}
      </button>
    </div>
  );
}

/** Tempos oferecidos na Recuperação. Lista fechada porque digitar minutos
 *  soltos convidava a "1440" quando a intenção era "1 dia". */
const TEMPOS = [
  { min: 5, label: "5 min" },
  { min: 10, label: "10 min" },
  { min: 15, label: "15 min" },
  { min: 20, label: "20 min" },
  { min: 25, label: "25 min" },
  { min: 30, label: "30 min" },
  { min: 45, label: "45 min" },
  { min: 60, label: "1 hora" },
  { min: 120, label: "2 horas" },
  { min: 180, label: "3 horas" },
  { min: 360, label: "6 horas" },
  { min: 720, label: "12 horas" },
  { min: 1440, label: "1 dia" },
  { min: 2880, label: "2 dias" },
  { min: 4320, label: "3 dias" },
];

const DESCONTOS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70];

/** Quais planos vão no teclado da mensagem. */
const MODOS_BOTAO: { key: NonNullable<FunnelStep["planMode"]>; label: string }[] = [
  { key: "all", label: "Todos os planos" },
  { key: "subs", label: "Só assinaturas" },
  { key: "packages", label: "Só pacotes" },
  { key: "none", label: "Sem botões" },
];

/** Para quem esta mensagem vale, dentro do público do funil. */
const PUBLICOS: { key: NonNullable<FunnelStep["audience"]>; label: string; hint: string }[] = [
  { key: "leads", label: "Só leads (não compraram)", hint: "Nunca comprou nada." },
  { key: "expirados", label: "Expirados", hint: "Já comprou e o acesso venceu." },
  { key: "todos", label: "Todos", hint: "Leads e expirados." },
];

/** Minutos → a maior unidade inteira, para o campo personalizado abrir certo. */
function decompoeMinutos(min: number): { valor: number; unidade: "min" | "h" | "d" } {
  if (min > 0 && min % 1440 === 0) return { valor: min / 1440, unidade: "d" };
  if (min > 0 && min % 60 === 0) return { valor: min / 60, unidade: "h" };
  return { valor: min, unidade: "min" };
}

function paraMinutos(valor: number, unidade: "min" | "h" | "d"): number {
  const v = Math.max(1, Math.floor(valor) || 1);
  return unidade === "d" ? v * 1440 : unidade === "h" ? v * 60 : v;
}

function rotuloDoTempo(min: number): string {
  const achado = TEMPOS.find((t) => t.min === min);
  if (achado) return achado.label;
  const { valor, unidade } = decompoeMinutos(min);
  return `${valor} ${unidade === "d" ? "dia(s)" : unidade === "h" ? "hora(s)" : "min"}`;
}

/**
 * Campo de TEMPO com lista fechada mais "Personalizado".
 *
 * A lista cobre o que se usa no dia a dia; o personalizado existe porque
 * fechar a lista de vez obrigaria a escolher o valor errado quando o certo não
 * está nela. E ele pede a UNIDADE, em vez de minutos: "3 dias" digitado como
 * 4320 é onde se erra uma casa e a mensagem sai um mês depois.
 */
function TempoDoPasso({ minutos, onChange }: { minutos: number; onChange: (v: number) => void }) {
  const naLista = TEMPOS.some((t) => t.min === minutos);
  const [personalizado, setPersonalizado] = useState(!naLista);
  const inicial = decompoeMinutos(minutos);
  const [valor, setValor] = useState(inicial.valor);
  const [unidade, setUnidade] = useState<"min" | "h" | "d">(inicial.unidade);

  return (
    <div>
      <label className="eyebrow block">Tempo de espera</label>
      <select
        className="input mt-1 h-9 py-0 text-xs"
        value={personalizado ? "custom" : String(minutos)}
        onChange={(e) => {
          if (e.target.value === "custom") {
            setPersonalizado(true);
            const d = decompoeMinutos(minutos);
            setValor(d.valor);
            setUnidade(d.unidade);
          } else {
            setPersonalizado(false);
            onChange(Number(e.target.value));
          }
        }}
      >
        {TEMPOS.map((t) => (
          <option key={t.min} value={t.min}>
            {t.label}
          </option>
        ))}
        <option value="custom">Personalizado…</option>
      </select>

      {personalizado && (
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="number"
            min={1}
            className="input h-9 w-20 py-0 text-xs"
            value={valor}
            onChange={(e) => {
              const v = Number(e.target.value);
              setValor(v);
              onChange(paraMinutos(v, unidade));
            }}
          />
          <select
            className="input h-9 flex-1 py-0 text-xs"
            value={unidade}
            onChange={(e) => {
              const u = e.target.value as "min" | "h" | "d";
              setUnidade(u);
              onChange(paraMinutos(valor, u));
            }}
          >
            <option value="min">minutos</option>
            <option value="h">horas</option>
            <option value="d">dias</option>
          </select>
        </div>
      )}
      <p className="mt-1 text-[11px] text-zinc-500">Envia {rotuloDoTempo(minutos)} depois da anterior.</p>
    </div>
  );
}

/** Desconto com lista fechada mais "Personalizado". */
function DescontoDoPasso({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  const [personalizado, setPersonalizado] = useState(!DESCONTOS.includes(valor));

  return (
    <div>
      <label className="eyebrow block">Desconto</label>
      <select
        className="input mt-1 h-9 py-0 text-xs"
        value={personalizado ? "custom" : String(valor)}
        onChange={(e) => {
          if (e.target.value === "custom") setPersonalizado(true);
          else {
            setPersonalizado(false);
            onChange(Number(e.target.value));
          }
        }}
      >
        {DESCONTOS.map((d) => (
          <option key={d} value={d}>
            {d === 0 ? "Sem desconto" : `${d}%`}
          </option>
        ))}
        <option value="custom">Personalizado…</option>
      </select>

      {personalizado && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={100}
            className="input h-9 w-20 py-0 text-xs"
            value={valor}
            // Acima de 100% o preço viraria negativo e o gateway recusaria a
            // cobrança — o limite é do mundo real, não da tela.
            onChange={(e) => onChange(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
          />
          <span className="text-xs text-zinc-500">%</span>
        </div>
      )}
    </div>
  );
}

/**
 * Um passo da RECUPERAÇÃO.
 *
 * Mesmo editor das outras telas (texto, variáveis, mídia escolhida) mais o que
 * só existe aqui: quando a mensagem sai, quanto de desconto ela leva, e a
 * lista dos PLANOS ENVIADOS já com o desconto aplicado — porque o desconto é
 * um número solto que só significa alguma coisa depois de virar preço, e
 * conferir isso de cabeça a cada mudança é como se erra o valor da oferta.
 */
function FunnelEditor({
  profileId,
  title,
  steps,
  setSteps,
  planos,
}: {
  profileId: string;
  title: string;
  steps: FunnelStep[];
  setSteps: (s: FunnelStep[]) => void;
  planos: Plan[];
}) {
  function update(i: number, patch: Partial<FunnelStep>) {
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  const todosAtivos = planos.filter((p) => p.active !== false);

  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      {title && <p className="eyebrow">{title}</p>}
      <div className="mt-2 space-y-3">
        {steps.map((s, i) => {
          const desconto = s.discountPercent ?? 0;
          // O "Planos enviados" mostra EXATAMENTE o que vai no teclado — se
          // ignorasse o modo de botões, o operador conferiria uma lista que
          // não é a que o lead recebe.
          const modo = s.planMode || "all";
          const ativos = todosAtivos.filter((p) =>
            modo === "subs" ? p.kind !== "package" : modo === "packages" ? p.kind === "package" : true,
          );
          return (
            <div key={i} className="panel p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="chip">Mensagem {i + 1}</span>
                <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                  <input
                    type="checkbox"
                    className="accent-white"
                    checked={Boolean(s.isLoop)}
                    onChange={(e) => update(i, { isLoop: e.target.checked })}
                  />
                  repetir (loop)
                </label>
                {/* Duplicar poupa refazer texto, mídia e desconto quando a
                    mensagem seguinte é uma variação da anterior — que é o caso
                    na maior parte das sequências de recuperação. */}
                <button
                  onClick={() => setSteps([...steps.slice(0, i + 1), { ...s }, ...steps.slice(i + 1)])}
                  className="ml-auto rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  Duplicar
                </button>
                <button
                  onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                  className="rounded px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10"
                >
                  Excluir
                </button>
              </div>

              <MessageEditor
                profileId={profileId}
                text={s.text}
                onText={(v) => update(i, { text: v })}
                mediaIds={s.mediaIds || []}
                onMediaIds={(v) => update(i, { mediaIds: v })}
                mode={s.mediaMode}
                onMode={(v) => update(i, { mediaMode: v })}
                vars={VARS_PADRAO}
                placeholder="Texto da mensagem · use {nome}"
                minHeight={90}
              />

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <TempoDoPasso
                  minutos={s.delayMinutes ?? 60}
                  onChange={(v) => update(i, { delayMinutes: v })}
                />
                <DescontoDoPasso
                  valor={desconto}
                  onChange={(v) => update(i, { discountPercent: v })}
                />
                <div>
                  <label className="eyebrow block">Modo dos botões</label>
                  <select
                    className="input mt-1 h-9 py-0 text-xs"
                    value={s.planMode || "all"}
                    onChange={(e) =>
                      update(i, { planMode: e.target.value as FunnelStep["planMode"] })
                    }
                  >
                    {MODOS_BOTAO.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="eyebrow block">Destinatários</label>
                  <select
                    className="input mt-1 h-9 py-0 text-xs"
                    value={s.audience || "leads"}
                    onChange={(e) =>
                      update(i, { audience: e.target.value as FunnelStep["audience"] })
                    }
                  >
                    {PUBLICOS.map((pb) => (
                      <option key={pb.key} value={pb.key}>
                        {pb.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {PUBLICOS.find((pb) => pb.key === (s.audience || "leads"))?.hint}
                  </p>
                </div>
              </div>

              {ativos.length > 0 && s.planMode !== "none" && (
                <div className="mt-3 rounded-xl border border-dashed border-white/10 p-2.5">
                  <p className="eyebrow mb-1.5">Planos enviados</p>
                  <div className="space-y-1">
                    {ativos.map((p) => {
                      const cheio = p.priceCents;
                      const comDesconto =
                        desconto > 0 ? Math.floor(cheio * (1 - desconto / 100)) : cheio;
                      return (
                        <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-zinc-300">
                            {desconto > 0 && <span className="text-amber-400">🔥 (-{desconto}%) </span>}
                            {p.highlight === "green" && "⭐ "}
                            {p.name}
                          </span>
                          <span className="shrink-0 font-mono">
                            {desconto > 0 && (
                              <span className="mr-1.5 text-zinc-600 line-through">
                                {brl(cheio)}
                              </span>
                            )}
                            <span className={desconto > 0 ? "text-emerald-400" : "text-zinc-300"}>
                              {brl(comDesconto)}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={() =>
          setSteps([...steps, { delayMinutes: steps.length === 0 ? 60 : 1440, text: "", discountPercent: 0 }])
        }
        className="btn-ghost mt-2 text-sm"
      >
        <IconPlus size={13} /> Adicionar mensagem
      </button>
      {todosAtivos.length === 0 && (
        <p className="mt-2 text-[11px] text-amber-400">
          Nenhum plano ativo: estas mensagens sairiam sem botão de compra.
        </p>
      )}
    </div>
  );
}

/** Centavos → R$ 0,00. */
function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Preço dinâmico e cores dos botões — DA MODELO
//
// Nasceram como configuração global do painel, e isso estava errado: tudo no
// bot de vendas é decidido modelo a modelo — preço, planos, textos, funis.
// Duas modelos podem ter paletas e políticas de preço diferentes, e com um
// valor só uma delas sempre estaria com a configuração da outra.
// ---------------------------------------------------------------------------

/** As três cores que o Telegram aceita (Bot API 9.4), mais o padrão. */
const CORES_BOTAO: { key: string; label: string; dot: string; ring: string }[] = [
  { key: "", label: "Padrão", dot: "bg-zinc-500", ring: "border-white/10 text-zinc-300" },
  { key: "primary", label: "Azul", dot: "bg-indigo-400", ring: "border-indigo-500/50 text-indigo-300" },
  { key: "success", label: "Verde", dot: "bg-emerald-400", ring: "border-emerald-500/50 text-emerald-300" },
  { key: "danger", label: "Vermelho", dot: "bg-red-400", ring: "border-red-500/50 text-red-300" },
];

const PRECO_VAZIO: DynamicPrice = { enabled: false, cents: 9, direction: "random" };

function PrecoDinamicoRow({
  profileId,
  bot,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  onSaved: () => void;
}) {
  const [preco, setPreco] = useState<DynamicPrice>(bot.dynamicPrice || PRECO_VAZIO);
  const [busy, setBusy] = useState(false);

  async function salvar() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-dynamic-price",
        profileId,
        dynamicPrice: preco,
      });
      showToast("Preço dinâmico salvo.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  const direcao =
    preco.direction === "up" ? "para cima" : preco.direction === "down" ? "para baixo" : "aleatório";

  return (
    <SectionRow
      icon={<IconPayments size={16} />}
      title="Preço dinâmico"
      summary={
        preco.enabled
          ? `Ligado · até ${preco.cents} centavo(s) · ${direcao}`
          : "Desligado — todo mundo paga o mesmo valor"
      }
      status={preco.enabled ? { label: "ligado", tone: "ok" } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs leading-relaxed text-zinc-400">
          Soma ou subtrai alguns centavos do valor, de forma <b>única por cliente</b>. A conta vem do
          ID do Telegram, então o mesmo lead recebe sempre o mesmo valor — é isso que permite casar
          um PIX recebido com quem devia pagá-lo, mesmo quando o comprovante não traz mais nada.
          Dificulta o estorno indevido e o &quot;já paguei&quot; de quem não pagou.
        </p>
        <Switch
          checked={preco.enabled}
          onChange={(v) => setPreco({ ...preco, enabled: v })}
          ariaLabel="Preço dinâmico"
        />
      </div>

      {preco.enabled && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="eyebrow block">Variação em centavos</label>
            <input
              type="number"
              min={1}
              max={100}
              className="input mt-1.5"
              value={preco.cents}
              onChange={(e) => setPreco({ ...preco, cents: Number(e.target.value) })}
            />
            <p className="mt-1 text-[11px] text-zinc-500">De 1 até 100 centavos.</p>
          </div>
          <div>
            <label className="eyebrow block">Direção da variação</label>
            <select
              className="input mt-1.5"
              value={preco.direction}
              onChange={(e) =>
                setPreco({ ...preco, direction: e.target.value as DynamicPrice["direction"] })
              }
            >
              <option value="random">Aleatório (fixo por lead)</option>
              <option value="up">Sempre para cima</option>
              <option value="down">Sempre para baixo</option>
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">
              No aleatório o sentido também vem do ID, então não muda entre as tentativas do mesmo
              cliente.
            </p>
          </div>
        </div>
      )}

      <button onClick={salvar} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar preço dinâmico"}
      </button>
    </SectionRow>
  );
}

function CoresBotoesRow({
  profileId,
  bot,
  roles,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  roles: ButtonRoleInfo[];
  onSaved: () => void;
}) {
  const [estilos, setEstilos] = useState<ButtonStyles>(bot.buttonStyles || {});
  const [busy, setBusy] = useState(false);

  async function salvar() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-button-styles",
        profileId,
        buttonStyles: estilos,
      });
      showToast("Cores salvas.", "success");
      // Recarrega: o PREVIEW ao lado desenha os botões com essas cores e
      // mentiria até o próximo F5.
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  const comCor = roles.filter((r) => estilos[r.key]).length;

  return (
    <SectionRow
      icon={<IconSparkle size={16} />}
      title="Cores dos botões"
      summary={
        comCor > 0
          ? `${comCor} de ${roles.length} papéis com cor própria`
          : "Todos na cor padrão do Telegram"
      }
      status={comCor > 0 ? { label: `${comCor} com cor`, tone: "ok" } : undefined}
    >
      <p className="text-xs leading-relaxed text-zinc-400">
        Cor dos botões que o bot desta modelo mostra dentro do Telegram. Cada papel do fluxo tem a
        sua, porque a intenção muda: a lista de planos pede destaque, copiar a chave é auxiliar, e o
        acesso ao VIP depois do pagamento merece o verde. Um plano com cor própria ignora a cor da
        lista.
      </p>
      <p className="mt-2 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.07] p-2.5 text-[11px] leading-relaxed text-zinc-300">
        A cor chegou na <b>Bot API 9.4</b> (fev/2026) e aparece nos apps atualizados. Em apps antigos
        o botão sai na cor padrão — o texto e a ação continuam funcionando, então não há risco em
        ligar.
      </p>

      <div className="mt-4 space-y-3">
        {roles.map((r) => (
          <div key={r.key} className="panel p-3">
            <p className="text-sm font-semibold text-white">{r.label}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{r.hint}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CORES_BOTAO.map((c) => {
                const ativo = (estilos[r.key] || "") === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setEstilos({ ...estilos, [r.key]: c.key as ButtonStyles[string] })}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      ativo ? `${c.ring} bg-white/5` : "border-white/10 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {roles.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">Carregando…</p>}
      </div>

      <button onClick={salvar} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar cores"}
      </button>
    </SectionRow>
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
  planos,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  /** Os botões dos planos, como o preview desenha — para a linha "usar a
   *  mensagem de boas-vindas" mostrar exatamente o que vai ser enviado. */
  planos: Btn[];
  onSaved: () => void;
}) {
  const [vip, setVip] = useState<ApprovalMode>(bot.vipApprovalMode || "subscribers");
  const [previas, setPrevias] = useState<ApprovalMode>(bot.previasApprovalMode || "all");
  const [seqPrevias, setSeqPrevias] = useState<WelcomeStep[]>(parseSteps(bot.previasWelcomeFunnel));
  const [seqVip, setSeqVip] = useState<WelcomeStep[]>(parseSteps(bot.vipWelcomeFunnel));
  const [usaPrevias, setUsaPrevias] = useState(Boolean(bot.previasUseWelcome));
  const [usaVip, setUsaVip] = useState(Boolean(bot.vipUseWelcome));
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
        previasUseWelcome: usaPrevias,
        vipUseWelcome: usaVip,
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
        profileId={profileId}
        titulo="Boas-vindas ao entrar nas Prévias"
        steps={seqPrevias}
        setSteps={setSeqPrevias}
        usarBoasVindas={usaPrevias}
        setUsarBoasVindas={setUsaPrevias}
        boasVindas={bot.welcomeMessage}
        boasVindasMedia={bot.welcomeMediaIds || []}
        boasVindasModo={bot.welcomeMediaMode}
        planos={planos}
        botUsername={bot.botUsername}
      />
      <WelcomeSequence
        profileId={profileId}
        titulo="Boas-vindas ao entrar no VIP"
        steps={seqVip}
        setSteps={setSeqVip}
        usarBoasVindas={usaVip}
        setUsarBoasVindas={setUsaVip}
        boasVindas={bot.welcomeMessage}
        boasVindasMedia={bot.welcomeMediaIds || []}
        boasVindasModo={bot.welcomeMediaMode}
        planos={planos}
        botUsername={bot.botUsername}
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
  profileId,
  titulo,
  steps,
  setSteps,
  usarBoasVindas,
  setUsarBoasVindas,
  boasVindas,
  boasVindasMedia,
  boasVindasModo,
  planos,
  botUsername,
}: {
  profileId: string;
  titulo: string;
  steps: WelcomeStep[];
  setSteps: (s: WelcomeStep[]) => void;
  usarBoasVindas: boolean;
  setUsarBoasVindas: (v: boolean) => void;
  /** O que a mensagem de boas-vindas tem hoje — para mostrar no preview. */
  boasVindas: string;
  boasVindasMedia: string[];
  boasVindasModo: "album" | "separate";
  planos: Btn[];
  /** @ do bot desta modelo — monta o link padrão do botão próprio. */
  botUsername?: string;
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

      {/* REUSAR A MENSAGEM DE BOAS-VINDAS. É a mesma conversa: quem entra no
          grupo precisa ver a mesma oferta de quem chega pelo /start. Manter as
          duas em sincronia na mão era garantia de elas divergirem. */}
      <div className="mt-2.5 rounded-xl border border-white/10 bg-ink-850 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100">Usar a mensagem de boas-vindas</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              Manda a MESMA mensagem do <code>/start</code> — texto, mídias e botões dos planos —
              como primeira mensagem. Editar as boas-vindas muda as duas de uma vez.
            </p>
          </div>
          <Switch
            checked={usarBoasVindas}
            onChange={setUsarBoasVindas}
            ariaLabel="Usar a mensagem de boas-vindas"
          />
        </div>

        {usarBoasVindas && (
          <div className="mt-3">
            <p className="eyebrow mb-1.5">O que vai ser enviado</p>
            <PreviewBalao
              mediaIds={boasVindasMedia}
              mode={boasVindasModo}
              text={boasVindas}
              buttons={planos}
              vazio="(mensagem de boas-vindas vazia)"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              As mensagens abaixo continuam valendo e saem <b>depois</b> desta.
            </p>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">
                Mensagem {usarBoasVindas ? i + 2 : i + 1}
              </span>
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
                <option value="custom">Botões próprios desta mensagem</option>
              </select>
              <button
                onClick={() => setSteps([...steps.slice(0, i + 1), { ...s }, ...steps.slice(i + 1)])}
                className="ml-auto rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                Duplicar
              </button>
              <button
                onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
                aria-label="Remover mensagem"
              >
                <IconClose size={14} />
              </button>
            </div>

            <div className="mt-2">
              <MessageEditor
                profileId={profileId}
                text={s.text}
                onText={(v) => update(i, { text: v })}
                mediaIds={s.mediaIds || []}
                onMediaIds={(v) => update(i, { mediaIds: v })}
                mode={s.mediaMode}
                onMode={(v) => update(i, { mediaMode: v })}
                vars={VARS_PADRAO}
                placeholder="Texto da mensagem · use {nome}"
                minHeight={80}
              />
            </div>

            {s.buttons === "custom" && (
              <BotoesDoPasso
                botoes={s.customButtons || []}
                setBotoes={(v) => update(i, { customButtons: v })}
                botUsername={botUsername}
              />
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

/**
 * Botões próprios de UM passo da sequência de aprovação.
 *
 * O caso comum tem um botão só e sempre o mesmo: levar quem entrou no grupo
 * de prévias para a conversa do bot, onde a oferta acontece. Por isso o "+"
 * já nasce preenchido com esse botão — o operador não precisa lembrar do
 * formato do deep-link, e o link aponta para o bot DESTA modelo.
 */
function BotoesDoPasso({
  botoes,
  setBotoes,
  botUsername,
}: {
  botoes: { text: string; url: string }[];
  setBotoes: (v: { text: string; url: string }[]) => void;
  botUsername?: string;
}) {
  const padrao = linkDoBot(botUsername);

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-ink-850 p-3">
      <p className="eyebrow">Botões desta mensagem</p>
      <div className="mt-2 space-y-2">
        {botoes.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              className="input min-w-[140px] flex-1"
              placeholder="Texto do botão"
              value={b.text}
              onChange={(e) =>
                setBotoes(botoes.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
              }
            />
            <input
              className="input min-w-[180px] flex-[2] font-mono text-xs"
              placeholder="https://t.me/..."
              value={b.url}
              onChange={(e) =>
                setBotoes(botoes.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
              }
            />
            <button
              onClick={() => setBotoes(botoes.filter((_, j) => j !== i))}
              className="grid h-8 w-8 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
              aria-label="Remover botão"
            >
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setBotoes([...botoes, { text: BOTAO_APROVACAO_PADRAO, url: padrao }])}
        className="btn-ghost mt-2 px-2.5 py-1 text-xs"
      >
        <IconPlus size={13} /> Botão
      </button>

      {botoes.length === 0 && (
        <p className="mt-1.5 text-[11px] text-amber-400">
          Sem botão, esta mensagem sai só com o texto.
        </p>
      )}
      {!padrao && (
        <p className="mt-1.5 text-[11px] text-amber-400">
          O @ do bot ainda não foi lido — salve as credenciais em Modelos para o link do botão vir
          preenchido sozinho.
        </p>
      )}
    </div>
  );
}

/**
 * ORDER BUMP de um plano — a oferta extra mostrada entre escolher o plano e
 * gerar o PIX.
 *
 * O aceite SOMA o valor à mesma cobrança, em vez de criar uma segunda: dois
 * PIX deixariam um em aberto se o cliente desistisse no meio, e o painel
 * mostraria uma venda pendente que nunca fecharia.
 */
function BumpEditor({
  profileId,
  plano,
  precoPlano,
  bump,
  setBump,
}: {
  profileId: string;
  plano: string;
  precoPlano: number;
  bump: Bump;
  setBump: (b: Bump) => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<Bump>) => setBump({ ...bump, ...patch });
  const total = precoPlano + bump.priceCents;

  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Order Bump</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Oferta extra mostrada depois de escolher este plano e antes de gerar o PIX. O aceite
            soma ao <b>mesmo</b> pagamento.
          </p>
        </div>
        <Switch
          checked={bump.enabled}
          onChange={(v) => set({ enabled: v })}
          ariaLabel="Ativar Order Bump"
        />
      </div>

      {bump.enabled && (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
            <input
              className="input"
              placeholder="Nome do Order Bump"
              value={bump.name}
              onChange={(e) => set({ name: e.target.value })}
            />
            <input
              className="input"
              placeholder="Valor"
              inputMode="decimal"
              value={bump.priceCents ? (bump.priceCents / 100).toFixed(2) : ""}
              onChange={(e) =>
                set({ priceCents: Math.round(parseFloat(e.target.value.replace(",", ".")) * 100) || 0 })
              }
            />
          </div>
          {bump.priceCents > 0 && precoPlano > 0 && (
            <p className="mt-1 text-[11px] text-zinc-500">
              O cliente pagaria <b className="text-emerald-400">{money(total)}</b> ao aceitar
              ({money(precoPlano)} do plano + {money(bump.priceCents)} do bump).
            </p>
          )}

          <label className="eyebrow mt-3 block">Texto da oferta</label>
          <textarea
            ref={areaRef}
            className="input mt-1.5 min-h-[80px]"
            placeholder="Explique o que é a oferta e por que vale a pena…"
            value={bump.text}
            onChange={(e) => set({ text: e.target.value })}
          />
          <VarChips
            vars={[
              ["{selected_plan_name}", "nome do plano escolhido"],
              ["{order_bump_name}", "nome desta oferta"],
              ["{order_bump_value}", "valor desta oferta"],
              ["{total_value}", "plano + oferta, já somados"],
            ]}
            targetRef={areaRef}
            onChange={(v) => set({ text: v })}
          />

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="eyebrow block">Texto do botão aceitar</label>
              <input
                className="input mt-1.5"
                placeholder="Aceitar"
                value={bump.acceptText || ""}
                onChange={(e) => set({ acceptText: e.target.value })}
              />
            </div>
            <div>
              <label className="eyebrow block">Texto do botão recusar</label>
              <input
                className="input mt-1.5"
                placeholder="Recusar"
                value={bump.declineText || ""}
                onChange={(e) => set({ declineText: e.target.value })}
              />
            </div>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            Aparecem lado a lado, sem mostrar o preço. O aceitar ganha ✅ e o recusar ❌
            automaticamente — se você já puser um emoji no texto, ele é mantido como está. A cor sai
            de <b>Configurações → Bot de vendas</b>.
          </p>

          <label className="eyebrow mt-3 block">Mídia da oferta (opcional)</label>
          <div className="mt-1.5">
            <MediaPicker
              profileId={profileId}
              selected={bump.mediaIds || []}
              onChange={(ids) => set({ mediaIds: ids })}
              max={10}
            />
          </div>

          <label className="eyebrow mt-3 block">Áudio da oferta (URL pública .ogg)</label>
          <input
            className="input mt-1.5 font-mono text-xs"
            placeholder="https://… .ogg"
            value={bump.audioUrl || ""}
            onChange={(e) => set({ audioUrl: e.target.value })}
          />

          <label className="eyebrow mt-3 block">Entregável da oferta</label>
          <textarea
            className="input mt-1.5 min-h-[70px]"
            placeholder="O que o cliente recebe ao pagar com a oferta aceita."
            value={bump.deliverable || ""}
            onChange={(e) => set({ deliverable: e.target.value })}
          />
          <p className="mt-1 text-[11px] text-zinc-500">
            Enviado <b>depois</b> do acesso principal — o cliente veio pelo plano, o extra não pode
            chegar antes.
          </p>

          <label className="eyebrow mt-3 block">Botões do entregável da oferta</label>
          <div className="mt-1.5 space-y-1.5">
            {(bump.deliverableButtons || []).map((b, bi) => (
              <div key={bi} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  className="input text-xs"
                  placeholder="Texto do botão"
                  value={b.text}
                  onChange={(e) =>
                    set({
                      deliverableButtons: (bump.deliverableButtons || []).map((x, xi) =>
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
                    set({
                      deliverableButtons: (bump.deliverableButtons || []).map((x, xi) =>
                        xi === bi ? { ...x, url: e.target.value } : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    set({
                      deliverableButtons: (bump.deliverableButtons || []).filter((_, xi) => xi !== bi),
                    })
                  }
                  className="btn-ghost px-2.5"
                  aria-label="Remover botão"
                >
                  <IconClose size={13} />
                </button>
              </div>
            ))}
            {(bump.deliverableButtons || []).length < 6 && (
              <button
                type="button"
                onClick={() =>
                  set({ deliverableButtons: [...(bump.deliverableButtons || []), { text: "", url: "" }] })
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
}

/**
 * Uma das três sequências de recuperação, em bloco retrátil.
 *
 * Retrátil porque são três sequências de várias mensagens cada: abertas ao
 * mesmo tempo, a aba viraria uma rolagem em que não dá para ver o conjunto.
 * Fechado, o cabeçalho já diz o essencial — o gatilho, se está ligado e
 * quantas mensagens tem.
 */
function FunilRetratil({
  titulo,
  resumo,
  aviso,
  ativo,
  setAtivo,
  steps,
  setSteps,
  profileId,
  planos,
}: {
  titulo: string;
  resumo: string;
  aviso: string;
  ativo: boolean;
  setAtivo: (v: boolean) => void;
  steps: FunnelStep[];
  setSteps: (s: FunnelStep[]) => void;
  profileId: string;
  planos: Plan[];
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className={`card overflow-hidden ${aberto ? "border-emerald-500/25" : ""}`}>
      <div className="flex items-center gap-3 p-4">
        <button type="button" onClick={() => setAberto((v) => !v)} className="min-w-0 flex-1 text-left">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            {titulo}
            <span
              className={`chip border text-[10px] ${
                ativo
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-white/10 text-zinc-500"
              }`}
            >
              {ativo ? "ativo" : "desligado"}
            </span>
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {resumo} · {steps.length} mensagem(ns)
          </p>
        </button>
        <Switch checked={ativo} onChange={setAtivo} ariaLabel={`Ativar ${titulo}`} />
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
          aria-expanded={aberto}
        >
          {aberto ? "Fechar" : "Abrir"}
          {aberto ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </div>

      {aberto && (
        <div className="border-t border-white/10 p-4">
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-200/90">
            {aviso}
          </p>
          <div className="mt-1">
            <FunnelEditor title="" profileId={profileId} steps={steps} setSteps={setSteps} planos={planos} />
          </div>
        </div>
      )}
    </div>
  );
}
