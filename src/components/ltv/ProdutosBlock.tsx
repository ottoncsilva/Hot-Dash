"use client";

import { useState } from "react";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import { IconPlus, IconTrash } from "@/components/icons";
import { apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import type { LtvAudio, LtvProduct } from "@/lib/ltvDb";

export type ProdutoEditavel = Omit<LtvProduct, "accountId" | "sortOrder"> & { id: string };

/**
 * Produtos, amostras e áudios — tudo o que a IA tem para OFERECER.
 *
 * O pagamento é sempre pela SyncPay: a IA gera a cobrança, manda o
 * copia-e-cola e o conteúdo sai sozinho quando o pagamento cai. Não existe
 * campo de chave pix aqui, e é de propósito — chave solta no meio da conversa
 * é venda que ninguém concilia depois.
 */
export default function ProdutosBlock({
  accountId,
  profileId,
  produtos,
  onProdutos,
  audios,
  onAudios,
  sampleMediaIds,
  onSampleMediaIds,
  maxDiscountPct,
  onMaxDiscountPct,
  podeCopiarDoWhatsapp,
}: {
  accountId: string;
  profileId: string;
  produtos: ProdutoEditavel[];
  onProdutos: (p: ProdutoEditavel[]) => void;
  audios: LtvAudio[];
  onAudios: (a: LtvAudio[]) => void;
  /** Ids da Galeria escolhidos como amostra/prévia. */
  sampleMediaIds: string[];
  onSampleMediaIds: (ids: string[]) => void;
  maxDiscountPct: number;
  onMaxDiscountPct: (v: number) => void;
  /** Some no WhatsApp: copiar da própria origem não faria sentido. */
  podeCopiarDoWhatsapp?: boolean;
}) {
  const [copiando, setCopiando] = useState(false);
  const [subindoAudio, setSubindoAudio] = useState(false);
  const [subindoAmostra, setSubindoAmostra] = useState(false);

  function alterar(id: string, patch: Partial<ProdutoEditavel>) {
    onProdutos(produtos.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function adicionar() {
    onProdutos([
      ...produtos,
      {
        // Id temporário: quem grava é o servidor, que devolve o definitivo.
        id: `novo-${Date.now()}`,
        name: "",
        priceCents: 0,
        description: "",
        deliveryKind: "media",
        extraMessage: "",
        mediaIds: [],
      },
    ]);
  }

  async function copiarDoWhatsapp() {
    setCopiando(true);
    try {
      const d = await apiSend<{ products: LtvProduct[] }>("/api/ltv/products", "POST", {
        accountId,
      });
      onProdutos(d.products.map((p) => ({ ...p })));
      showToast("Produtos copiados do WhatsApp.", "success");
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setCopiando(false);
    }
  }

  async function subirAudio(file: File) {
    setSubindoAudio(true);
    try {
      const form = new FormData();
      form.append("accountId", accountId);
      form.append("file", file);
      const res = await fetch("/api/ltv/audios", { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Falha ao enviar o áudio.");
      onAudios([...audios, d.audio]);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSubindoAudio(false);
    }
  }

  /** Upload direto pela tela: o arquivo entra na Galeria da modelo (mesma
   *  rota da tela de Mídia) e já sai marcado como amostra — sem precisar
   *  passar pela Galeria antes para depois voltar aqui e escolher. */
  async function subirAmostra(file: File) {
    setSubindoAmostra(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/profiles/${profileId}/media`, { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Falha ao enviar a amostra.");
      onSampleMediaIds([...sampleMediaIds, d.media.id]);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSubindoAmostra(false);
    }
  }

  async function removerAudio(id: string) {
    try {
      await apiSend(`/api/ltv/audios?id=${encodeURIComponent(id)}`, "DELETE");
      onAudios(audios.filter((a) => a.id !== id));
    } catch (e: any) {
      showToast(e.message, "error");
    }
  }

  async function salvarContexto(id: string, context: string) {
    onAudios(audios.map((a) => (a.id === id ? { ...a, context } : a)));
    try {
      await apiSend("/api/ltv/audios", "PATCH", { id, context });
    } catch {
      /* o contexto volta na próxima carga; não vale um toast de erro aqui */
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Amostras: escolhidas a dedo direto na Galeria — não mais por
          etiqueta. A cada prévia a IA sorteia uma destas, então cada lead vê
          uma foto diferente sem que a modelo precise pensar em etiquetar
          nada. */}
      <div className="rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] p-4">
        <p className="text-sm leading-relaxed text-zinc-300">
          <strong className="text-white">Amostras / prévias:</strong> a IA sorteia uma destas
          fotos para mandar como prévia leve e esquentar o lead. Escolha na Galeria ou suba uma
          foto nova direto por aqui.
        </p>
        <div className="mt-3">
          <MediaPicker
            profileId={profileId}
            selected={sampleMediaIds}
            onChange={onSampleMediaIds}
            apenasImagens
            max={30}
            onArquivo={subirAmostra}
            enviando={subindoAmostra}
          />
        </div>
      </div>

      {/* Áudio com a voz real é o que mais convence — e é o que um bot não faz. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-white">Áudios de voz da modelo</h3>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/5 [@media(pointer:coarse)]:min-h-[44px]">
            <IconPlus size={16} />
            {subindoAudio ? "Enviando..." : "Áudio"}
            <input
              type="file"
              accept=".mp3,.m4a,.ogg,.oga,.opus,.wav,audio/*"
              className="hidden"
              disabled={subindoAudio}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) subirAudio(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Grave áudios curtos com a voz REAL da modelo (saudação, saudade, provocação...) e dê um
          contexto a cada um. A IA manda o áudio certo na hora certa. MP3, M4A, OGG ou WAV.
        </p>

        {audios.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {audios.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls preload="none" src={`/api/ltv/audios/${a.id}/file`} className="h-9" />
                <input
                  className="input h-9 min-w-[10rem] flex-1"
                  placeholder="Contexto (ex: saudação)"
                  defaultValue={a.context}
                  onBlur={(e) => salvarContexto(a.id, e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removerAudio(a.id)}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  aria-label="Remover áudio"
                >
                  <IconTrash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm leading-relaxed text-zinc-300">
        A IA gera o <strong className="text-white">PIX na sua conta SyncPay</strong>, manda o
        código para o cliente e, quando o pagamento cai,{" "}
        <strong className="text-white">entrega o conteúdo automaticamente</strong>. A venda entra
        no seu faturamento. No Telegram o código vai em monoespaçado — o lead toca e já copia.
      </div>

      {/* O teto do desconto mora aqui, junto dos preços, porque é sobre eles
          que ele age. Sem teto, bastaria o lead insistir para o pacote sair
          por qualquer valor. */}
      <label className="block">
        <span className="eyebrow mb-1.5 block">Desconto máximo que a IA pode dar</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            className="input w-24"
            value={maxDiscountPct}
            onChange={(e) => onMaxDiscountPct(Number(e.target.value))}
          />
          <span className="text-sm text-zinc-400">%</span>
        </div>
        <span className="mt-1 block text-xs text-zinc-500">
          {maxDiscountPct > 0
            ? `Última cartada para não perder a venda: ela começa pelo valor cheio e só desce quando o lead está escapando. Um pacote de R$ 100 sai por no mínimo R$ ${(100 * (1 - maxDiscountPct / 100)).toFixed(2).replace(".", ",")}.`
            : "Zero = preço fixo. A IA não baixa de jeito nenhum, mesmo se o lead insistir."}
        </span>
      </label>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="eyebrow">Produtos</h3>
          {podeCopiarDoWhatsapp && (
            <button
              type="button"
              onClick={copiarDoWhatsapp}
              disabled={copiando}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/5 disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px]"
            >
              {copiando ? "Copiando..." : "Copiar do WhatsApp"}
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-4">
          {produtos.map((p) => (
            <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="Nome do produto"
                  value={p.name}
                  onChange={(e) => alterar(p.id, { name: e.target.value })}
                />
                <input
                  className="input w-28"
                  inputMode="decimal"
                  placeholder="29,90"
                  value={p.priceCents ? (p.priceCents / 100).toFixed(2).replace(".", ",") : ""}
                  onChange={(e) => {
                    const cents = Math.round(
                      Number(e.target.value.replace(/[^\d,.-]/g, "").replace(",", ".")) * 100,
                    );
                    alterar(p.id, { priceCents: Number.isFinite(cents) ? cents : 0 });
                  }}
                />
                <button
                  type="button"
                  onClick={() => onProdutos(produtos.filter((x) => x.id !== p.id))}
                  className="grid w-11 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  aria-label="Remover produto"
                >
                  <IconTrash size={16} />
                </button>
              </div>

              <input
                className="input mt-2"
                placeholder="Descrição — é o que a IA usa para vender"
                value={p.description}
                onChange={(e) => alterar(p.id, { description: e.target.value })}
              />

              <span className="eyebrow mt-3 block">O que ele recebe ao pagar</span>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => alterar(p.id, { deliveryKind: "media" })}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                    p.deliveryKind === "media"
                      ? "border-emerald-500 bg-emerald-500/10 text-white"
                      : "border-white/10 text-zinc-400 hover:bg-white/5"
                  }`}
                >
                  <span className="block font-semibold">Fotos e vídeos</span>
                  <span className="text-xs text-zinc-500">enviados sozinhos, na hora</span>
                </button>
                <button
                  type="button"
                  onClick={() => alterar(p.id, { deliveryKind: "videocall" })}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                    p.deliveryKind === "videocall"
                      ? "border-emerald-500 bg-emerald-500/10 text-white"
                      : "border-white/10 text-zinc-400 hover:bg-white/5"
                  }`}
                >
                  <span className="block font-semibold">Chamada de vídeo</span>
                  <span className="text-xs text-zinc-500">agendada ou na hora</span>
                </button>
              </div>

              {/* A ordem dos arquivos é parte do que foi vendido: a primeira
                  foto é a que segura o cliente enquanto as outras chegam. */}
              {p.deliveryKind === "media" && (
                <div className="mt-3">
                  <MediaPicker
                    profileId={profileId}
                    selected={p.mediaIds}
                    onChange={(ids) => alterar(p.id, { mediaIds: ids })}
                    max={30}
                  />
                </div>
              )}

              <input
                className="input mt-2"
                placeholder="Mensagem extra na entrega (opcional): link, combinado, agradecimento..."
                value={p.extraMessage}
                onChange={(e) => alterar(p.id, { extraMessage: e.target.value })}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={adicionar}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/5 [@media(pointer:coarse)]:min-h-[44px]"
        >
          <IconPlus size={16} /> Adicionar produto
        </button>
      </div>
    </div>
  );
}
