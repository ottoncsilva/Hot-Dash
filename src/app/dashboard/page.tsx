"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Profile } from "@/lib/types";
import {
  IconProfiles,
  IconMedia,
  IconPayments,
  IconSettings,
  IconSparkle,
  IconChevronRight,
} from "@/components/icons";

export default function DashboardHome() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => setProfiles(d.profiles))
      .catch(() => setProfiles([]));
  }, []);

  const profileCount = profiles?.length ?? null;
  const accountCount =
    profiles?.reduce((n, p) => n + p.accounts.length, 0) ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="eyebrow">visão geral</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
        Dashboard
      </h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-500">
        Central de operações das suas personagens. Métricas e módulos em um só
        lugar.
      </p>

      {/* Métricas */}
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Perfis" value={profileCount} />
        <Stat label="Contas" value={accountCount} />
        <Stat label="Mídias" value={0} muted />
        <Stat label="Receita (mês)" value="—" muted />
      </div>

      {/* Módulos */}
      <p className="eyebrow mt-10">módulos</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ModuleLink
          href="/dashboard/profiles"
          icon={<IconProfiles size={22} />}
          title="Perfis"
          desc="Personagens, redes sociais e credenciais."
        />
        <ModuleLink
          href="/dashboard/media"
          icon={<IconMedia size={22} />}
          title="Mídia"
          desc="Fotos e vídeos vinculados ao perfil, sem metadados."
        />
        <ModuleLink
          href="/dashboard/payments"
          icon={<IconPayments size={22} />}
          title="Pagamentos"
          desc="Vendas e receita — SyncPay e Stripe."
        />
        <ModuleLink
          href="/dashboard/metadata"
          icon={<IconSparkle size={22} />}
          title="Limpar Metadados"
          desc="Remova EXIF, GPS e rastros de IA avulsos."
        />
        <ModuleLink
          href="/dashboard/settings"
          icon={<IconSettings size={22} />}
          title="Configurações"
          desc="Menu, pagamentos e preferências."
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: number | string | null;
  muted?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-2 font-display text-2xl font-semibold ${
          muted ? "text-zinc-600" : "text-white"
        }`}
      >
        {value === null ? (
          <span className="inline-block h-6 w-10 animate-pulse rounded bg-white/5" />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

function ModuleLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="card group flex items-center gap-4 p-4 transition-all hover:border-white/20 hover:bg-white/[0.04]"
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300 transition-colors group-hover:text-white">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-white">{title}</p>
        <p className="truncate text-xs text-zinc-500">{desc}</p>
      </div>
      <span className="text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-300">
        <IconChevronRight size={18} />
      </span>
    </Link>
  );
}
