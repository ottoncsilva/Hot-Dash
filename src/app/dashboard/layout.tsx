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
  IconWhatsapp,
  IconBot,
  IconSend,
  IconMenu,
  IconX,
  IconBlur,
  IconFilm,
  IconQuestion,
  IconSparkle,
  IconPlay,
  IconSearch,
  IconFunnel,
  IconFire,
} from "@/components/icons";
import NavGroup, { type NavSubItem } from "@/components/NavGroup";
import CommandPalette from "@/components/CommandPalette";
import PullToRefresh from "@/components/PullToRefresh";
import MobileDrawer from "@/components/MobileDrawer";
import { ProfileProvider } from "@/context/ProfileContext";
import ProfilePicker from "@/components/ProfilePicker";
import { carregarLimiteUpload } from "@/lib/uploadLimit";

const ICONS: Record<NavKey, (p: { size?: number }) => JSX.Element> = {
  dashboard: IconDashboard,
  profiles: IconProfiles,
  media: IconMedia,
  censura: IconBlur,
  firstframe: IconFilm,
  caixinha: IconQuestion,
  imagegen: IconSparkle,
  videogen: IconPlay,
  motion: IconFilm,
  payments: IconPayments,
  funil: IconFunnel,
  telegram: IconTelegram,
  geracao: IconSparkle,
  ltv: IconFire,
  ltv_chat: IconBot,
  ltv_whatsapp: IconWhatsapp,
  ltv_telegram: IconSend,
  ltv_funil: IconFunnel,
  schedule: IconCalendar,
  settings: IconSettings,
};

// Submenu de Configurações — abre dentro da própria sidebar (desktop).
const SETTINGS_SUBSECTIONS: { label: string; anchor: string }[] = [
  { label: "Geral (fuso, grupos)", anchor: "geral" },
  { label: "Notificações", anchor: "notificacoes" },
  { label: "Menu", anchor: "menu" },
  { label: "Etiquetas", anchor: "etiquetas" },
  { label: "Status de modelos", anchor: "status" },
  { label: "Pagamentos", anchor: "pagamentos" },
  { label: "Conexão com IA", anchor: "ia" },
  { label: "Conexões do LTV", anchor: "whatsapp" },
  { label: "Segurança", anchor: "seguranca" },
];

// O LTV junta os dois canais: a conversa ao vivo (que serve WhatsApp e
// Telegram) e a configuração de cada um. O menu "Telegram" ao lado continua
// sendo outra coisa — o grupo VIP, que roda por bot.
// Só agrupa: cada tela continua no caminho de sempre, nada foi movido.
const GERACAO_SUBSECTIONS: NavSubItem[] = [
  { label: "Censura com IA", href: "/dashboard/censura" },
  { label: "First Frame", href: "/dashboard/first-frame" },
  { label: "Caixinha de perguntas", href: "/dashboard/caixinha" },
  { label: "Gerador de Imagem", href: "/dashboard/gerador-imagem" },
  { label: "Gerador de Vídeo", href: "/dashboard/gerador-video" },
  { label: "Motion Control", href: "/dashboard/motion-control" },
];

const LTV_SUBSECTIONS: NavSubItem[] = [
  { label: "Chat ao vivo", href: "/dashboard/ltv/chat" },
  { label: "LTV WhatsApp", href: "/dashboard/ltv/whatsapp" },
  { label: "LTV Telegram", href: "/dashboard/ltv/telegram" },
  { label: "Funil de LTV", href: "/dashboard/ltv/funil" },
];

const TELEGRAM_SUBSECTIONS: NavSubItem[] = [
  { label: "Automação de postagens", href: "/dashboard/telegram" },
  { label: "Bot de vendas", href: "/dashboard/telegram/bot" },
  { label: "Mailing", href: "/dashboard/telegram/mailing" },
  { label: "Usuários", href: "/dashboard/telegram/usuarios" },
];

