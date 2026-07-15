"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_MENU_ORDER,
  NAV_ITEMS,
  normalizeMenu,
  type MenuEntry,
  type NavKey,
} from "@/lib/navItems";
import {
  IconDashboard,
  IconProfiles,
  IconMedia,
  IconCalendar,
  IconPayments,
  IconTelegram,
  IconSettings,
  IconLogout,
  IconChevronDown,
  IconChevronUp,
  IconWhatsapp,
} from "@/components/icons";

const ICONS: Record<NavKey, (p: { size?: number }) => JSX.Element> = {
  dashboard: IconDashboard,
  profiles: IconProfiles,
  media: IconMedia,
  schedule: IconCalendar,
  payments: IconPayments,
  telegram_bot: IconTelegram,
  telegram_autopost: IconTelegram,
  whatsapp: IconWhatsapp,
  settings: IconSettings,
};

// Submenu de Configurações — abre dentro da própria sidebar (desktop).
const SETTINGS_SUBSECTIONS: { label: string; anchor: string }[] = [
  { label: "Menu", anchor: "menu" },
  { label: "Etiquetas", anchor: "etiquetas" },
  { label: "Status de modelos", anchor: "status" },
  { label: "Pagamentos", anchor: "pagamentos" },
  { label: "Conexão com IA", anchor: "ia" },
  { label: "WhatsApp (Evolution)", anchor: "whatsapp" },
  { label: "Segurança", anchor: "seguranca" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menu, setMenu] = useState<MenuEntry[]>(
    normalizeMenu(DEFAULT_MENU_ORDER.map((key) => ({ key, hidden: false }))),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (pathname?.startsWith("/dashboard/settings")) setSettingsOpen(true);
  }, [pathname]);

  useEffect(() => {
    fetch("/api/settings/menu")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.menu && setMenu(normalizeMenu(d.menu)))
      .catch(() => {});
  }, []);

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");

  const visible = menu.filter((m) => !m.hidden);

  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border border-white/20 border-t-white" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/40 p-4 md:flex md:h-dvh">
        <Brand />
        <nav className="mt-8 flex flex-1 flex-col gap-0.5">
          {visible.map(({ key }) => {
            const item = NAV_ITEMS[key];
            const Icon = ICONS[key];
            const active = isActive(item.href);

            if (key === "settings") {
              return (
                <div key={key}>
                  <div
                    className={`group flex items-center gap-3 rounded-lg pl-3 pr-1 text-sm transition-all ${
                      active
                        ? "bg-white/[0.06] text-white"
                        : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-200"
                    }`}
                  >
                    <Link href={item.href} className="flex flex-1 items-center gap-3 py-2.5">
                      <Icon size={18} />
                      <span className="font-medium">{item.label}</span>
                    </Link>
                    <button
                      onClick={() => setSettingsOpen((v) => !v)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/[0.06]"
                      aria-label={settingsOpen ? "Recolher" : "Expandir"}
                    >
                      {settingsOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                    </button>
                  </div>
                  {settingsOpen && (
                    <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-white/[0.06] pl-4">
                      {SETTINGS_SUBSECTIONS.map((s) => {
                        const href = `${item.href}/${s.anchor}`;
                        const subActive = pathname === href;
                        return (
                          <Link
                            key={s.anchor}
                            href={href}
                            className={`rounded-lg px-2 py-2 text-xs transition-all ${
                              subActive
                                ? "bg-white/[0.06] text-white"
                                : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-200"
                            }`}
                          >
                            {s.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={key}
                href={item.href}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                  active
                    ? "bg-white/[0.06] text-white"
                    : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-200"
                }`}
              >
                <Icon size={18} />
                <span className="font-medium">{item.label}</span>
                {active && (
                  <span className="ml-auto h-1 w-1 rounded-full bg-white" />
                )}
              </Link>
            );
          })}
        </nav>
        <UserBox email={user.email} onSignOut={signOut} />
      </aside>

      {/* Topbar (mobile) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.06] bg-ink-950/80 px-4 py-3 backdrop-blur-xl safe-top md:hidden">
        <Brand compact />
        <button
          onClick={signOut}
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-zinc-400"
          aria-label="Sair"
        >
          <IconLogout size={18} />
        </button>
      </header>

      {/* Conteúdo */}
      <main className="flex-1 px-4 pb-24 pt-6 md:h-dvh md:overflow-y-auto md:px-10 md:py-10">
        <div className="animate-fade-in">{children}</div>
      </main>

      {/* Nav inferior (mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-flow-col border-t border-white/[0.06] bg-ink-950/90 backdrop-blur-xl safe-bottom md:hidden">
        {visible.map(({ key }) => {
          const item = NAV_ITEMS[key];
          const Icon = ICONS[key];
          const active = isActive(item.href);
          return (
            <Link
              key={key}
              href={item.href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                active ? "text-white" : "text-zinc-600"
              }`}
            >
              <Icon size={20} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="Hot Dash"
        className={`rounded-lg border border-white/10 ${
          compact ? "h-9 w-9" : "h-10 w-10"
        }`}
      />
      {!compact && <p className="eyebrow">control panel</p>}
    </div>
  );
}

function UserBox({
  email,
  onSignOut,
}: {
  email: string | null;
  onSignOut: () => void;
}) {
  return (
    <div className="mt-4 border-t border-white/[0.06] pt-3">
      <p className="truncate px-1 font-mono text-[11px] text-zinc-600">
        {email}
      </p>
      <button
        onClick={onSignOut}
        className="mt-2 flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-400 transition-all hover:bg-white/5 hover:text-zinc-200"
      >
        <IconLogout size={16} />
        Sair
      </button>
    </div>
  );
}
