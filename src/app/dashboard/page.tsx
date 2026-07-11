"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";

type Module = {
  href: string;
  title: string;
  desc: string;
  icon: string;
  status: "ativo" | "em breve";
};

const MODULES: Module[] = [
  {
    href: "/dashboard/metadata",
    title: "Limpar Metadados",
    desc: "Remova EXIF, GPS e rastros de IA de fotos e vídeos antes de publicar.",
    icon: "✦",
    status: "ativo",
  },
  {
    href: "#",
    title: "Gestão de Perfis",
    desc: "Cadastro das personagens de IA e suas redes sociais.",
    icon: "◆",
    status: "em breve",
  },
  {
    href: "#",
    title: "Cofre de Senhas",
    desc: "Logins e senhas das contas, guardados com criptografia.",
    icon: "⬢",
    status: "em breve",
  },
];

export default function DashboardHome() {
  const { user } = useAuth();
  const firstName = user?.email?.split("@")[0] ?? "";

  return (
    <div className="mx-auto max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-sm text-slate-400">Bem-vindo de volta</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
          Olá, <span className="capitalize">{firstName}</span> 👋
        </h1>
        <p className="mt-2 max-w-xl text-slate-400">
          Seu painel de ferramentas. Escolha um módulo para começar — novos
          serão adicionados conforme a necessidade.
        </p>
      </motion.div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m, i) => (
          <ModuleCard key={m.title} module={m} index={i} />
        ))}
      </div>
    </div>
  );
}

function ModuleCard({ module, index }: { module: Module; index: number }) {
  const isActive = module.status === "ativo";
  const inner = (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 * index }}
      className={`card group h-full p-5 transition-all ${
        isActive ? "hover:border-brand-500/40 hover:bg-white/[0.06]" : "opacity-70"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500/80 to-accent-500/80 text-lg text-white">
          {module.icon}
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs ${
            isActive
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-white/5 text-slate-400"
          }`}
        >
          {module.status}
        </span>
      </div>
      <h3 className="mt-4 text-lg font-medium text-white">{module.title}</h3>
      <p className="mt-1.5 text-sm text-slate-400">{module.desc}</p>
    </motion.div>
  );

  return isActive ? <Link href={module.href}>{inner}</Link> : inner;
}
