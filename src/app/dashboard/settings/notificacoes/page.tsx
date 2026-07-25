"use client";

import PushToggle from "@/components/PushToggle";
import { BackToSettings } from "../_shared";

export default function NotificationsSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <BackToSettings />
      <p className="eyebrow mt-4">notificações</p>
      <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
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
        <p className="eyebrow mb-2">O que dispara alerta hoje</p>
        <ul className="space-y-1.5 text-xs text-zinc-400">
          <li>
            <b className="text-emerald-300">Venda aprovada</b> — assim que o SyncPay confirma o
            pagamento, com o valor e o produto. Vale também para checkout externo.
          </li>
          <li>
            <b className="text-zinc-200">Lembrete de post</b> — 15 minutos antes de um post
            agendado do cronograma.
          </li>
        </ul>
        <p className="mt-3 text-[11px] text-zinc-500">
          O alerta exige que o webhook do SyncPay esteja apontado para o seu domínio em
          Configurações → Pagamentos.
        </p>
      </div>
    </div>
  );
}
