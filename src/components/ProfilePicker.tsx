"use client";

import Link from "next/link";
import { useProfile } from "@/context/ProfileContext";

/**
 * Seletor de modelo do menu — a escolha vale para o painel inteiro.
 *
 * Fica logo abaixo do "Buscar", na sidebar e no menu do celular, porque é o
 * mesmo tipo de controle: algo que acompanha você enquanto navega, e não
 * pertence a nenhuma tela em particular.
 */
export default function ProfilePicker({ id }: { id?: string }) {
  const { profiles, profileId, setProfileId, loading } = useProfile();

  if (loading) {
    return <div className="mt-3 h-9 animate-pulse rounded-lg bg-white/5" />;
  }
  if (profiles.length === 0) return null;

  return (
    <div className="mt-3">
      <label
        htmlFor={id}
        className="font-mono text-[10px] uppercase tracking-widest2 text-zinc-600"
      >
        Modelo
      </label>
      <select
        id={id}
        value={profileId}
        onChange={(e) => setProfileId(e.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 outline-none transition-colors hover:bg-white/[0.07] focus:border-white/30"
      >
        <option value="">Todas as modelos</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Estado vazio das telas que só funcionam com UMA modelo (Galeria, Telegram,
 * WhatsApp). Aparece quando o menu está em "Todas as modelos".
 *
 * Antes cada uma dessas telas escolhia a primeira modelo sozinha. Com o
 * seletor no menu isso viraria mentira: o menu diria "Todas" enquanto a tela
 * configuraria o bot de uma modelo específica — dá para mexer na modelo errada
 * sem perceber. Melhor pedir a escolha.
 */
export function PrecisaDeModelo({ oQue }: { oQue: string }) {
  const { profiles } = useProfile();
  return (
    <div className="mt-6 card p-8 text-center">
      <p className="text-sm text-zinc-300">Escolha uma modelo para {oQue}.</p>
      <p className="mx-auto mt-2 max-w-md text-xs text-zinc-500">
        {profiles.length === 0
          ? "Você ainda não tem modelos cadastradas."
          : "Use o seletor no menu, logo abaixo do Buscar — a escolha vale para todas as telas e fica salva."}
      </p>
      {profiles.length === 0 && (
        <Link href="/dashboard/profiles" className="btn-primary mt-4 inline-flex text-xs">
          Cadastrar modelo
        </Link>
      )}
    </div>
  );
}
