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
  IconBot,
  IconSend,
  IconMenu,
  IconX,
  IconBlur,
} from "@/components/icons";

const ICONS: Record<NavKey, (p: { size?: number }) => JSX.Element> = {
  dashboard: IconDashboard,
  profiles: IconProfiles,
  media: IconMedia,
  censura: IconBlur,
  payments: IconPayments,
  telegram: IconTelegram,
  whatsapp: IconWhatsapp,
  whatsapp_settings: IconSettings,
  whatsapp_chat: IconWhatsapp,
  schedule: IconCalendar,
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

const WHATSAPP_SUBSECTIONS: { label: string; href: string }[] = [
  { label: "Configurações", href: "/dashboard/whatsapp" },
  { label: "Chat ao vivo", href: "/dashboard/whatsapp/chat" },
];



export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menu, setMenu] = useState<MenuEntry[]>(
    normalizeMenu(DEFAULT_MENU_ORDER.map((key) => ({ key, hidden: false })))
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (pathname?.startsWith("/dashboard/settings")) setSettingsOpen(true);
    if (pathname?.startsWith("/dashboard/whatsapp")) setWhatsappOpen(true);
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

  // Tab bar inferior (mobile): os 4 primeiros destinos simples (sem submenu) +
  // "Mais", que abre o menu completo. Respeita a ordem/visibilidade do menu.
  const TAB_EXCLUDE: NavKey[] = ["settings", "whatsapp", "whatsapp_settings", "whatsapp_chat"];
  const tabItems = visible.filter((m) => !TAB_EXCLUDE.includes(m.key)).slice(0, 4);


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



            if (key === "whatsapp") {
              const isWhatsappActive = pathname?.startsWith("/dashboard/whatsapp");
              return (
                <div key={key}>
                  <button
                    onClick={() => setWhatsappOpen(!whatsappOpen)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isWhatsappActive ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon size={18} />
                      {item.label}
                    </div>
                    {whatsappOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  </button>
                  {whatsappOpen && (
                    <div className="mt-1 flex flex-col border-l border-white/10 pl-4">
                      {WHATSAPP_SUBSECTIONS.map((sub) => (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className={`px-3 py-1.5 text-xs transition-colors ${
                            pathname === sub.href
                              ? "text-white"
                              : "text-zinc-500 hover:text-white"
                          }`}
                        >
                          {sub.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            if (key === "settings") {
              return (
                <div key={key}>
                  <button
                    onClick={() => setSettingsOpen(!settingsOpen)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
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
                          href={`/dashboard/settings/${sub.anchor}`}
                          className={`px-3 py-1.5 text-xs transition-colors ${
                            pathname === `/dashboard/settings/${sub.anchor}`
                              ? "text-white"
                              : "text-zinc-500 hover:text-white"
                          }`}
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
                  active ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
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

      {/* Tab bar inferior (Mobile) — substitui o antigo botão flutuante, que
          colidia com as ações no topo das páginas. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-ink-950/90 backdrop-blur-md safe-bottom md:hidden">
        {tabItems.map(({ key }) => {
          const item = NAV_ITEMS[key];
          const Icon = ICONS[key];
          const active = isActive(item.href);
          return (
            <Link
              key={key}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Icon size={20} />
              <span className="max-w-full truncate px-1">{item.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
          aria-label="Abrir menu completo"
        >
          <IconMenu size={20} />
          <span>Mais</span>
        </button>
      </nav>

      {/* Drawer Mobile Overlay (Menu Hambúrguer) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink-950 p-6 md:hidden overflow-y-auto">
          <div className="flex items-center justify-between">
            <Brand />
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white"
              aria-label="Fechar menu"
            >
              <IconX size={20} />
            </button>
          </div>
          
          <nav className="mt-8 flex-1 flex flex-col gap-1.5">
            {visible.map(({ key }) => {
              const item = NAV_ITEMS[key];
              const Icon = ICONS[key];
              const active = isActive(item.href);

              const handleLinkClick = () => {
                setMobileMenuOpen(false);
              };



              if (key === "whatsapp") {
                const isWhatsappActive = pathname?.startsWith("/dashboard/whatsapp");
                return (
                  <div key={key}>
                    <button
                      onClick={() => setWhatsappOpen(!whatsappOpen)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        isWhatsappActive ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={18} />
                        {item.label}
                      </div>
                      {whatsappOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                    </button>
                    {whatsappOpen && (
                      <div className="mt-1 flex flex-col border-l border-white/10 pl-4">
                        {WHATSAPP_SUBSECTIONS.map((sub) => (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            onClick={handleLinkClick}
                            className={`px-3 py-2 text-xs transition-colors ${
                              pathname === sub.href
                                ? "text-white"
                                : "text-zinc-500 hover:text-white"
                            }`}
                          >
                            {sub.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              if (key === "settings") {
                return (
                  <div key={key}>
                    <button
                      onClick={() => setSettingsOpen(!settingsOpen)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        active ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
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
                            href={`/dashboard/settings/${sub.anchor}`}
                            onClick={handleLinkClick}
                            className={`px-3 py-2 text-xs transition-colors ${
                              pathname === `/dashboard/settings/${sub.anchor}`
                                ? "text-white"
                                : "text-zinc-500 hover:text-white"
                            }`}
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
                  onClick={handleLinkClick}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          
          <div className="mt-auto">
            <UserBox email={user?.email ?? null} onSignOut={() => { setMobileMenuOpen(false); signOut(); }} />
          </div>
        </div>
      )}

      {/* Conteúdo */}
      <main className="flex-1 px-4 pb-24 pt-6 md:h-dvh md:overflow-y-auto md:px-10 md:py-10">
        <div className="animate-fade-in">{children}</div>
      </main>
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
