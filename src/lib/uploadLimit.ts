"use client";

import { useEffect, useState } from "react";

/**
 * LIMITE DE UPLOAD, DO LADO DO NAVEGADOR.
 *
 * O número mora no banco e é editado em Configurações → Geral. Aqui fica só a
 * cópia que a tela usa para recusar um arquivo grande ANTES de começar a subi-lo
 * — a validação acontece dos dois lados, e o servidor não é a primeira barreira.
 *
 * Por que não é mais uma constante: era `NEXT_PUBLIC_MAX_UPLOAD_MB`, embutida no
 * BUILD. Mudar o limite obrigava um redeploy inteiro, e no EasyPanel isso não é
 * óbvio — a variável estava lá, editável, sem efeito nenhum até o próximo deploy.
 *
 * O valor chega uma vez por sessão (`carregarLimiteUpload`, chamada no layout do
 * painel) e fica num módulo, não num contexto: `erroPadrao` em `api.ts` precisa
 * dele de forma síncrona, no meio do tratamento de um erro, onde não há hook.
 */

/** Enquanto o valor salvo não chega. É o mesmo padrão do servidor. */
export const UPLOAD_MB_PADRAO = 500;

let limiteMb = UPLOAD_MB_PADRAO;
const ouvintes = new Set<(mb: number) => void>();

export function limiteUploadMb(): number {
  return limiteMb;
}

export function limiteUploadBytes(): number {
  return limiteMb * 1024 * 1024;
}

/** Guarda o valor que veio do servidor e avisa quem estiver na tela. */
export function definirLimiteUpload(mb: unknown): void {
  const n = Math.round(Number(mb));
  if (!Number.isFinite(n) || n <= 0 || n === limiteMb) return;
  limiteMb = n;
  for (const f of ouvintes) f(n);
}

/** Busca o limite salvo. Chamada uma vez, no layout do painel. */
export async function carregarLimiteUpload(): Promise<void> {
  try {
    const r = await fetch("/api/settings/general", { credentials: "same-origin" });
    if (!r.ok) return;
    const d = (await r.json()) as { uploadLimitMb?: number };
    definirLimiteUpload(d.uploadLimitMb);
  } catch {
    // Sem resposta, segue com o padrão: recusar o upload por não saber o
    // limite seria pior do que deixar o servidor decidir.
  }
}

/** O limite em MB, já reagindo a quem o alterar em Configurações. */
export function useLimiteUpload(): number {
  const [mb, setMb] = useState(limiteMb);
  useEffect(() => {
    setMb(limiteMb);
    ouvintes.add(setMb);
    return () => {
      ouvintes.delete(setMb);
    };
  }, []);
  return mb;
}
