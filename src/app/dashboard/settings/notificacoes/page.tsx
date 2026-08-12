"use client";

import { useEffect, useState } from "react";
import PushToggle from "@/components/PushToggle";
import Switch from "@/components/Switch";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import {
  PUSH_EVENTS,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type PushEventType,
} from "@/lib/notificationTypes";
import { BackToSettings } from "../_shared";

/** Liga/desliga cada TIPO de alerta. Salva na hora (sem botão de salvar). */
function AlertTypes() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<PushEventType | null>(null);

  useEffect(() => {
    apiGet<{ prefs: NotificationPrefs }>("/api/settings/notifications")
      .then((d) => setPrefs(d.prefs))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function toggle(id: PushEventType, value: boolean) {
    const prev = prefs;
    setPrefs({ ...prefs, [id]: value }); // otimista: o interruptor responde na hora
    setSaving(id);
    try {
      const d = await apiSend<{ prefs: NotificationPrefs }>(
        "/api/settings/notifications",
        "PATCH",
        { [id]: value },
      );
      setPrefs(d.prefs);
    } catch {
      setPrefs(prev); // desfaz se o servidor recusou
      showToast("Não foi possível salvar. Tente de novo.", "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="divide-y divide-white/[0.06]">
      {PUSH_EVENTS.map((e) => (
        <div key={e.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100">{e.label}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{e.description}</p>
          </div>
          <div className="shrink-0 pt-0.5">
            <Switch
              checked={prefs[e.id]}
              onChange={(v) => toggle(e.id, v)}
              disabled={!loaded || saving === e.id}
              ariaLabel={e.label}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NotificationsSettingsPage() {
  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
        Alertas no celular
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        O Hot Dash é um app instalável (PWA): dá para colocar na tela do celular e receber
        notificação a cada <b>venda aprovada</b>, mesmo com o app fechado. Não precisa baixar
        nada da App Store nem da Play Store.
      </p>

      <div className="mt-4 card p-4">
        <p className="eyebrow mb-3">Este aparelho</p>
        <PushToggle />
        <p className="mt-3 text-[11px] text-zinc-500">
          A ativação é <b>por aparelho</b>. Se quiser receber no celular e no computador,
          repita em cada um. Use “Enviar teste” para confirmar que chega.
        </p>
      </div>

      <div className="mt-4 card p-4">
        <p className="eyebrow mb-2">Como instalar no celular</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold text-zinc-200">iPhone / iPad</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-zinc-400">
              <li>Abra o Hot Dash no <b>Safari</b>.</li>
              <li>Toque em <b>Compartilhar</b> (o quadradinho com a seta).</li>
              <li>Escolha <b>Adicionar à Tela de Início</b>.</li>
              <li>Abra o app por esse ícone e ative os alertas aqui.</li>
            </ol>
            <p className="mt-1.5 text-[11px] text-amber-400/80">
              No iPhone a Apple só permite notificação com o app na tela de início (iOS 16.4+).
            </p>
          </div>
          <div>
            <p className="text-xs font-bold text-zinc-200">Android</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-zinc-400">
              <li>Abra o Hot Dash no <b>Chrome</b>.</li>
              <li>Toque no menu <b>⋮</b> → <b>Instalar app</b>.</li>
              <li>Abra pelo ícone e ative os alertas aqui.</li>
            </ol>
            <p className="mt-1.5 text-[11px] text-zinc-500">
              No Android também funciona direto no navegador, sem instalar.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 card p-4">
        <p className="eyebrow mb-1">Tipos de alerta</p>
        <p className="mb-3 text-xs text-zinc-500">
          Escolha o que quer receber. Vale para <b>todos</b> os aparelhos ativados e é salvo
          na hora.
        </p>
        <AlertTypes />
        <p className="mt-3 text-[11px] text-zinc-500">
          Vendas e Pix dependem do webhook do SyncPay apontado para o seu domínio em
          Configurações → Pagamentos.
        </p>
      </div>
    </div>
  );
}
