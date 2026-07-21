"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useConfirm } from "@/hooks/useConfirm";
import Switch from "@/components/Switch";
import type { Profile } from "@/lib/types";
import { IconTelegram, IconClose, IconRefresh } from "@/components/icons";

// ---- Tipos (espelham telegramDb.ts) ----
type Bot = {
  id: string;
  botToken: string;
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
  operationActive: boolean;
};
type Plan = { id: string; name: string; priceCents: number; durationDays: number };
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
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [loading, setLoading] = useState(false);

  const [bot, setBot] = useState<Bot | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [buttons, setButtons] = useState<CustomButton[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => {
        setProfiles(d.profiles || []);
        if (d.profiles?.[0]) setProfileId(d.profiles[0].id);
      })
      .catch(() => {});
  }, []);

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
      }>(`/api/telegram?profileId=${profileId}`);
      setBot(d.bot);
      setPlans(d.plans || []);
      setButtons(d.customButtons || []);
      setSubs(d.subscriptions || []);
      setTags(d.availableTags || []);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-1 py-2">
      {ConfirmDialog}
      <div className="mb-5">
        <p className="eyebrow">telegram · vendas</p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
          <IconTelegram size={22} /> Bot de vendas
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Ofertas, funis, mensagens e assinantes do bot — o mesmo bot da automação de postagens.
        </p>
      </div>

      {/* Seletor de modelo */}
      <div className="card mb-5 p-4">
        <p className="eyebrow">Modelo</p>
        <select
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          className="input mt-2"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="grid place-items-center py-10">
          <div className="h-7 w-7 animate-spin rounded-full border border-white/15 border-t-white" />
        </div>
      )}

      {!loading && !bot && (
        <div className="card p-6 text-center text-sm text-zinc-400">
          Este modelo ainda não tem o bot configurado. Vá em{" "}
          <b>Telegram → Automação de postagens</b>, informe o <b>Token do Bot</b> e os{" "}
          <b>IDs dos grupos VIP e Prévias</b> e salve. Depois volte aqui para configurar as vendas.
        </div>
      )}

      {!loading && bot && (
        <div className="space-y-5">
          <WebhookCard profileId={profileId} bot={bot} onSaved={load} />
          <MessagesCard profileId={profileId} bot={bot} tags={tags} onSaved={load} />
          <PlansCard profileId={profileId} plans={plans} onSaved={load} />
          <FunnelCard profileId={profileId} bot={bot} tags={tags} onSaved={load} />
          <ButtonsCard profileId={profileId} buttons={buttons} onSaved={load} />
          <SubscribersCard subs={subs} onAction={load} confirm={confirm} />
        </div>
      )}
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

  const active = bot.operationActive;

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
      await checkStatus();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Operação do bot</h2>

      {/* Liga/desliga da operação (cutover ApexVips → Hot-Dash) */}
      <div
        className={`mt-3 flex items-center justify-between gap-3 rounded-xl border p-3.5 ${
          active ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-white/10 bg-ink-900"
        }`}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {active ? "Ligada — o Hot-Dash controla o bot" : "Desligada — o ApexVips controla o bot"}
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
      <p className="mt-2 text-xs text-zinc-500">
        Token e IDs dos grupos VIP/Prévias vêm de <b>Automação de postagens</b>. A postagem
        automática funciona independentemente deste liga/desliga.
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
    <div className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2">
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 truncate font-mono text-xs text-zinc-200">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------
function MessagesCard({
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
  const [welcome, setWelcome] = useState(bot.welcomeMessage || "");
  const [welcomeTags, setWelcomeTags] = useState(bot.welcomeMediaTags || "");
  const [success, setSuccess] = useState(bot.successMessage || "");
  const [support, setSupport] = useState(bot.supportUsername || "");
  const [registro, setRegistro] = useState(bot.idRegistro || "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-bot-messages",
        profileId,
        welcomeMessage: welcome,
        welcomeMediaTags: welcomeTags,
        successMessage: success,
        supportUsername: support,
        idRegistro: registro,
      });
      showToast("Mensagens salvas.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Mensagens</h2>
      <label className="eyebrow mt-3 block">Boas-vindas (no /start) · use {"{nome}"}</label>
      <textarea className="input mt-1.5 min-h-[90px]" value={welcome} onChange={(e) => setWelcome(e.target.value)} />
      <label className="eyebrow mt-3 block">Etiquetas da mídia de boas-vindas (opcional)</label>
      <input
        className="input mt-1.5"
        placeholder="ex.: previa, quente"
        value={welcomeTags}
        onChange={(e) => setWelcomeTags(e.target.value)}
      />
      {tags.length > 0 && (
        <p className="mt-1 text-[11px] text-zinc-500">
          Disponíveis: {tags.map((t) => t.name).join(", ")}
        </p>
      )}
      <label className="eyebrow mt-3 block">Mensagem de sucesso (após pagar) · use {"{link_vip}"}</label>
      <textarea className="input mt-1.5 min-h-[80px]" value={success} onChange={(e) => setSuccess(e.target.value)} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="eyebrow block">Suporte (@usuário ou link)</label>
          <input className="input mt-1.5" value={support} onChange={(e) => setSupport(e.target.value)} />
        </div>
        <div>
          <label className="eyebrow block">Canal de registro/vendas (ID)</label>
          <input className="input mt-1.5 font-mono" value={registro} onChange={(e) => setRegistro(e.target.value)} />
        </div>
      </div>
      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar mensagens"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Planos / Ofertas
// ---------------------------------------------------------------------------
function PlansCard({ profileId, plans, onSaved }: { profileId: string; plans: Plan[]; onSaved: () => void }) {
  type Row = { id?: string; name: string; price: string; durationDays: string };
  const [rows, setRows] = useState<Row[]>(
    plans.map((p) => ({ id: p.id, name: p.name, price: (p.priceCents / 100).toFixed(2), durationDays: String(p.durationDays) })),
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
      <p className="mt-1 text-xs text-zinc-500">Os botões que o bot mostra no /start e nos funis.</p>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-900 p-2">
            <input
              className="input min-w-[120px] flex-1"
              placeholder="Nome do plano"
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
            <div className="flex items-center gap-1">
              <input
                className="input w-16"
                value={r.durationDays}
                onChange={(e) => update(i, { durationDays: e.target.value })}
              />
              <span className="text-xs text-zinc-500">dias</span>
            </div>
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
        <button
          onClick={() => setRows((r) => [...r, { name: "", price: "", durationDays: "30" }])}
          className="btn-ghost"
        >
          + Adicionar plano
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
          <div key={i} className="rounded-lg border border-white/10 bg-ink-900 p-2.5">
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
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-900 p-2">
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
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-900 p-2.5">
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