/**
 * O ProfileProvider envolve o layout inteiro — inclusive a sidebar, que é onde
 * o seletor de modelo vive. Fica aqui e não no layout raiz porque /login e a
 * home não precisam da lista de perfis.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProfileProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </ProfileProvider>
  );
}

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menu, setMenu] = useState<MenuEntry[]>(
    normalizeMenu(DEFAULT_MENU_ORDER.map((key) => ({ key, hidden: false })))
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geracaoOpen, setGeracaoOpen] = useState(false);
  const [ltvOpen, setLtvOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // O limite de upload vive no banco (Configurações → Geral). Buscado UMA vez,
  // aqui, porque toda tela de envio precisa dele para recusar um arquivo antes
  // de começar a subi-lo.
  useEffect(() => {
    carregarLimiteUpload();
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // Fecha o menu ao trocar de tela (inclusive no voltar do navegador), senão
  // ele fica aberto por cima do conteúdo novo.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (pathname?.startsWith("/dashboard/settings")) setSettingsOpen(true);
    if (GERACAO_SUBSECTIONS.some((s) => pathname === s.href)) setGeracaoOpen(true);
    if (pathname?.startsWith("/dashboard/ltv")) setLtvOpen(true);
    if (pathname?.startsWith("/dashboard/telegram")) setTelegramOpen(true);
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

  // A sidebar do desktop e o menu do celular mostram a MESMA lista; o que muda
  // é o espaçamento e o fechar o menu ao navegar. Antes era o mesmo JSX escrito
  // duas vezes, e cada grupo com submenu dobrava de novo.
  const renderNav = (compact: boolean, onNavigate?: () => void) =>
    visible.map(({ key }) => {
      const item = NAV_ITEMS[key];
      const Icon = ICONS[key];
      const icon = <Icon size={18} />;

      if (key === "geracao") {
        return (
          <NavGroup
            key={key}
            label={item.label}
            icon={icon}
            items={GERACAO_SUBSECTIONS}
            open={geracaoOpen}
            onToggle={() => setGeracaoOpen(!geracaoOpen)}
            active={GERACAO_SUBSECTIONS.some((s) => pathname === s.href)}
            pathname={pathname}
            compact={compact}
            onNavigate={onNavigate}
          />
        );
      }

      if (key === "ltv") {
        return (
          <NavGroup
            key={key}
            label={item.label}
            icon={icon}
            items={LTV_SUBSECTIONS}
            open={ltvOpen}
            onToggle={() => setLtvOpen(!ltvOpen)}
            active={pathname?.startsWith("/dashboard/ltv") ?? false}
            pathname={pathname}
            compact={compact}
            onNavigate={onNavigate}
          />
        );
      }

      if (key === "telegram") {
        return (
          <NavGroup
            key={key}
            label={item.label}
            icon={icon}
            items={TELEGRAM_SUBSECTIONS}
            open={telegramOpen}
            onToggle={() => setTelegramOpen(!telegramOpen)}
            active={pathname?.startsWith("/dashboard/telegram") ?? false}
            pathname={pathname}
            compact={compact}
            onNavigate={onNavigate}
          />
        );
      }

      if (key === "settings") {
        return (
          <NavGroup
            key={key}
            label={item.label}
            icon={icon}
            items={SETTINGS_SUBSECTIONS.map((sub) => ({
              label: sub.label,
              href: `/dashboard/settings/${sub.anchor}`,
            }))}
            open={settingsOpen}
            onToggle={() => setSettingsOpen(!settingsOpen)}
            active={isActive(item.href)}
            pathname={pathname}
            compact={compact}
            onNavigate={onNavigate}
          />
        );
      }

      return (
        <Link
          key={key}
          href={item.href}
          onClick={onNavigate}
          className={`flex items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
            compact ? "py-2" : "py-2.5"
          } ${
            isActive(item.href)
              ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          }`}
        >
          {icon}
          {item.label}
        </Link>
      );
    });

  return (
    <div className="flex min-h-dvh bg-ink-950 text-white">
      {/* Sidebar Desktop */}
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-white/[0.06] bg-ink-950 p-6 lg:flex lg:h-dvh">
        <Brand />
        <button
          onClick={() => window.dispatchEvent(new Event("hotdash:command"))}
          className="mt-6 flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
        >
          <IconSearch size={16} /> Buscar
          <span className="ml-auto font-mono text-[10px] tracking-wider text-zinc-600">⌘K</span>
        </button>
        {/* Modelo selecionada — vale para o painel inteiro, não só para a tela
            aberta. Fica aqui, junto do Buscar, porque acompanha a navegação. */}
        <ProfilePicker id="modelo-desktop" />
        <nav className="mt-4 flex flex-col gap-1">
          {renderNav(true)}
        </nav>
        <div className="mt-auto">
          <UserBox email={user?.email ?? null} onSignOut={signOut} />
        </div>
      </aside>

      {/* Barra superior (Mobile) — hambúrguer no canto superior esquerdo +
          A marca (logo) fica DENTRO do menu, não numa barra fixa.
          `print:hidden` porque ao imprimir o navegador usa a largura do PAPEL
          (~794px numa A4), abaixo do `lg`: quem vai para o papel é o layout de
          celular, e o hambúrguer saía carimbado por cima do título. */}
      <button
        onClick={() => setMobileMenuOpen(true)}
        style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
        className="fixed left-3 z-40 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-ink-950/70 text-zinc-100 shadow-lg backdrop-blur-md transition-colors hover:bg-ink-850 lg:hidden print:hidden"
        aria-label="Abrir menu"
      >
        <IconMenu size={22} />
      </button>

      {/* Menu lateral TEMPORÁRIO (mobile e celular deitado): desliza por cima
          do conteúdo e some quando fechado, sem tomar a tela. Abre arrastando
          da borda esquerda; fecha arrastando para a esquerda. */}
      <MobileDrawer open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <div className="flex h-full flex-col overflow-y-auto overscroll-contain px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
          <div className="flex items-center justify-between">
            <Brand />
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              aria-label="Fechar menu"
            >
              <IconX size={20} />
            </button>
          </div>

          <ProfilePicker id="modelo-mobile" />

          <nav className="mt-6 flex flex-1 flex-col gap-1.5">
            {renderNav(false, () => setMobileMenuOpen(false))}
          </nav>
          
          <div className="mt-auto">
            <UserBox email={user?.email ?? null} onSignOut={() => { setMobileMenuOpen(false); signOut(); }} />
          </div>
        </div>
      </MobileDrawer>

      {/* Conteúdo. No mobile, o padding-top livra a barra superior fixa + o
          recorte da câmera; no desktop, lg:py-10 assume. */}
      <main className="min-w-0 flex-1 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(3.5rem+env(safe-area-inset-top))] lg:h-dvh lg:overflow-y-auto lg:px-10 lg:py-10 lg:pt-10">
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
        className="mt-2 flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-400 transition-all hover:bg-white/5 hover:text-zinc-200 [@media(pointer:coarse)]:min-h-[44px]"
      >
        <IconLogout size={16} />
        Sair
      </button>
    </div>
  );
}
