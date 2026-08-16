"use client";

import { useState } from "react";
import { apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { IconSearch } from "@/components/icons";

/**
 * "Detectar": escolher o grupo de uma lista em vez de caçar o ID numérico.
 *
 * A API do Telegram NÃO tem método que liste os grupos de um bot — não existe
 * "meus chats". A descoberta depende de ter visto um update vindo do grupo, e
 * com o bot já dentro dos grupos ANTES do cutover esse update nunca chegou:
 * era por isso que a lista nascia vazia mesmo com a conexão funcionando.
 *
 * Por isso o servidor parte dos IDs que já estão no cadastro da modelo e
 * RESOLVE cada um com o token (título de verdade e, principalmente, se o bot é
 * administrador ali). O `hint` explica o que falta quando algo não bate —
 * lista vazia sem motivo é pior que o campo manual que ela veio substituir.
 */
type Chat = {
  chatId: string;
  title?: string;
  type?: string;
  /** O bot é administrador ali? É o que decide se ele consegue operar. */
  isAdmin?: boolean;
  /** O bot enxerga o chat? Falso = ID errado ou bot removido do grupo. */
  reachable?: boolean;
  status?: string;
};

export default function DetectChat({
  profileId,
  onPick,
  /** O que está digitado no campo. Vai junto para o servidor poder conferir se
   *  o bot é admin num ID ainda NÃO salvo — sem isso só dava para descobrir
   *  depois de gravar. */
  atual,
}: {
  profileId: string;
  onPick: (chatId: string) => void;
  atual?: string;
}) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [hint, setHint] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function detectar() {
    setBusy(true);
    try {
      const r = await apiSend<{ ok: boolean; chats: Chat[]; hint?: string }>(
        "/api/telegram",
        "POST",
        { action: "detect-chats", profileId, extraChatId: atual || undefined },
      );
      setChats(r.chats || []);
      setHint(r.hint);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao detectar.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={detectar} disabled={busy} className="btn-ghost px-2.5 py-1.5 text-xs">
          <IconSearch size={14} /> {busy ? "Procurando..." : "Detectar"}
        </button>
        {chats !== null && (
          <button type="button" onClick={detectar} disabled={busy} className="btn-ghost px-2 py-1.5 text-xs">
            Atualizar
          </button>
        )}
      </div>

      {chats !== null && (
        <div className="mt-2 rounded-xl border border-white/10 bg-ink-850 p-2">
          {chats.length === 0 ? (
            <p className="px-1 py-2 text-[11px] leading-relaxed text-amber-300">
              {hint || "Nenhum grupo encontrado."}
            </p>
          ) : (
            <>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {chats.map((c) => (
                  <button
                    key={c.chatId}
                    type="button"
                    onClick={() => {
                      onPick(c.chatId);
                      setChats(null);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-zinc-200">
                        {c.title || (c.reachable ? "(sem título)" : "grupo não encontrado")}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-zinc-500">
                        {c.type === "channel" ? "canal" : c.type === "private" ? "privado" : "grupo"} ·{" "}
                        {c.chatId}
                      </span>
                    </span>
                    {/* O status de admin é o dado que decide se o bot consegue
                        operar naquele grupo — vale mais que o nome. */}
                    <span
                      className={`chip shrink-0 border text-[10px] ${
                        !c.reachable
                          ? "border-red-500/30 bg-red-500/10 text-red-300"
                          : c.isAdmin
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {!c.reachable ? "fora" : c.isAdmin ? "admin" : "sem admin"}
                    </span>
                  </button>
                ))}
              </div>
              {hint && <p className="mt-1.5 px-1 text-[11px] text-zinc-500">{hint}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
