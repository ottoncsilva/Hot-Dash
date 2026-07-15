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

const ICONS: Record<string, (p: { size?: number }) => JSX.Element> = {
  whatsapp: IconWhatsapp,
  whatsapp_settings: IconSettings,
  whatsapp_chat: IconWhatsapp,
  settings: IconSettings,
  dashboard: IconDashboard,
  profiles: IconProfiles,
  media: IconMedia,
  calendar: IconCalendar,
  payments: IconPayments,
  telegram: IconTelegram,
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

  export default function DashboardLayout({ children }: { children: React.ReactNode; }) {
  const { user, loading, signOut } = useAuth();
const router = useRouter();
  const pathname = usePathname();
  const [menu, setMenu] = useState<MenuEntry[]>(
    normalizeMenu(DEFAULT_MENU_ORDER.map((key) => ({ key, hidden: false })))
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


  return (
    <div className="flex min-h-dvh bg-ink-950 text-white">
      {/* Sidebar Desktop */}
      <aside className="hidden w-64 flex-col border-r border-white/[0.06] bg-ink-950 p-6 md:flex">
        <Brand />
        <nav className="mt-8 flex flex-col gap-1">
          {visible.map(({ key }) => {
            const item = NAV_ITEMS[key];
            const Icon = ICONS[key];
            const active = isActive(item.href);

            if (key === "settings") {
              return (
                <div key={key}>
                  <button
                    onClick={() => setSettingsOpen(!settingsOpen)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active ? "bg-white/5 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon size={18} />
                      {item.label}
                    </div>
                    {settingsOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  </button>
                  {settingsOpen && (
                    <div className="mt-1 flex flex-col border-l border-white/10 pl-4">
                      {SETTINGS_SUBSECTIONS.map((sub) => (
                        <Link
                          key={sub.anchor}
                          href={`/dashboard/settings#${sub.anchor}`}
                          className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white"
                        >
                          {sub.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={key}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-white/5 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto">
          <UserBox email={user?.email ?? null} onSignOut={signOut} />
        </div>
      </aside>

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
