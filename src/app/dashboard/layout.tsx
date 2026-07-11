"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { href: "/dashboard", label: "Início", icon: "◆" },
  { href: "/dashboard/profiles", label: "Perfis", icon: "☺" },
  { href: "/dashboard/metadata", label: "Limpar Metadados", icon: "✦" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-brand-500" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-base-900/50 p-5 md:flex">
        <Brand />
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.href} {...item} active={isActive(item.href)} />
          ))}
        </nav>
        <UserBox email={user.email} onSignOut={signOut} />
      </aside>

      {/* Topbar (mobile) */}
      <header className="flex items-center justify-between border-b border-white/5 bg-base-900/70 px-4 py-3 backdrop-blur-xl safe-top md:hidden">
        <Brand compact />
        <button
          onClick={signOut}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300"
        >
          Sair
        </button>
      </header>

      {/* Conteúdo */}
      <main className="flex-1 px-4 py-6 md:px-10 md:py-10">{children}</main>

      {/* Nav inferior (mobile) */}
      <nav className="sticky bottom-0 flex items-center justify-around border-t border-white/5 bg-base-900/80 backdrop-blur-xl safe-bottom md:hidden">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-3 text-xs ${
              isActive(item.href) ? "text-brand-400" : "text-slate-400"
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 shadow-lg shadow-brand-600/30">
        <span className="font-bold text-white">H</span>
      </div>
      {!compact && (
        <span className="text-lg font-semibold tracking-tight text-white">
          Hot Dash
        </span>
      )}
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
        active
          ? "bg-white/10 text-white"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
    >
      <span className="text-base">{icon}</span>
      {label}
    </Link>
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
    <div className="mt-4 border-t border-white/5 pt-4">
      <p className="truncate px-1 text-xs text-slate-500">{email}</p>
      <button
        onClick={onSignOut}
        className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 transition-all hover:bg-white/5"
      >
        Sair
      </button>
    </div>
  );
}
