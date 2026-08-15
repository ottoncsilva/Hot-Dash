"use client";

import { useState } from "react";
import { apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { IconSearch } from "@/components/icons";

/**
 * "Detectar": escolher o grupo de uma lista em vez de caçar o ID numérico.
 *
 * A API do Telegram NÃO deixa um bot listar os próprios grupos — a única forma
 * de saber de um grupo é ter visto um update vindo dele. Por isso o servidor
 * junta os chats que o webhook já anotou com o que a fila do getUpdates ainda
 * tiver, e quando não encontra nada devolve um `hint` dizendo o que fazer
 * (normalmente: mandar uma mensagem no grupo e tentar de novo). Esse aviso é
 * mostrado aqui, porque uma lista vazia sem explicação é pior que o campo
 * manual que ela veio substituir.
 */
type Chat = { chatId: string; title?: string; type?: string };

export default function DetectChat({
  profileId,
  onPick,
}: {
  profileId: string;
  onPick: (chatId: string) => void;
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
        { action: "detect-chats", profileId },
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
      <button type="button" onClick={detectar} disabled={busy} className="btn-ghost px-2.5 py-1.5 text-xs">
        <IconSearch size={14} /> {busy ? "Procurando..." : "Detectar"}
      </button>

      {chats !== null && (
        <div className="mt-2 rounded-xl border border-white/10 bg-ink-850 p-2">
          {chats.length === 0 ? (
            <p className="px-1 py-2 text-[11px] leading-relaxed text-amber-300">
              {hint || "Nenhum grupo encontrado."}
            </p>
          ) : (
            <>
              <div className="max-h-48 space-y-1 overflow-y-auto">
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
                    <span className="min-w-0 truncate text-xs text-zinc-200">
                      {c.title || "(sem título)"}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">{c.chatId}</span>
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
