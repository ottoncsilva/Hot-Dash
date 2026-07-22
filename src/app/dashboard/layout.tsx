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
  IconSearch,
} from "@/components/icons";
import CommandPalette from "@/components/CommandPalette";
import PullToRefresh from "@/components/PullToRefresh";

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

const TELEGRAM_SUBSECTIONS: { label: string; href: string }[] = [
  { label: "Automação de postagens", href: "/dashboard/telegram" },
  { label: "Bot de vendas", href: "/dashboard/telegram/bot" },
];

const MEDIA_SUBSECTIONS: { label: string; href: string }[] = [
  { label: "Galeria", href: "/dashboard/media" },
  { label: "Censura com IA", href: "/dashboard/censura" },
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
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (pathname?.startsWith("/dashboard/settings")) setSettingsOpen(true);
    if (pathname?.startsWith("/dashboard/whatsapp")) setWhatsappOpen(true);
    if (pathname?.startsWith("/dashboard/telegram")) setTelegramOpen(true);
    if (pathname?.startsWith("/dashboard/media") || pathname?.startsWith("/dashboard/censura")) setMediaOpen(true);
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
        <button
          onClick={() => window.dispatchEvent(new Event("hotdash:command"))}
          className="mt-6 flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
        >
          <IconSearch size={16} /> Buscar
          <span className="ml-auto font-mono text-[10px] tracking-wider text-zinc-600">⌘K</span>
        </button>
        <nav className="mt-4 flex flex-col gap-1">
          {visible.map(({ key }) => {
            const item = NAV_ITEMS[key];
            const Icon = ICONS[key];
            const active = isActive(item.href);



            if (key === "media") {
              const isMediaActive = pathname?.startsWith("/dashboard/media") || pathname?.startsWith("/dashboard/censura");
              return (
                <div key={key}>
                  <button
                    onClick={() => setMediaOpen(!mediaOpen)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isMediaActive ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon size={18} />
                      {item.label}
                    </div>
                    {mediaOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  </button>
                  {mediaOpen && (
                    <div className="mt-1 flex flex-col border-l border-white/10 pl-4">
                      {MEDIA_SUBSECTIONS.map((sub) => (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className={`px-3 py-1.5 text-xs transition-colors ${
                            pathname === sub.href ? "text-white" : "text-zinc-500 hover:text-white"
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

            if (key === "telegram") {
              const isTelegramActive = pathname?.startsWith("/dashboard/telegram");
              return (
                <div key={key}>
                  <button
                    onClick={() => setTelegramOpen(!telegramOpen)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isTelegramActive ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon size={18} />
                      {item.label}
                    </div>
                    {telegramOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  </button>
                  {telegramOpen && (
                    <div className="mt-1 flex flex-col border-l border-white/10 pl-4">
                      {TELEGRAM_SUBSECTIONS.map((sub) => (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className={`px-3 py-1.5 text-xs transition-colors ${
                            pathname === sub.href ? "text-white" : "text-zinc-500 hover:text-white"
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

      {/* Barra superior (Mobile) — hambúrguer no canto superior esquerdo +
          A marca (logo) fica DENTRO do menu, não numa barra fixa. */}
      <button
        onClick={() => setMobileMenuOpen(true)}
        style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
        className="fixed left-3 z-40 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-ink-950/70 text-zinc-100 shadow-lg backdrop-blur-md transition-colors hover:bg-ink-900 md:hidden"
        aria-label="Abrir menu"
      >
        <IconMenu size={22} />
      </button>

      {/* Drawer Mobile Overlay (Menu Hambúrguer) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink-950 px-6 pb-6 pt-[calc(1.5rem+env(safe-area-inset-top))] md:hidden overflow-y-auto">
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



              if (key === "media") {
                const isMediaActive = pathname?.startsWith("/dashboard/media") || pathname?.startsWith("/dashboard/censura");
                return (
                  <div key={key}>
                    <button
                      onClick={() => setMediaOpen(!mediaOpen)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        isMediaActive ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={18} />
                        {item.label}
                      </div>
                      {mediaOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                    </button>
                    {mediaOpen && (
                      <div className="mt-1 flex flex-col border-l border-white/10 pl-4">
                        {MEDIA_SUBSECTIONS.map((sub) => (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            onClick={handleLinkClick}
                            className={`px-3 py-2 text-xs transition-colors ${
                              pathname === sub.href ? "text-white" : "text-zinc-500 hover:text-white"
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

              if (key === "telegram") {
                const isTelegramActive = pathname?.startsWith("/dashboard/telegram");
                return (
                  <div key={key}>
                    <button
                      onClick={() => setTelegramOpen(!telegramOpen)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        isTelegramActive ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={18} />
                        {item.label}
                      </div>
                      {telegramOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                    </button>
                    {telegramOpen && (
                      <div className="mt-1 flex flex-col border-l border-white/10 pl-4">
                        {TELEGRAM_SUBSECTIONS.map((sub) => (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            onClick={handleLinkClick}
                            className={`px-3 py-2 text-xs transition-colors ${
                              pathname === sub.href ? "text-white" : "text-zinc-500 hover:text-white"
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

      {/* Conteúdo. No mobile, o padding-top livra a barra superior fixa + o
          recorte da câmera; no desktop, md:py-10 assume. */}
      <main className="flex-1 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(3.5rem+env(safe-area-inset-top))] md:h-dvh md:overflow-y-auto md:px-10 md:py-10 md:pt-10">
        <PullToRefresh>
          <div className="animate-fade-in">{children}</div>
        </PullToRefresh>
      </main>

      <CommandPalette />
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
